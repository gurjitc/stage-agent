import type {
  DeliveryMethod,
  OrderCategory,
  OrderPriority,
  ParsedLineItem,
  ParsedOrderRequest,
  ShippingMethod
} from "../types.js";

function parseShippingMethod(text: string): ShippingMethod {
  const normalized = text.toLowerCase();
  if (normalized.includes("white glove")) {
    return "WHITE_GLOVE";
  }
  if (normalized.includes("freight") || normalized.includes("ltl")) {
    return "FREIGHT";
  }
  if (normalized.includes("overnight") || normalized.includes("next day")) {
    return "OVERNIGHT";
  }
  if (normalized.includes("2-day") || normalized.includes("two day") || normalized.includes("expedited")) {
    return "TWO_DAY";
  }
  return "GROUND";
}

function parseDeliveryMethod(text: string): DeliveryMethod {
  const normalized = text.toLowerCase();
  if (normalized.includes("curbside")) {
    return "CURBSIDE";
  }
  if (normalized.includes("pickup") || normalized.includes("pick up")) {
    return "PICKUP";
  }
  if (normalized.includes("locker")) {
    return "LOCKER";
  }
  if (normalized.includes("same day") || normalized.includes("same-day") || normalized.includes("courier")) {
    return "SAME_DAY";
  }
  if (normalized.includes("digital") || normalized.includes("email delivery")) {
    return "DIGITAL";
  }
  return "STANDARD_DELIVERY";
}

function parseOrderCategory(text: string): OrderCategory {
  const normalized = text.toLowerCase();
  if (normalized.includes("grocery") || normalized.includes("produce") || normalized.includes("food")) {
    return "GROCERY";
  }
  if (
    normalized.includes("tech") ||
    normalized.includes("electronics") ||
    normalized.includes("laptop") ||
    normalized.includes("device")
  ) {
    return "TECH";
  }
  if (normalized.includes("medical") || normalized.includes("clinical") || normalized.includes("health")) {
    return "MEDICAL";
  }
  return "REGULAR";
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
  const deliveryMethod = parseDeliveryMethod(text);
  if (deliveryMethod === "DIGITAL") {
    return "Email Delivery";
  }

  const match = text.match(/\bto\s+([a-zA-Z\s,-]{2,}?)(?=\s+by\s+[a-zA-Z\s.-]{2,}|[.]?$)/i);
  if (match?.[1]) {
    return match[1].trim().replace(/[.]+$/, "");
  }

  const pickupMatch = text.match(/\bat\s+([a-zA-Z\s,-]{2,}?)(?=\s+by\s+[a-zA-Z\s.-]{2,}|[.]?$)/i);
  if (pickupMatch?.[1]) {
    return pickupMatch[1].trim().replace(/[.]+$/, "");
  }

  return "Default Staging Facility";
}

function parseRequestEmail(text: string): string | null {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.toLowerCase() ?? null;
}

function parseCustomer(text: string, customerEmail: string | null): string {
  const match = text.match(/\bfor\s+([a-zA-Z0-9\s&.-]+?)\s+(with|containing|including)\b/i);
  if (match?.[1]) {
    return match[1].trim();
  }

  const fallback = text.match(/\bfor\s+([a-zA-Z0-9\s&.-]+?)(?=\s+(to|by|at|via|with|shipping|ship)\b|[.]?$)/i);
  if (fallback?.[1]) {
    const candidate = fallback[1].trim().replace(/[.]+$/, "");
    const nonCustomerPattern = /\b(same day|same-day|courier|pickup|curbside|locker|delivery|digital)\b/i;

    if (!nonCustomerPattern.test(candidate)) {
      return candidate;
    }
  }

  if (customerEmail) {
    return "Email-routed customer";
  }

  return "Acme Retail";
}

function parseRequestedBy(text: string): string {
  const requestEmail = parseRequestEmail(text);

  const match = text.match(/\bby\s+([a-zA-Z\s.-]{2,})/i);
  if (match?.[1]) {
    return match[1].trim().replace(/[.]+$/, "");
  }

  if (requestEmail) {
    return requestEmail.split("@")[0] ?? "staging-agent-demo";
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
      items.push({ sku, itemText: sku, quantity });
    }
  }

  const skuThenQty = /((?:SKU-)?[A-Z]{3,4}-\d{3})\s*(?:x|qty)\s*(\d+)/gi;
  for (const match of text.matchAll(skuThenQty)) {
    const sku = (match[1] ?? "").toUpperCase().replace(/^([^S]|S[^K]|SK[^U])/, "SKU-$1");
    const quantity = Number.parseInt(match[2] ?? "0", 10);
    if (quantity > 0 && sku && !items.some((i) => i.sku === sku && i.quantity === quantity)) {
      items.push({ sku, itemText: sku, quantity });
    }
  }

  const genericQtyPattern =
    /(\d+)\s*(?:x|units?|qty|items?)?\s*(?:of\s+)?([a-z][a-z0-9\s-]{2,}?)(?=\s+and\s+\d+\s|\s*,\s*\d+\s|\s+to\s|\s+for\s|\s+with\s|\s+shipping\s|\s+ship\s|\s+by\s|\s+via\s|$)/gi;
  for (const match of text.matchAll(genericQtyPattern)) {
    const quantity = Number.parseInt(match[1] ?? "0", 10);
    let itemText = (match[2] ?? "").trim();

    if (!quantity || !itemText) {
      continue;
    }

    itemText = itemText.replace(/\b(and|to|for|with|shipping|ship|by|via)\b.*$/i, "").trim();
    itemText = itemText.replace(/[.,]+$/, "");

    if (!itemText || /\bSKU-[A-Z]{3,4}-\d{3}\b/i.test(itemText)) {
      continue;
    }

    if (itemText.length < 3) {
      continue;
    }

    const dedupeKey = `${quantity}:${itemText.toLowerCase()}`;
    const alreadyExists = items.some((i) => `${i.quantity}:${i.itemText.toLowerCase()}` === dedupeKey);
    if (!alreadyExists) {
      items.push({ sku: null, itemText, quantity });
    }
  }

  return items;
}

export function parseNaturalLanguageRequest(text: string): ParsedOrderRequest {
  const lineItems = parseLineItems(text);
  const customerEmail = parseRequestEmail(text);

  return {
    customerName: parseCustomer(text, customerEmail),
    customerEmail,
    orderCategory: parseOrderCategory(text),
    shippingMethod: parseShippingMethod(text),
    deliveryMethod: parseDeliveryMethod(text),
    priority: parsePriority(text),
    destination: parseDestination(text),
    lineItems,
    requestedBy: parseRequestedBy(text),
    requestSource: customerEmail ? "EMAIL" : "CHAT",
    notes: text.trim()
  };
}
