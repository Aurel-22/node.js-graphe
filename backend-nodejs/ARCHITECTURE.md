# Architecture détaillée du Backend

## Table des matières

- [Vue d'ensemble](#vue-densemble)
- [Stack technique et librairies](#stack-technique-et-librairies)
- [Structure des fichiers](#structure-des-fichiers)
- [Point d'entrée — index.ts](#point-dentrée--indexts)
- [Modèle de données — models/graph.ts](#modèle-de-données--modelsgraphts)
- [Interface du service — GraphDatabaseService.ts](#interface-du-service--graphdatabaseservicets)
- [Implémentation MSSQL — MssqlService.ts](#implémentation-mssql--mssqlservicets)
- [Routes](#routes)
  - [graphRoutes.ts](#graphroutests)
  - [algorithmRoutes.ts](#algorithmroutests)
  - [databaseRoutes.ts](#databaser outests)
  - [cmdbRoutes.ts](#cmdbroutests)
- [Services](#services)
  - [AlgorithmService.ts](#algorithmservicets)
  - [MermaidParser.ts](#mermaidparserts)
- [Système de cache](#système-de-cache)
- [WebSocket](#websocket)
- [Diagramme de flux des requêtes](#diagramme-de-flux-des-requêtes)
- [Variables d'environnement](#variables-denvironnement)

---

## Vue d'ensemble

Le backend est une **API REST** construite avec **Express.js** et **TypeScript** qui expose des opérations CRUD sur des graphes stockés dans **Microsoft SQL Server**. Il fournit également :

- L'exécution de **14 algorithmes de graphe** en mémoire (BFS, Dijkstra, PageRank, Louvain, etc.)
- Une **analyse d'impact** (propagation de panne via BFS)
- Un **import CMDB depuis EasyVista** (base de gestion de parc informatique)
- Un cache en mémoire (**NodeCache**, TTL 5 min)
- Des notifications temps réel via **WebSocket**
- La compression **Gzip** des réponses
- Un endpoint de **benchmark** (SQL vs Cache vs JSON)

Le serveur écoute par défaut sur `http://127.0.0.1:8080`.

---

## Stack technique et librairies

| Librairie | Version | Rôle |
|-----------|---------|------|
| **express** | ^4.18.2 | Framework HTTP — routing, middleware, gestion des requêtes/réponses |
| **mssql** | ^12.2.0 | Client SQL Server — pools de connexion, requêtes paramétrées, transactions |
| **ws** | ^8.19.0 | Serveur WebSocket natif — notifications temps réel aux clients connectés |
| **node-cache** | ^5.1.2 | Cache clé-valeur en mémoire (TTL, check period) — stocke les `GraphData` |
| **cors** | ^2.8.5 | Middleware CORS — autorise les requêtes cross-origin du frontend |
| **compression** | ^1.8.1 | Middleware Gzip — compresse les réponses HTTP (désactivable via `?nocompress=true`) |
| **dotenv** | ^16.3.1 | Charge les variables d'environnement depuis `.env` |
| **pino** | ^8.16.0 | Logger JSON structuré haute performance |
| **pino-http** | ^8.5.0 | Middleware de logging HTTP automatique (requêtes entrantes/sortantes) |
| **typescript** | ^5.2.2 | Compilateur TypeScript — mode strict, cible ES2022 |
| **tsx** | ^4.1.0 | Exécution TypeScript à la volée en développement (`tsx watch`) |

### Configuration TypeScript

```json
{
  "target": "ES2022",
  "module": "ES2022",
  "moduleResolution": "node",
  "strict": true
}
```

Le projet utilise **ESM** (`"type": "module"` dans `package.json`), ce qui signifie que tous les imports utilisent des **extensions `.js`** (même pour les fichiers `.ts`) :

```typescript
import { MssqlService } from "./services/MssqlService.js";
```

---

## Structure des fichiers

```
backend-nodejs/
├── src/
│   ├── index.ts                          # Point d'entrée — Express + WebSocket
│   ├── models/
│   │   └── graph.ts                      # Interfaces TypeScript (GraphNode, GraphEdge, etc.)
│   ├── routes/
│   │   ├── graphRoutes.ts                # CRUD graphes, neighbors, impact, benchmark, cache
│   │   ├── algorithmRoutes.ts            # Exécution des 14 algorithmes
│   │   ├── databaseRoutes.ts             # Gestion des bases SQL Server
│   │   └── cmdbRoutes.ts                 # Import CMDB EasyVista
│   └── services/
│       ├── GraphDatabaseService.ts       # Interface abstraite du service DB
│       ├── MssqlService.ts               # Implémentation SQL Server
│       ├── AlgorithmService.ts           # 14 algorithmes de graphe (pur TypeScript)
│       └── MermaidParser.ts              # Parseur de code Mermaid → nœuds/arêtes
├── package.json
├── tsconfig.json
└── .env                                  # Variables d'environnement (non versionné)
```

---

## Point d'entrée — `index.ts`

Le fichier `index.ts` est le point d'entrée de l'application. Il orchestre :

### 1. Initialisation des middlewares

```
Express app
  ├── cors()              → Expose les headers custom (X-Cache, X-Response-Time, etc.)
  ├── compression()       → Gzip niveau 6, désactivable via ?nocompress=true
  ├── express.json()      → Parse le body JSON, limite 50 MB
  └── pinoHttp()          → Log chaque requête HTTP
```

### 2. Connexion à SQL Server

Le `MssqlService` est instancié avec les paramètres lus depuis `.env` (`MSSQL_HOST`, `MSSQL_PORT`, etc.), puis `initialize()` est appelé (création des tables si nécessaire).

Si `MSSQL_HOST` n'est pas défini, le processus quitte immédiatement (`process.exit(1)`).

### 3. Middleware `resolveEngine`

Chaque requête traverse le middleware `resolveEngine` qui injecte le service de base de données dans l'objet `req` :

```typescript
function resolveEngine(req, _res, next) {
  (req as any).dbService = dbService;  // instance de MssqlService
  next();
}
```

### 4. Montage des routes

| Chemin | Module | Description |
|--------|--------|-------------|
| `/api` | `graphRoutes` | CRUD graphes, voisins, impact, benchmark, cache |
| `/api` | `algorithmRoutes` | Algorithmes de graphe |
| `/api/databases` | `databaseRoutes` | Gestion des bases SQL Server |
| `/api/cmdb` | `cmdbRoutes` | Import CMDB EasyVista |
| `/api/query` | Inline | Exécution de requêtes SQL brutes |
| `/api/health` | Inline | Health check |
| `/api/engines` | Inline | Liste des moteurs disponibles |

### 5. Endpoints inline

- **`POST /api/query`** — Exécute une requête SQL brute via `service.executeRawQuery()`. Valide que le body contient un champ `query` non vide. Retourne `{ rows, elapsed_ms, rowCount, engine }`.
- **`GET /api/health`** — Retourne `{ status: "ok", timestamp, engines: ["mssql"] }`.
- **`GET /api/engines`** — Retourne `{ available: ["mssql"], default: "mssql" }`.

### 6. Gestion des erreurs

Un error handler global capture toutes les erreurs remontées par `next(error)` dans les routes :

```typescript
app.use((err, req, res, next) => {
  logger.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});
```

### 7. Serveur HTTP + WebSocket

Le serveur HTTP Node.js natif (`http.createServer(app)`) est partagé entre Express et le serveur WebSocket (`ws`). Le WebSocket écoute sur le chemin `/ws`.

---

## Modèle de données — `models/graph.ts`

Toutes les interfaces TypeScript utilisées dans le backend :

### Entités principales

| Interface | Champs clés | Description |
|-----------|-------------|-------------|
| `GraphNode` | `id`, `label`, `node_type`, `properties` | Un nœud du graphe |
| `GraphEdge` | `source`, `target`, `label?`, `edge_type`, `properties` | Une arête (relation) |
| `GraphData` | `nodes[]`, `edges[]` | Contenu complet d'un graphe |
| `Graph` | `id`, `title`, `description`, `graph_type`, `node_count`, `edge_count`, `created_at` | Métadonnées d'un graphe |
| `GraphSummary` | `id`, `title`, `description`, `graph_type`, `node_count`, `edge_count` | Version allégée pour le listing |
| `GraphStats` | `node_count`, `edge_count`, `node_types`, `average_degree` | Statistiques d'un graphe |
| `ImpactResult` | `sourceNodeId`, `impactedNodes[]`, `depth`, `threshold`, `elapsed_ms`, `engine` | Résultat d'analyse d'impact |
| `CreateGraphRequest` | `title`, `description`, `graph_type`, `mermaid_code?`, `nodes?`, `edges?` | Body de création de graphe |

### Deux modes de création de graphe

1. **Via code Mermaid** : le champ `mermaid_code` est parsé par `MermaidParser`
2. **Via nœuds/arêtes directs** : les champs `nodes[]` et `edges[]` sont fournis directement (pour les grands graphes)

---

## Interface du service — `GraphDatabaseService.ts`

Interface TypeScript définissant le contrat que doit respecter toute implémentation de moteur de base de données :

```typescript
interface GraphDatabaseService {
  readonly engineName: string;

  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;

  // CRUD
  createGraph(graphId, title, description, graphType, nodes, edges, database?): Promise<Graph>;
  getGraph(graphId, database?, bypassCache?): Promise<GraphData>;
  listGraphs(database?): Promise<GraphSummary[]>;
  getGraphStats(graphId, database?): Promise<GraphStats>;
  deleteGraph(graphId, database?): Promise<void>;

  // Navigation
  getStartingNode(graphId, database?): Promise<GraphNode | null>;
  getNodeNeighbors(graphId, nodeId, depth, database?): Promise<GraphData>;
  computeImpact(graphId, nodeId, depth, database?, threshold?): Promise<ImpactResult>;

  // SQL brut (optionnel)
  executeRawQuery?(query, database?): Promise<{ rows, elapsed_ms, rowCount, engine }>;

  // Cache
  getCacheStats(): { hits, misses, bypasses, cachedGraphs, keys };
  clearCache(graphId?, database?): { cleared: string[] };

  // Gestion des bases
  listDatabases(): Promise<Array<{ name, default, status }>>;
  createDatabase(databaseName): Promise<void>;
  deleteDatabase(databaseName): Promise<void>;
  getDatabaseStats(databaseName): Promise<{ nodeCount, relationshipCount, graphCount }>;
}
```

Le paramètre `database?` présent sur la plupart des méthodes permet de cibler une base SQL Server spécifique (le backend gère un **pool de connexions par base**).

---

## Implémentation MSSQL — `MssqlService.ts`

Classe qui implémente `GraphDatabaseService` pour **Microsoft SQL Server**.

### Schéma de base de données

Trois tables sont créées automatiquement lors de `initialize()` :

```
┌─────────────────────┐
│       graphs        │
├─────────────────────┤
│ id (PK)             │ NVARCHAR(255)
│ title               │ NVARCHAR(255)
│ description         │ NVARCHAR(MAX)
│ graph_type          │ NVARCHAR(50)
│ node_count          │ INT
│ edge_count          │ INT
│ created_at          │ DATETIME2
└─────────────────────┘
         │ 1
         │
         │ * (ON DELETE CASCADE)
┌─────────────────────┐     ┌─────────────────────┐
│    graph_nodes      │     │    graph_edges       │
├─────────────────────┤     ├─────────────────────┤
│ id (PK, IDENTITY)   │     │ id (PK, IDENTITY)    │
│ graph_id (FK)       │     │ graph_id (FK)        │
│ node_id (UNIQUE)    │     │ source_id            │
│ label               │     │ target_id            │
│ node_type           │     │ label                │
│ properties (JSON)   │     │ edge_type            │
└─────────────────────┘     │ properties (JSON)    │
                            └─────────────────────┘
```

**Index créés** : `graph_id` sur les deux tables, `(graph_id, source_id)` et `(graph_id, target_id)` sur `graph_edges`.

### Gestion des pools de connexion

Le service maintient un `Map<string, ConnectionPool>` pour gérer un pool par base de données :

```typescript
private pools = new Map<string, sql.ConnectionPool>();

private async getPool(database?: string): Promise<sql.ConnectionPool> {
  const db = database || this.defaultDatabase;
  if (!this.pools.has(db)) {
    const pool = new sql.ConnectionPool({ ...this.baseConfig, database: db });
    await pool.connect();
    this.pools.set(db, pool);
  }
  return this.pools.get(db)!;
}
```

Configuration du pool : max 10 connexions, idle timeout 30s, request timeout 600s (10 min).

### Insertion par batch

SQL Server limite à **2100 paramètres** par requête. Le service batch l'insertion :

- **Nœuds** : 4 colonnes par nœud + 1 `graphId` partagé → batch de **500 nœuds**
- **Arêtes** : 5 colonnes par arête + 1 `graphId` partagé → batch de **400 arêtes**

Chaque batch construit dynamiquement les paramètres nommés (`@nid0`, `@nlbl0`, `@ntyp0`, `@nprop0`, ...) et les insère en une seule requête `INSERT INTO ... VALUES`.

### Lecture parallèle (`getGraph`)

La lecture d'un graphe exécute **deux requêtes en parallèle** via `Promise.all()` :

```typescript
const [nodesRes, edgesRes] = await Promise.all([
  pool.request().query(`SELECT ... FROM graph_nodes WHERE graph_id = @graphId`),
  pool.request().query(`SELECT ... FROM graph_edges WHERE graph_id = @graphId`),
]);
```

Les résultats sont ensuite désérialisés (parsing du JSON des `properties`) et assemblés en un objet `GraphData`.

### Traversée par CTE récursive (`getNodeNeighbors`)

La navigation dans le graphe utilise une **Common Table Expression (CTE) récursive** SQL Server :

```sql
WITH Traverse AS (
  -- Cas de base : le nœud source
  SELECT node_id, 0 AS lvl
  FROM graph_nodes WHERE graph_id = @graphId AND node_id = @nodeId

  UNION ALL

  -- Récursion : suivre les arêtes sortantes
  SELECT n.node_id, t.lvl + 1
  FROM Traverse t
  JOIN graph_edges e ON e.source_id = t.node_id
  JOIN graph_nodes n ON n.node_id = e.target_id
  WHERE t.lvl < @maxDepth
)
```

- Explore les arêtes **sortantes ET entrantes** (deux CTEs distinctes fusionnées)
- Limité à 15 niveaux de profondeur max
- `OPTION (MAXRECURSION 200)` pour SQL Server

### Analyse d'impact (`computeImpact`)

Deux modes selon le seuil (`threshold`) :

1. **Sans seuil (threshold = 0)** : CTE récursive SQL Server — BFS sortant, retourne tous les nœuds atteignables avec leur niveau de propagation.

2. **Avec seuil (threshold > 0)** : BFS **en mémoire** — charge le graphe complet, puis propage niveau par niveau. Un nœud est impacté seulement si `≥ threshold%` de ses parents entrants sont déjà impactés.

### Auto-création des tables

Lors de la première connexion à une base non-système (hors `master`, `tempdb`, `model`, `msdb`), le service appelle automatiquement `ensureTables()` pour créer les tables `graphs`, `graph_nodes` et `graph_edges` si elles n'existent pas déjà. Cela permet d'utiliser n'importe quelle base (y compris `DATA_VALEO`) comme cible pour stocker et lire des graphes, sans configuration préalable.

---

## Routes

### `graphRoutes.ts`

**Pattern** : fonction factory `graphRoutes(service, broadcast?)` qui retourne un `Router`.

| Méthode | Endpoint | Description | Appels service |
|---------|----------|-------------|----------------|
| `GET` | `/graphs` | Lister tous les graphes | `service.listGraphs(database)` |
| `GET` | `/graphs/:id` | Récupérer un graphe complet | `service.getGraph(id, database, bypassCache)` |
| `GET` | `/graphs/:id/stats` | Statistiques d'un graphe | `service.getGraphStats(id, database)` |
| `GET` | `/graphs/:id/starting-node` | Premier nœud du graphe | `service.getStartingNode(id, database)` |
| `GET` | `/graphs/:id/nodes/:nodeId/neighbors` | Voisins d'un nœud (depth 1–15) | `service.getNodeNeighbors(id, nodeId, depth, database)` |
| `POST` | `/graphs/:id/impact` | Analyse d'impact serveur | `service.computeImpact(id, nodeId, depth, database, threshold)` |
| `GET` | `/graphs/:id/benchmark` | Benchmark SQL vs Cache vs JSON | `service.getGraph()` × N itérations |
| `POST` | `/graphs` | Créer un graphe (Mermaid ou nœuds directs) | `MermaidParser.parse()` + `service.createGraph()` |
| `DELETE` | `/graphs/:id` | Supprimer un graphe | `service.deleteGraph()` + `service.clearCache()` |
| `GET` | `/optim/cache/stats` | Stats du cache | `service.getCacheStats()` |
| `DELETE` | `/optim/cache` | Vider le cache | `service.clearCache()` |
| `GET` | `/optim/status` | Optimisations actives | Réponse statique |

#### Headers de performance

La route `GET /graphs/:id` ajoute des headers customs :

| Header | Valeur | Description |
|--------|--------|-------------|
| `X-Cache` | `HIT` / `MISS` / `BYPASS` | État du cache pour cette requête |
| `X-Response-Time` | `123ms` | Temps de traitement serveur |
| `X-Parallel-Queries` | `true` | Indique que les requêtes SQL sont parallélisées |
| `X-Content-Length-Raw` | `456789` | Taille non compressée en octets |
| `X-Engine` | `mssql` | Moteur de base de données utilisé |

#### Benchmark (`GET /graphs/:id/benchmark`)

Mesure 3 stratégies de chargement sur N itérations (max 10) :

1. **SQL direct** : `getGraph(id, db, true)` — bypass le cache, requête SQL pure
2. **Cache** : `getGraph(id, db, false)` — lecture depuis NodeCache
3. **JSON parse** : `JSON.parse(JSON.stringify(graphData))` — coût de sérialisation

Retourne les temps min/avg/max pour chaque stratégie + le ratio de speedup.

### `algorithmRoutes.ts`

**Pattern** : fonction factory `algorithmRoutes(service)` → `Router`.

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/graphs/:id/algorithms` | Liste les 14 algorithmes disponibles |
| `POST` | `/graphs/:id/algorithms` | Exécute un algorithme |

#### Flux d'exécution d'un algorithme

```
  Client → POST /graphs/:id/algorithms { algorithm: "pagerank", iterations: 20 }
    │
    ├─ 1. Validation : l'algorithme existe-t-il ?
    ├─ 2. Chargement du graphe : service.getGraph(id, db, true)  ← bypass cache
    ├─ 3. Exécution in-memory : AlgorithmService.pageRank(graphData, 20, 0.85)
    └─ 4. Réponse : { algorithm, elapsed_ms, nodeCount, edgeCount, result }
```

#### Paramètres du body

| Paramètre | Type | Défaut | Utilisé par |
|-----------|------|--------|-------------|
| `algorithm` | string | *requis* | Tous |
| `sourceNode` | string | — | BFS, DFS, Bidirectional BFS, Dijkstra, Cascading Failure |
| `targetNode` | string | — | Bidirectional BFS, Dijkstra |
| `depth` | number | 100 | BFS, DFS |
| `iterations` | number | 20 | PageRank, Label Propagation |
| `damping` | number | 0.85 | PageRank |
| `threshold` | number | 0.5 | Cascading Failure |
| `sampleSize` | number | — | Betweenness Centrality (échantillonnage) |

### `databaseRoutes.ts`

**Pattern** : fonction factory `createDatabaseRoutes(service)` → `Router`.

| Méthode | Endpoint | Description | Appels service |
|---------|----------|-------------|----------------|
| `GET` | `/` | Lister les bases SQL Server | `service.listDatabases()` |
| `POST` | `/` | Créer une base | `service.createDatabase(name)` |
| `DELETE` | `/:name` | Supprimer une base | `service.deleteDatabase(name)` |
| `GET` | `/:name/stats` | Stats d'une base (nœuds, arêtes, graphes) | `service.getDatabaseStats(name)` |

**Validation** : le nom de base ne peut contenir que des lettres, chiffres et underscores (`/^[a-zA-Z0-9_]+$/`).

### `cmdbRoutes.ts`

**Pattern** : fonction factory `cmdbRoutes(mssqlConfig, createGraphFn, broadcast?)` → `Router`.

Routes spécifiques à l'import de données depuis **EasyVista CMDB** (base de gestion d'actifs IT).

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `POST` | `/import` | Import CIs depuis la base EVO_DATA (EasyVista historique) |
| `POST` | `/import-valeo` | Import CIs depuis DATA_VALEO (3 modes) |
| `GET` | `/view-valeo` | Lecture directe DATA_VALEO (sans stockage) |

#### Modes d'import de `/import-valeo`

| Mode | Description |
|------|-------------|
| `default` | Sélection alphabétique classique avec filtre localisation |
| `connected` | CIs triés par nombre de relations (les plus denses d'abord) |
| `cluster` | Top N hubs (par degré) + tous leurs voisins directs + arêtes internes |

#### Flux d'import typique

```
1. Connexion à la base EasyVista (DATA_VALEO ou EVO_DATA)
2. Requête SQL : charger les CIs (AM_ASSET + classification)
3. Requête SQL : charger les relations (CONFIGURATION_ITEM_LINK + AM_REFERENCE)
4. Filtrage : garder seulement les edges dont parent ET target sont dans le set
5. Transformation en format GraphNode[] / GraphEdge[]
6. Appel createGraphFn() pour stocker dans la base cible (dev-11)
7. Broadcast WebSocket { type: "graph:created" }
8. Réponse 201 avec le graphe créé + métadonnées d'import
```

Les tables EasyVista interrogées :

| Table | Rôle |
|-------|------|
| `AM_ASSET` | Actifs IT (serveurs, services, etc.) |
| `AM_CATALOG` | Catalogue de produits |
| `AM_UN_CLASSIFICATION` | Classification hiérarchique des types d'asset |
| `CONFIGURATION_ITEM_LINK` | Relations parent/enfant entre CIs |
| `AM_REFERENCE` | Labels des types de relation |
| `CMDB_CI_STATUS` | Statut du CI (actif, retiré, etc.) |
| `CMDB_UNAVAILABILITY` | Périodes d'indisponibilité |
| `AM_LOCATION` | Localisations |

---

## Services

### `AlgorithmService.ts`

Moteur d'algorithmes de graphe **pur TypeScript**, sans dépendance à la base de données. Toutes les méthodes sont **statiques** et opèrent sur des `GraphData` en mémoire.

#### Structure interne

L'`AlgorithmService` commence par construire des **listes d'adjacence** à partir du `GraphData` :

```typescript
interface AdjList {
  outgoing: Map<string, Array<{ target: string; weight: number }>>;
  incoming: Map<string, Array<{ source: string; weight: number }>>;
  nodes: Set<string>;
}
```

Le poids des arêtes est lu depuis `edge.properties.weight` (défaut : 1).

#### Les 14 algorithmes

| # | Algorithme | Type résultat | Description |
|---|-----------|---------------|-------------|
| 1 | **BFS** | `traversal` | Parcours en largeur depuis un nœud source, avec profondeur max |
| 2 | **DFS** | `traversal` | Parcours en profondeur récursif depuis un nœud source |
| 3 | **Bidirectional BFS** | `shortestPath` | BFS simultané depuis source et target, reconstruction du chemin au point de rencontre |
| 4 | **Dijkstra** | `shortestPath` ou `traversal` | Plus court chemin pondéré (avec target) ; arbre des distances (sans target). Priority queue basée sur un tableau trié |
| 5 | **Degree Centrality** | `centrality` | Centralité de degré normalisée : `(in_degree + out_degree) / (n - 1)` |
| 6 | **Betweenness Centrality** | `centrality` | Algorithme de Brandes — mesure la fréquence à laquelle un nœud apparaît sur les plus courts chemins. Support d'échantillonnage (`sampleSize`) pour les grands graphes |
| 7 | **Closeness Centrality** | `centrality` | Centralité de proximité Wasserman-Faust normalisée : `(reachable/(n-1)) × (reachable/totalDist)` |
| 8 | **PageRank** | `centrality` | Algorithme itératif Google PageRank avec damping factor et gestion des nœuds puits (sink nodes) |
| 9 | **Louvain** | `community` | Détection de communautés par maximisation de modularité — traite le graphe comme non-dirigé. Calcul de la modularité Q |
| 10 | **Label Propagation** | `community` | Chaque nœud adopte le label le plus fréquent parmi ses voisins. Ordre aléatoire à chaque itération |
| 11 | **Connected Components** | `community` | Composantes connexes faibles (graphe non-dirigé) — BFS |
| 12 | **Strongly Connected Components** | `community` | Composantes fortement connexes — algorithme de **Tarjan** (stack + lowlink) |
| 13 | **Topological Sort** | `topologicalSort` | Tri topologique — algorithme de **Kahn** (suppression itérative des nœuds sans prédécesseur). Détecte les cycles |
| 14 | **Cascading Failure** | `traversal` | Simulation de panne en cascade — un nœud tombe si `≥ threshold%` de ses voisins entrants sont en panne |

#### Types de résultats (union discriminée)

```typescript
type AlgorithmResult = {
  algorithm: string;
  elapsed_ms: number;
  nodeCount: number;
  edgeCount: number;
  result:
    | { type: "traversal";      data: TraversalResult }
    | { type: "shortestPath";   data: ShortestPathResult }
    | { type: "centrality";     data: CentralityResult }
    | { type: "community";      data: CommunityResult }
    | { type: "topologicalSort"; data: TopologicalSortResult };
};
```

Pour les résultats de centralité, seuls les **top 100 scores** sont retournés, triés par ordre décroissant, accompagnés de statistiques (min, max, avg, median).

#### Fonctions utilitaires

- `computeStats(values)` : calcule min/max/avg/median d'un tableau de nombres
- `shuffleArray(arr)` : mélange aléatoire Fisher-Yates (utilisé par Label Propagation)

### `MermaidParser.ts`

Parseur de code **Mermaid** (syntaxe de diagramme de flux) qui transforme le texte en `{ nodes: GraphNode[], edges: GraphEdge[] }`.

#### Formats de nœuds supportés

| Syntaxe Mermaid | `node_type` |
|-----------------|-------------|
| `A[Label]` | `process` |
| `A((Label))` | `start` |
| `A{Label}` | `decision` |
| `A(Label)` | `process` |

#### Formats d'arêtes supportés

| Syntaxe | `edge_type` |
|---------|-------------|
| `A --> B` | `next` |
| `A -->│Label│ B` | `next` |
| `A ---│Label│ B` | `relation` |
| `A --- B` | `relation` |
| `A ==> B` | `strong` |
| `A -.->│Label│ B` | `optional` |
| `A -.-> B` | `optional` |

#### Inférence du type de nœud

Si un nœud est créé implicitement (via une arête), son type est inféré à partir de son ID :

- Contient `start`/`begin` → `start`
- Contient `end`/`finish` → `end`
- Contient `error`/`fail` → `error`
- Contient `decision`/`if`/`choice` → `decision`
- Sinon → `default`

---

## Système de cache

Le cache utilise **NodeCache** avec les paramètres suivants :

| Paramètre | Valeur |
|-----------|--------|
| TTL | 300 secondes (5 min) |
| Check period | 60 secondes |

### Clé de cache

Format : `graph:<database>:<graphId>`

Exemple : `graph:dev-11:graph_1710000000_abc123`

### Comportement

```
Client GET /graphs/:id
  │
  ├─ ?nocache=true → bypass cache → requête SQL → cacheStats.bypasses++
  │
  └─ Cache lookup
       ├─ HIT  → retourne les données → cacheStats.hits++
       └─ MISS → requête SQL → stocke en cache → cacheStats.misses++
```

### Invalidation

- `createGraph()` : supprime la clé du cache
- `deleteGraph()` : supprime la clé du cache
- `DELETE /optim/cache` : vide tout le cache + reset les compteurs

### Endpoints de monitoring

- `GET /optim/cache/stats` : retourne hits, misses, bypasses, nombre de graphes en cache, clés
- `GET /optim/status` : indique quelles optimisations sont actives (gzip, parallel queries, cache)

---

## WebSocket

Le serveur WebSocket est monté sur `/ws` via la librairie `ws`, partagé avec le serveur HTTP.

### Connexion

À la connexion, le serveur envoie immédiatement :

```json
{ "type": "connected", "engines": ["mssql"] }
```

### Événements broadcastés

| Événement | Déclencheur | Payload |
|-----------|-------------|---------|
| `graph:created` | Création d'un graphe (POST ou import CMDB) | `{ type, graphId, title, engine, database }` |
| `graph:deleted` | Suppression d'un graphe | `{ type, graphId, engine, database }` |

### Mécanisme de broadcast

La fonction `broadcast()` est définie dans `index.ts` et passée aux route factories :

```typescript
function broadcast(message: Record<string, any>) {
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}
```

---

## Diagramme de flux des requêtes

```
                   Client HTTP (Frontend React)
                          │
                    ┌──────┴──────┐
                    │   Express   │ :8080
                    ├─────────────┤
                    │ cors()      │
                    │ compression │
                    │ json(50MB)  │
                    │ pinoHttp    │
                    └──────┬──────┘
                           │
                    resolveEngine()
                    inject dbService
                           │
              ┌────────────┼─────────────┐
              │            │             │
        /api/graphs   /api/databases  /api/cmdb
              │            │             │
     graphRoutes()   databaseRoutes() cmdbRoutes()
              │            │             │
              └────────────┼─────────────┘
                           │
                   MssqlService
              ┌────────────┼────────────┐
              │            │            │
         NodeCache    ConnectionPool  broadcast()
         (5 min)      (per database)    → WS
              │            │
              │     ┌──────┴──────┐
              │     │ SQL Server  │
              │     │ ┌─────────┐ │
              │     │ │ graphs  │ │
              │     │ │ nodes   │ │
              │     │ │ edges   │ │
              │     └─┴─────────┘ │
              └───────────────────┘
```

---

## Variables d'environnement

Fichier `.env` à la racine de `backend-nodejs/` :

| Variable | Défaut | Description |
|----------|--------|-------------|
| `MSSQL_HOST` | *requis* | Adresse du serveur SQL Server |
| `MSSQL_PORT` | `1433` | Port SQL Server |
| `MSSQL_USER` | `sa` | Utilisateur SQL |
| `MSSQL_PASSWORD` | `""` | Mot de passe SQL |
| `MSSQL_DATABASE` | `graph_db` | Base de données par défaut |
| `SERVER_PORT` | `8080` | Port du serveur Express |
| `SERVER_HOST` | `127.0.0.1` | Adresse d'écoute |
| `LOG_LEVEL` | `info` | Niveau de log pino (trace, debug, info, warn, error, fatal) |

---

## Commandes de développement

```bash
# Démarrer en mode développement (hot reload)
npm run dev

# Compiler le TypeScript
npm run build

# Démarrer la version compilée
npm start

# Vérifier le typage sans compiler
npm run typecheck

# Nettoyer le dossier dist/
npm run clean
```
