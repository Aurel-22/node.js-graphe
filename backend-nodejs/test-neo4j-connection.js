// Test de connexion Neo4j
// Usage: node test-neo4j-connection.js

import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.NEO4J_URI || 'neo4j://127.0.0.1:7687';
const user = process.env.NEO4J_USER || 'neo4j';
const password = process.env.NEO4J_PASSWORD || 'password';

async function testConnection() {
  console.log(`🔌 Connecting to Neo4j at ${uri}...`);
  
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  
  try {
    // Tester la connexion
    await driver.verifyConnectivity();
    console.log('✅ Connected successfully!');
    
    const session = driver.session();
    
    try {
      console.log('🧪 Running test operations...');
      
      // Créer un nœud de test
      const createResult = await session.run(
        'CREATE (n:TestNode {id: $id, name: $name}) RETURN n',
        { id: `test_${Date.now()}`, name: 'Test Node' }
      );
      
      const node = createResult.records[0].get('n');
      console.log(`✅ Created test node with id: ${node.properties.id}`);
      
      // Lire le nœud
      const readResult = await session.run(
        'MATCH (n:TestNode {id: $id}) RETURN n',
        { id: node.properties.id }
      );
      
      if (readResult.records.length > 0) {
        console.log(`✅ Read test node: ${readResult.records[0].get('n').properties.name}`);
      }
      
      // Supprimer le nœud de test
      await session.run(
        'MATCH (n:TestNode {id: $id}) DELETE n',
        { id: node.properties.id }
      );
      console.log('✅ Deleted test node');
      
      console.log('\n✅ All tests passed!');
      
    } finally {
      await session.close();
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\n💡 Troubleshooting:');
    console.error('   1. Check if Neo4j is running: neo4j status');
    console.error('   2. Verify credentials in .env file');
    console.error('   3. Try connecting via Neo4j Browser: http://localhost:7474');
    process.exit(1);
  } finally {
    await driver.close();
    console.log('🔒 Connection closed');
  }
}

testConnection();
