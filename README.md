# stage-agent

Node.js + TypeScript AI agent that converts natural-language staging-order requests into synthetic staging order data using LangChain tools and a LangGraph workflow.

The agent now supports:
- Email-based customer routing
- Generic item descriptions (no exact SKU required)
- Order categories (`REGULAR`, `GROCERY`, `TECH`, `MEDICAL`)
- Expanded shipping (`GROUND`, `TWO_DAY`, `OVERNIGHT`, `FREIGHT`, `WHITE_GLOVE`)
- Delivery methods (`STANDARD_DELIVERY`, `SAME_DAY`, `PICKUP`, `CURBSIDE`, `LOCKER`, `DIGITAL`)
- Optional local Ollama enrichment with Qwen/Gwen 8B
- V1 RAG for synthetic business-rule retrieval and OrderPlan generation

## What this project demonstrates

- Backend-first Node.js/TypeScript implementation aligned with AI-enabled backend engineering work.
- Tool-based orchestration with LangChain.
- Deterministic multi-step execution flow with LangGraph.
- Fake staging APIs and synthetic data so you can practice architecture without external dependencies.

## Stack

- Node.js + TypeScript
- LangChain (`@langchain/core`)
- LangChain Ollama (`@langchain/ollama`)
- LangGraph (`@langchain/langgraph`)
- Zod for tool I/O validation
- dotenv for environment management

## Run it

1. Install dependencies:

```bash
npm install
```

2. Run the agent with a natural-language request:

```bash
npm run agent -- "Create a rush order for Acme Retail with 2 blue reagents and 1 red cartridge to Seattle by Jordan"

# Email + category + delivery example
npm run agent -- "Create a tech order from ops@northwindlabs.test with 2 blue reagents and 1 calibration strip for same-day courier to Austin"
```

3. Optional type-check:

```bash
npm run typecheck
```

4. Run RAG demonstration (without retrieval vs with retrieval):

```bash
npm run rag:demo -- "Create a curbside order with milk and eggs."
```

5. Run browser UI:

```bash
npm run ui
```

Then open http://localhost:3000.

If you want to guarantee the latest UI server each run (and avoid stale processes on the same port):

```bash
npm run ui:fresh
```

## Example input

```text
Create a grocery order from orders@acmeretail.test with 4 white labels and 2 red cartridges for curbside pickup at Houston by Priya
```

## Example output shape

```json
{
  "order": {
    "id": "SO-5000",
    "status": "READY_FOR_STAGING",
    "customerName": "Northwind Labs",
    "lineItems": [
      {
        "sku": "SKU-GRN-003",
        "quantity": 3
      }
    ]
  },
  "reasoning": [
    "Parsed the natural-language prompt into structured fields (customer/email, category, shipping, delivery, priority, destination, line items).",
    "Used find_customer_by_email so email-originated requests resolve to a canonical customerId with less ambiguity.",
    "Created a DRAFT order shell with category, shipping, delivery, and request-source metadata before line-item mutations.",
    "Resolved generic item descriptions to SKUs when needed, validated catalog matches, and then added line items safely.",
    "Finalized only after all required line items were attached, ensuring the order leaves the flow in READY_FOR_STAGING state."
  ]
}
```

## Local Ollama (Qwen/Gwen 8B)

1. Start Ollama locally and pull a model:

```bash
ollama pull qwen3:8b
```

2. Configure environment variables (PowerShell example):

```powershell
$env:OLLAMA_ENABLED="true"
$env:OLLAMA_BASE_URL="http://127.0.0.1:11434"
$env:OLLAMA_MODEL="qwen3:8b"
```

If your local model tag is `gwen:8b`, set:

```powershell
$env:OLLAMA_MODEL="gwen:8b"
```

3. Run agent/UI as normal. When generic line items are present, the parser will try local Ollama enrichment and gracefully fall back to heuristic parsing if Ollama is unavailable.

## Architecture

- `src/agent/requestParser.ts`: Heuristic natural-language parser that extracts customer/email, order category, shipping method, delivery method, priority, destination, requester, and line items.
- `src/tools/stagingTools.ts`: LangChain tools for customer resolution (name/email), product resolution from generic text, SKU validation, order creation, line-item insertion, and finalization.
- `src/agent/ollamaExtractor.ts`: Optional local Ollama structured extraction/enrichment layer.
- `src/agent/stagingOrderGraph.ts`: LangGraph state machine that orchestrates the order lifecycle.
- `src/rag/ruleRetriever.ts`: Loads synthetic rule docs, chunks text, computes embeddings, and performs top-k similarity search.
- `src/rag/orderPlanRag.ts`: Builds OrderPlan from retrieved chunks using LLM or deterministic fallback.
- `src/rag/demo.ts`: Demonstrates why retrieval is needed for rule-grounded decisions.
- `src/api/stagingApi.ts`: Fake async staging APIs backed by in-memory synthetic data.
- `src/data/syntheticData.ts`: Synthetic customer and product catalog.
- `src/index.ts`: CLI entrypoint for ad-hoc testing.
- `src/server/app.ts`: Express server exposing API + static UI.
- `public/index.html`: Browser console for submitting prompts and viewing order output/reasoning.

## Tool-by-tool reasoning (why each tool exists)

1. `find_customer`
- Purpose: Convert ambiguous free-text customer names into canonical IDs.
- Why it matters: APIs should not accept fuzzy names as keys; canonical IDs improve correctness and traceability.

2. `find_customer_by_email`
- Purpose: Resolve email-originated requests to the right customer using exact email or domain matching.
- Why it matters: In real inbound order flows, email is a strong identity signal and reduces ambiguity.

3. `validate_sku`
- Purpose: Check each SKU against the synthetic catalog before line-item creation.
- Why it matters: Fails fast for bad inputs and prevents creating partially corrupted orders.

4. `find_product`
- Purpose: Map generic item descriptions (for example, "blue reagent") to best-match catalog SKUs.
- Why it matters: Lets users place orders naturally without memorizing SKU codes.

5. `create_staging_order`
- Purpose: Create an order shell in `DRAFT` state.
- Why it matters: Mirrors real backend workflows where an order aggregate is created before mutating child entities and stores category/delivery metadata up front.

6. `add_line_item`
- Purpose: Attach validated product lines and compute totals.
- Why it matters: Encapsulates pricing and quantity rules in one tool boundary.

7. `finalize_order`
- Purpose: Transition order status from `DRAFT` to `READY_FOR_STAGING`.
- Why it matters: Explicit lifecycle transition avoids releasing incomplete orders.

## Notes

- This project intentionally uses fake APIs and in-memory storage.
- To productionize: replace fake APIs with real service clients, add retries/timeouts/idempotency, persist state, and add telemetry.

## Synthetic Rule Corpus

- 10 synthetic rule documents are stored in `docs/synthetic-staging-rules/`.
- The corpus includes approximately 50 business rules (`R-001` through `R-050`).
- Example synthetic rule used in RAG validation:
  - `R-011`: CURBSIDE orders containing refrigerated products require fulfillment profile `COLD_CHAIN_2`.

## V1 RAG Flow

```text
/docs -> chunk -> embedding model -> in-memory vector store -> user request -> embed -> similarity search -> top 5 chunks -> LLM -> OrderPlan
```

OrderPlan output feeds order creation with:
- `fulfillmentProfile`
- `appliedRuleIds`
- `suggestedItems` when request is generic
