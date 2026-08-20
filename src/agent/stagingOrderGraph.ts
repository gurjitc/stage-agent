import { Annotation, StateGraph } from "@langchain/langgraph";
import { parseNaturalLanguageRequest } from "./requestParser.js";
import { addLineItemTool, createOrderTool, finalizeOrderTool, findCustomerTool, validateSkuTool } from "../tools/stagingTools.js";
import type { ParsedOrderRequest, StagingOrder } from "../types.js";

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
  const parsed = parseNaturalLanguageRequest(state.request);
  return {
    parsed,
    reasoning: [
      "Parsed the natural-language prompt into structured fields (customer, shipping, priority, destination, line items)."
    ]
  };
}

async function resolveCustomerNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  if (!state.parsed) {
    throw new Error("Missing parsed request.");
  }

  const result = await findCustomerTool.invoke({ customerName: state.parsed.customerName });
  return {
    customer: { id: result.selected.id, name: result.selected.name },
    reasoning: [
      "Used find_customer so the order uses a canonical customerId instead of a free-text name, preventing downstream API mismatches."
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
    shippingMethod: state.parsed.shippingMethod,
    priority: state.parsed.priority,
    destination: state.parsed.destination,
    requestedBy: state.parsed.requestedBy,
    notes: state.parsed.notes
  });

  return {
    orderId: order.id,
    reasoning: [
      "Created a DRAFT order shell first, so line items can be added safely before finalization."
    ]
  };
}

async function addItemsNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  if (!state.parsed || !state.orderId) {
    throw new Error("Missing parsed request or orderId.");
  }

  for (const item of state.parsed.lineItems) {
    await validateSkuTool.invoke({ sku: item.sku });
    await addLineItemTool.invoke({ orderId: state.orderId, sku: item.sku, quantity: item.quantity });
  }

  return {
    reasoning: [
      "Validated each SKU before insertion and then added line items, which catches bad catalog references early."
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
