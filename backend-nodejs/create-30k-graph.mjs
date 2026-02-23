/**
 * Crée un graphe de 30 000 nœuds avec une structure multi-communautés réaliste.
 * 
 * Structure :
 * - 15 communautés de 2 000 nœuds chacune
 * - Connexions denses INTRA-communauté (chaque nœud a 3-8 voisins locaux)
 * - Ponts INTER-communautés (hubs qui relient les clusters)
 * - ~150 000 arêtes au total (~5 par nœud en moyenne)
 * 
 * Utilise UNWIND pour des batch inserts rapides.
 */

import neo4j from 'neo4j-driver';

const URI = 'neo4j://127.0.0.1:7687';
const USER = 'neo4j';
const PASSWORD = 'Aurelien22';

const GRAPH_ID = 'community_30k';
const NODE_COUNT = 30_000;
const COMMUNITY_COUNT = 15;
const NODES_PER_COMMUNITY = NODE_COUNT / COMMUNITY_COUNT; // 2000

const NODE_TYPES = [
  'process', 'service', 'database', 'api', 'user',
  'system', 'queue', 'notification', 'validation', 'action',
  'gateway', 'cache', 'scheduler', 'monitor', 'storage'
];
const EDGE_TYPES = ['calls', 'depends_on', 'reads', 'writes', 'triggers', 'validates', 'notifies', 'queues'];

console.log(`\n🔧 Génération du graphe "${GRAPH_ID}" — ${NODE_COUNT} nœuds, ${COMMUNITY_COUNT} communautés\n`);

// ─── Génération des nœuds ───
const nodes = [];
for (let i = 0; i < NODE_COUNT; i++) {
  const community = Math.floor(i / NODES_PER_COMMUNITY);
  const localIndex = i % NODES_PER_COMMUNITY;
  const nodeType = NODE_TYPES[community];

  nodes.push({
    node_id: `C${community}_N${localIndex}`,
    label: `${nodeType.charAt(0).toUpperCase() + nodeType.slice(1)} ${community}.${localIndex}`,
    node_type: nodeType,
    community: community,
    properties: JSON.stringify({ community, localIndex }),
  });
}

console.log(`  ✅ ${nodes.length} nœuds générés`);

// ─── Génération des arêtes ───
const edges = [];
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

    // 1. Chaîne linéaire
    if (i < NODES_PER_COMMUNITY - 1) {
      addEdge(nodeId, `C${c}_N${i + 1}`, 'calls');
    }

    // 2. Connexion +3 (voisinage proche)
    if (i + 3 < NODES_PER_COMMUNITY) {
      addEdge(nodeId, `C${c}_N${i + 3}`, 'depends_on');
    }

    // 3. Connexion +7 (voisinage moyen)
    if (i + 7 < NODES_PER_COMMUNITY && i % 2 === 0) {
      addEdge(nodeId, `C${c}_N${i + 7}`, 'reads');
    }

    // 4. Connexion +15 (intra-cluster long range)
    if (i + 15 < NODES_PER_COMMUNITY && i % 3 === 0) {
      addEdge(nodeId, `C${c}_N${i + 15}`, 'triggers');
    }

    // 5. Connexion +30 (cross-cluster interne)
    if (i + 30 < NODES_PER_COMMUNITY && i % 5 === 0) {
      addEdge(nodeId, `C${c}_N${i + 30}`, 'writes');
    }

    // 6. Retour arrière partiel
    if (i > 5 && i % 4 === 0) {
      addEdge(nodeId, `C${c}_N${i - 5}`, 'validates');
    }

    // 7. Connexion aléatoire locale (déterministe basée sur i)
    if (i % 6 === 0) {
      const offset = 10 + (i % 20);
      if (i + offset < NODES_PER_COMMUNITY) {
        addEdge(nodeId, `C${c}_N${i + offset}`, EDGE_TYPES[i % EDGE_TYPES.length]);
      }
    }

    // 8. Connexion +50 (medium range, pour plus de densité)
    if (i + 50 < NODES_PER_COMMUNITY && i % 7 === 0) {
      addEdge(nodeId, `C${c}_N${i + 50}`, 'notifies');
    }

    // 9. Connexion +100 (long range interne)
    if (i + 100 < NODES_PER_COMMUNITY && i % 10 === 0) {
      addEdge(nodeId, `C${c}_N${i + 100}`, 'queues');
    }
  }

  // Hub nodes — le nœud 0 de chaque communauté est un hub interne
  for (let j = 50; j < NODES_PER_COMMUNITY; j += 50) {
    addEdge(`C${c}_N0`, `C${c}_N${j}`, 'queues');
  }
}

