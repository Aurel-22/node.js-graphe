import neo4j from 'neo4j-driver';
import { config } from 'dotenv';

config();

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

async function recalculateGraphMetadata() {
  const session = driver.session();
  
  try {
    console.log('🔍 Recalcul des métadonnées des graphes...\n');
    
    // Récupérer tous les graphes
    const graphsResult = await session.run('MATCH (g:Graph) RETURN g.id as id');
    
    for (const record of graphsResult.records) {
      const graphId = record.get('id');
      
      // Compter les vrais nœuds
      const nodeResult = await session.run(
        'MATCH (n:GraphNode) WHERE n.graph_id = $graphId RETURN count(n) as count',
        { graphId }
      );
      const realNodeCount = Number(nodeResult.records[0].get('count').toString());
      
      // Compter les vraies relations
      const edgeResult = await session.run(
        'MATCH (n:GraphNode)-[r]->(m:GraphNode) WHERE n.graph_id = $graphId AND m.graph_id = $graphId RETURN count(r) as count',
        { graphId }
      );
      const realEdgeCount = Number(edgeResult.records[0].get('count').toString());
      
      console.log(`📊 Graphe: ${graphId}`);
      console.log(`   Nœuds réels: ${realNodeCount}`);
      console.log(`   Relations réelles: ${realEdgeCount}`);
      
      // Mettre à jour les métadonnées
      await session.run(
        `MATCH (g:Graph {id: $graphId}) 
         SET g.node_count = $nodeCount, g.edge_count = $edgeCount`,
        { 
          graphId, 
          nodeCount: neo4j.int(realNodeCount),
          edgeCount: neo4j.int(realEdgeCount)
        }
      );
      
      console.log(`   ✅ Métadonnées mises à jour\n`);
    }
    
    console.log('🎉 Toutes les métadonnées ont été recalculées !');
    
  } catch (err) {
    console.error('❌ Erreur:', err.message);
  } finally {
    await session.close();
    await driver.close();
  }
}

recalculateGraphMetadata();
