# Graph Visualizer — CMDB PoC

Outil de visualisation et d'analyse de graphes multi-moteurs de base de données.  
Monorepo composé d'un backend REST et d'un frontend SPA, communicant via HTTP.

---

## Architecture

```
node.js-graphe/
├── backend-nodejs/          # API Express + TypeScript (port 8080)
│   ├── src/
│   │   ├── index.ts         # Point d'entrée, enregistrement des moteurs
│   │   ├── models/graph.ts  # Types partagés (GraphNode, GraphEdge, etc.)
│   │   ├── routes/          # graphRoutes.ts, databaseRoutes.ts
│   │   ├── services/        # Un service par moteur de BDD
│   │   │   ├── GraphDatabaseService.ts   # Interface commune
│   │   │   ├── Neo4jService.ts
│   │   │   ├── MemgraphService.ts        # extends Neo4jService
│   │   │   ├── MssqlService.ts
│   │   │   └── ArangoService.ts
│   │   └── config/database.ts
│   └── create-engine-graphs.mjs  # Script de génération de graphes de test
└── frontend-graph-viewer/   # React 18 + Vite + TypeScript (port 5173)
    └── src/
        ├── App.tsx           # État global, hooks, routage des viewers
        ├── components/       # Un composant par moteur de visualisation
        │   ├── GraphViewer.tsx        # force-graph 2D
        │   ├── Graph3DViewer.tsx      # 3D force-graph
        │   ├── SigmaGraphViewer.tsx   # Sigma.js + ForceAtlas2 + mode progressif
        │   ├── G6Viewer.tsx           # AntV G6
        │   ├── D3Viewer.tsx           # D3.js
        │   ├── CytoscapeViewer.tsx    # Cytoscape.js
        │   ├── VisNetworkViewer.tsx   # vis-network
        │   └── ImpactAnalysis.tsx     # BFS client vs serveur
        └── services/api.ts   # Client axios vers le backend
```

### Pattern Strategy — Multi-moteur

Tous les moteurs implémentent l'interface `GraphDatabaseService` :

| Méthode | Description |
|---------|-------------|
| `createGraph` | Création avec `nodes[]` + `edges[]` ou Mermaid |
| `getGraph` | Récupération par ID (avec cache 5 min) |
| `listGraphs` | Liste des graphes d'une base |
| `deleteGraph` | Suppression |
| `getNodeNeighbors` | Voisins directs d'un nœud |
| `computeImpact` | BFS côté serveur jusqu'à profondeur N |
| `listDatabases` | Bases disponibles sur le moteur |

Le moteur est sélectionné par requête via `?engine=neo4j|memgraph|mssql|arango`.

---

## Prérequis

- **Docker** (pour les bases de données)
- **Node.js 18+** et **npm**

---

## Installation et démarrage

### 1. Cloner le dépôt

```bash
git clone https://github.com/ezv-esisar/cmdb-poc.git
cd cmdb-poc
```

### 2. Lancer les bases de données (Docker)

```bash
# Neo4j 5.26.0 (ne pas utiliser latest — tire 2026.x incompatible)
docker run -d --name neo4j --network=host \
  -e NEO4J_AUTH=neo4j/neo4j-pi11 \
  neo4j:5.26.0

# Memgraph (port 7688 pour éviter conflit avec Neo4j sur 7687)
docker run -d --name memgraph --network=host \
  memgraph/memgraph --bolt-port 7688

# MSSQL Server 2022 (attendre ~30s avant de créer la base)
docker run -d --name mssql --network=host \
  -e ACCEPT_EULA=Y \
  -e SA_PASSWORD=YourPassword123! \
  mcr.microsoft.com/mssql/server:2022-latest
```

> **Note réseau** : `--network=host` est requis si un proxy bloque le bridge Docker.  
> En réseau normal (maison), remplacer par `-p 7687:7687`, `-p 7688:7688`, `-p 1433:1433`.

### 3. Créer la base MSSQL

```bash
# Après ~30s de démarrage :
docker exec -it mssql /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P 'YourPassword123!' -No \
  -Q "CREATE DATABASE graph_db"
```

### 4. Configurer l'environnement

```bash
cd backend-nodejs
```

Créer le fichier `.env` :

```env
NEO4J_URI=bolt://127.0.0.1:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=neo4j-pi11

MEMGRAPH_URI=bolt://127.0.0.1:7688

MSSQL_HOST=127.0.0.1
MSSQL_PORT=1433
MSSQL_USER=sa
MSSQL_PASSWORD=YourPassword123!
MSSQL_DATABASE=graph_db

# ARANGO_URL=http://127.0.0.1:8529   # Optionnel
```

> Commenter/décommenter les lignes pour activer/désactiver un moteur.  
> Au moins un moteur doit être actif.

### 5. Lancer les serveurs

