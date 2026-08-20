# Synthetic Staging Rules - Customer Routing

- R-006: Exact sender email match has higher trust than display-name customer matching.
- R-007: If multiple customer candidates are tied, prefer the account with most recent successful staging order.
- R-008: For domain-level email matches, attach confidence tag DOMAIN_MATCH and continue unless policy blocks.
- R-009: If no customer can be resolved, route to UNKNOWN_CUSTOMER queue and return guidance to requester.
- R-010: Medical category orders from unverified sender domains require MANUAL_COMPLIANCE_REVIEW.
