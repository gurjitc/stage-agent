import "dotenv/config";
import { parseNaturalLanguageRequest } from "../agent/requestParser.js";
import { buildOrderPlanWithRag } from "./orderPlanRag.js";
import type { RetrievalConfig } from "./ruleRetriever.js";

interface EvalCase {
  id: string;
  request: string;
  expectedFulfillmentProfile: string | null;
  expectedRuleId: string | null;
  forbiddenFulfillmentProfiles?: string[];
  forbiddenRuleIds?: string[];
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
  },
  {
    id: "tech-lexical-trap-milk-frother",
    request: "Create a pickup tech order with a milk frother and egg timer.",
    expectedFulfillmentProfile: null,
    expectedRuleId: "R-021",
    forbiddenFulfillmentProfiles: ["COLD_CHAIN_2", "COLD_CHAIN_3"],
    forbiddenRuleIds: ["R-011", "R-026"]
  },
  {
    id: "rush-priority-order",
    request: "Create a rush priority grocery order for pantry staples.",
    expectedFulfillmentProfile: null,
    expectedRuleId: "R-031",
    forbiddenFulfillmentProfiles: ["COLD_CHAIN_2", "COLD_CHAIN_3"]
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
  profilePass: boolean;
  rulePass: boolean;
  negativePass: boolean;
  expectedProfile: string | null;
  actualProfile: string | null;
  expectedRuleId: string | null;
  citedRuleIds: string[];
  retrievedRuleIds: string[];
  expectedRuleRank: number | null;
  hitAt5: boolean | null;
  reciprocalRank: number | null;
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
  const retrievedRuleIds = Array.from(new Set(result.retrievedChunks.flatMap((chunk) => chunk.chunk.ruleIds)));
  const expectedRuleRank = evalCase.expectedRuleId ? retrievedRuleIds.indexOf(evalCase.expectedRuleId) + 1 : null;
  const hitAt5 = evalCase.expectedRuleId ? expectedRuleRank !== null && expectedRuleRank > 0 && expectedRuleRank <= 5 : null;
  const reciprocalRank = expectedRuleRank && expectedRuleRank > 0 ? 1 / expectedRuleRank : null;

  const profilePass = evalCase.expectedFulfillmentProfile === actualProfile;
  const rulePass = !evalCase.expectedRuleId || citedRuleIds.includes(evalCase.expectedRuleId);
  const forbiddenProfiles = evalCase.forbiddenFulfillmentProfiles ?? [];
  const forbiddenRules = evalCase.forbiddenRuleIds ?? [];
  const negativeProfilePass = !actualProfile || !forbiddenProfiles.includes(actualProfile);
  const negativeRulePass = forbiddenRules.every((ruleId) => !citedRuleIds.includes(ruleId));
  const negativePass = negativeProfilePass && negativeRulePass;

  const pass = profilePass && rulePass && negativePass;

  return {
    caseId: evalCase.id,
    config: config.name,
    pass,
    profilePass,
    rulePass,
    negativePass,
    expectedProfile: evalCase.expectedFulfillmentProfile,
    actualProfile,
    expectedRuleId: evalCase.expectedRuleId,
    citedRuleIds,
    retrievedRuleIds,
    expectedRuleRank,
    hitAt5,
    reciprocalRank,
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
    const retrievalEligible = scoped.filter((row) => row.expectedRuleId !== null);
    const retrievalHits = retrievalEligible.filter((row) => row.hitAt5 === true).length;
    const rrValues = retrievalEligible
      .map((row) => row.reciprocalRank)
      .filter((v): v is number => typeof v === "number");
    const negativeChecks = scoped.filter((row) => {
      const evalCase = evalCases.find((c) => c.id === row.caseId);
      return (evalCase?.forbiddenFulfillmentProfiles?.length ?? 0) > 0 || (evalCase?.forbiddenRuleIds?.length ?? 0) > 0;
    });
    const negativePassCount = negativeChecks.filter((row) => row.negativePass).length;

    return {
      config: config.name,
      passed,
      total: scoped.length,
      accuracy: Number((passed / scoped.length).toFixed(3)),
      hitAt5: retrievalEligible.length > 0 ? Number((retrievalHits / retrievalEligible.length).toFixed(3)) : null,
      mrr: rrValues.length > 0 ? Number((rrValues.reduce((acc, v) => acc + v, 0) / rrValues.length).toFixed(3)) : null,
      negativePassRate:
        negativeChecks.length > 0 ? Number((negativePassCount / negativeChecks.length).toFixed(3)) : null
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
