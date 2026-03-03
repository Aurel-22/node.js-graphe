// neo4j-driver-memgraph est un alias vers neo4j-driver@4.4.x
// (Bolt 4.x, seul protocole supporté par Memgraph 2.x)
// neo4j-driver v5 envoie un handshake Bolt 5.x que Memgraph rejette.
import neo4jV4 from "neo4j-driver-memgraph";
import type { Driver, Session } from "neo4j-driver";
import { Neo4jService } from "./Neo4jService.js";
import { Graph, GraphNode, GraphEdge, ImpactResult } from "../models/graph.js";

/**
 * Service Memgraph — hérite de Neo4jService.
 *
 * Memgraph est compatible avec le protocole Bolt de Neo4j, mais avec
 * quelques différences importantes :
 *  - Pas d'authentification par défaut (user/pass vides)
 *  - Une seule base de données (pas de multi-db)
 *  - Syntaxe de contraintes légèrement différente
 *  - URI en bolt:// (pas neo4j://)
 */
export class MemgraphService extends Neo4jService {
  override readonly engineName: string = "memgraph";

  constructor(uri: string) {
    // Appel parent avec des valeurs factices (on écrase le driver juste après)
    super(uri, "", "");
    // Remplacer le driver v5 par un driver v4 sans authentification.
    // On passe par `any` pour contourner l'incompatibilité de types entre v4 et v5.
    // neo4j-driver v4 n'a pas auth.none() — les credentials vides suffisent pour Memgraph sans auth
    this.driver = neo4jV4.driver(uri, neo4jV4.auth.basic("", "")) as any as Driver;
    // Memgraph n'a pas le concept de "default database" nommée
    this.defaultDatabase = "";
  }

  /** Session sans paramètre de database — Memgraph ne supporte pas le multi-db */
  protected override getSession(_database?: string): Session {
    return this.driver.session();
  }

  /** Initialisation : contraintes et index compatibles Memgraph */
  override async initialize(): Promise<void> {
    console.log("Initializing Memgraph database...");
    console.log(`  driver       : neo4j-driver v4 (Bolt 4.x — Memgraph compatible)`);
    console.log(`  auth        : basic('', '') — no auth (Memgraph default)`);

    // ── 1. Test de connectivité basique ──────────────────────────
    console.log("  [Memgraph] Testing connectivity (RETURN 1)...");
    const testSession = this.getSession();
    try {
      const r = await testSession.run("RETURN 1 AS ok");
      console.log(`  [Memgraph] Connectivity OK — got: ${JSON.stringify(r.records[0]?.get("ok"))}`);
    } catch (err: any) {
      console.error("  [Memgraph] ❌ Connectivity test FAILED");
      console.error("    code    :", err.code);
      console.error("    message :", err.message);
      console.error("    stack   :", err.stack);
      throw err; // inutile de continuer si la connexion est impossible
    } finally {
      await testSession.close();
    }

    // ── 2. Contrainte Graph.id unique ────────────────────────────
    const s1 = this.getSession();
    try {
      console.log("  [Memgraph] Creating constraint Graph.id...");
      await s1.run(`CREATE CONSTRAINT ON (g:Graph) ASSERT g.id IS UNIQUE`);
      console.log("  [Memgraph] Constraint created.");
    } catch (err: any) {
      if (err.message?.includes("already exists")) {
        console.log("  [Memgraph] Constraint already exists — OK.");
      } else {
        console.error("  [Memgraph] ❌ Constraint error — code:", err.code, "msg:", err.message);
      }
    } finally {
      await s1.close();
    }

    // ── 3. Index GraphNode(graph_id) ─────────────────────────────
    const s2 = this.getSession();
    try {
      console.log("  [Memgraph] Creating index :GraphNode(graph_id)...");
      await s2.run(`CREATE INDEX ON :GraphNode(graph_id)`);
      console.log("  [Memgraph] Index 1 created.");
    } catch (err: any) {
      if (err.message?.includes("already exists")) {
        console.log("  [Memgraph] Index 1 already exists — OK.");
      } else {
        console.error("  [Memgraph] ❌ Index 1 error — code:", err.code, "msg:", err.message);
      }
    } finally {
      await s2.close();
    }

    // ── 4. Index GraphNode(graph_id, node_id) ────────────────────
    // Note: Memgraph 2.x ne supporte pas les index composites — ignoré.

    console.log("  [Memgraph] Initialization complete ✓");
  }

  // =========================================================
  //  Multi-db stubs — Memgraph ne supporte pas les databases
  // =========================================================

  override async listDatabases(): Promise<Array<{ name: string; default: boolean; status: string }>> {
    return [{ name: "memgraph", default: true, status: "online" }];
  }

  override async createDatabase(_databaseName: string): Promise<void> {
    throw new Error("Memgraph does not support multiple databases");
  }

  override async deleteDatabase(_databaseName: string): Promise<void> {
    throw new Error("Memgraph does not support multiple databases");
  }

  /**
   * Override computeImpact — Memgraph ne supporte pas length(path).
   * On utilise size(relationships(path)) qui est équivalent.
   */
  override async computeImpact(graphId: string, nodeId: string, depth: number, database?: string): Promise<ImpactResult> {
    const t0 = Date.now();
    const maxDepth = Math.min(depth, 15);
    const session = this.getSession(database);
    try {
      const result = await session.run(
        `MATCH path = (source:GraphNode {graph_id: $graphId, node_id: $nodeId})
               -[:CONNECTED_TO*1..${maxDepth}]->
               (n:GraphNode {graph_id: $graphId})
         RETURN n.node_id AS nodeId, min(size(relationships(path))) AS level`,
        { graphId, nodeId }
      );

      const impactedNodes = result.records.map((r: any) => ({
        nodeId: r.get("nodeId") as string,
        level: typeof r.get("level")?.toNumber === "function"
          ? r.get("level").toNumber()
          : Number(r.get("level")),
      }));

      return {
        sourceNodeId: nodeId,
        impactedNodes,
        depth: maxDepth,
        elapsed_ms: Date.now() - t0,
        engine: this.engineName,
      };
    } finally {
      await session.close();
    }
  }

