import fs from "node:fs/promises";
import path from "node:path";
import { OllamaEmbeddings } from "@langchain/ollama";

export interface RuleChunk {
  id: string;
  docId: string;
  text: string;
  ruleIds: string[];
}

export interface RetrievedChunk {
  chunk: RuleChunk;
  score: number;
}

export interface RetrievalResult {
  query: string;
  chunks: RetrievedChunk[];
  embeddingModel: string;
  vectorStore: "IN_MEMORY";
}

interface IndexedChunk {
  chunk: RuleChunk;
  vector: number[];
}

interface BuildIndexResult {
  chunks: RuleChunk[];
  vectors: number[][];
  embeddingModel: string;
}

class InMemoryVectorStore {
  private readonly rows: IndexedChunk[] = [];

  add(chunks: RuleChunk[], vectors: number[][]): void {
    chunks.forEach((chunk, index) => {
      this.rows.push({ chunk, vector: vectors[index] ?? [] });
    });
  }

  similaritySearch(queryVector: number[], topK: number): RetrievedChunk[] {
    return this.rows
      .map((row) => ({ chunk: row.chunk, score: cosineSimilarity(queryVector, row.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

const RULES_DIR = path.resolve(process.cwd(), "docs/synthetic-staging-rules");
const CHUNK_SIZE = 520;
const CHUNK_OVERLAP = 90;
const FALLBACK_EMBED_DIM = 256;

let vectorStoreCache: InMemoryVectorStore | null = null;
let chunksCache: RuleChunk[] | null = null;
let embeddingModelCache = "LOCAL_HASH_EMBED_V1";

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
}

function hashToken(token: string, dim: number): number {
  let h = 0;
  for (let i = 0; i < token.length; i += 1) {
    h = (h * 31 + token.charCodeAt(i)) >>> 0;
  }
  return h % dim;
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((acc, n) => acc + n * n, 0));
  if (magnitude === 0) {
    return vector;
  }
  return vector.map((n) => n / magnitude);
}

function hashEmbed(text: string, dim = FALLBACK_EMBED_DIM): number[] {
  const vector = new Array<number>(dim).fill(0);
  for (const token of tokenize(text)) {
    vector[hashToken(token, dim)] += 1;
  }
  return normalizeVector(vector);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot;
}

function extractRuleIds(text: string): string[] {
  return Array.from(new Set(text.match(/R-\d{3}/g) ?? []));
}

function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n");
  const paragraphs = clean.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;

    if (candidate.length <= CHUNK_SIZE) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
    }

    if (paragraph.length <= CHUNK_SIZE) {
      current = paragraph;
      continue;
    }

    let start = 0;
    while (start < paragraph.length) {
      const end = Math.min(start + CHUNK_SIZE, paragraph.length);
      const slice = paragraph.slice(start, end).trim();
      if (slice) {
        chunks.push(slice);
      }
      if (end === paragraph.length) {
        break;
      }
      start = Math.max(end - CHUNK_OVERLAP, start + 1);
    }

    current = "";
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

async function readRuleChunks(): Promise<RuleChunk[]> {
  const files = (await fs.readdir(RULES_DIR)).filter((f) => f.endsWith(".md")).sort();
  const chunks: RuleChunk[] = [];

  for (const file of files) {
    const filePath = path.join(RULES_DIR, file);
    const text = await fs.readFile(filePath, "utf8");
    const split = chunkText(text);

    split.forEach((chunkTextValue, index) => {
      chunks.push({
        id: `${file.replace(/\.md$/, "")}-chunk-${index + 1}`,
        docId: file,
        text: chunkTextValue,
        ruleIds: extractRuleIds(chunkTextValue)
      });
    });
  }

  return chunks;
}

async function buildEmbeddingIndex(chunks: RuleChunk[]): Promise<BuildIndexResult> {
  const texts = chunks.map((chunk) => chunk.text);

  if ((process.env.RAG_USE_OLLAMA_EMBEDDINGS ?? "true").toLowerCase() !== "false") {
    const model = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
    const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";

    try {
      const embeddings = new OllamaEmbeddings({ model, baseUrl });
      const vectors = await embeddings.embedDocuments(texts);
      return {
        chunks,
        vectors,
        embeddingModel: `OLLAMA:${model}`
      };
    } catch {
      // Fall through to deterministic local embeddings.
    }
  }

  return {
    chunks,
    vectors: texts.map((text) => hashEmbed(text)),
    embeddingModel: "LOCAL_HASH_EMBED_V1"
  };
}

async function ensureVectorStore(): Promise<InMemoryVectorStore> {
  if (vectorStoreCache) {
    return vectorStoreCache;
  }

  const chunks = await readRuleChunks();
  const built = await buildEmbeddingIndex(chunks);

  const store = new InMemoryVectorStore();
  store.add(built.chunks, built.vectors);

  chunksCache = built.chunks;
  embeddingModelCache = built.embeddingModel;
  vectorStoreCache = store;

  return store;
}

async function embedQuery(query: string): Promise<number[]> {
  if (embeddingModelCache.startsWith("OLLAMA:")) {
    const model = embeddingModelCache.replace("OLLAMA:", "");
    const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";

    try {
      const embeddings = new OllamaEmbeddings({ model, baseUrl });
      return await embeddings.embedQuery(query);
    } catch {
      return hashEmbed(query);
    }
  }

  return hashEmbed(query);
}

export async function retrieveTopRuleChunks(query: string, topK = 5): Promise<RetrievalResult> {
  const store = await ensureVectorStore();
  const queryVector = await embedQuery(query);
  const chunks = store.similaritySearch(queryVector, topK);

  return {
    query,
    chunks,
    embeddingModel: embeddingModelCache,
    vectorStore: "IN_MEMORY"
  };
}

export function getRuleCorpusStats(): { chunkCount: number; embeddingModel: string } {
  return {
    chunkCount: chunksCache?.length ?? 0,
    embeddingModel: embeddingModelCache
  };
}
