import { Router } from "express";
import { GraphDatabaseService } from "../services/GraphDatabaseService.js";
import { MermaidParser } from "../services/MermaidParser.js";
import { CreateGraphRequest } from "../models/graph.js";

export function graphRoutes(service: GraphDatabaseService, broadcast?: (msg: Record<string, any>) => void) {
  const router = Router();

  // List all graphs
  router.get("/graphs", async (req, res, next) => {
    try {
      const database = req.query.database as string | undefined;
      const graphs = await service.listGraphs(database);
      res.json(graphs);
    } catch (error) {
      next(error);
    }
  });

  // Get a specific graph
  router.get("/graphs/:id", async (req, res, next) => {
    try {
      const database = req.query.database as string | undefined;
      const bypassCache = req.query.nocache === "true";
      const t0 = Date.now();

      // Vérifier le cache avant la requête pour savoir si c'est un HIT
      const cacheKey = `graph:${database || "mssql"}:${req.params.id}`;
      const isHit = !bypassCache && (service as any).graphCache?.has(cacheKey);

      const graphData = await service.getGraph(req.params.id, database, bypassCache);

      const elapsed = Date.now() - t0;
      const jsonStr = JSON.stringify(graphData);
      const rawBytes = Buffer.byteLength(jsonStr, 'utf8');
      res.setHeader("X-Cache", bypassCache ? "BYPASS" : isHit ? "HIT" : "MISS");
      res.setHeader("X-Response-Time", `${elapsed}ms`);
      res.setHeader("X-Parallel-Queries", "true");
      res.setHeader("X-Content-Length-Raw", rawBytes.toString());
      res.setHeader("X-Engine", service.engineName);
      res.setHeader("Content-Type", "application/json");
      res.send(jsonStr);
    } catch (error) {
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

  // Benchmark: compare SQL vs Cache vs JSON timing
  // GET /graphs/:id/benchmark — runs SQL + cache queries and returns timings
  router.get("/graphs/:id/benchmark", async (req, res, next) => {
    try {
      const database = req.query.database as string | undefined;
      const iterations = Math.min(parseInt(req.query.iterations as string) || 3, 10);

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

      const avg = (arr: number[]) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 100) / 100;
      const min = (arr: number[]) => Math.min(...arr);
      const max = (arr: number[]) => Math.max(...arr);

      const jsonSizeBytes = Buffer.byteLength(jsonStr, 'utf8');

      res.json({
        graphId: req.params.id,
        engine: service.engineName,
        database: database || 'default',
        iterations,
        nodeCount: graphData.nodes?.length || 0,
        edgeCount: graphData.edges?.length || 0,
        jsonSizeBytes,
        jsonSizeKB: Math.round(jsonSizeBytes / 1024 * 10) / 10,
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
        speedup: {
          cacheVsSql: Math.round(avg(sqlTimes) / Math.max(avg(cacheTimes), 0.01) * 10) / 10,
          jsonVsSql: Math.round(avg(sqlTimes) / Math.max(avg(jsonTimes), 0.01) * 10) / 10,
        },
      });
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

  // GET /optim/status  — indique quelles optimisations sont actives
  router.get("/optim/status", (_req, res) => {
    res.json({
      gzip: true,          // toujours actif (middleware global)
      parallelQueries: true, // toujours actif dans getGraph
      inMemoryCache: true, // toujours actif sauf ?nocache=true
      cacheTtlSeconds: 300,
      bypassFlags: {
        cache: "?nocache=true",
        gzip: "Accept-Encoding: identity header",
      },
    });
  });

  return router;
}
