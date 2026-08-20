import { Annotation, StateGraph } from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";
import { z } from "zod";
import { runStagingOrderAgent, type AgentRunResult } from "./stagingOrderGraph.js";
import { getStagingOrder } from "../api/stagingApi.js";
import type { StagingOrder } from "../types.js";

type SupervisorIntent = "CREATE_STAGING_ORDER" | "ORDER_STATUS" | "UNKNOWN";

export interface SupervisorRunResult {
  intent: SupervisorIntent;
  reasoning: string[];
  order: StagingOrder | null;
  parsedRequest: AgentRunResult["parsedRequest"] | null;
  message: string;
}

const intentSchema = z.object({
  intent: z.enum(["CREATE_STAGING_ORDER", "ORDER_STATUS", "UNKNOWN"]),
  reason: z.string().min(1)
});

const SupervisorState = Annotation.Root({
  request: Annotation<string>(),
  intent: Annotation<SupervisorIntent | null>(),
  reasoning: Annotation<string[]>({
    reducer: (current, update) => current.concat(update),
    default: () => []
  }),
  result: Annotation<SupervisorRunResult | null>()
});

type SupervisorStateType = typeof SupervisorState.State;

function classifyIntent(text: string): SupervisorIntent {
  const normalized = text.toLowerCase();

  const statusSignals = ["status", "track", "lookup", "check", "find"];
  const hasOrderId = /\bSO-\d+\b/i.test(text);
  if (hasOrderId && statusSignals.some((signal) => normalized.includes(signal))) {
    return "ORDER_STATUS";
  }

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
      "Choose ORDER_STATUS when the user asks for status/lookup/tracking of an order and includes an order id like SO-5001.",
      "Choose UNKNOWN for chit-chat or unrelated questions.",
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
        : intent === "ORDER_STATUS"
          ? classification.usedLlm
            ? `Supervisor used LLM intent classification and routed to order-status lookup (${classification.reason}).`
            : "Supervisor classified this as an order-status request and delegated to status lookup."
        : classification.usedLlm
          ? `Supervisor used LLM intent classification and routed to generic help (${classification.reason}).`
          : "Supervisor could not confidently map this request to a known operation, so it returned guidance."
    ]
  };
}

function extractOrderId(text: string): string | null {
  const match = text.match(/\bSO-\d+\b/i);
  return match?.[0]?.toUpperCase() ?? null;
}

async function delegateNode(state: SupervisorStateType): Promise<Partial<SupervisorStateType>> {
  if (state.intent === "CREATE_STAGING_ORDER") {
    const result = await runStagingOrderAgent(state.request);

    return {
      result: {
        intent: "CREATE_STAGING_ORDER",
        order: result.order,
        parsedRequest: result.parsedRequest,
        reasoning: [...state.reasoning, ...result.reasoning],
        message: "Created staging order successfully."
      }
    };
  }

  if (state.intent === "ORDER_STATUS") {
    const orderId = extractOrderId(state.request);
    if (!orderId) {
      return {
        result: {
          intent: "ORDER_STATUS",
          order: null,
          parsedRequest: null,
          reasoning: state.reasoning,
          message: "I can check status if you include an order id, e.g. 'Check status for SO-5000'."
        }
      };
    }

    const order = await getStagingOrder(orderId);
    return {
      result: {
        intent: "ORDER_STATUS",
        order,
        parsedRequest: null,
        reasoning: state.reasoning,
        message: order
          ? `Found ${orderId} with status ${order.status}.`
          : `No staging order found for ${orderId}.`
      }
    };
  }

  return {
    result: {
      intent: "UNKNOWN",
      order: null,
      parsedRequest: null,
      reasoning: state.reasoning,
      message:
        "I can create staging orders or check order status. Try 'Create a tech order for Northwind Labs to Dallas' or 'Check status for SO-5000'."
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

export async function runSupervisorAgent(request: string): Promise<SupervisorRunResult> {
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
