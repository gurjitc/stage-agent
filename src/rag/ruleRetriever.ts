import fs from "node:fs/promises";
import path from "node:path";
import { OllamaEmbeddings } from "@langchain/ollama";

export interface RuleChunk {
  id: string;
  docId: string;
  text: string;
  ruleIds: string[];
  metadata: {
    categories: string[];
    deliveryMethods: string[];
    tags: string[];
    fulfillmentProfiles: string[];
  };
}

export interface RetrievedChunk {
  chunk: RuleChunk;
  score: number;
  vectorScore: number;
  bm25Score: number;
  hybridScore: number;
  rerankScore: number;
}

export interface RetrievalConfig {
  topK?: number;
  candidateK?: number;
  useMetadataFilter?: boolean;
  useHybrid?: boolean;
  useRerank?: boolean;
}

export interface RetrievalResult {
  query: string;
  chunks: RetrievedChunk[];
  embeddingModel: string;
  vectorStore: "IN_MEMORY";
  retrievalMode: "VECTOR_ONLY" | "HYBRID";
  metadataFilterApplied: boolean;
  metadataHints: {
    categories: string[];
    deliveryMethods: string[];
    tags: string[];
  };
}

interface IndexedChunk {
  chunk: RuleChunk;
  vector: number[];
  tokens: string[];
}

interface BuildIndexResult {
  chunks: RuleChunk[];
  vectors: number[][];
  embeddingModel: string;
}

interface CorpusStats {
  docCount: number;
  avgDocLength: number;
  docFreq: Map<string, number>;
}

interface QueryMetadataHints {
  categories: string[];
  deliveryMethods: string[];
  tags: string[];
}

class InMemoryVectorStore {
  private readonly rows: IndexedChunk[] = [];
  private stats: CorpusStats = {
    docCount: 0,
    avgDocLength: 0,
    docFreq: new Map<string, number>()
  };

  add(chunks: RuleChunk[], vectors: number[][]): void {
    let totalDocLength = 0;
    const docFreq = new Map<string, number>();

    chunks.forEach((chunk, index) => {
      const tokens = tokenize(chunk.text);
      totalDocLength += tokens.length;

      const seenInDoc = new Set<string>();
      tokens.forEach((token) => {
        if (!seenInDoc.has(token)) {
          seenInDoc.add(token);
          docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
        }
      });

      this.rows.push({ chunk, vector: vectors[index] ?? [], tokens });
    });

    this.stats = {
      docCount: this.rows.length,
      avgDocLength: this.rows.length > 0 ? totalDocLength / this.rows.length : 0,
      docFreq
    };
  }

  similaritySearch(queryVector: number[], topK: number, queryText: string, config: RetrievalConfig): RetrievedChunk[] {
    const hints = inferMetadataHints(queryText);
    const useMetadataFilter = config.useMetadataFilter ?? true;
    const useHybrid = config.useHybrid ?? true;
    const useRerank = config.useRerank ?? true;
    const candidateK = config.candidateK ?? Math.max(topK * 3, 10);

    const filteredRows = useMetadataFilter ? this.rows.filter((row) => matchesMetadataHints(row.chunk, hints)) : this.rows;
    const rowsToScore = filteredRows.length > 0 ? filteredRows : this.rows;

    const queryTokens = tokenize(queryText);

    const scored = rowsToScore.map((row) => {
      const vectorScore = cosineSimilarity(queryVector, row.vector);
      const bm25Score = computeBm25Score(queryTokens, row.tokens, this.stats);
      return {
        row,
        vectorScore,
        bm25Score,
        hybridScore: vectorScore,
        rerankScore: vectorScore,
        score: vectorScore
      };
    });

    if (useHybrid) {
      const vectorNorm = minMaxNormalize(scored.map((s) => s.vectorScore));
      const bm25Norm = minMaxNormalize(scored.map((s) => s.bm25Score));

      scored.forEach((entry, index) => {
        const hybrid = 0.65 * (vectorNorm[index] ?? 0) + 0.35 * (bm25Norm[index] ?? 0);
        entry.hybridScore = hybrid;
        entry.score = hybrid;
      });
    }

    let ranked = scored.sort((a, b) => b.score - a.score).slice(0, candidateK);

    if (useRerank) {
      ranked = ranked
        .map((entry) => {
          const rerankBoost = lexicalCoverageScore(queryTokens, entry.row.tokens);
          const profileBoost = hints.tags.includes("refrigerated") && entry.row.chunk.text.toLowerCase().includes("cold_chain_2") ? 0.2 : 0;
          const rerankScore = entry.score + rerankBoost + profileBoost;
          return { ...entry, rerankScore, score: rerankScore };
        })
        .sort((a, b) => b.score - a.score);
    }

    return ranked.slice(0, topK).map((entry) => ({
      chunk: entry.row.chunk,
      score: entry.score,
      vectorScore: entry.vectorScore,
      bm25Score: entry.bm25Score,
      hybridScore: entry.hybridScore,
      rerankScore: entry.rerankScore
    }));
  }

