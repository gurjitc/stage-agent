import type { SyntheticCustomer, SyntheticProduct } from "../types.js";

export const syntheticCustomers: SyntheticCustomer[] = [
  {
    id: "CUST-100",
    name: "Acme Retail",
    aliases: ["acme", "acme retail"],
    emails: ["orders@acmeretail.test", "staging@acmeretail.test"]
  },
  {
    id: "CUST-101",
    name: "Northwind Labs",
    aliases: ["northwind", "northwind labs"],
    emails: ["ops@northwindlabs.test", "orders@northwindlabs.test"]
  },
  {
    id: "CUST-102",
    name: "Blue Harbor Health",
    aliases: ["blue harbor", "harbor health"],
    emails: ["procurement@blueharbor.test", "staging@blueharbor.test"]
  },
  {
    id: "CUST-103",
    name: "Delta Aero",
    aliases: ["delta aero", "delta"],
    emails: ["supply@deltaaero.test", "orders@deltaaero.test"]
  }
];

export const syntheticProducts: SyntheticProduct[] = [
  {
    sku: "SKU-RED-001",
    name: "Red Test Cartridge",
    aliases: ["red cartridge", "test cartridge", "red test"],
    categories: ["REGULAR", "MEDICAL"],
    unitPrice: 12.5
  },
  {
    sku: "SKU-BLU-002",
    name: "Blue Validation Reagent",
    aliases: ["blue reagent", "validation reagent", "reagent"],
    categories: ["TECH", "MEDICAL"],
    unitPrice: 19.75
  },
  {
    sku: "SKU-GRN-003",
    name: "Green Calibration Strip",
    aliases: ["green strip", "calibration strip", "calibration"],
    categories: ["TECH", "MEDICAL"],
    unitPrice: 7.25
  },
  {
    sku: "SKU-BLK-004",
    name: "Black Instrument Sleeve",
    aliases: ["black sleeve", "instrument sleeve", "sleeve"],
    categories: ["TECH", "REGULAR"],
    unitPrice: 4.9
  },
  {
    sku: "SKU-WHT-005",
    name: "White Label Pack",
    aliases: ["white labels", "label pack", "labels"],
    categories: ["GROCERY", "REGULAR"],
    unitPrice: 2.15
  }
];
