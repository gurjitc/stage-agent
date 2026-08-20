import type { OrderPriority, ParsedLineItem, ParsedOrderRequest, ShippingMethod } from "../types.js";

function parseShippingMethod(text: string): ShippingMethod {
  const normalized = text.toLowerCase();
  if (normalized.includes("overnight") || normalized.includes("next day")) {
    return "OVERNIGHT";
  }
  if (normalized.includes("2-day") || normalized.includes("two day") || normalized.includes("expedited")) {
    return "TWO_DAY";
  }
  return "GROUND";
}

function parsePriority(text: string): OrderPriority {
  const normalized = text.toLowerCase();
  if (normalized.includes("rush") || normalized.includes("critical")) {
    return "RUSH";
  }
  if (normalized.includes("high priority") || normalized.includes("urgent")) {
    return "HIGH";
  }
  if (normalized.includes("low priority")) {
    return "LOW";
  }
  return "NORMAL";
}

function parseDestination(text: string): string {
  const match = text.match(/\bto\s+([a-zA-Z\s,-]{2,}?)(?=\s+by\s+[a-zA-Z\s.-]{2,}|[.]?$)/i);
  if (match?.[1]) {
    return match[1].trim().replace(/[.]+$/, "");
  }
  return "Default Staging Facility";
}

function parseCustomer(text: string): string {
  const match = text.match(/\bfor\s+([a-zA-Z0-9\s&.-]+?)\s+(with|containing|including|to|shipping|ship)/i);
  if (match?.[1]) {
    return match[1].trim();
  }

  const fallback = text.match(/\bfor\s+([a-zA-Z0-9\s&.-]+)/i);
  if (fallback?.[1]) {
    return fallback[1].trim().replace(/[.]+$/, "");
  }

  return "Acme Retail";
}

function parseRequestedBy(text: string): string {
  const match = text.match(/\bby\s+([a-zA-Z\s.-]{2,})/i);
  if (match?.[1]) {
    return match[1].trim().replace(/[.]+$/, "");
  }
  return "staging-agent-demo";
}

function parseLineItems(text: string): ParsedLineItem[] {
  const items: ParsedLineItem[] = [];

  const qtyThenSku = /(?:(\d+)\s*(?:x|units?|qty)\s*(?:of\s+)?)((?:SKU-)?[A-Z]{3,4}-\d{3})/gi;
  for (const match of text.matchAll(qtyThenSku)) {
    const quantity = Number.parseInt(match[1] ?? "0", 10);
    const sku = (match[2] ?? "").toUpperCase().replace(/^([^S]|S[^K]|SK[^U])/, "SKU-$1");
    if (quantity > 0 && sku) {
      items.push({ sku, quantity });
    }
  }

  const skuThenQty = /((?:SKU-)?[A-Z]{3,4}-\d{3})\s*(?:x|qty)\s*(\d+)/gi;
  for (const match of text.matchAll(skuThenQty)) {
    const sku = (match[1] ?? "").toUpperCase().replace(/^([^S]|S[^K]|SK[^U])/, "SKU-$1");
    const quantity = Number.parseInt(match[2] ?? "0", 10);
    if (quantity > 0 && sku && !items.some((i) => i.sku === sku && i.quantity === quantity)) {
      items.push({ sku, quantity });
    }
  }

  return items;
}

export function parseNaturalLanguageRequest(text: string): ParsedOrderRequest {
  const lineItems = parseLineItems(text);
  if (lineItems.length === 0) {
    throw new Error(
      "Could not extract line items. Include item quantities and SKUs, e.g. '2 units of SKU-RED-001 and 1 x SKU-BLU-002'."
    );
  }

  return {
    customerName: parseCustomer(text),
    shippingMethod: parseShippingMethod(text),
    priority: parsePriority(text),
    destination: parseDestination(text),
    lineItems,
    requestedBy: parseRequestedBy(text),
    notes: text.trim()
  };
}
