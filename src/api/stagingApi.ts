import { syntheticCustomers, syntheticProducts } from "../data/syntheticData.js";
import type {
  DeliveryMethod,
  OrderCategory,
  OrderPriority,
  ShippingMethod,
  StagingOrder,
  SyntheticCustomer,
  SyntheticProduct
} from "../types.js";

const stagingOrders = new Map<string, StagingOrder>();
let orderCounter = 5000;
let lineCounter = 1;

function buildId(prefix: string, counter: number): string {
  return `${prefix}-${counter}`;
}

function scoreCustomerMatch(customer: SyntheticCustomer, query: string): number {
  const normalizedQuery = query.toLowerCase().trim();
  if (customer.name.toLowerCase() === normalizedQuery) {
    return 100;
  }
  if (customer.aliases.some((a) => a === normalizedQuery)) {
    return 90;
  }
  if (customer.name.toLowerCase().includes(normalizedQuery)) {
    return 80;
  }
  if (customer.aliases.some((a) => a.includes(normalizedQuery))) {
    return 70;
  }
  return 0;
}

function scoreCustomerEmailMatch(customer: SyntheticCustomer, queryEmail: string): number {
  const normalizedEmail = queryEmail.toLowerCase().trim();
  const domain = normalizedEmail.split("@")[1] ?? "";

  if (customer.emails.some((email) => email.toLowerCase() === normalizedEmail)) {
    return 100;
  }

  if (domain && customer.emails.some((email) => email.toLowerCase().endsWith(`@${domain}`))) {
    return 85;
  }

  return 0;
}

export async function searchCustomers(query: string): Promise<SyntheticCustomer[]> {
  const scored = syntheticCustomers
    .map((customer) => ({ customer, score: scoreCustomerMatch(customer, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.customer);

  return scored;
}

export async function searchCustomersByEmail(email: string): Promise<SyntheticCustomer[]> {
  const scored = syntheticCustomers
    .map((customer) => ({ customer, score: scoreCustomerEmailMatch(customer, email) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.customer);

  return scored;
}

export async function getProductBySku(sku: string): Promise<SyntheticProduct | null> {
  const normalized = sku.toUpperCase().trim();
  return syntheticProducts.find((product) => product.sku === normalized) ?? null;
}

function scoreProductMatch(product: SyntheticProduct, query: string, category?: OrderCategory): number {
  const normalizedQuery = query.toLowerCase().trim();
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);

  let score = 0;

  if (product.sku.toLowerCase() === normalizedQuery) {
    score += 100;
  }

  if (product.name.toLowerCase() === normalizedQuery) {
    score += 95;
  }

  if (product.aliases.some((alias) => alias.toLowerCase() === normalizedQuery)) {
    score += 90;
  }

  if (product.name.toLowerCase().includes(normalizedQuery)) {
    score += 80;
  }

  if (product.aliases.some((alias) => alias.toLowerCase().includes(normalizedQuery))) {
    score += 75;
  }

  const aliasTokenHits = product.aliases
    .join(" ")
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => queryTokens.includes(token)).length;
  score += Math.min(aliasTokenHits * 8, 24);

  const nameTokenHits = product.name
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => queryTokens.includes(token)).length;
  score += Math.min(nameTokenHits * 6, 18);

  if (category && product.categories.includes(category)) {
    score += 10;
  }

  return score;
}

export async function searchProducts(query: string, category?: OrderCategory): Promise<SyntheticProduct[]> {
  const scored = syntheticProducts
    .map((product) => ({ product, score: scoreProductMatch(product, query, category) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.product);

  return scored;
}

export async function createStagingOrder(input: {
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  orderCategory: OrderCategory;
  fulfillmentProfile: string | null;
  appliedRuleIds: string[];
  shippingMethod: ShippingMethod;
  deliveryMethod: DeliveryMethod;
  priority: OrderPriority;
  destination: string;
  requestedBy: string;
  requestSource: "CHAT" | "EMAIL";
  notes: string;
}): Promise<StagingOrder> {
  const id = buildId("SO", orderCounter++);
  const order: StagingOrder = {
    id,
    customerId: input.customerId,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    orderCategory: input.orderCategory,
    fulfillmentProfile: input.fulfillmentProfile,
    appliedRuleIds: input.appliedRuleIds,
    shippingMethod: input.shippingMethod,
    deliveryMethod: input.deliveryMethod,
    priority: input.priority,
    destination: input.destination,
    requestedBy: input.requestedBy,
    requestSource: input.requestSource,
    notes: input.notes,
    status: "DRAFT",
    lineItems: [],
    totalAmount: 0,
    createdAt: new Date().toISOString()
  };

  stagingOrders.set(order.id, order);
  return order;
}

export async function addLineItem(input: {
  orderId: string;
  sku: string;
  quantity: number;
}): Promise<StagingOrder> {
  const order = stagingOrders.get(input.orderId);
  if (!order) {
    throw new Error(`Order not found: ${input.orderId}`);
  }

  const product = await getProductBySku(input.sku);
  if (!product) {
    throw new Error(`Unknown SKU: ${input.sku}`);
  }

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error(`Invalid quantity for ${input.sku}: ${input.quantity}`);
  }

  order.lineItems.push({
    lineId: buildId("LINE", lineCounter++),
    sku: product.sku,
    productName: product.name,
    quantity: input.quantity,
    unitPrice: product.unitPrice,
    extendedPrice: product.unitPrice * input.quantity
  });

  order.totalAmount = order.lineItems.reduce((acc, line) => acc + line.extendedPrice, 0);

  return order;
}

export async function finalizeOrder(input: { orderId: string }): Promise<StagingOrder> {
  const order = stagingOrders.get(input.orderId);
  if (!order) {
    throw new Error(`Order not found: ${input.orderId}`);
  }

  if (order.lineItems.length === 0) {
    throw new Error("Cannot finalize an order with no line items.");
  }

  order.status = "READY_FOR_STAGING";
  return order;
}

export async function getStagingOrder(orderId: string): Promise<StagingOrder | null> {
  return stagingOrders.get(orderId) ?? null;
}
