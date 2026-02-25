/**
 * Crée 3 graphes de test : 500, 2 000 et 10 000 nœuds
 * Structure multi-communautés réaliste (même modèle que create-5k-graph.mjs)
 * 
 * Usage : node create-multi-graphs.mjs
 */

import neo4j from 'neo4j-driver';
import { config } from 'dotenv';

config();

const URI = process.env.NEO4J_URI || 'neo4j://127.0.0.1:7687';
const USER = process.env.NEO4J_USER || 'neo4j';
const PASSWORD = process.env.NEO4J_PASSWORD;

const NODE_TYPES = ['process', 'service', 'database', 'api', 'user', 'system', 'queue', 'notification', 'validation', 'action'];
const EDGE_TYPES = ['calls', 'depends_on', 'reads', 'writes', 'triggers', 'validates', 'notifies', 'queues'];

const GRAPHS_TO_CREATE = [
  { graphId: 'community_500',   nodeCount: 500,    communityCount: 5,  title: 'Community Graph 500' },
  { graphId: 'community_2k',    nodeCount: 2000,   communityCount: 8,  title: 'Community Graph 2K' },
  { graphId: 'community_10k',   nodeCount: 10000,  communityCount: 10, title: 'Community Graph 10K' },
];

// ─── Génération d'un graphe ───
function generateGraph(nodeCount, communityCount) {
  const nodesPerCommunity = Math.floor(nodeCount / communityCount);
  const nodes = [];
  const edges = [];
  const edgeSet = new Set();

  function addEdge(source, target, edgeType) {
    const key = `${source}->${target}`;
    if (edgeSet.has(key) || source === target) return;
    edgeSet.add(key);
    edges.push({ source, target, edge_type: edgeType, label: edgeType, properties: '{}' });
  }

  // Nœuds
  for (let i = 0; i < nodeCount; i++) {
    const community = Math.min(Math.floor(i / nodesPerCommunity), communityCount - 1);
    const localIndex = i - community * nodesPerCommunity;
    const nodeType = NODE_TYPES[community % NODE_TYPES.length];

    nodes.push({
      node_id: `C${community}_N${localIndex}`,
      label: `${nodeType.charAt(0).toUpperCase() + nodeType.slice(1)} ${community}.${localIndex}`,
      node_type: nodeType,
      properties: JSON.stringify({ community, localIndex }),
    });
  }

  // Arêtes intra-communauté
  for (let c = 0; c < communityCount; c++) {
    const size = c < communityCount - 1 ? nodesPerCommunity : nodeCount - c * nodesPerCommunity;

    for (let i = 0; i < size; i++) {
      const nodeId = `C${c}_N${i}`;

      // Chaîne linéaire
      if (i + 1 < size) addEdge(nodeId, `C${c}_N${i + 1}`, 'calls');

      // +3 voisinage proche
      if (i + 3 < size) addEdge(nodeId, `C${c}_N${i + 3}`, 'depends_on');

      // +7 voisinage moyen
      if (i + 7 < size && i % 2 === 0) addEdge(nodeId, `C${c}_N${i + 7}`, 'reads');

      // +15 long range intra
      if (i + 15 < size && i % 3 === 0) addEdge(nodeId, `C${c}_N${i + 15}`, 'triggers');

      // +30 cross-cluster interne
      if (i + 30 < size && i % 5 === 0) addEdge(nodeId, `C${c}_N${i + 30}`, 'writes');

      // Retour arrière
      if (i > 5 && i % 4 === 0) addEdge(nodeId, `C${c}_N${i - 5}`, 'validates');

      // Aléatoire locale déterministe
      if (i % 6 === 0) {
        const offset = 10 + (i % 20);
        if (i + offset < size) addEdge(nodeId, `C${c}_N${i + offset}`, EDGE_TYPES[i % EDGE_TYPES.length]);
      }
    }

    // Hub nœud 0
    for (let j = 50; j < size; j += 50) {
      addEdge(`C${c}_N0`, `C${c}_N${j}`, 'queues');
    }
  }

  // Ponts inter-communautés
  for (let c = 0; c < communityCount; c++) {
    const nextC = (c + 1) % communityCount;
    const oppositeC = (c + Math.floor(communityCount / 2)) % communityCount;
    const size = c < communityCount - 1 ? nodesPerCommunity : nodeCount - c * nodesPerCommunity;
    const nextSize = nextC < communityCount - 1 ? nodesPerCommunity : nodeCount - nextC * nodesPerCommunity;

    // Hub-to-hub
    addEdge(`C${c}_N0`, `C${nextC}_N0`, 'calls');
    addEdge(`C${c}_N0`, `C${oppositeC}_N0`, 'depends_on');

    // Ponts répartis
    for (let i = 100; i < Math.min(size, nextSize); i += 100) {
      addEdge(`C${c}_N${i}`, `C${nextC}_N${i}`, 'triggers');
    }

    // Ponts éloignés
    for (let i = 50; i < size; i += 250) {
      const targetC = (c + 3) % communityCount;
      const targetSize = targetC < communityCount - 1 ? nodesPerCommunity : nodeCount - targetC * nodesPerCommunity;
      const targetIdx = targetSize - 1 - (i % targetSize);
      if (targetIdx >= 0 && targetIdx < targetSize) {
        addEdge(`C${c}_N${i}`, `C${targetC}_N${targetIdx}`, 'notifies');
      }
    }
  }

  return { nodes, edges };
}