// Ponts INTER-communautés
for (let c = 0; c < COMMUNITY_COUNT; c++) {
  const nextC = (c + 1) % COMMUNITY_COUNT;
  const oppositeC = (c + Math.floor(COMMUNITY_COUNT / 2)) % COMMUNITY_COUNT;
  const thirdC = (c + Math.floor(COMMUNITY_COUNT / 3)) % COMMUNITY_COUNT;

  // Hub-to-hub
  addEdge(`C${c}_N0`, `C${nextC}_N0`, 'calls');
  addEdge(`C${c}_N0`, `C${oppositeC}_N0`, 'depends_on');
  addEdge(`C${c}_N0`, `C${thirdC}_N0`, 'triggers');

  // Ponts répartis entre communautés adjacentes
  for (let i = 100; i < NODES_PER_COMMUNITY; i += 100) {
    addEdge(`C${c}_N${i}`, `C${nextC}_N${i}`, 'triggers');
  }

  // Ponts aléatoires (déterministes) entre communautés éloignées
  for (let i = 50; i < NODES_PER_COMMUNITY; i += 200) {
    const targetC = (c + 3) % COMMUNITY_COUNT;
    const targetNode = Math.abs(NODES_PER_COMMUNITY - 1 - i) % NODES_PER_COMMUNITY;
    addEdge(`C${c}_N${i}`, `C${targetC}_N${targetNode}`, 'notifies');
  }

  // Extra cross-community bridges pour 30K
  for (let i = 250; i < NODES_PER_COMMUNITY; i += 500) {
    const targetC = (c + 4) % COMMUNITY_COUNT;
    addEdge(`C${c}_N${i}`, `C${targetC}_N${i}`, 'reads');
  }
}

console.log(`  ✅ ${edges.length} arêtes générées (${(edges.length / nodes.length).toFixed(1)} par nœud en moyenne)`);

// ─── Insertion dans Neo4j avec UNWIND (batch) ───
const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD));
const session = driver.session({ database: 'neo4j' });

try {
  const startTime = Date.now();

  // 1. Supprimer l'ancien graphe s'il existe
  console.log(`\n🗑️  Suppression de l'ancien graphe "${GRAPH_ID}" si existant...`);
  await session.run(
    `MATCH (n:GraphNode {graph_id: $graphId}) DETACH DELETE n`,
    { graphId: GRAPH_ID }
  );
  await session.run(
    `MATCH (g:Graph {id: $graphId}) DELETE g`,
    { graphId: GRAPH_ID }
  );

  // 2. Créer les métadonnées du graphe
  console.log('📝 Création des métadonnées...');
  await session.run(
    `CREATE (g:Graph {
      id: $graphId,
      title: $title,
      description: $description,
      graph_type: $graphType,
      node_count: $nodeCount,
      edge_count: $edgeCount,
      created_at: $createdAt
    })`,
    {
      graphId: GRAPH_ID,
      title: 'Community Graph 30K',
      description: `Graphe réaliste de ${NODE_COUNT} nœuds organisés en ${COMMUNITY_COUNT} communautés interconnectées (${NODE_TYPES.join(', ')})`,
      graphType: 'network',
      nodeCount: neo4j.int(nodes.length),
      edgeCount: neo4j.int(edges.length),
      createdAt: new Date().toISOString(),
    }
  );

  // 3. Batch insert nœuds avec UNWIND
  const BATCH_SIZE = 2000;
  console.log(`\n📦 Insertion des nœuds par batches de ${BATCH_SIZE}...`);

  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const batch = nodes.slice(i, i + BATCH_SIZE);
    await session.run(
      `UNWIND $batch AS node
       CREATE (n:GraphNode {
         graph_id: $graphId,
         node_id: node.node_id,
         label: node.label,
         node_type: node.node_type,
         properties: node.properties
       })`,
      { graphId: GRAPH_ID, batch }
    );
    console.log(`   Nœuds: ${Math.min(i + BATCH_SIZE, nodes.length)} / ${nodes.length}`);
  }

  // 4. Batch insert arêtes avec UNWIND
  console.log(`\n🔗 Insertion des arêtes par batches de ${BATCH_SIZE}...`);

  for (let i = 0; i < edges.length; i += BATCH_SIZE) {
    const batch = edges.slice(i, i + BATCH_SIZE);
    await session.run(
      `UNWIND $batch AS edge
       MATCH (source:GraphNode {graph_id: $graphId, node_id: edge.source})
       MATCH (target:GraphNode {graph_id: $graphId, node_id: edge.target})
       CREATE (source)-[:CONNECTED_TO {
         graph_id: $graphId,
         label: edge.label,
         edge_type: edge.edge_type,
         properties: edge.properties
       }]->(target)`,
      { graphId: GRAPH_ID, batch }
    );
    console.log(`   Arêtes: ${Math.min(i + BATCH_SIZE, edges.length)} / ${edges.length}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Graphe "${GRAPH_ID}" créé avec succès en ${elapsed}s`);
  console.log(`   📊 ${nodes.length} nœuds, ${edges.length} arêtes`);
  console.log(`   🏘️  ${COMMUNITY_COUNT} communautés : ${NODE_TYPES.join(', ')}`);
  console.log(`   🔗 ${(edges.length / nodes.length).toFixed(1)} arêtes/nœud en moyenne\n`);

} catch (error) {
  console.error('❌ Erreur:', error.message);
  throw error;
} finally {
  await session.close();
  await driver.close();
}