```bash
# Terminal 1 — Backend
cd backend-nodejs
npm install
npm run dev          # port 8080, redémarre automatiquement

# Terminal 2 — Frontend
cd frontend-graph-viewer
npm install
npm run dev          # port 5173, Vite HMR
```

Ouvrir **http://localhost:5173**

---

## Moteurs de base de données

| Moteur | Port | Technologie | Particularités |
|--------|------|-------------|----------------|
| **Neo4j** | 7687 | Cypher, Bolt 5.x | Multi-base, `neo4j-driver@5.28.3` (pas v6) |
| **Memgraph** | 7688 | Cypher, Bolt 4.x | Mono-base, pas de `length(path)`, `~23×` plus lent en écriture |
| **MSSQL** | 1433 | T-SQL, CTE récursif | Explosion exponentielle à profondeur ≥ 5, limite 2100 params |
| **ArangoDB** | 8529 | AQL | Optionnel |

### Performances — Impact Analysis (BFS serveur)

Graphe de 30 000 nœuds, nœud central :

| Profondeur | Neo4j | MSSQL | Ratio |
|-----------|-------|-------|-------|
| d = 3 | 22 ms | 63 ms | 3× |
| d = 5 | 40 ms | 637 ms | 16× |
| d = 8 | 97 ms | 18 637 ms | **192×** |

→ Voir [IMPACT_ANALYSIS_COMPARISON.md](IMPACT_ANALYSIS_COMPARISON.md) pour l'analyse complète.

---

## Génération de graphes de test

```bash
cd backend-nodejs

# Génère des graphes 1K, 2K, 5K, 10K, 20K, 30K nœuds
node create-engine-graphs.mjs --engine=neo4j
node create-engine-graphs.mjs --engine=mssql --database=graph_db
node create-engine-graphs.mjs --engine=memgraph
```

---

## API principale

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/databases?engine=` | Lister les bases disponibles |
| `GET` | `/api/graphs?engine=&database=` | Lister les graphes |
| `POST` | `/api/graphs?engine=` | Créer un graphe |
| `GET` | `/api/graphs/:id?engine=&database=` | Récupérer un graphe |
| `DELETE` | `/api/graphs/:id?engine=&database=` | Supprimer un graphe |
| `POST` | `/api/graphs/:id/impact?engine=` | Analyse d'impact BFS |
| `GET` | `/optim/cache/stats` | Stats du cache NodeCache |

**Exemple — créer un graphe Mermaid :**
```bash
curl -X POST "http://127.0.0.1:8080/api/graphs?engine=neo4j" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","graph_type":"dependency","mermaid_code":"graph TD\n  A-->B\n  B-->C"}'
```

**Exemple — analyse d'impact :**
```bash
curl -X POST "http://127.0.0.1:8080/api/graphs/<id>/impact?engine=neo4j" \
  -H "Content-Type: application/json" \
  -d '{"nodeId":"node-1","depth":5}'
```

---

## Moteurs de visualisation (frontend)

| Viewer | Technologie | Usage recommandé |
|--------|-------------|-----------------|
| `force-graph` | react-force-graph 2D | Vue générale < 10K nœuds |
| `3d` | react-force-graph 3D | Exploration spatiale |
| `sigma` | Sigma.js + ForceAtlas2 | Grands graphes, mode progressif |
| `g6` | AntV G6 | Hiérarchies, arbres |
| `d3` | D3.js | Contrôle fin du layout |
| `cytoscape` | Cytoscape.js | Analyse de réseau |
| `vis-network` | vis-network | Interactivité avancée |
| `impact` | Sigma.js + graphology | BFS visuel + comparaison serveur |

### Mode progressif Sigma

Pour les très grands graphes, Sigma démarre avec un **panneau liste de nœuds** (sidebar gauche) plutôt qu'en chargeant tout le graphe :

- Affiche jusqu'à **100 nœuds** (échantillon déterministe par Fisher-Yates)
- Cliquer sur un nœud → ajoute le nœud et ses voisins directs au graphe
- Bouton "Level suivant" pour étendre la frontière
- Recherche/filtre par id, label ou type

---

## Stack technique

**Backend**
- Express 4 + TypeScript (ESM, `"type":"module"`)
- `tsx watch` pour le dev (rechargement à chaud)
- `neo4j-driver@5.28.3`, `mssql@12.2.0`, `arangojs@10`, `node-cache`
- Validation : `zod`, Logs : `pino`

**Frontend**
- React 18 + Vite 5 + TypeScript
- État : hooks uniquement dans `App.tsx` (pas de Redux/Zustand)
- `graphology` + Sigma.js pour le mode progressif et l'impact
- `axios` pour les appels API

---

## Développement

```bash
# Vérification TypeScript
cd backend-nodejs && npm run typecheck
cd frontend-graph-viewer && npx tsc --noEmit

# Vérifier les logs backend
tail -f /tmp/backend.log
```
