import "dotenv/config";
import { parseNaturalLanguageRequest } from "../agent/requestParser.js";
import { buildOrderPlanWithRag } from "./orderPlanRag.js";
import type { RetrievalConfig } from "./ruleRetriever.js";

interface EvalCase {
  id: string;
  request: string;
  expectedFulfillmentProfile: string | null;
  expectedRuleId: string | null;
}

interface EvalRunConfig {
  name: string;
  retrievalConfig: RetrievalConfig;
}

const evalCases: EvalCase[] = [
  {
    id: "cold-chain-curbside",
    request: "Create a curbside order with milk and eggs.",
    expectedFulfillmentProfile: "COLD_CHAIN_2",
    expectedRuleId: "R-011"
  },
  {
    id: "tech-generic",
    request: "Create a tech order to Dallas with calibration strips.",
    expectedFulfillmentProfile: null,
    expectedRuleId: "R-021"
  },
  {
    id: "grocery-curbside",
    request: "Create a curbside grocery order with refrigerated milk.",
    expectedFulfillmentProfile: "COLD_CHAIN_2",
    expectedRuleId: "R-027"
  }
];

const evalConfigs: EvalRunConfig[] = [
  {
    name: "vector-only-no-filter",
    retrievalConfig: {
      useHybrid: false,
      useMetadataFilter: false,
      useRerank: false,
      candidateK: 5
    }
  },
  {
    name: "hybrid-plus-metadata",
    retrievalConfig: {
      useHybrid: true,
      useMetadataFilter: true,
      useRerank: false,
      candidateK: 10
    }
  },
  {
    name: "hybrid-metadata-rerank",
    retrievalConfig: {
      useHybrid: true,
      useMetadataFilter: true,
      useRerank: true,
      candidateK: 12
    }
  }
];

async function evaluateCase(evalCase: EvalCase, config: EvalRunConfig): Promise<{
  caseId: string;
  config: string;
  pass: boolean;
  expectedProfile: string | null;
  actualProfile: string | null;
  expectedRuleId: string | null;
  citedRuleIds: string[];
  topChunkIds: string[];
  retrievalMode: string;
  metadataHints: { categories: string[]; deliveryMethods: string[]; tags: string[] };
}> {
  const parsed = parseNaturalLanguageRequest(evalCase.request);
  const result = await buildOrderPlanWithRag({
    request: evalCase.request,
    parsedRequest: parsed,
    retrievalConfig: config.retrievalConfig,
    forceFallbackPlanner: true
  });

  const actualProfile = result.plan.fulfillmentProfile;
  const citedRuleIds = result.plan.citedRuleIds;

  const profilePass = evalCase.expectedFulfillmentProfile === actualProfile;
  const rulePass = !evalCase.expectedRuleId || citedRuleIds.includes(evalCase.expectedRuleId);
  const pass = profilePass && rulePass;

  return {
    caseId: evalCase.id,
    config: config.name,
    pass,
    expectedProfile: evalCase.expectedFulfillmentProfile,
    actualProfile,
    expectedRuleId: evalCase.expectedRuleId,
    citedRuleIds,
    topChunkIds: result.retrievedChunks.map((chunk) => chunk.chunk.id),
    retrievalMode: result.retrieval.mode,
    metadataHints: result.retrieval.metadataHints
  };
}

async function main(): Promise<void> {
  const rows = [] as Array<Awaited<ReturnType<typeof evaluateCase>>>;

  for (const config of evalConfigs) {
    for (const evalCase of evalCases) {
      rows.push(await evaluateCase(evalCase, config));
    }
  }

  const summary = evalConfigs.map((config) => {
    const scoped = rows.filter((row) => row.config === config.name);
    const passed = scoped.filter((row) => row.pass).length;
    return {
      config: config.name,
      passed,
      total: scoped.length,
      accuracy: Number((passed / scoped.length).toFixed(3))
    };
  });

  console.log(
    JSON.stringify(
      {
        summary,
        rows
      },
      null,
      2
    )
  );
}

main().catch((error: unknown) => {
  console.error("RAG eval failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
