/**
 * Crée un graphe de 1 000 nœuds dans Memgraph.
 * Structure identique à create-1k-graph.mjs (5 communautés de 200 nœuds).
 *
 * Usage :
 *   node create-memgraph-1k-graph.mjs [bolt://127.0.0.1:7688]
 */

import neo4j from 'neo4j-driver-memgraph';
import { config } from 'dotenv';

config();

const URI = process.argv[2] ?? process.env.MEMGRAPH_URI ?? 'bolt://127.0.0.1:7688';

const GRAPH_ID          = 'memgraph_community_1k';
const NODE_COUNT        = 1_000;
const COMMUNITY_COUNT   = 5;
const NODES_PER_COMMUNITY = NODE_COUNT / COMMUNITY_COUNT; // 200

const NODE_TYPES  = ['process', 'service', 'database', 'api', 'user', 'system', 'queue', 'notification', 'validation', 'action'];
const EDGE_TYPES  = ['calls', 'depends_on', 'reads', 'writes', 'triggers', 'validates', 'notifies', 'queues'];

console.log(`\n🔧 Génération du graphe "${GRAPH_ID}" — ${NODE_COUNT} nœuds, ${COMMUNITY_COUNT} communautés`);
console.log(`   URI Memgraph : ${URI}\n`);

// ─── Génération des nœuds ─────────────────────────────────────────────────
const nodes = [];
for (let i = 0; i < NODE_COUNT; i++) {
  const community  = Math.floor(i / NODES_PER_COMMUNITY);
  const localIndex = i % NODES_PER_COMMUNITY;
  const nodeType   = NODE_TYPES[community];
  nodes.push({
    node_id:    `C${community}_N${localIndex}`,
    label:      `${nodeType.charAt(0).toUpperCase() + nodeType.slice(1)} ${community}.${localIndex}`,
    node_type:  nodeType,
    properties: JSON.stringify({ community, localIndex }),
  });
}
console.log(`  ✅ ${nodes.length} nœuds générés`);

// ─── Génération des arêtes ────────────────────────────────────────────────
const edges   = [];
const edgeSet = new Set();

function addEdge(source, target, edgeType) {
  const key = `${source}->${target}`;
  if (edgeSet.has(key) || source === target) return;
  edgeSet.add(key);
  edges.push({ source, target, edge_type: edgeType, label: edgeType, properties: '{}' });
}

for (let c = 0; c < COMMUNITY_COUNT; c++) {
  for (let i = 0; i < NODES_PER_COMMUNITY; i++) {
    const nodeId = `C${c}_N${i}`;
    if (i < NODES_PER_COMMUNITY - 1)              addEdge(nodeId, `C${c}_N${i + 1}`,  'calls');
    if (i + 3 < NODES_PER_COMMUNITY)              addEdge(nodeId, `C${c}_N${i + 3}`,  'depends_on');
    if (i + 7 < NODES_PER_COMMUNITY && i % 2 ===0) addEdge(nodeId, `C${c}_N${i + 7}`,  'reads');
    if (i + 15 < NODES_PER_COMMUNITY && i % 3 ===0) addEdge(nodeId, `C${c}_N${i + 15}`, 'triggers');
    if (i + 30 < NODES_PER_COMMUNITY && i % 5 ===0) addEdge(nodeId, `C${c}_N${i + 30}`, 'writes');
    if (i > 5 && i % 4 === 0)                      addEdge(nodeId, `C${c}_N${i - 5}`,  'validates');
    if (i % 6 === 0) {
      const offset = 10 + (i % 20);
      if (i + offset < NODES_PER_COMMUNITY)
        addEdge(nodeId, `C${c}_N${i + offset}`, EDGE_TYPES[i % EDGE_TYPES.length]);
    }
  }
  for (let j = 50; j < NODES_PER_COMMUNITY; j += 50) addEdge(`C${c}_N0`, `C${c}_N${j}`, 'queues');
}
// Ponts inter-communautés
for (let c = 0; c < COMMUNITY_COUNT; c++) {
  const nextC     = (c + 1) % COMMUNITY_COUNT;
  const oppositeC = (c + 5) % COMMUNITY_COUNT;
  addEdge(`C${c}_N0`, `C${nextC}_N0`,     'calls');
  addEdge(`C${c}_N0`, `C${oppositeC}_N0`, 'depends_on');
  for (let i = 100; i < NODES_PER_COMMUNITY; i += 100)
    addEdge(`C${c}_N${i}`, `C${nextC}_N${i}`, 'triggers');
  for (let i = 50; i < NODES_PER_COMMUNITY; i += 250) {
    const targetC = (c + 3) % COMMUNITY_COUNT;
    addEdge(`C${c}_N${i}`, `C${targetC}_N${NODES_PER_COMMUNITY - 1 - i}`, 'notifies');
  }
}
console.log(`  ✅ ${edges.length} arêtes générées (${(edges.length / nodes.length).toFixed(1)} par nœud en moyenne)\n`);

