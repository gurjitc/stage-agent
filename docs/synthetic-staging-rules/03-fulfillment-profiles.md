# Synthetic Staging Rules - Fulfillment Profiles

- R-011: CURBSIDE orders containing refrigerated products require fulfillment profile COLD_CHAIN_2.
- R-012: PICKUP orders with fragile tech bundles require fulfillment profile HANDOFF_SECURE_1.
- R-013: STANDARD_DELIVERY with non-fragile regular items uses fulfillment profile GENERAL_PACK_1.
- R-014: LOCKER deliveries are incompatible with oversized items and must use profile LOCKER_FIT_CHECK.
- R-015: Same-day courier requests default to fulfillment profile RAPID_DISPATCH_1 unless overridden by cold-chain rules.
