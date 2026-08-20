import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { addLineItem, createStagingOrder, finalizeOrder, getProductBySku, searchCustomers } from "../api/stagingApi.js";

export const findCustomerTool = tool(
  async ({ customerName }: { customerName: string }) => {
    const matches = await searchCustomers(customerName);
    if (matches.length === 0) {
      throw new Error(`No customer matches found for '${customerName}'.`);
    }

    return {
      selected: matches[0],
      alternatives: matches.slice(1, 3)
    };
  },
  {
    name: "find_customer",
    description: "Resolve a user-provided customer name to a canonical customer record.",
    schema: z.object({
      customerName: z.string().min(2)
    })
  }
);

export const validateSkuTool = tool(
  async ({ sku }: { sku: string }) => {
    const product = await getProductBySku(sku);
    if (!product) {
      throw new Error(`SKU does not exist in synthetic catalog: ${sku}`);
    }
    return product;
  },
  {
    name: "validate_sku",
    description: "Validate an SKU and return synthetic catalog metadata.",
    schema: z.object({
      sku: z.string().min(3)
    })
  }
);

export const createOrderTool = tool(
  async (input: {
    customerId: string;
    customerName: string;
    shippingMethod: "GROUND" | "TWO_DAY" | "OVERNIGHT";
    priority: "LOW" | "NORMAL" | "HIGH" | "RUSH";
    destination: string;
    requestedBy: string;
    notes: string;
  }) => createStagingOrder(input),
  {
    name: "create_staging_order",
    description: "Create a synthetic staging order shell in DRAFT state.",
    schema: z.object({
      customerId: z.string(),
      customerName: z.string(),
      shippingMethod: z.enum(["GROUND", "TWO_DAY", "OVERNIGHT"]),
      priority: z.enum(["LOW", "NORMAL", "HIGH", "RUSH"]),
      destination: z.string(),
      requestedBy: z.string(),
      notes: z.string()
    })
  }
);

export const addLineItemTool = tool(
  async ({ orderId, sku, quantity }: { orderId: string; sku: string; quantity: number }) =>
    addLineItem({ orderId, sku, quantity }),
  {
    name: "add_line_item",
    description: "Add a validated SKU and quantity to an existing synthetic staging order.",
    schema: z.object({
      orderId: z.string(),
      sku: z.string(),
      quantity: z.number().int().positive()
    })
  }
);

export const finalizeOrderTool = tool(
  async ({ orderId }: { orderId: string }) => finalizeOrder({ orderId }),
  {
    name: "finalize_order",
    description: "Finalize the synthetic staging order after all line items are attached.",
    schema: z.object({
      orderId: z.string()
    })
  }
);
