import "dotenv/config";
import { runStagingOrderAgent } from "./agent/stagingOrderGraph.js";

async function main(): Promise<void> {
  const request = process.argv.slice(2).join(" ").trim();

  if (!request) {
    console.error(
      "Usage: npm run agent -- \"Create a rush order for Acme Retail with 2 units of SKU-RED-001 and 1 x SKU-BLU-002 to Seattle by Jordan\""
    );
    process.exit(1);
  }

  const result = await runStagingOrderAgent(request);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error("Agent failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
