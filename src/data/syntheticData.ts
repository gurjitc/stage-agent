import type { SyntheticCustomer, SyntheticProduct } from "../types.js";

export const syntheticCustomers: SyntheticCustomer[] = [
  { id: "CUST-100", name: "Acme Retail", aliases: ["acme", "acme retail"] },
  { id: "CUST-101", name: "Northwind Labs", aliases: ["northwind", "northwind labs"] },
  { id: "CUST-102", name: "Blue Harbor Health", aliases: ["blue harbor", "harbor health"] },
  { id: "CUST-103", name: "Delta Aero", aliases: ["delta aero", "delta"] }
];

export const syntheticProducts: SyntheticProduct[] = [
  { sku: "SKU-RED-001", name: "Red Test Cartridge", unitPrice: 12.5 },
  { sku: "SKU-BLU-002", name: "Blue Validation Reagent", unitPrice: 19.75 },
  { sku: "SKU-GRN-003", name: "Green Calibration Strip", unitPrice: 7.25 },
  { sku: "SKU-BLK-004", name: "Black Instrument Sleeve", unitPrice: 4.9 },
  { sku: "SKU-WHT-005", name: "White Label Pack", unitPrice: 2.15 }
];
