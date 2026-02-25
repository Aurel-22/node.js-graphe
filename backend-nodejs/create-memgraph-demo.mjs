#!/usr/bin/env node
/**
 * create-memgraph-demo.mjs
 * ────────────────────────
 * Crée le graphe de démonstration "Réseau ferroviaire & aérien européen"
 * directement dans Memgraph via le driver neo4j-bolt.
 *
 * Usage :
 *   node create-memgraph-demo.mjs [bolt://127.0.0.1:7687]
 *
 * Memgraph doit tourner et écouter sur le port Bolt (7687 par défaut).
 * Aucun identifiant requis par défaut.
 */

import neo4j from "neo4j-driver";

const MEMGRAPH_URI = process.argv[2] ?? "bolt://172.17.0.2:7687";
const GRAPH_ID     = "europe-cities-demo";
const GRAPH_TITLE  = "Réseau ferroviaire & aérien européen";
const GRAPH_DESC   = "Graphe de démonstration Memgraph : villes européennes reliées par train et avion";
const GRAPH_TYPE   = "network";

const nodes = [
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

const edges = [
  { source: "paris",     target: "brussels",  label: "1h20",  edge_type: "train",  km: 315,  duration_min: 80  },
  { source: "paris",     target: "amsterdam", label: "3h20",  edge_type: "train",  km: 500,  duration_min: 200 },
  { source: "paris",     target: "lyon",      label: "2h",    edge_type: "train",  km: 450,  duration_min: 120 },
  { source: "paris",     target: "madrid",    label: "9h30",  edge_type: "train",  km: 1272, duration_min: 570 },
  { source: "paris",     target: "frankfurt", label: "3h50",  edge_type: "train",  km: 570,  duration_min: 230 },
  { source: "brussels",  target: "amsterdam", label: "1h50",  edge_type: "train",  km: 210,  duration_min: 110 },
  { source: "brussels",  target: "frankfurt", label: "3h",    edge_type: "train",  km: 380,  duration_min: 180 },
  { source: "frankfurt", target: "berlin",    label: "4h",    edge_type: "train",  km: 550,  duration_min: 240 },
  { source: "frankfurt", target: "vienna",    label: "6h30",  edge_type: "train",  km: 680,  duration_min: 390 },
  { source: "frankfurt", target: "zurich",    label: "3h",    edge_type: "train",  km: 340,  duration_min: 180 },
  { source: "zurich",    target: "milan",     label: "3h20",  edge_type: "train",  km: 290,  duration_min: 200 },
  { source: "zurich",    target: "vienna",    label: "8h",    edge_type: "train",  km: 780,  duration_min: 480 },
  { source: "milan",     target: "rome",      label: "3h",    edge_type: "train",  km: 575,  duration_min: 180 },
  { source: "milan",     target: "barcelona", label: "10h",   edge_type: "train",  km: 900,  duration_min: 600 },
  { source: "madrid",    target: "barcelona", label: "2h30",  edge_type: "train",  km: 620,  duration_min: 150 },
  { source: "lyon",      target: "milan",     label: "5h",    edge_type: "train",  km: 380,  duration_min: 300 },
  { source: "lyon",      target: "zurich",    label: "4h",    edge_type: "train",  km: 400,  duration_min: 240 },
  { source: "berlin",    target: "vienna",    label: "9h30",  edge_type: "train",  km: 680,  duration_min: 570 },
  { source: "paris",     target: "rome",      label: "2h15",  edge_type: "flight", km: 1105, duration_min: 135 },
  { source: "paris",     target: "berlin",    label: "1h55",  edge_type: "flight", km: 1050, duration_min: 115 },
  { source: "madrid",    target: "rome",      label: "2h30",  edge_type: "flight", km: 1365, duration_min: 150 },
  { source: "amsterdam", target: "berlin",    label: "1h30",  edge_type: "flight", km: 575,  duration_min: 90  },
];

// ────────────────────────────────────────────────────────────
const driver = neo4j.driver(MEMGRAPH_URI, neo4j.auth.none());

async function run() {
  const session = driver.session();
  try {
    console.log(`Connexion à Memgraph : ${MEMGRAPH_URI}`);

    // Initialiser contraintes et index
    for (const q of [
      `CREATE CONSTRAINT ON (g:Graph) ASSERT g.id IS UNIQUE`,
      `CREATE INDEX ON :GraphNode(graph_id)`,
      `CREATE INDEX ON :GraphNode(graph_id, node_id)`,
    ]) {
      try { await session.run(q); } catch (_) { /* déjà existant */ }
    }

    // Vérifier si le graphe existe déjà
    const existing = await session.run(
      `MATCH (g:Graph {id: $id}) RETURN g LIMIT 1`,
      { id: GRAPH_ID }
    );
    if (existing.records.length > 0) {
      console.log(`✓ Le graphe "${GRAPH_ID}" existe déjà — suppression avant recréation…`);
      await session.run(`MATCH (n:GraphNode {graph_id: $id}) DETACH DELETE n`, { id: GRAPH_ID });
      await session.run(`MATCH (g:Graph {id: $id}) DELETE g`, { id: GRAPH_ID });
    }

    // Créer le nœud Graph principal
    const createdAt = new Date().toISOString();
    await session.run(
      `CREATE (g:Graph {
         id: $id, title: $title, description: $desc,
         graph_type: $type, node_count: $nc, edge_count: $ec, created_at: $ca
       })`,
      { id: GRAPH_ID, title: GRAPH_TITLE, desc: GRAPH_DESC, type: GRAPH_TYPE,
        nc: nodes.length, ec: edges.length, ca: createdAt }
    );

    // Créer les nœuds
    for (const n of nodes) {
      await session.run(
        `CREATE (n:GraphNode {
           graph_id: $graphId, node_id: $nodeId, label: $label,
           node_type: $nodeType, properties: $props
         })`,
        { graphId: GRAPH_ID, nodeId: n.id, label: n.label,
          nodeType: n.node_type, props: JSON.stringify(n.properties) }
      );
    }
    console.log(`  ✓ ${nodes.length} nœuds créés`);

    // Créer les arêtes
    let edgeCount = 0;
    for (const e of edges) {
      await session.run(
        `MATCH (s:GraphNode {graph_id: $gid, node_id: $src})
         MATCH (t:GraphNode {graph_id: $gid, node_id: $tgt})
         CREATE (s)-[r:CONNECTED_TO {
           graph_id: $gid, label: $label, edge_type: $etype,
           properties: $props
         }]->(t)`,
        {
          gid: GRAPH_ID,
          src: e.source,
          tgt: e.target,
          label: e.label ?? "",
          etype: e.edge_type,
          props: JSON.stringify({ km: e.km, duration_min: e.duration_min }),
        }
      );
      edgeCount++;
    }
    console.log(`  ✓ ${edgeCount} arêtes créées`);
    console.log(`\n✅ Graphe "${GRAPH_TITLE}" (id: ${GRAPH_ID}) créé avec succès dans Memgraph !`);
    console.log(`   → Visualiser via l'API : GET /api/graphs/${GRAPH_ID}?engine=memgraph`);

  } finally {
    await session.close();
    await driver.close();
  }
}

run().catch(err => {
  console.error("❌ Erreur :", err.message);
  process.exit(1);
});
