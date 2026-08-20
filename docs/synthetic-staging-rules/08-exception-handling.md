# Synthetic Staging Rules - Exception Handling

- R-036: If required fulfillment profile cannot be assigned, order remains DRAFT and emits PROFILE_MISSING error.
- R-037: Unknown SKU references trigger catalog remediation path before finalization.
- R-038: Conflicting delivery constraints must produce explicit conflict summary for agent response.
- R-039: For status lookups on missing ids, respond with NOT_FOUND and suggest nearest known ids when available.
- R-040: If compliance review is required, suppress READY_FOR_STAGING transition until review completion.
