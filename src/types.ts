export type ShippingMethod = "GROUND" | "TWO_DAY" | "OVERNIGHT";

export type OrderPriority = "LOW" | "NORMAL" | "HIGH" | "RUSH";

export interface ParsedLineItem {
  sku: string;
  quantity: number;
}

export interface ParsedOrderRequest {
  customerName: string;
  shippingMethod: ShippingMethod;
  priority: OrderPriority;
  destination: string;
  lineItems: ParsedLineItem[];
  requestedBy: string;
  notes: string;
}

export interface SyntheticCustomer {
  id: string;
  name: string;
  aliases: string[];
}

export interface SyntheticProduct {
  sku: string;
  name: string;
  unitPrice: number;
}

export interface StagingOrder {
  id: string;
  customerId: string;
  customerName: string;
  shippingMethod: ShippingMethod;
  priority: OrderPriority;
  destination: string;
  requestedBy: string;
  notes: string;
  status: "DRAFT" | "READY_FOR_STAGING";
  lineItems: Array<{
    lineId: string;
    sku: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    extendedPrice: number;
  }>;
  totalAmount: number;
  createdAt: string;
}
