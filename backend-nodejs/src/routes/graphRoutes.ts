import { Router } from "express";
import { encode } from "@msgpack/msgpack";
import { brotliCompress, constants as zlibConstants } from "zlib";
import { promisify } from "util";
import { GraphDatabaseService } from "../services/GraphDatabaseService.js";
import { MssqlService } from "../services/MssqlService.js";
import { MermaidParser } from "../services/MermaidParser.js";
import { CreateGraphRequest } from "../models/graph.js";

const brotliCompressAsync = promisify(brotliCompress);

export function graphRoutes(service: GraphDatabaseService, broadcast?: (msg: Record<string, any>) => void) {
  const router = Router();

  // List all graphs
  router.get("/graphs", async (req, res, next) => {
    const database = req.query.database as string | undefined;
    try {
      const graphs = await service.listGraphs(database);
      MssqlService.sqlLog("HTTP", database || "default", {
        method: "GET", route: "/graphs",
        client: req.ip, count: graphs.length,
      });
      res.json(graphs);
    } catch (error) {
      MssqlService.sqlLog("ERROR", database || "default", {
        method: "GET", route: "/graphs",
        client: req.ip, error: (error as Error).message,
      });
      next(error);
    }
  });

  // Get a specific graph
  // Options: ?format=msgpack (binary), ?enrich=true (live EasyVista data), ?nocache=true
  // Optim flags: ?forjson=true (SQL FOR JSON PATH), ?stream=true (chunked NDJSON)
  router.get("/graphs/:id", async (req, res, next) => {
    const database = req.query.database as string | undefined;
    try {
      const bypassCache = req.query.nocache === "true";
      const format = req.query.format as string | undefined;
      const enrich = req.query.enrich === "true";
      const useForJson = req.query.forjson === "true";
      const useStream = req.query.stream === "true";
      const t0 = Date.now();

      // ─── Streaming HTTP: chunked transfer ───
      if (useStream && service instanceof MssqlService) {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Transfer-Encoding", "chunked");
        res.setHeader("X-Cache", "BYPASS");
        res.setHeader("X-Engine", service.engineName);
        res.setHeader("X-Format", "stream");
        for await (const chunk of service.streamGraph(req.params.id, database)) {
          res.write(chunk);
        }
        const elapsed = Date.now() - t0;
        res.setHeader("X-Response-Time", `${elapsed}ms`);
        res.end();
        return;
      }

      // ─── FOR JSON PATH: SQL builds the JSON string ───
      if (useForJson && service instanceof MssqlService) {
        const jsonStr = await service.getGraphForJson(req.params.id, database);
        const elapsed = Date.now() - t0;
        const rawBytes = Buffer.byteLength(jsonStr, 'utf8');
        res.setHeader("X-Cache", "BYPASS");
        res.setHeader("X-Response-Time", `${elapsed}ms`);
        res.setHeader("X-Parallel-Queries", "true");
        res.setHeader("X-Engine", service.engineName);
        res.setHeader("X-Content-Length-Raw", rawBytes.toString());
        res.setHeader("X-Format", "forjson");
        res.setHeader("Content-Type", "application/json");
        res.send(jsonStr);
        return;
      }

      // Vérifier le cache avant la requête pour savoir si c'est un HIT
      const cacheKey = `graph:${database || "mssql"}:${req.params.id}`;
      const isHit = !bypassCache && (service as any).graphCache?.has(cacheKey);

      let graphData = await service.getGraph(req.params.id, database, bypassCache);

      // Enrichissement live EasyVista si demandé
      if (enrich && service instanceof MssqlService) {
        graphData = await service.enrichGraphFromEasyVista(graphData, database);
      }

      const elapsed = Date.now() - t0;

      res.setHeader("X-Cache", bypassCache ? "BYPASS" : isHit ? "HIT" : "MISS");
      res.setHeader("X-Response-Time", `${elapsed}ms`);
      res.setHeader("X-Parallel-Queries", "true");
      res.setHeader("X-Engine", service.engineName);
      if (enrich) res.setHeader("X-Enriched", "true");

      // Compression: Brotli when explicitly requested, gzip via middleware (default), or none
      const useBrotli = req.query.compress === 'brotli';
      const brotliQuality = Math.min(Math.max(parseInt(req.query.brotli_quality as string) || 4, 0), 11);

      // MessagePack binary format
      if (format === "msgpack") {
        const msgpackBuf = Buffer.from(encode(graphData));
        res.setHeader("X-Content-Length-Raw", msgpackBuf.length.toString());
        res.setHeader("X-Format", "msgpack");
        MssqlService.sqlLog("HTTP", database || "default", {
          method: "GET", route: `/graphs/${req.params.id}`,
          client: req.ip, format: "msgpack", enrich,
          nodes: graphData.nodes.length, edges: graphData.edges.length,
          responseSize: `${Math.round(msgpackBuf.length / 1024)}KB`,
          duration: `${elapsed}ms`,
        });
        if (useBrotli) {
          const compressed = await brotliCompressAsync(msgpackBuf, {
            params: { [zlibConstants.BROTLI_PARAM_QUALITY]: brotliQuality },
          });
          res.setHeader("X-Compression", `brotli-q${brotliQuality}`);
          res.setHeader("X-Brotli-Size", compressed.length.toString());
          res.type("application/octet-stream").send(compressed);
        } else {
          res.type("application/x-msgpack").send(msgpackBuf);
        }
      } else {
        const jsonStr = JSON.stringify(graphData);
        const rawBytes = Buffer.byteLength(jsonStr, 'utf8');
        res.setHeader("X-Content-Length-Raw", rawBytes.toString());
        res.setHeader("X-Format", "json");
        res.setHeader("Content-Type", "application/json");
        MssqlService.sqlLog("HTTP", database || "default", {
          method: "GET", route: `/graphs/${req.params.id}`,
          client: req.ip, format: "json", enrich,
          nodes: graphData.nodes.length, edges: graphData.edges.length,
          responseSize: `${Math.round(rawBytes / 1024)}KB`,
          duration: `${elapsed}ms`,
        });
        if (useBrotli) {
          const compressed = await brotliCompressAsync(Buffer.from(jsonStr, 'utf8'), {
            params: { [zlibConstants.BROTLI_PARAM_QUALITY]: brotliQuality },
          });
          res.setHeader("X-Compression", `brotli-q${brotliQuality}`);
          res.setHeader("X-Brotli-Size", compressed.length.toString());
          res.type("application/octet-stream").send(compressed);
        } else {
          res.send(jsonStr);
        }
      }
    } catch (error) {
      MssqlService.sqlLog("ERROR", database || "default", {
        method: "GET", route: `/graphs/${req.params.id}`,
        client: req.ip, error: (error as Error).message,
      });
      next(error);
    }
  });

  // Get graph statistics
  router.get("/graphs/:id/stats", async (req, res, next) => {
    try {
      const database = req.query.database as string | undefined;
      const stats = await service.getGraphStats(req.params.id, database);
      res.json(stats);
    } catch (error) {
      next(error);
    }
  });

  // Get starting node for a graph
  router.get("/graphs/:id/starting-node", async (req, res, next) => {
    try {
      const database = req.query.database as string | undefined;
      const node = await service.getStartingNode(req.params.id, database);
      if (!node) {
        return res.status(404).json({ error: "No nodes found in graph" });
      }
      res.json(node);
    } catch (error) {
      next(error);
    }
  });

  // Get neighbors of a node
  router.get("/graphs/:id/nodes/:nodeId/neighbors", async (req, res, next) => {
    try {
      const database = req.query.database as string | undefined;
      const depth = Math.min(parseInt(req.query.depth as string) || 1, 15); // Limite à 15 niveaux maximum
      const neighbors = await service.getNodeNeighbors(
        req.params.id,
        req.params.nodeId,
        depth,
        database
      );
      res.json(neighbors);
    } catch (error) {
      next(error);
    }
  });

  // Server-side impact analysis — POST /graphs/:id/impact
  // Body: { nodeId: string, depth?: number (1–15, default 5), threshold?: number (0–100) }
  // threshold = pourcentage minimum de parents impactés pour propager (0 = dès qu'un seul parent est impacté)
  // Retourne les nœuds impactés en aval + temps de calcul côté serveur.
  router.post("/graphs/:id/impact", async (req, res, next) => {
    try {
      const database = req.query.database as string | undefined;
      const { nodeId, depth = 5, threshold = 0 } = req.body as { nodeId?: string; depth?: number; threshold?: number };
      if (!nodeId) {
        return res.status(400).json({ error: "Missing nodeId in request body" });
      }
      const t0 = Date.now();
      const safeThreshold = Math.max(0, Math.min(100, Number(threshold) || 0));
      const result = await service.computeImpact(
        req.params.id,
        nodeId,
        Math.min(Number(depth), 15),
        database,
        safeThreshold,
      );
      res.setHeader("X-Response-Time", `${Date.now() - t0}ms`);
      res.setHeader("X-Engine", service.engineName);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // Benchmark: compare loading strategies
  // GET /graphs/:id/benchmark?iterations=3
  // Tests: SQL direct, Cache, JSON parse, MessagePack encode, Enrichment (if applicable)
  router.get("/graphs/:id/benchmark", async (req, res, next) => {
    try {
      const database = req.query.database as string | undefined;
      const iterations = Math.min(parseInt(req.query.iterations as string) || 3, 50);

      // 1. Warm up the cache first
      await service.getGraph(req.params.id, database, false);

      // 2. Measure SQL direct (bypass cache) — multiple iterations
      const sqlTimes: number[] = [];
      let graphData: any = null;
      for (let i = 0; i < iterations; i++) {
        const t0 = performance.now();
        graphData = await service.getGraph(req.params.id, database, true); // nocache
        sqlTimes.push(Math.round((performance.now() - t0) * 100) / 100);
      }

      // 3. Measure Cache HIT — multiple iterations
      const cacheTimes: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const t0 = performance.now();
        await service.getGraph(req.params.id, database, false); // with cache
        cacheTimes.push(Math.round((performance.now() - t0) * 100) / 100);
      }

      // 4. Measure JSON serialization/deserialization
      const jsonStr = JSON.stringify(graphData);
      const jsonTimes: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const t0 = performance.now();
        JSON.parse(jsonStr);
        jsonTimes.push(Math.round((performance.now() - t0) * 100) / 100);
      }

      // 5. Measure MessagePack encode
      const msgpackTimes: number[] = [];
      let msgpackSize = 0;
      for (let i = 0; i < iterations; i++) {
        const t0 = performance.now();
        const buf = encode(graphData);
        msgpackTimes.push(Math.round((performance.now() - t0) * 100) / 100);
        if (i === 0) msgpackSize = buf.byteLength;
      }

      // 6. Measure enrichment (if MssqlService and nodes have CI_ prefix)
      const enrichTimes: number[] = [];
      const isMssql = service instanceof MssqlService;
      const hasCiNodes = graphData.nodes?.some((n: any) => n.id?.startsWith("CI_"));
      if (isMssql && hasCiNodes) {
        for (let i = 0; i < iterations; i++) {
          // Deep clone to avoid mutating cached data
          const clone = JSON.parse(JSON.stringify(graphData));
          const t0 = performance.now();
          await service.enrichGraphFromEasyVista(clone, database);
          enrichTimes.push(Math.round((performance.now() - t0) * 100) / 100);
        }
      }

      const avg = (arr: number[]) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 100) / 100;
      const min = (arr: number[]) => Math.min(...arr);
      const max = (arr: number[]) => Math.max(...arr);

      const jsonSizeBytes = Buffer.byteLength(jsonStr, 'utf8');

      const result: Record<string, any> = {
        graphId: req.params.id,
        engine: service.engineName,
        database: database || 'default',
        iterations,
        nodeCount: graphData.nodes?.length || 0,
        edgeCount: graphData.edges?.length || 0,
        jsonSizeBytes,
        jsonSizeKB: Math.round(jsonSizeBytes / 1024 * 10) / 10,
        msgpackSizeBytes: msgpackSize,
        msgpackSizeKB: Math.round(msgpackSize / 1024 * 10) / 10,
        compressionRatio: Math.round((1 - msgpackSize / jsonSizeBytes) * 1000) / 10,
        sql: {
          times: sqlTimes,
          avg: avg(sqlTimes),
          min: min(sqlTimes),
          max: max(sqlTimes),
          label: 'Requête SQL directe (bypass cache)',
        },
        cache: {
          times: cacheTimes,
          avg: avg(cacheTimes),
          min: min(cacheTimes),
          max: max(cacheTimes),
          label: 'Cache NodeCache (mémoire serveur)',
        },
        json: {
          times: jsonTimes,
          avg: avg(jsonTimes),
          min: min(jsonTimes),
          max: max(jsonTimes),
          label: 'JSON parse (désérialisation)',
        },
        msgpack: {
          times: msgpackTimes,
          avg: avg(msgpackTimes),
          min: min(msgpackTimes),
          max: max(msgpackTimes),
          label: 'MessagePack encode (sérialisation binaire)',
        },
        speedup: {
          cacheVsSql: Math.round(avg(sqlTimes) / Math.max(avg(cacheTimes), 0.01) * 10) / 10,
          jsonVsSql: Math.round(avg(sqlTimes) / Math.max(avg(jsonTimes), 0.01) * 10) / 10,
          msgpackVsJson: Math.round(avg(jsonTimes) / Math.max(avg(msgpackTimes), 0.01) * 10) / 10,
        },
      };

      if (enrichTimes.length > 0) {
        result.enrich = {
          times: enrichTimes,
          avg: avg(enrichTimes),
          min: min(enrichTimes),
          max: max(enrichTimes),
          label: 'Enrichissement live EasyVista',
        };
      }

      // Check covering indexes status
      if (isMssql) {
        result.coveringIndexes = await service.hasCoveringIndexes(database);
      }

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // Create a new graph from Mermaid code
  router.post("/graphs", async (req, res, next) => {
    try {
      const body = req.body as CreateGraphRequest;
      const database = req.query.database as string | undefined;

      // Validate input
      if (!body.title || !body.description) {
        return res.status(400).json({
          error: "Missing required fields: title, description",
        });
      }
      if (!body.mermaid_code && (!body.nodes || body.nodes.length === 0)) {
        return res.status(400).json({
          error: "Provide either mermaid_code or a non-empty nodes array",
        });
      }

      // Parse Mermaid code OR utiliser les nœuds/arêtes fournis directement
      let nodes: import('../models/graph.js').GraphNode[];
      let edges: import('../models/graph.js').GraphEdge[];
      if (body.nodes) {
        nodes = body.nodes.map(n => ({
          id: n.id,
          label: n.label,
          node_type: n.node_type,
          properties: n.properties ?? {},
        }));
        edges = (body.edges ?? []).map(e => ({
          source: e.source,
          target: e.target,
          label: e.label ?? e.edge_type,
          edge_type: e.edge_type,
          properties: e.properties ?? {},
        }));
      } else {
        ({ nodes, edges } = MermaidParser.parse(body.mermaid_code!));
      }

      // Generate unique graph ID
      const graphId = `graph_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Create graph in database
      const graph = await service.createGraph(
        graphId,
        body.title,
        body.description,
        body.graph_type || "flowchart",
        nodes,
        edges,
        database,
      );

      // Broadcast WebSocket event
      broadcast?.({
        type: "graph:created",
        graphId,
        title: body.title,
        engine: service.engineName,
        database,
      });

      res.status(201).json(graph);
    } catch (error) {
      if (error instanceof Error && error.message.includes("No nodes found")) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  // Delete a graph (+ invalider le cache)
  router.delete("/graphs/:id", async (req, res, next) => {
    try {
      const database = req.query.database as string | undefined;
      await service.deleteGraph(req.params.id, database);
      service.clearCache(req.params.id, database);

      // Broadcast WebSocket event
      broadcast?.({
        type: "graph:deleted",
        graphId: req.params.id,
        engine: service.engineName,
        database,
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // --- Cache management ---

  // GET /optim/cache/stats
  router.get("/optim/cache/stats", (_req, res) => {
    res.json(service.getCacheStats());
  });

  // DELETE /optim/cache
  router.delete("/optim/cache", (_req, res) => {
    const result = service.clearCache();
    res.json({ message: "Cache cleared", ...result });
  });

  // ── Covering Indexes management ──

  // GET /optim/indexes/covering — check if covering indexes exist
  router.get("/optim/indexes/covering", async (req, res, next) => {
    try {
      if (!(service instanceof MssqlService)) {
        res.status(400).json({ error: "Covering indexes only supported on MSSQL engine" });
        return;
      }
      const database = req.query.database as string | undefined;
      const exists = await service.hasCoveringIndexes(database);
      res.json({ coveringIndexes: exists, database: database || "default" });
    } catch (error) {
      next(error);
    }
  });

  // POST /optim/indexes/covering — create covering indexes
  router.post("/optim/indexes/covering", async (req, res, next) => {
    try {
      if (!(service instanceof MssqlService)) {
        res.status(400).json({ error: "Covering indexes only supported on MSSQL engine" });
        return;
      }
      const database = req.query.database as string | undefined;
      await service.createCoveringIndexes(database);
      res.json({ message: "Covering indexes created", database: database || "default" });
    } catch (error) {
      next(error);
    }
  });

  // DELETE /optim/indexes/covering — drop covering indexes
  router.delete("/optim/indexes/covering", async (req, res, next) => {
    try {
      if (!(service instanceof MssqlService)) {
        res.status(400).json({ error: "Covering indexes only supported on MSSQL engine" });
        return;
      }
      const database = req.query.database as string | undefined;
      await service.dropCoveringIndexes(database);
      res.json({ message: "Covering indexes dropped", database: database || "default" });
    } catch (error) {
      next(error);
    }
  });

  // GET /optim/status  — indique quelles optimisations sont actives
  router.get("/optim/status", async (req, res, next) => {
    try {
      const database = req.query.database as string | undefined;
      const isMssql = service instanceof MssqlService;

      let coveringIndexes = false;
      if (isMssql) {
        coveringIndexes = await service.hasCoveringIndexes(database);
      }

      res.json({
        gzip: true,
        parallelQueries: true,
        inMemoryCache: true,
        cacheTtlSeconds: 300,
        coveringIndexes,
        msgpackSupport: true,
        enrichmentSupport: isMssql,
        bypassFlags: {
          cache: "?nocache=true",
          gzip: "Accept-Encoding: identity header",
        },
        queryParams: {
          format: "?format=msgpack — retourne du MessagePack binaire au lieu de JSON",
          enrich: "?enrich=true — enrichit les nœuds CI_ avec les données live EasyVista",
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
