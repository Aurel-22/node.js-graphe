import express from "express";
import cors from "cors";
import compression from "compression";
import { config } from "dotenv";
import pino from "pino";
import pinoHttp from "pino-http";
import { Neo4jService } from "./services/Neo4jService.js";
import { ArangoService } from "./services/ArangoService.js";
import { MemgraphService } from "./services/MemgraphService.js";
import { MssqlService } from "./services/MssqlService.js";
import { GraphDatabaseService } from "./services/GraphDatabaseService.js";
import { graphRoutes } from "./routes/graphRoutes.js";
import { createDatabaseRoutes } from "./routes/databaseRoutes.js";

config(); // Charge .env

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const app = express();

// Middleware
app.use(cors({
  exposedHeaders: ['X-Cache', 'X-Response-Time', 'X-Parallel-Queries', 'X-Content-Length-Raw', 'Content-Length', 'X-Engine'],
}));
// Gzip compression — skipped if client sends ?nocompress=true (for benchmarking)
app.use(compression({
  filter: (req, res) => {
    if (req.query.nocompress === 'true') return false;
    return compression.filter(req, res);
  },
  level: 6,
}));
app.use(express.json({ limit: "50mb" }));
app.use(pinoHttp({ logger }));

// ===== Initialize database engines =====

const engines: Record<string, GraphDatabaseService> = {};

// Initialize Neo4j (if configured)
if (process.env.NEO4J_URI) {
  const neo4jService = new Neo4jService(
    process.env.NEO4J_URI,
    process.env.NEO4J_USER!,
    process.env.NEO4J_PASSWORD!,
  );
  await neo4jService.initialize();
  engines.neo4j = neo4jService;
  logger.info("Neo4j engine initialized");
}

// Initialize Memgraph (if configured)
if (process.env.MEMGRAPH_URI) {
  const memgraphService = new MemgraphService(process.env.MEMGRAPH_URI);
  await memgraphService.initialize();
  engines.memgraph = memgraphService;

  // Créer le graphe de démo s'il n'existe pas encore
  try {
    const graphs = await memgraphService.listGraphs();
    const hasDemo = graphs.some(g => g.id === "europe-cities-demo");
    if (!hasDemo) {
      await memgraphService.createDemoGraph();
      logger.info("Memgraph demo graph 'europe-cities-demo' created");
    } else {
      logger.info("Memgraph demo graph already exists — skipping creation");
    }
  } catch (demoErr: any) {
    logger.warn({ err: demoErr.message }, "Could not create Memgraph demo graph");
  }

  logger.info("Memgraph engine initialized");
}

// Initialize ArangoDB (if configured)
if (process.env.ARANGO_URL) {
  const arangoService = new ArangoService(
    process.env.ARANGO_URL,
    process.env.ARANGO_USER || "root",
    process.env.ARANGO_PASSWORD || "",
    process.env.ARANGO_DATABASE || "_system",
  );
  await arangoService.initialize();
  engines.arangodb = arangoService;
  logger.info("ArangoDB engine initialized");
}

// Initialize MSSQL (if configured)
if (process.env.MSSQL_HOST) {
  const mssqlService = new MssqlService(
    process.env.MSSQL_HOST,
    parseInt(process.env.MSSQL_PORT || "1433"),
    process.env.MSSQL_USER || "sa",
    process.env.MSSQL_PASSWORD || "",
    process.env.MSSQL_DATABASE || "graph_db",
  );
  await mssqlService.initialize();
  engines.mssql = mssqlService;
  logger.info("MSSQL engine initialized");
}

// Determine default engine
const defaultEngine = process.env.DEFAULT_ENGINE ||
  (engines.neo4j ? "neo4j" : engines.memgraph ? "memgraph" : engines.mssql ? "mssql" : "arangodb");

if (Object.keys(engines).length === 0) {
  logger.error("No database engine configured! Set NEO4J_URI and/or ARANGO_URL in .env");
  process.exit(1);
}

/** Middleware : résoudre le service selon ?engine=neo4j|arangodb */
function resolveEngine(req: express.Request, _res: express.Response, next: express.NextFunction) {
  const engineParam = (req.query.engine as string) || defaultEngine;
  const service = engines[engineParam];
  if (!service) {
    return _res.status(400).json({
      error: `Unknown engine '${engineParam}'. Available: ${Object.keys(engines).join(", ")}`,
    });
  }
  (req as any).dbService = service;
  next();
}

// Routes pour chaque moteur — préfixées /api
// Les routes utilisent ?engine=neo4j ou ?engine=arangodb
app.use("/api", resolveEngine, (req, res, next) => {
  const service: GraphDatabaseService = (req as any).dbService;
  graphRoutes(service)(req, res, next);
});

app.use("/api/databases", resolveEngine, (req, res, next) => {
  const service: GraphDatabaseService = (req as any).dbService;
  createDatabaseRoutes(service)(req, res, next);
});

// Health check — liste les moteurs disponibles
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    engines: Object.keys(engines),
    defaultEngine,
  });
});

// Liste des moteurs disponibles
app.get("/api/engines", (req, res) => {
  res.json({
    available: Object.keys(engines),
    default: defaultEngine,
  });
});

logger.info("Skipping example graphs creation for faster startup");

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
  logger.info(`Available engines: ${Object.keys(engines).join(", ")} (default: ${defaultEngine})`);
});