// ─── Connexion Memgraph (driver v4, sans auth, sans database) ─────────────
const driver  = neo4j.driver(URI, neo4j.auth.basic('', ''));
// Memgraph ne supporte pas le paramètre `database` → session sans options
const session = driver.session();

try {
  const startTime = Date.now();

  // 1. Supprimer l'ancien graphe si présent
  console.log(`🗑️  Suppression de "${GRAPH_ID}" si existant...`);
  await session.run(`MATCH (n:GraphNode {graph_id: $gid}) DETACH DELETE n`, { gid: GRAPH_ID });
  await session.run(`MATCH (g:Graph {id: $gid}) DELETE g`,                  { gid: GRAPH_ID });

  // 2. Créer les métadonnées
  console.log('📝 Création des métadonnées...');
  await session.run(
    `CREATE (g:Graph {
       id: $id, title: $title, description: $desc,
       graph_type: $type, node_count: $nc, edge_count: $ec, created_at: $ca
     })`,
    {
      id:    GRAPH_ID,
      title: 'Memgraph Community 1K',
      desc:  `1 000 nœuds en ${COMMUNITY_COUNT} communautés : ${NODE_TYPES.slice(0, COMMUNITY_COUNT).join(', ')}`,
      type:  'network',
      nc:    nodes.length,
      ec:    edges.length,
      ca:    new Date().toISOString(),
    }
  );

  // 3. Insertion des nœuds par batches de 500
  const BATCH_SIZE = 500;
  console.log(`\n📦 Insertion des nœuds (batches de ${BATCH_SIZE})...`);
  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const batch = nodes.slice(i, i + BATCH_SIZE);
    await session.run(
      `UNWIND $batch AS node
       CREATE (n:GraphNode {
         graph_id: $gid,
         node_id:  node.node_id,
         label:    node.label,
         node_type: node.node_type,
         properties: node.properties
       })`,
      { gid: GRAPH_ID, batch }
    );
    process.stdout.write(`\r   Nœuds : ${Math.min(i + BATCH_SIZE, nodes.length)} / ${nodes.length}`);
  }
  console.log();

  // 4. Insertion des arêtes par batches de 500
  console.log(`\n🔗 Insertion des arêtes (batches de ${BATCH_SIZE})...`);
  for (let i = 0; i < edges.length; i += BATCH_SIZE) {
    const batch = edges.slice(i, i + BATCH_SIZE);
    await session.run(
      `UNWIND $batch AS edge
       MATCH (s:GraphNode {graph_id: $gid, node_id: edge.source})
       MATCH (t:GraphNode {graph_id: $gid, node_id: edge.target})
       CREATE (s)-[:CONNECTED_TO {
         graph_id: $gid, label: edge.label,
         edge_type: edge.edge_type, properties: edge.properties
       }]->(t)`,
      { gid: GRAPH_ID, batch }
    );
    process.stdout.write(`\r   Arêtes : ${Math.min(i + BATCH_SIZE, edges.length)} / ${edges.length}`);
  }
  console.log();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Graphe "${GRAPH_ID}" créé en ${elapsed}s`);
  console.log(`   📊 ${nodes.length} nœuds, ${edges.length} arêtes`);
  console.log(`   🔗 API : GET /api/graphs/${GRAPH_ID}?engine=memgraph\n`);

} catch (err) {
  console.error('❌ Erreur :', err.message);
  process.exit(1);
} finally {
  await session.close();
  await driver.close();
}
