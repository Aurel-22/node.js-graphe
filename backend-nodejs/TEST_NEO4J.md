# Test de Connexion Neo4j

Ce script permet de tester rapidement la connexion à Neo4j avant de lancer le backend complet.

## Utilisation

```bash
# Installer les dépendances si nécessaire
npm install

# Exécuter le test
node test-neo4j-connection.js
```

## Ce que ce script teste

- ✅ Connexion au serveur Neo4j
- ✅ Authentification
- ✅ Création d'un nœud de test
- ✅ Lecture du nœud
- ✅ Suppression du nœud
- ✅ Fermeture de la connexion

## Résultats Attendus

```
🔌 Connecting to Neo4j at neo4j://127.0.0.1:7687...
✅ Connected successfully!
🧪 Running test operations...
✅ Created test node with id: test_123456789
✅ Read test node: Test Node
✅ Deleted test node
✅ All tests passed!
🔒 Connection closed
```

## En cas d'erreur

### "ServiceUnavailable: Connection refused"
- Vérifiez que Neo4j est démarré : `neo4j status`
- Démarrez Neo4j : `neo4j start` ou `neo4j console`

### "Neo4jError: The client is unauthorized"
- Vérifiez les identifiants dans `.env`
- Connectez-vous à Neo4j Browser (http://localhost:7474) pour vérifier

### "Neo4jError: Unable to connect"
- Vérifiez que le port 7687 est ouvert
- Vérifiez l'URI dans `.env` (doit être `neo4j://127.0.0.1:7687`)
