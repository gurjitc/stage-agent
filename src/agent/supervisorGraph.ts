import { Annotation, StateGraph } from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";
import { z } from "zod";
import { runStagingOrderAgent, type AgentRunResult } from "./stagingOrderGraph.js";

type SupervisorIntent = "CREATE_STAGING_ORDER" | "UNKNOWN";

const intentSchema = z.object({
  intent: z.enum(["CREATE_STAGING_ORDER", "UNKNOWN"]),
  reason: z.string().min(1)
});

const SupervisorState = Annotation.Root({
  request: Annotation<string>(),
  intent: Annotation<SupervisorIntent | null>(),
  reasoning: Annotation<string[]>({
    reducer: (current, update) => current.concat(update),
    default: () => []
  }),
  result: Annotation<AgentRunResult | null>()
});

type SupervisorStateType = typeof SupervisorState.State;

function classifyIntent(text: string): SupervisorIntent {
  const normalized = text.toLowerCase();
  const orderSignals = ["order", "staging", "ship", "delivery", "sku", "qty", "quantity", "grocery", "tech", "medical"];
  const matched = orderSignals.some((signal) => normalized.includes(signal));
  return matched ? "CREATE_STAGING_ORDER" : "UNKNOWN";
}

async function classifyIntentWithLlm(text: string): Promise<{
  intent: SupervisorIntent;
  reason: string;
  usedLlm: boolean;
}> {
  const llmClassifierEnabled = (process.env.SUPERVISOR_LLM_CLASSIFIER ?? "true").toLowerCase() !== "false";

  if (!llmClassifierEnabled) {
    return {
      intent: classifyIntent(text),
      reason: "LLM classifier disabled by SUPERVISOR_LLM_CLASSIFIER; used rules fallback.",
      usedLlm: false
    };
  }

  const model = process.env.OLLAMA_MODEL ?? "qwen3:8b";
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";

  try {
    const llm = new ChatOllama({ model, baseUrl, temperature: 0 });
    const classifier = llm.withStructuredOutput(intentSchema);

    const result = await classifier.invoke([
      "You are an intent router for a staging order backend.",
      "Choose CREATE_STAGING_ORDER only when the user asks to create/build/generate a staging or test order.",
      "Choose UNKNOWN for anything else (status checks, chit-chat, unrelated questions).",
      `User request: ${text}`
    ].join("\n\n"));

    return {
      intent: result.intent,
      reason: result.reason,
      usedLlm: true
    };
  } catch {
    return {
      intent: classifyIntent(text),
      reason: "LLM classifier unavailable; used rules fallback.",
      usedLlm: false
    };
  }
}

async function classifyNode(state: SupervisorStateType): Promise<Partial<SupervisorStateType>> {
  const classification = await classifyIntentWithLlm(state.request);
  const intent = classification.intent;

  return {
    intent,
    reasoning: [
      intent === "CREATE_STAGING_ORDER"
        ? classification.usedLlm
          ? `Supervisor used LLM intent classification and routed to staging-order creation (${classification.reason}).`
          : "Supervisor classified this as a staging-order creation request and delegated to the order orchestration graph."
        : classification.usedLlm
          ? `Supervisor used LLM intent classification and did not route to order creation (${classification.reason}).`
          : "Supervisor could not confidently map this request to staging-order creation."
    ]
  };
}

async function delegateNode(state: SupervisorStateType): Promise<Partial<SupervisorStateType>> {
  if (state.intent !== "CREATE_STAGING_ORDER") {
    throw new Error(
      "Supervisor could not route this request. Try a staging-order prompt like 'Create a tech order for Northwind Labs to Dallas'."
    );
  }

  const result = await runStagingOrderAgent(state.request);

  return {
    result: {
      ...result,
      reasoning: [...state.reasoning, ...result.reasoning]
    }
  };
}

const supervisorGraph = new StateGraph(SupervisorState)
  .addNode("classify_intent", classifyNode)
  .addNode("delegate", delegateNode)
  .addEdge("__start__", "classify_intent")
  .addEdge("classify_intent", "delegate")
  .addEdge("delegate", "__end__")
  .compile();

export async function runSupervisorAgent(request: string): Promise<AgentRunResult> {
  const finalState = await supervisorGraph.invoke({
    request,
    intent: null,
    reasoning: [],
    result: null
  });

  if (!finalState.result) {
    throw new Error("Supervisor finished without producing a delegated result.");
  }

  return finalState.result;
}
