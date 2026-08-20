# Synthetic Staging Rules - Grocery and Perishables

- R-026: Grocery orders with dairy aliases (milk, eggs, cream) are tagged REFRIGERATED.
- R-027: REFRIGERATED plus CURBSIDE must reference COLD_CHAIN_2 in fulfillment plan.
- R-028: Grocery orders scheduled for PICKUP beyond 6 hours require freshness check event FRESH_SCAN_1.
- R-029: If egg quantities exceed 48 units, allocate reinforced crate profile CRATE_EGG_1.
- R-030: Grocery orders to locker delivery are blocked if any REFRIGERATED tag is present.
