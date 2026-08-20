import { ChatOllama } from "@langchain/ollama";
import { z } from "zod";
import { syntheticProducts } from "../data/syntheticData.js";
import type { ParsedLineItem, ParsedOrderRequest } from "../types.js";

const extractionSchema = z.object({
  customerName: z.string().min(1).optional(),
  orderCategory: z.enum(["REGULAR", "GROCERY", "TECH", "MEDICAL"]).optional(),
  shippingMethod: z.enum(["GROUND", "TWO_DAY", "OVERNIGHT", "FREIGHT", "WHITE_GLOVE"]).optional(),
  deliveryMethod: z.enum(["STANDARD_DELIVERY", "SAME_DAY", "PICKUP", "CURBSIDE", "LOCKER", "DIGITAL"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "RUSH"]).optional(),
  destination: z.string().min(2).optional(),
  requestedBy: z.string().min(1).optional(),
  lineItems: z
    .array(
      z.object({
        quantity: z.number().int().positive(),
        sku: z.string().nullable().optional(),
        itemText: z.string().min(2)
      })
    )
    .default([])
});

function normalizeSku(rawSku: string | null | undefined): string | null {
  if (!rawSku) {
    return null;
  }

  const normalized = rawSku.toUpperCase().trim();
  if (normalized.startsWith("SKU-")) {
    return normalized;
  }

  if (/^[A-Z]{3,4}-\d{3}$/.test(normalized)) {
    return `SKU-${normalized}`;
  }

  return normalized;
}

function sanitizeLineItems(items: Array<{ quantity: number; sku?: string | null; itemText: string }>): ParsedLineItem[] {
  return items
    .map((item) => ({
      quantity: item.quantity,
      sku: normalizeSku(item.sku),
      itemText: item.itemText.trim()
    }))
    .filter((item) => item.quantity > 0 && item.itemText.length >= 2);
}

export async function enhanceRequestWithOllama(
  request: string,
  parsed: ParsedOrderRequest
): Promise<{ parsed: ParsedOrderRequest; usedOllama: boolean }> {
  const ollamaEnabled = (process.env.OLLAMA_ENABLED ?? "true").toLowerCase() !== "false";
  const hasGenericItems = parsed.lineItems.some((item) => !item.sku);

  if (!ollamaEnabled || !hasGenericItems) {
    return { parsed, usedOllama: false };
  }

  const model = process.env.OLLAMA_MODEL ?? "qwen3:8b";
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";

  try {
    const llm = new ChatOllama({ model, baseUrl, temperature: 0 });
    const extractor = llm.withStructuredOutput(extractionSchema);

    const catalog = syntheticProducts
      .map((product) => `${product.sku} | ${product.name} | aliases: ${product.aliases.join(", ")} | categories: ${product.categories.join(",")}`)
      .join("\n");

    const response = await extractor.invoke([
      "You extract staging order data from a user request.",
      "Use the catalog to map generic item descriptions to the most likely SKU when possible.",
      "If you are unsure, keep sku as null and keep itemText descriptive.",
      `Catalog:\n${catalog}`,
      `Request:\n${request}`
    ].join("\n\n"));

    const llmLineItems = sanitizeLineItems(response.lineItems ?? []);
    const mergedLineItems = llmLineItems.length > 0 ? llmLineItems : parsed.lineItems;

    const merged: ParsedOrderRequest = {
      ...parsed,
      customerName: response.customerName ?? parsed.customerName,
      orderCategory: response.orderCategory ?? parsed.orderCategory,
      shippingMethod: response.shippingMethod ?? parsed.shippingMethod,
      deliveryMethod: response.deliveryMethod ?? parsed.deliveryMethod,
      priority: response.priority ?? parsed.priority,
      destination: response.destination ?? parsed.destination,
      requestedBy: response.requestedBy ?? parsed.requestedBy,
      lineItems: mergedLineItems
    };

    return { parsed: merged, usedOllama: true };
  } catch {
    return { parsed, usedOllama: false };
  }
}
