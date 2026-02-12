import { Router } from "express";
import { Neo4jService } from "../services/Neo4jService.js";
import { MermaidParser } from "../services/MermaidParser.js";
import { CreateGraphRequest } from "../models/graph.js";

export function graphRoutes(neo4jService: Neo4jService) {
  const router = Router();

  // List all graphs
  router.get("/graphs", async (req, res, next) => {
    try {
      const database = req.query.database as string | undefined;
      const graphs = await neo4jService.listGraphs(database);
      res.json(graphs);
    } catch (error) {
      next(error);
    }
  });

  // Get a specific graph
  router.get("/graphs/:id", async (req, res, next) => {
    try {
      const database = req.query.database as string | undefined;
      const graphData = await neo4jService.getGraph(req.params.id, database);
      res.json(graphData);
    } catch (error) {
      next(error);
    }
  });

  // Get graph statistics
  router.get("/graphs/:id/stats", async (req, res, next) => {
    try {
      const database = req.query.database as string | undefined;
      const stats = await neo4jService.getGraphStats(req.params.id, database);
      res.json(stats);
    } catch (error) {
      next(error);
    }
  });

  // Get starting node for a graph
  router.get("/graphs/:id/starting-node", async (req, res, next) => {
    try {
      const database = req.query.database as string | undefined;
      const node = await neo4jService.getStartingNode(req.params.id, database);
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
      const neighbors = await neo4jService.getNodeNeighbors(
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

  // Create a new graph from Mermaid code
  router.post("/graphs", async (req, res, next) => {
    try {
      const body = req.body as CreateGraphRequest;
      const database = req.query.database as string | undefined;

      // Validate input
      if (!body.title || !body.description || !body.mermaid_code) {
        return res.status(400).json({
          error: "Missing required fields: title, description, mermaid_code",
        });
      }

      // Parse Mermaid code
      const { nodes, edges } = MermaidParser.parse(body.mermaid_code);

      // Generate unique graph ID
      const graphId = `graph_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Create graph in database
      const graph = await neo4jService.createGraph(
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

  // Delete a graph
  router.delete("/graphs/:id", async (req, res, next) => {
    try {
      const database = req.query.database as string | undefined;
      await neo4jService.deleteGraph(req.params.id, database);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