  getHints(queryText: string): QueryMetadataHints {
    return inferMetadataHints(queryText);
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

function minMaxNormalize(values: number[]): number[] {
  if (values.length === 0) {
    return [];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) {
    return values.map(() => 0.5);
  }

  return values.map((v) => (v - min) / (max - min));
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

function extractMetadata(text: string): RuleChunk["metadata"] {
  const normalized = text.toLowerCase();

  const categories = ["tech", "grocery", "medical", "regular"].filter((c) => normalized.includes(c));
  const deliveryMethods = ["curbside", "pickup", "locker", "same_day", "same-day", "standard_delivery", "digital"]
    .filter((d) => normalized.includes(d))
    .map((d) => d.replace("same-day", "same_day"));

  const tags = ["refrigerated", "cold-chain", "fragile", "rush", "compliance"].filter((t) => normalized.includes(t));
  const fulfillmentProfiles = Array.from(new Set(normalized.match(/[a-z]+_[a-z0-9_]+/g) ?? [])).map((p) => p.toUpperCase());

  return {
    categories,
    deliveryMethods,
    tags,
    fulfillmentProfiles
  };
}

function inferMetadataHints(query: string): QueryMetadataHints {
  const normalized = query.toLowerCase();
  return {
    categories: ["tech", "grocery", "medical", "regular"].filter((c) => normalized.includes(c)),
    deliveryMethods: ["curbside", "pickup", "locker", "same day", "same-day", "digital"]
      .filter((d) => normalized.includes(d))
      .map((d) => d.replace("same day", "same_day").replace("same-day", "same_day")),
    tags: ["refrigerated", "milk", "eggs", "cold", "fragile"].filter((t) => normalized.includes(t))
  };
}

function hasAnyIntersection(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) {
    return false;
  }
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function matchesMetadataHints(chunk: RuleChunk, hints: QueryMetadataHints): boolean {
  const categoryMatch = hints.categories.length === 0 || hasAnyIntersection(chunk.metadata.categories, hints.categories);
  const deliveryMatch = hints.deliveryMethods.length === 0 || hasAnyIntersection(chunk.metadata.deliveryMethods, hints.deliveryMethods);

  const needsRefrigerated = hints.tags.some((t) => ["refrigerated", "milk", "eggs", "cold"].includes(t));
  const tagMatch = !needsRefrigerated || chunk.metadata.tags.some((t) => ["refrigerated", "cold-chain"].includes(t));

  return categoryMatch && deliveryMatch && tagMatch;
}

function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  tokens.forEach((token) => {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  });
  return tf;
}

function computeBm25Score(queryTokens: string[], docTokens: string[], stats: CorpusStats): number {
  if (queryTokens.length === 0 || docTokens.length === 0 || stats.docCount === 0 || stats.avgDocLength === 0) {
    return 0;
  }

  const tf = termFrequency(docTokens);
  const docLen = docTokens.length;
  const k1 = 1.2;
  const b = 0.75;

  let score = 0;
  for (const token of queryTokens) {
    const df = stats.docFreq.get(token) ?? 0;
    const termFreq = tf.get(token) ?? 0;
    if (termFreq === 0) {
      continue;
    }

    const idf = Math.log(1 + (stats.docCount - df + 0.5) / (df + 0.5));
    const numerator = termFreq * (k1 + 1);
    const denominator = termFreq + k1 * (1 - b + (b * docLen) / stats.avgDocLength);
    score += idf * (numerator / denominator);
  }

  return score;
}

function lexicalCoverageScore(queryTokens: string[], docTokens: string[]): number {
  if (queryTokens.length === 0 || docTokens.length === 0) {
    return 0;
  }

  const docSet = new Set(docTokens);
  const matched = queryTokens.filter((token) => docSet.has(token)).length;
  return (matched / queryTokens.length) * 0.25;
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
        ruleIds: extractRuleIds(chunkTextValue),
        metadata: extractMetadata(chunkTextValue)
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

export async function retrieveTopRuleChunks(query: string, topK = 5, config: RetrievalConfig = {}): Promise<RetrievalResult> {
  const store = await ensureVectorStore();
  const queryVector = await embedQuery(query);
  const chunks = store.similaritySearch(queryVector, topK, query, config);
  const hints = store.getHints(query);
  const useHybrid = config.useHybrid ?? true;
  const metadataFilterApplied = config.useMetadataFilter ?? true;

  return {
    query,
    chunks,
    embeddingModel: embeddingModelCache,
    vectorStore: "IN_MEMORY",
    retrievalMode: useHybrid ? "HYBRID" : "VECTOR_ONLY",
    metadataFilterApplied,
    metadataHints: hints
  };
}

export function getRuleCorpusStats(): { chunkCount: number; embeddingModel: string } {
  return {
    chunkCount: chunksCache?.length ?? 0,
    embeddingModel: embeddingModelCache
  };
}
