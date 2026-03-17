import express from "express";
import http from "http";
import cors from "cors";
import compression from "compression";
import { config } from "dotenv";
import pino from "pino";
import pinoHttp from "pino-http";
import { WebSocketServer, WebSocket } from "ws";
import { MssqlService } from "./services/MssqlService.js";
import { GraphDatabaseService } from "./services/GraphDatabaseService.js";
import { graphRoutes } from "./routes/graphRoutes.js";
import { createDatabaseRoutes } from "./routes/databaseRoutes.js";
import { cmdbRoutes } from "./routes/cmdbRoutes.js";
import { algorithmRoutes } from "./routes/algorithmRoutes.js";

config(); // Charge .env

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const app = express();

// Middleware
app.use(cors({
  exposedHeaders: ['X-Cache', 'X-Response-Time', 'X-Parallel-Queries', 'X-Content-Length-Raw', 'Content-Length', 'X-Engine', 'X-Compression', 'X-Brotli-Size'],
}));
// Gzip compression — active by default for all responses
// Also compresses MsgPack (application/x-msgpack) which the default filter ignores
// Skipped if: ?nocompress=true (benchmarking) or ?compress=brotli (route-level Brotli)
app.use(compression({
  filter: (req, res) => {
    if (req.query.nocompress === 'true') return false;
    if (req.query.compress === 'brotli') return false;
    // Force compression for MsgPack too
    const contentType = res.getHeader('Content-Type');
    if (contentType && String(contentType).includes('msgpack')) return true;
    return compression.filter(req, res);
  },
  level: 6,
}));
app.use(express.json({ limit: "50mb" }));
app.use(pinoHttp({ logger }));

// ===== Initialize MSSQL engine =====

if (!process.env.MSSQL_HOST) {
  logger.error("MSSQL_HOST not configured in .env");
  process.exit(1);
}

const mssqlService = new MssqlService(
  process.env.MSSQL_HOST,
  parseInt(process.env.MSSQL_PORT || "1433"),
  process.env.MSSQL_USER || "sa",
  process.env.MSSQL_PASSWORD || "",
  process.env.MSSQL_DATABASE || "graph_db",
);
await mssqlService.initialize();
logger.info("MSSQL engine initialized");

// Auto-create covering indexes on startup (biggest perf gain: -50%)
try {
  const { created } = await mssqlService.createCoveringIndexes();
  if (created.length > 0) {
    logger.info({ created }, "Covering indexes created on default database");
  } else {
    logger.info("Covering indexes already exist on default database");
  }
} catch (err) {
  logger.warn({ err }, "Could not auto-create covering indexes (non-blocking)");
}

const dbService: GraphDatabaseService = mssqlService;

/** Middleware : injecter le service MSSQL dans la requête */
function resolveEngine(req: express.Request, _res: express.Response, next: express.NextFunction) {
  (req as any).dbService = dbService;
  next();
}

// Routes pour chaque moteur — préfixées /api
// Les routes utilisent ?engine=neo4j ou ?engine=arangodb
app.use("/api", resolveEngine, (req, res, next) => {
  const service: GraphDatabaseService = (req as any).dbService;
  graphRoutes(service, broadcast)(req, res, next);
});

app.use("/api/databases", resolveEngine, (req, res, next) => {
  const service: GraphDatabaseService = (req as any).dbService;
  createDatabaseRoutes(service)(req, res, next);
});

// ===== Algorithm routes =====
app.use("/api", resolveEngine, (req, res, next) => {
  const service: GraphDatabaseService = (req as any).dbService;
  algorithmRoutes(service)(req, res, next);
});

// ===== CMDB Import route =====
app.use("/api/cmdb", cmdbRoutes(
  {
    host: process.env.MSSQL_HOST,
    port: parseInt(process.env.MSSQL_PORT || "1433"),
    user: process.env.MSSQL_USER || "sa",
    password: process.env.MSSQL_PASSWORD || "",
  },
  mssqlService.createGraph.bind(mssqlService),
  broadcast,
));
logger.info("CMDB import route registered at POST /api/cmdb/import");

// ===== Raw query execution endpoint =====
// POST /api/query — execute raw SQL
app.post("/api/query", resolveEngine, async (req, res, next) => {
  try {
    const service: GraphDatabaseService = (req as any).dbService;
    const { query } = req.body as { query?: string };
    const database = req.query.database as string | undefined;

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return res.status(400).json({ error: "Missing 'query' in request body" });
    }

    if (!service.executeRawQuery) {
      return res.status(501).json({ error: `Engine '${service.engineName}' does not support raw queries` });
    }

    const result = await service.executeRawQuery(query.trim(), database);
    res.setHeader("X-Response-Time", `${result.elapsed_ms}ms`);
    res.setHeader("X-Engine", service.engineName);
    res.json(result);
  } catch (error: any) {
    // Return the DB error message for debugging
    res.status(400).json({
      error: error.message || "Query execution failed",
      engine: ((req as any).dbService as GraphDatabaseService)?.engineName,
    });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    engines: ["mssql"],
    defaultEngine: "mssql",
  });
});

// Liste des moteurs disponibles
app.get("/api/engines", (req, res) => {
  res.json({
    available: ["mssql"],
    default: "mssql",
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

const server = http.createServer(app);

// ===== WebSocket server =====
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  logger.info("WebSocket client connected");
  ws.send(JSON.stringify({ type: "connected", engines: ["mssql"] }));
  ws.on("close", () => logger.info("WebSocket client disconnected"));
});

/** Broadcast a message to all connected WebSocket clients. */
function broadcast(message: Record<string, any>) {
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

server.listen(PORT, HOST, () => {
  logger.info(`Server running at http://${HOST}:${PORT}`);
  logger.info(`WebSocket available at ws://${HOST}:${PORT}/ws`);
  logger.info(`Available engine: mssql`);
});
