# ArangoDB Integration — Comparaison avec Neo4j

## Prérequis

### Installer ArangoDB

```bash
# Ubuntu/Debian
curl -OL https://download.arangodb.com/arangodb311/DEBIAN/Release.key
sudo apt-key add - < Release.key
echo 'deb https://download.arangodb.com/arangodb311/DEBIAN/ /' | sudo tee /etc/apt/sources.list.d/arangodb.list
sudo apt-get update
sudo apt-get install arangodb3

# Docker (recommandé pour tester)
docker run -d --name arangodb \
  -p 8529:8529 \
  -e ARANGO_ROOT_PASSWORD="" \
  arangodb/arangodb:3.11
```

## Configuration

Ajouter dans `.env` :

```env
# ArangoDB Configuration
ARANGO_URL=http://127.0.0.1:8529
ARANGO_USER=root
ARANGO_PASSWORD=
ARANGO_DATABASE=_system

# Moteur par défaut (neo4j | arangodb)
DEFAULT_ENGINE=neo4j
```

## Architecture

```
┌────────────────────────────────────────────────┐
│                   Frontend                      │
│         ?engine=neo4j | ?engine=arangodb        │
└───────────────────┬────────────────────────────┘
                    │
         ┌──────────▼──────────┐
         │    Express Server   │
         │   resolveEngine()   │
         └──┬──────────────┬───┘
            │              │
   ┌────────▼───┐    ┌────▼──────────┐
   │ Neo4jService│    │ ArangoService │
   │  (Cypher)   │    │   (AQL)       │
   └──────┬──────┘    └──────┬────────┘
          │                  │
   ┌──────▼──────┐    ┌─────▼─────────┐
   │   Neo4j DB  │    │  ArangoDB DB  │
   │  :7687      │    │  :8529        │
   └─────────────┘    └───────────────┘
```

Les deux services implémentent l'interface `GraphDatabaseService`.

## Utilisation de l'API

Toutes les routes API existantes acceptent un paramètre `?engine=` :

```bash
# Lister les moteurs disponibles
GET /api/engines

# Lister les graphes (Neo4j — par défaut)
GET /api/graphs

# Lister les graphes (ArangoDB)
GET /api/graphs?engine=arangodb

# Obtenir un graphe sur ArangoDB
GET /api/graphs/my_graph?engine=arangodb

# Créer un graphe sur ArangoDB
POST /api/graphs?engine=arangodb

# Health check (montre les moteurs disponibles)
GET /api/health
```

## Comparaison des performances

Pour comparer les deux moteurs sur le même graphe :

```bash
# 1. Créer un graphe sur Neo4j
curl -X POST http://127.0.0.1:8080/api/graphs?engine=neo4j \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","description":"Benchmark","mermaid_code":"graph TD\nA-->B\nB-->C\nC-->D"}'

# 2. Créer le même graphe sur ArangoDB
curl -X POST http://127.0.0.1:8080/api/graphs?engine=arangodb \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","description":"Benchmark","mermaid_code":"graph TD\nA-->B\nB-->C\nC-->D"}'

# 3. Comparer les temps de réponse (nocache pour des mesures fiables)
curl -w "Total: %{time_total}s\n" \
  "http://127.0.0.1:8080/api/graphs/GRAPH_ID?engine=neo4j&nocache=true"

curl -w "Total: %{time_total}s\n" \
  "http://127.0.0.1:8080/api/graphs/GRAPH_ID?engine=arangodb&nocache=true"
```

Le header `X-Engine` dans la réponse HTTP indique quel moteur a été utilisé.

## Différences techniques

| Aspect | Neo4j | ArangoDB |
|--------|-------|----------|
| Langage de requête | Cypher | AQL |
| Modèle | Graphe natif | Multi-modèle (document + graphe) |
| Port par défaut | 7687 | 8529 |
| Collections d'arêtes | Relations natives | Edge collections |
| Traversal | `MATCH path` | `FOR v, e IN 1..N` |
| Insertion batch | Boucle Cypher | `collection.import()` |
| Interface web | Neo4j Browser | ArangoDB Web UI |

## Modèle de données ArangoDB

- **`graphs`** — Collection de documents (métadonnées des graphes)
- **`graph_nodes`** — Collection de documents (nœuds)
- **`graph_edges`** — Edge collection (arêtes, avec `_from` / `_to`)

## Fichiers modifiés/créés

- `src/services/GraphDatabaseService.ts` — Interface commune
- `src/services/ArangoService.ts` — Implémentation ArangoDB
- `src/services/Neo4jService.ts` — Ajout `implements GraphDatabaseService`
- `src/index.ts` — Multi-engine avec middleware `resolveEngine()`
- `src/routes/graphRoutes.ts` — Accepte `GraphDatabaseService`
- `src/routes/databaseRoutes.ts` — Accepte `GraphDatabaseService`
- `frontend-graph-viewer/src/services/api.ts` — Paramètre `engine` sur toutes les API
