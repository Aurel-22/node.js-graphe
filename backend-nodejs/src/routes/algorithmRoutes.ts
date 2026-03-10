import { Router } from "express";
import { GraphDatabaseService } from "../services/GraphDatabaseService.js";
import { AlgorithmService, AlgorithmResult } from "../services/AlgorithmService.js";

/**
 * Routes pour exécuter des algorithmes de graphe côté serveur.
 * Le graphe est chargé via le service DB, puis traité en mémoire par AlgorithmService.
 *
 * POST /graphs/:id/algorithms  { algorithm, sourceNode?, targetNode?, depth?, iterations?, damping?, threshold?, sampleSize? }
 */
export function algorithmRoutes(service: GraphDatabaseService) {
  const router = Router();

  const ALGORITHMS = [
    "bfs",
    "dfs",
    "bidirectional-bfs",
    "dijkstra",
    "degree-centrality",
    "betweenness-centrality",
    "closeness-centrality",
    "pagerank",
    "louvain",
    "label-propagation",
    "connected-components",
    "strongly-connected-components",
    "topological-sort",
    "cascading-failure",
  ];

  // Liste des algorithmes disponibles
  router.get("/graphs/:id/algorithms", (_req, res) => {
    res.json({ algorithms: ALGORITHMS });
  });

  // Exécuter un algorithme
  router.post("/graphs/:id/algorithms", async (req, res, next) => {
    try {
      const graphId = req.params.id;
      const database = req.query.database as string | undefined;

      const {
        algorithm,
        sourceNode,
        targetNode,
        depth = 100,
        iterations = 20,
        damping = 0.85,
        threshold = 0.5,
        sampleSize,
      } = req.body as {
        algorithm: string;
        sourceNode?: string;
        targetNode?: string;
        depth?: number;
        iterations?: number;
        damping?: number;
        threshold?: number;
        sampleSize?: number;
      };

      if (!algorithm || !ALGORITHMS.includes(algorithm)) {
        return res.status(400).json({
          error: `Unknown algorithm '${algorithm}'. Available: ${ALGORITHMS.join(", ")}`,
        });
      }

      // Charger le graphe depuis la BDD
      const graphData = await service.getGraph(graphId, database, true); // bypass cache pour avoir les données fraîches

      if (!graphData || graphData.nodes.length === 0) {
        return res.status(404).json({ error: `Graph '${graphId}' not found or empty` });
      }

      let result: AlgorithmResult;

      switch (algorithm) {
        case "bfs":
          if (!sourceNode) return res.status(400).json({ error: "sourceNode is required for BFS" });
          result = AlgorithmService.bfs(graphData, sourceNode, depth);
          break;

        case "dfs":
          if (!sourceNode) return res.status(400).json({ error: "sourceNode is required for DFS" });
          result = AlgorithmService.dfs(graphData, sourceNode, depth);
          break;

        case "bidirectional-bfs":
          if (!sourceNode || !targetNode) return res.status(400).json({ error: "sourceNode and targetNode are required for bidirectional BFS" });
          result = AlgorithmService.bidirectionalBfs(graphData, sourceNode, targetNode);
          break;

        case "dijkstra":
          if (!sourceNode) return res.status(400).json({ error: "sourceNode is required for Dijkstra" });
          result = AlgorithmService.dijkstra(graphData, sourceNode, targetNode);
          break;

        case "degree-centrality":
          result = AlgorithmService.degreeCentrality(graphData);
          break;

        case "betweenness-centrality":
          result = AlgorithmService.betweennessCentrality(graphData, sampleSize);
          break;

        case "closeness-centrality":
          result = AlgorithmService.closenessCentrality(graphData);
          break;

        case "pagerank":
          result = AlgorithmService.pageRank(graphData, iterations, damping);
          break;

        case "louvain":
          result = AlgorithmService.louvain(graphData);
          break;

        case "label-propagation":
          result = AlgorithmService.labelPropagation(graphData, iterations);
          break;

        case "connected-components":
          result = AlgorithmService.connectedComponents(graphData);
          break;

        case "strongly-connected-components":
          result = AlgorithmService.stronglyConnectedComponents(graphData);
          break;

        case "topological-sort":
          result = AlgorithmService.topologicalSort(graphData);
          break;

        case "cascading-failure":
          if (!sourceNode) return res.status(400).json({ error: "sourceNode is required for cascading failure" });
          result = AlgorithmService.cascadingFailure(graphData, sourceNode, threshold);
          break;

        default:
          return res.status(400).json({ error: `Algorithm '${algorithm}' not implemented` });
      }

      res.setHeader("X-Response-Time", `${result.elapsed_ms}ms`);
      res.setHeader("X-Engine", service.engineName);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
