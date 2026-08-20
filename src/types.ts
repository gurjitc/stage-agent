export type ShippingMethod = "GROUND" | "TWO_DAY" | "OVERNIGHT" | "FREIGHT" | "WHITE_GLOVE";

export type DeliveryMethod = "STANDARD_DELIVERY" | "SAME_DAY" | "PICKUP" | "CURBSIDE" | "LOCKER" | "DIGITAL";

export type OrderCategory = "REGULAR" | "GROCERY" | "TECH" | "MEDICAL";

export type OrderPriority = "LOW" | "NORMAL" | "HIGH" | "RUSH";

export interface ParsedLineItem {
  sku: string | null;
  itemText: string;
  quantity: number;
}

export interface ParsedOrderRequest {
  customerName: string;
  customerEmail: string | null;
  orderCategory: OrderCategory;
  shippingMethod: ShippingMethod;
  deliveryMethod: DeliveryMethod;
  priority: OrderPriority;
  destination: string;
  lineItems: ParsedLineItem[];
  requestedBy: string;
  requestSource: "CHAT" | "EMAIL";
  notes: string;
}

export interface SyntheticCustomer {
  id: string;
  name: string;
  aliases: string[];
  emails: string[];
}

export interface SyntheticProduct {
  sku: string;
  name: string;
  aliases: string[];
  categories: OrderCategory[];
  unitPrice: number;
}

export interface StagingOrder {
  id: string;
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  orderCategory: OrderCategory;
  shippingMethod: ShippingMethod;
  deliveryMethod: DeliveryMethod;
  priority: OrderPriority;
  destination: string;
  requestedBy: string;
  requestSource: "CHAT" | "EMAIL";
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
