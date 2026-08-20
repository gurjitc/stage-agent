import { ChatOllama } from "@langchain/ollama";
import { z } from "zod";
import type { OrderCategory, ParsedOrderRequest } from "../types.js";
import { retrieveTopRuleChunks, type RetrievedChunk, type RetrievalConfig } from "./ruleRetriever.js";

export interface OrderPlan {
  fulfillmentProfile: string | null;
  suggestedItems: Array<{
    itemText: string;
    quantity: number;
  }>;
  citedRuleIds: string[];
  rationale: string;
}

export interface RagOrderPlanResult {
  plan: OrderPlan;
  retrievedChunks: RetrievedChunk[];
  embeddingModel: string;
  vectorStore: "IN_MEMORY";
  usedLlm: boolean;
  retrieval: {
    mode: "VECTOR_ONLY" | "HYBRID";
    metadataFilterApplied: boolean;
    metadataHints: {
      categories: string[];
      deliveryMethods: string[];
      tags: string[];
    };
  };
}

const orderPlanSchema = z.object({
  fulfillmentProfile: z.string().nullable(),
  suggestedItems: z
    .array(
      z.object({
        itemText: z.string().min(2),
        quantity: z.number().int().positive()
      })
    )
    .default([]),
  citedRuleIds: z.array(z.string()).default([]),
  rationale: z.string().min(1)
});

function hasColdIntent(request: string): boolean {
  const normalized = request.toLowerCase();
  const explicitCold = /\brefrigerated\b|\bcold\b|\bfrozen\b|\bchilled\b|\bperishable\b/.test(normalized);
  const foodLexical = /\bmilk\b|\beggs?\b/.test(normalized);
  const techLexical = /\btech\b|\belectronic\w*\b|\bappliance\w*\b|\bfrother\b|\btimer\b|\bdevice\b/.test(normalized);
  return explicitCold || (foodLexical && !techLexical);
}

function getRuleIds(chunks: RetrievedChunk[], request: string, fulfillmentProfile: string | null): string[] {
  const normalized = request.toLowerCase();
  const coldIntent = hasColdIntent(request);
  const rushIntent = /\brush\b|\bpriority\b|\bsla\b|\burgent\b/.test(normalized);

  const relevantChunks = chunks.filter((entry) => {
    const text = entry.chunk.text.toLowerCase();

    if (fulfillmentProfile && text.includes(fulfillmentProfile.toLowerCase())) {
      return true;
    }

    if (!coldIntent && /cold_chain_\d/.test(text)) {
      return false;
    }

    if (normalized.includes("tech") && !text.includes("tech") && !text.includes("fragile")) {
      return false;
    }

    if (normalized.includes("digital") && !text.includes("digital")) {
      return false;
    }

    if (rushIntent && !/\brush\b|\bpriority\b|\bsla\b/.test(text)) {
      return false;
    }

    return true;
  });

  const source = relevantChunks.length > 0 ? relevantChunks : chunks.slice(0, 2);
  return Array.from(new Set(source.flatMap((c) => c.chunk.ruleIds)));
}

function inferFallbackPlan(request: string, category: OrderCategory, chunks: RetrievedChunk[]): OrderPlan {
  const normalized = request.toLowerCase();
  const chunkText = chunks.map((c) => c.chunk.text.toLowerCase()).join("\n\n");
  const rushIntent = /\brush\b|\bpriority\b|\bsla\b|\burgent\b/.test(normalized);

  const suggestsMilk = /\bmilk\b/.test(normalized);
  const suggestsEggs = /\beggs?\b/.test(normalized);
  const isCurbside = /\bcurbside\b/.test(normalized);
  const mentionsRefrigerated = /\brefrigerated\b|\bchilled\b/.test(normalized);

  let fulfillmentProfile: string | null = null;
  if ((suggestsMilk || suggestsEggs || mentionsRefrigerated) && isCurbside && chunkText.includes("cold_chain_2")) {
    fulfillmentProfile = "COLD_CHAIN_2";
  }

  const suggestedItems: Array<{ itemText: string; quantity: number }> = [];
  if (suggestsMilk) {
    suggestedItems.push({ itemText: "milk", quantity: 1 });
  }
  if (suggestsEggs) {
    suggestedItems.push({ itemText: "eggs", quantity: 1 });
  }

  if (suggestedItems.length === 0) {
    if (category === "TECH") {
      suggestedItems.push({ itemText: "calibration strip", quantity: 1 });
    } else if (category === "GROCERY") {
      suggestedItems.push({ itemText: "milk", quantity: 1 });
    }
  }

  let citedRuleIds = getRuleIds(chunks, request, fulfillmentProfile);
  if (rushIntent) {
    const priorityRuleIds = chunks
      .filter((entry) => /\brush\b|\bpriority\b|\bsla\b/.test(entry.chunk.text.toLowerCase()))
      .flatMap((entry) => entry.chunk.ruleIds);
    citedRuleIds = Array.from(new Set([...citedRuleIds, ...priorityRuleIds]));
  }

  return {
    fulfillmentProfile,
    suggestedItems,
    citedRuleIds,
    rationale:
      fulfillmentProfile === "COLD_CHAIN_2"
        ? "Applied refrigerated curbside rule from retrieved context."
        : "Fallback planner used retrieved rule context and request terms."
  };
}

