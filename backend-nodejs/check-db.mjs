import neo4j from 'neo4j-driver';
import { config } from 'dotenv';

config();

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

const session = driver.session();

try {
  console.log('=== Statistiques Neo4j ===\n');
  
  // Total de tous les nœuds
  const allNodes = await session.run('MATCH (n) RETURN count(n) as count');
  console.log(`📊 Total nœuds (tous types): ${allNodes.records[0].get('count')}`);
  
  // Total des relations
  const allRels = await session.run('MATCH ()-[r]->() RETURN count(r) as count');
  console.log(`🔗 Total relations: ${allRels.records[0].get('count')}\n`);
  
  // Nœuds GraphNode
  const graphNodes = await session.run('MATCH (n:GraphNode) RETURN count(n) as count');
  console.log(`📦 Nœuds GraphNode: ${graphNodes.records[0].get('count')}`);
  
  // Nœuds Graph (métadonnées)
  const graphs = await session.run('MATCH (g:Graph) RETURN count(g) as count');
  console.log(`📋 Graphes enregistrés: ${graphs.records[0].get('count')}\n`);
  
  // Détails des graphes
  const graphDetails = await session.run(`
    MATCH (g:Graph) 
    RETURN g.id as id, g.title as title, g.node_count as nodes, g.edge_count as edges
    ORDER BY g.node_count DESC
  `);
  
  console.log('=== Détails des graphes ===');
  graphDetails.records.forEach(record => {
    const id = record.get('id');
    const title = record.get('title');
    const nodes = record.get('nodes')?.toNumber?.() || record.get('nodes') || 0;
    const edges = record.get('edges')?.toNumber?.() || record.get('edges') || 0;
    console.log(`  • ${id}: "${title}"`);
    console.log(`    └─ ${nodes.toLocaleString()} nœuds, ${edges.toLocaleString()} relations`);
  });
  
  // Compter les nœuds par type
  console.log('\n=== Types de nœuds ===');
  const nodeTypes = await session.run('MATCH (n) RETURN labels(n) as labels, count(n) as count ORDER BY count DESC');
  nodeTypes.records.forEach(record => {
    const labels = record.get('labels');
    const count = record.get('count');
    console.log(`  • ${labels.join(', ')}: ${count}`);
  });
  
} catch (err) {
  console.error('❌ Erreur:', err.message);
} finally {
  await session.close();
  await driver.close();
}