// ─── Insertion dans Neo4j ───
const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD));

for (const { graphId, nodeCount, communityCount, title } of GRAPHS_TO_CREATE) {
  const session = driver.session({ database: 'neo4j' });

  try {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🔧 Génération de "${graphId}" — ${nodeCount.toLocaleString()} nœuds, ${communityCount} communautés`);
    console.log(`${'═'.repeat(60)}`);

    const { nodes, edges } = generateGraph(nodeCount, communityCount);
    console.log(`  ✅ ${nodes.length} nœuds, ${edges.length} arêtes (${(edges.length / nodes.length).toFixed(1)}/nœud)`);

    const startTime = Date.now();

    // Supprimer l'ancien graphe
    console.log(`\n🗑️  Suppression de l'ancien "${graphId}"...`);
    await session.run(`MATCH (n:GraphNode {graph_id: $graphId}) DETACH DELETE n`, { graphId });
    await session.run(`MATCH (g:Graph {id: $graphId}) DELETE g`, { graphId });

    // Métadonnées
    console.log('📝 Création des métadonnées...');
    const typesUsed = NODE_TYPES.slice(0, communityCount).join(', ');
    await session.run(
      `CREATE (g:Graph {
        id: $graphId,
        title: $title,
        description: $description,
        graph_type: 'network',
        node_count: $nodeCount,
        edge_count: $edgeCount,
        created_at: $createdAt
      })`,
      {
        graphId,
        title,
        description: `Graphe réaliste de ${nodeCount.toLocaleString()} nœuds en ${communityCount} communautés (${typesUsed})`,
        nodeCount: neo4j.int(nodes.length),
        edgeCount: neo4j.int(edges.length),
        createdAt: new Date().toISOString(),
      }
    );

    // Batch insert nœuds
    const BATCH_SIZE = 1000;
    console.log(`\n📦 Insertion des nœuds...`);
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
        { graphId, batch }
      );
      process.stdout.write(`\r   Nœuds: ${Math.min(i + BATCH_SIZE, nodes.length)} / ${nodes.length}`);
    }
    console.log();

    // Batch insert arêtes
    console.log(`🔗 Insertion des arêtes...`);
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
        { graphId, batch }
      );
      process.stdout.write(`\r   Arêtes: ${Math.min(i + BATCH_SIZE, edges.length)} / ${edges.length}`);
    }
    console.log();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ "${graphId}" créé en ${elapsed}s — ${nodes.length} nœuds, ${edges.length} arêtes`);

  } catch (error) {
    console.error(`❌ Erreur pour "${graphId}":`, error.message);
  } finally {
    await session.close();
  }
}

await driver.close();
console.log(`\n🎉 Terminé ! 3 graphes créés.\n`);
