import express from "express";
import cors from "cors";
import { config } from "dotenv";
import pino from "pino";
import pinoHttp from "pino-http";
import { Neo4jService } from "./services/Neo4jService.js";
import { graphRoutes } from "./routes/graphRoutes.js";
import { createDatabaseRoutes } from "./routes/databaseRoutes.js";

config(); // Charge .env

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(pinoHttp({ logger }));

// Initialize Neo4j
const neo4jService = new Neo4jService(
  process.env.NEO4J_URI!,
  process.env.NEO4J_USER!,
  process.env.NEO4J_PASSWORD!,
);

await neo4jService.initialize();

// Créer les graphes de test
try {
  await neo4jService.createExampleGraph();
  logger.info("Example graph created");
} catch (err: any) {
  logger.error("Failed to create example graph", err);
}

try {
  await neo4jService.createXLargeTestGraph();
  logger.info("XLarge test graph created");
} catch (err: any) {
  logger.error("Failed to create xlarge graph", err);
}

// Routes
app.use("/api", graphRoutes(neo4jService));
app.use("/api/databases", createDatabaseRoutes(neo4jService));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Error handler
app.use((err: any, req: any, res: any, next: any) => {
  logger.error(err);
  res
    .status(err.status || 500)
    .json({ error: err.message || "Internal server error" });
});

// Start server
const PORT = parseInt(process.env.SERVER_PORT || "8080");
const HOST = process.env.SERVER_HOST || "127.0.0.1";

app.listen(PORT, HOST, () => {
  logger.info(`Server running at http://${HOST}:${PORT}`);
});
