import { Router } from "express";
import { GraphDatabaseService } from "../services/GraphDatabaseService.js";
import { MermaidParser } from "../services/MermaidParser.js";
import { CreateGraphRequest } from "../models/graph.js";

export function graphRoutes(service: GraphDatabaseService) {
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
      const cacheKey = `graph:${database || "neo4j"}:${req.params.id}`;
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
  // Body: { nodeId: string, depth?: number (1–15, default 5) }
  // Retourne les nœuds impactés en aval + temps de calcul côté serveur.
  // Permet de comparer la latence entre le BFS client (graphology) et le moteur serveur.
  router.post("/graphs/:id/impact", async (req, res, next) => {
    try {
      const database = req.query.database as string | undefined;
      const { nodeId, depth = 5 } = req.body as { nodeId?: string; depth?: number };
      if (!nodeId) {
        return res.status(400).json({ error: "Missing nodeId in request body" });
      }
      const t0 = Date.now();
      const result = await service.computeImpact(
        req.params.id,
        nodeId,
        Math.min(Number(depth), 15),
        database
      );
      res.setHeader("X-Response-Time", `${Date.now() - t0}ms`);
      res.setHeader("X-Engine", service.engineName);
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
