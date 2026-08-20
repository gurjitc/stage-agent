# Synthetic Staging Rules - Priority and SLA

- R-031: RUSH priority orders target staging release within 20 minutes.
- R-032: HIGH priority orders target staging release within 45 minutes.
- R-033: NORMAL priority orders target staging release within 2 hours.
- R-034: LOW priority orders can be deferred to batch window if no cold-chain profile is required.
- R-035: Any order with COLD_CHAIN_2 ignores low-priority deferral and enters immediate queue.
