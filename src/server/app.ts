import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSupervisorAgent } from "../agent/supervisorGraph.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");
const publicDir = path.join(projectRoot, "public");

const app = express();
app.use(express.json());
app.use(express.static(publicDir));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/orders/staging", async (req, res) => {
  const requestText = typeof req.body?.request === "string" ? req.body.request.trim() : "";

  if (!requestText) {
    res.status(400).json({
      error: "request is required",
      hint: "Pass JSON body: { \"request\": \"Create a tech order ...\" }"
    });
    return;
  }

  try {
    const result = await runSupervisorAgent(requestText);
    res.json(result);
  } catch (error: unknown) {
    res.status(500).json({
      error: "Agent failed",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

app.use((_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
app.listen(port, () => {
  console.log(`Staging order UI server running at http://localhost:${port}`);
});
