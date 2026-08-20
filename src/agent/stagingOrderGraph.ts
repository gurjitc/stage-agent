import { Annotation, StateGraph } from "@langchain/langgraph";
import { enhanceRequestWithOllama } from "./ollamaExtractor.js";
import { parseNaturalLanguageRequest } from "./requestParser.js";
import {
  addLineItemTool,
  createOrderTool,
  finalizeOrderTool,
  findCustomerByEmailTool,
  findProductTool,
  findCustomerTool,
  validateSkuTool
} from "../tools/stagingTools.js";
import type { ParsedOrderRequest, StagingOrder } from "../types.js";

const CATEGORY_FALLBACK_QUERIES: Record<ParsedOrderRequest["orderCategory"], string[]> = {
  TECH: ["calibration", "reagent", "instrument sleeve"],
  GROCERY: ["label pack", "red cartridge"],
  MEDICAL: ["reagent", "test cartridge"],
  REGULAR: ["label pack", "instrument sleeve"]
};

const AgentState = Annotation.Root({
  request: Annotation<string>(),
  parsed: Annotation<ParsedOrderRequest | null>(),
  customer: Annotation<{ id: string; name: string } | null>(),
  orderId: Annotation<string | null>(),
  finalOrder: Annotation<StagingOrder | null>(),
  reasoning: Annotation<string[]>({
    reducer: (current, update) => current.concat(update),
    default: () => []
  })
});

type AgentStateType = typeof AgentState.State;

async function parseNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const initiallyParsed = parseNaturalLanguageRequest(state.request);
  const { parsed, usedOllama } = await enhanceRequestWithOllama(state.request, initiallyParsed);

  return {
    parsed,
    reasoning: [
      usedOllama
        ? "Parsed request fields and used local Ollama (Qwen) to enrich generic line items into structured order data."
        : "Parsed the natural-language prompt into structured fields (customer/email, category, shipping, delivery, priority, destination, line items)."
    ]
  };
}

async function resolveCustomerNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  if (!state.parsed) {
    throw new Error("Missing parsed request.");
  }

  const result = state.parsed.customerEmail
    ? await findCustomerByEmailTool.invoke({ email: state.parsed.customerEmail })
    : await findCustomerTool.invoke({ customerName: state.parsed.customerName });

  return {
    customer: { id: result.selected.id, name: result.selected.name },
    reasoning: [
      state.parsed.customerEmail
        ? "Used find_customer_by_email so email-originated requests resolve to a canonical customerId with less ambiguity."
        : "Used find_customer so the order uses a canonical customerId instead of a free-text name, preventing downstream API mismatches."
    ]
  };
}

async function createOrderNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  if (!state.parsed || !state.customer) {
    throw new Error("Missing parsed request or customer.");
  }

  const order = await createOrderTool.invoke({
    customerId: state.customer.id,
    customerName: state.customer.name,
    customerEmail: state.parsed.customerEmail,
    orderCategory: state.parsed.orderCategory,
    shippingMethod: state.parsed.shippingMethod,
    deliveryMethod: state.parsed.deliveryMethod,
    priority: state.parsed.priority,
    destination: state.parsed.destination,
    requestedBy: state.parsed.requestedBy,
    requestSource: state.parsed.requestSource,
    notes: state.parsed.notes
  });

  return {
    orderId: order.id,
    reasoning: [
      "Created a DRAFT order shell with category, shipping, delivery, and request-source metadata before line-item mutations."
    ]
  };
}

async function addItemsNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  if (!state.parsed || !state.orderId) {
    throw new Error("Missing parsed request or orderId.");
  }

  const itemsToProcess = [...state.parsed.lineItems];

  if (itemsToProcess.length === 0) {
    const selectedSkus = new Set<string>();

    try {
      const fromRequest = await findProductTool.invoke({
        query: state.parsed.notes,
        category: state.parsed.orderCategory
      });
      itemsToProcess.push({ sku: fromRequest.selected.sku, itemText: fromRequest.selected.name, quantity: 1 });
      selectedSkus.add(fromRequest.selected.sku);
    } catch {
      // Continue with category fallbacks.
    }

    for (const query of CATEGORY_FALLBACK_QUERIES[state.parsed.orderCategory]) {
      if (itemsToProcess.length >= 2) {
        break;
      }

      try {
        const candidate = await findProductTool.invoke({
          query,
          category: state.parsed.orderCategory
        });
        if (!selectedSkus.has(candidate.selected.sku)) {
          itemsToProcess.push({ sku: candidate.selected.sku, itemText: candidate.selected.name, quantity: 1 });
          selectedSkus.add(candidate.selected.sku);
        }
      } catch {
        // Try next fallback query.
      }
    }
  }

  if (itemsToProcess.length === 0) {
    throw new Error(
      "Could not infer relevant items for this generic request. Add one item phrase, e.g. 'include blue reagent'."
    );
  }

  for (const item of itemsToProcess) {
    let resolvedSku = item.sku;

    if (!resolvedSku) {
      const productResult = await findProductTool.invoke({
        query: item.itemText,
        category: state.parsed.orderCategory
      });
      resolvedSku = productResult.selected.sku;
    }

    await validateSkuTool.invoke({ sku: resolvedSku });
    await addLineItemTool.invoke({ orderId: state.orderId, sku: resolvedSku, quantity: item.quantity });
  }

  return {
    reasoning: [
      state.parsed.lineItems.length === 0
        ? "No explicit line items were supplied, so the agent selected relevant catalog items from request/category context, then validated and added them."
        : "Resolved generic item descriptions to SKUs when needed, validated catalog matches, and then added line items safely."
    ]
  };
}

async function finalizeNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  if (!state.orderId) {
    throw new Error("Missing orderId.");
  }

  const finalOrder = await finalizeOrderTool.invoke({ orderId: state.orderId });
  return {
    finalOrder,
    reasoning: [
      "Finalized only after all required line items were attached, ensuring the order leaves the flow in READY_FOR_STAGING state."
    ]
  };
}

const graph = new StateGraph(AgentState)
  .addNode("parse_request", parseNode)
  .addNode("resolve_customer", resolveCustomerNode)
  .addNode("create_order", createOrderNode)
  .addNode("add_line_items", addItemsNode)
  .addNode("finalize_order", finalizeNode)
  .addEdge("__start__", "parse_request")
  .addEdge("parse_request", "resolve_customer")
  .addEdge("resolve_customer", "create_order")
  .addEdge("create_order", "add_line_items")
  .addEdge("add_line_items", "finalize_order")
  .addEdge("finalize_order", "__end__")
  .compile();

export interface AgentRunResult {
  order: StagingOrder;
  reasoning: string[];
  parsedRequest: ParsedOrderRequest;
}

export async function runStagingOrderAgent(request: string): Promise<AgentRunResult> {
  const finalState = await graph.invoke({
    request,
    parsed: null,
    customer: null,
    orderId: null,
    finalOrder: null,
    reasoning: []
  });

  if (!finalState.finalOrder || !finalState.parsed) {
    throw new Error("Agent did not produce a final order.");
  }

  return {
    order: finalState.finalOrder,
    reasoning: finalState.reasoning,
    parsedRequest: finalState.parsed
  };
}