  // =========================================================
  //  Graphe de démonstration : réseau de villes européennes
  // =========================================================

  async createDemoGraph(): Promise<Graph> {
    console.log("Creating Memgraph demo graph...");

    const nodes: GraphNode[] = [
      { id: "paris",     label: "Paris",     node_type: "capital",  properties: { country: "France",      population: 2161000 } },
      { id: "berlin",    label: "Berlin",    node_type: "capital",  properties: { country: "Germany",     population: 3645000 } },
      { id: "madrid",    label: "Madrid",    node_type: "capital",  properties: { country: "Spain",       population: 3223000 } },
      { id: "rome",      label: "Rome",      node_type: "capital",  properties: { country: "Italy",       population: 2873000 } },
      { id: "brussels",  label: "Brussels",  node_type: "capital",  properties: { country: "Belgium",     population: 1218000 } },
      { id: "amsterdam", label: "Amsterdam", node_type: "capital",  properties: { country: "Netherlands", population: 921000  } },
      { id: "vienna",    label: "Vienna",    node_type: "capital",  properties: { country: "Austria",     population: 1897000 } },
      { id: "zurich",    label: "Zurich",    node_type: "hub",      properties: { country: "Switzerland", population: 434000  } },
      { id: "frankfurt", label: "Frankfurt", node_type: "hub",      properties: { country: "Germany",     population: 753000  } },
      { id: "lyon",      label: "Lyon",      node_type: "city",     properties: { country: "France",      population: 516000  } },
      { id: "milan",     label: "Milan",     node_type: "hub",      properties: { country: "Italy",       population: 1371000 } },
      { id: "barcelona", label: "Barcelona", node_type: "city",     properties: { country: "Spain",       population: 1620000 } },
    ];

    const edges: GraphEdge[] = [
      // Liaisons ferroviaires (< 4h)
      { source: "paris",     target: "brussels",  label: "1h20",  edge_type: "train", properties: { km: 315,  duration_min: 80  } },
      { source: "paris",     target: "amsterdam", label: "3h20",  edge_type: "train", properties: { km: 500,  duration_min: 200 } },
      { source: "paris",     target: "lyon",      label: "2h",    edge_type: "train", properties: { km: 450,  duration_min: 120 } },
      { source: "paris",     target: "madrid",    label: "9h30",  edge_type: "train", properties: { km: 1272, duration_min: 570 } },
      { source: "paris",     target: "frankfurt", label: "3h50",  edge_type: "train", properties: { km: 570,  duration_min: 230 } },
      { source: "brussels",  target: "amsterdam", label: "1h50",  edge_type: "train", properties: { km: 210,  duration_min: 110 } },
      { source: "brussels",  target: "frankfurt", label: "3h",    edge_type: "train", properties: { km: 380,  duration_min: 180 } },
      { source: "frankfurt", target: "berlin",    label: "4h",         edge_type: "train", properties: { km: 550,  duration_min: 240 } },
      { source: "frankfurt", target: "vienna",    label: "6h30",  edge_type: "train", properties: { km: 680,  duration_min: 390 } },
      { source: "frankfurt", target: "zurich",    label: "3h",    edge_type: "train", properties: { km: 340,  duration_min: 180 } },
      { source: "zurich",    target: "milan",     label: "3h20",  edge_type: "train", properties: { km: 290,  duration_min: 200 } },
      { source: "zurich",    target: "vienna",    label: "8h",    edge_type: "train", properties: { km: 780,  duration_min: 480 } },
      { source: "milan",     target: "rome",      label: "3h",    edge_type: "train", properties: { km: 575,  duration_min: 180 } },
      { source: "milan",     target: "barcelona", label: "10h",   edge_type: "train", properties: { km: 900,  duration_min: 600 } },
      { source: "madrid",    target: "barcelona", label: "2h30",  edge_type: "train", properties: { km: 620,  duration_min: 150 } },
      { source: "lyon",      target: "milan",     label: "5h",    edge_type: "train", properties: { km: 380,  duration_min: 300 } },
      { source: "lyon",      target: "zurich",    label: "4h",    edge_type: "train", properties: { km: 400,  duration_min: 240 } },
      { source: "berlin",    target: "vienna",    label: "9h30",  edge_type: "train", properties: { km: 680,  duration_min: 570 } },
      // Vols directs
      { source: "paris",     target: "rome",      label: "2h15",  edge_type: "flight", properties: { km: 1105, duration_min: 135 } },
      { source: "paris",     target: "berlin",    label: "1h55",  edge_type: "flight", properties: { km: 1050, duration_min: 115 } },
      { source: "madrid",    target: "rome",      label: "2h30",  edge_type: "flight", properties: { km: 1365, duration_min: 150 } },
      { source: "amsterdam", target: "berlin",    label: "1h30",  edge_type: "flight", properties: { km: 575,  duration_min: 90  } },
    ];

    return await this.createGraph(
      "europe-cities-demo",
      "Réseau ferroviaire & aérien européen",
      "Graphe de démonstration Memgraph : villes européennes reliées par train et avion",
      "network",
      nodes,
      edges
    );
  }
}
