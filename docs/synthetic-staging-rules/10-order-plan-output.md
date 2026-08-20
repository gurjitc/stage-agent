# Synthetic Staging Rules - OrderPlan Contract

- R-046: OrderPlan must output fulfillmentProfile when a deterministic rule applies.
- R-047: OrderPlan should include suggested line items when request lacks explicit quantities.
- R-048: OrderPlan must include citedRuleIds for every non-default operational decision.
- R-049: If retrieval context is insufficient, OrderPlan should emit clarifying message rather than hallucinate.
- R-050: For refrigerated curbside scenarios, OrderPlan must set fulfillmentProfile to COLD_CHAIN_2.