export async function buildOrderPlanWithRag(input: {
  request: string;
  parsedRequest: ParsedOrderRequest;
  retrievalConfig?: RetrievalConfig;
  forceFallbackPlanner?: boolean;
}): Promise<RagOrderPlanResult> {
  const retrieval = await retrieveTopRuleChunks(input.request, 5, input.retrievalConfig ?? {});

  if (input.forceFallbackPlanner || (process.env.RAG_USE_LLM_PLANNER ?? "true").toLowerCase() === "false") {
    return {
      plan: inferFallbackPlan(input.request, input.parsedRequest.orderCategory, retrieval.chunks),
      retrievedChunks: retrieval.chunks,
      embeddingModel: retrieval.embeddingModel,
      vectorStore: retrieval.vectorStore,
      usedLlm: false,
      retrieval: {
        mode: retrieval.retrievalMode,
        metadataFilterApplied: retrieval.metadataFilterApplied,
        metadataHints: retrieval.metadataHints
      }
    };
  }

  const model = process.env.OLLAMA_MODEL ?? "qwen3:8b";
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";

  try {
    const llm = new ChatOllama({ model, baseUrl, temperature: 0 });
    const planner = llm.withStructuredOutput(orderPlanSchema);

    const context = retrieval.chunks
      .map((entry, index) => {
        const rules = entry.chunk.ruleIds.join(", ");
        return `Chunk ${index + 1} (score=${entry.score.toFixed(4)}, doc=${entry.chunk.docId}, rules=${rules}):\n${entry.chunk.text}`;
      })
      .join("\n\n");

    const plan = await planner.invoke([
      "You are generating an OrderPlan for a synthetic staging backend.",
      "Use ONLY retrieved context for rule-based decisions. Do not invent rule IDs.",
      "If a rule clearly requires a fulfillment profile, set fulfillmentProfile.",
      "If request has generic products (e.g. milk, eggs), include suggestedItems.",
      `User request: ${input.request}`,
      `Retrieved context:\n${context}`
    ].join("\n\n"));

    return {
      plan: {
        fulfillmentProfile: plan.fulfillmentProfile,
        suggestedItems: plan.suggestedItems ?? [],
        citedRuleIds: plan.citedRuleIds ?? [],
        rationale: plan.rationale
      },
      retrievedChunks: retrieval.chunks,
      embeddingModel: retrieval.embeddingModel,
      vectorStore: retrieval.vectorStore,
      usedLlm: true,
      retrieval: {
        mode: retrieval.retrievalMode,
        metadataFilterApplied: retrieval.metadataFilterApplied,
        metadataHints: retrieval.metadataHints
      }
    };
  } catch {
    return {
      plan: inferFallbackPlan(input.request, input.parsedRequest.orderCategory, retrieval.chunks),
      retrievedChunks: retrieval.chunks,
      embeddingModel: retrieval.embeddingModel,
      vectorStore: retrieval.vectorStore,
      usedLlm: false,
      retrieval: {
        mode: retrieval.retrievalMode,
        metadataFilterApplied: retrieval.metadataFilterApplied,
        metadataHints: retrieval.metadataHints
      }
    };
  }
}
