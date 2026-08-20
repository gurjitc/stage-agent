# Synthetic Staging Rules - Order Intake

- R-001: All inbound staging requests must include a destination region code in free text or customer profile metadata.
- R-002: If request source is EMAIL and sender domain is unknown, mark order for manual identity verification.
- R-003: Orders flagged as RUSH require at least one supervisor acknowledgment event before finalization.
- R-004: Grocery category orders default to STANDARD_DELIVERY unless request explicitly asks for CURBSIDE or PICKUP.
- R-005: If no explicit line items are provided, system may auto-select up to 2 category-relevant starter SKUs.
