import "dotenv/config";
import { parseNaturalLanguageRequest } from "../agent/requestParser.js";
import { buildOrderPlanWithRag } from "./orderPlanRag.js";

interface BaselinePlan {
  fulfillmentProfile: string | null;
  rationale: string;
}

function buildBaselinePlanWithoutRetrieval(request: string): BaselinePlan {
  const normalized = request.toLowerCase();
  const hasCurbside = normalized.includes("curbside");
  const hasRefrigeratedHints = /\bmilk\b|\beggs?\b|\brefrigerated\b/.test(normalized);

  if (hasCurbside && hasRefrigeratedHints) {
    return {
      fulfillmentProfile: null,
      rationale:
        "Baseline planner sees curbside + refrigerated hints but has no rule corpus, so it cannot infer the required fulfillment profile."
    };
  }

  return {
    fulfillmentProfile: null,
    rationale: "Baseline planner has no retrieval context; no deterministic profile inferred."
  };
}

async function main(): Promise<void> {
  const request = process.argv.slice(2).join(" ").trim() || "Create a curbside order with milk and eggs.";
  const parsed = parseNaturalLanguageRequest(request);

  const withoutRag = buildBaselinePlanWithoutRetrieval(request);
  const withRag = await buildOrderPlanWithRag({ request, parsedRequest: parsed });

  const output = {
    request,
    withoutRag,
    withRag: {
      fulfillmentProfile: withRag.plan.fulfillmentProfile,
      suggestedItems: withRag.plan.suggestedItems,
      citedRuleIds: withRag.plan.citedRuleIds,
      rationale: withRag.plan.rationale,
      retrievedTopChunks: withRag.retrievedChunks.map((entry) => ({
        chunkId: entry.chunk.id,
        docId: entry.chunk.docId,
        score: Number(entry.score.toFixed(4)),
        ruleIds: entry.chunk.ruleIds,
        preview: entry.chunk.text.slice(0, 180)
      })),
      embeddingModel: withRag.embeddingModel,
      vectorStore: withRag.vectorStore,
      usedLlm: withRag.usedLlm,
      retrieval: withRag.retrieval
    }
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error: unknown) => {
  console.error("RAG demo failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
