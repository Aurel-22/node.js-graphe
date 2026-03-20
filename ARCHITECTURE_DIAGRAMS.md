# 📐 Architecture & Diagrammes — Graph Visualizer

> Ensemble de diagrammes Mermaid pour visualiser la structure, les flux et les dépendances du projet.

---

## Table des matières

- [📐 Architecture \& Diagrammes — Graph Visualizer](#-architecture--diagrammes--graph-visualizer)
  - [Table des matières](#table-des-matières)
  - [1 — Stack Technique](#1--stack-technique)
  - [2 — Architecture Globale](#2--architecture-globale)
  - [3 — Arborescence des fichiers](#3--arborescence-des-fichiers)
  - [4 — Modèle de données](#4--modèle-de-données)
    - [Types TypeScript partagés](#types-typescript-partagés)
  - [5 — Flux de requêtes HTTP](#5--flux-de-requêtes-http)
  - [6 — Séquence de chargement initial](#6--séquence-de-chargement-initial)
  - [7 — Chaîne useEffect en cascade](#7--chaîne-useeffect-en-cascade)
  - [8 — Endpoints REST](#8--endpoints-rest)
  - [9 — Pipeline GET /api/graphs/:id](#9--pipeline-get-apigraphsid)
  - [10 — Analyse d'impact](#10--analyse-dimpact)
    - [Flux global](#flux-global)
    - [Logique BFS avec seuil](#logique-bfs-avec-seuil)
  - [11 — Algorithmes de graphe](#11--algorithmes-de-graphe)
  - [12 — Exécution d'un algorithme](#12--exécution-dun-algorithme)
  - [13 — Import CMDB](#13--import-cmdb)
    - [Propriétés d'un nœud CMDB importé](#propriétés-dun-nœud-cmdb-importé)
  - [14 — WebSocket](#14--websocket)
  - [15 — Architecture Frontend](#15--architecture-frontend)
  - [16 — Viewers interchangeables](#16--viewers-interchangeables)
    - [Rendu adaptatif selon la taille du graphe](#rendu-adaptatif-selon-la-taille-du-graphe)
  - [17 — Cache \& Performance](#17--cache--performance)
  - [18 — Schéma SQL Server](#18--schéma-sql-server)
    - [Contraintes MSSQL](#contraintes-mssql)
  - [19 — Gestion multi-bases](#19--gestion-multi-bases)
  - [Résumé des librairies par rôle](#résumé-des-librairies-par-rôle)

---

## 1 — Stack Technique

```mermaid
graph TB
    subgraph Frontend["🖥️ Frontend — SPA React"]
        React["React 18.2"]
        Vite["Vite 5.0"]
        TS_F["TypeScript 5.3"]
        Axios["Axios 1.6"]
        Sigma["Sigma.js 3.0<br/>(WebGL)"]
        Graphology["Graphology 0.26"]
        ForceAtlas["ForceAtlas2"]
        ThreeJS["Three.js 0.183"]
        ForceGraph3D["react-force-graph-3d"]
        MsgPack_F["@msgpack/msgpack"]
        Bootstrap["Bootstrap Icons"]
    end

    subgraph Backend["⚙️ Backend — API Node.js"]
        Express["Express 4.18"]
        TS_B["TypeScript (ESM)"]
        MSSQL_Driver["mssql 12.2"]
        WS["ws 8.19<br/>(WebSocket)"]
        NodeCache["node-cache 5.1"]
        Pino["Pino 8.16<br/>(Logging)"]
        Compression["compression 1.8<br/>(gzip)"]
        MsgPack_B["@msgpack/msgpack"]
        Dotenv["dotenv"]
    end

    subgraph Database["🗄️ Base de données"]
        MSSQL[("SQL Server<br/>(MSSQL)")]
    end

    Frontend -->|"REST (JSON / MsgPack)"| Backend
    Frontend -->|"WebSocket ws://"| Backend
    Backend -->|"TDS Protocol"| Database

    style Frontend fill:#1a1a2e,stroke:#e94560,color:#fff
    style Backend fill:#16213e,stroke:#0f3460,color:#fff
    style Database fill:#0f3460,stroke:#533483,color:#fff
```

---

## 2 — Architecture Globale

```mermaid
graph LR
    subgraph Client["Navigateur Web"]
        SPA["React SPA<br/>:5173"]
    end

    subgraph Server["Serveur Node.js :8080"]
        direction TB
        MW["Middleware<br/>CORS · Gzip · JSON 50MB · Pino"]
        Router["Express Router"]
        
        subgraph Routes["Routes"]
            GR["/api/graphs"]
            DR["/api/databases"]
            AR["/api/graphs/:id/algorithms"]
            CR["/api/cmdb"]
            QR["/api/query"]
            HR["/api/health"]
        end
        
        subgraph Services["Services"]
            GDS["GraphDatabaseService<br/>(Interface)"]
            MS["MssqlService<br/>(Implémentation)"]
            AS["AlgorithmService<br/>(In-memory)"]
            MP["MermaidParser"]
        end
        
        Cache["NodeCache<br/>TTL 5 min"]
        WSS["WebSocket Server<br/>/ws"]
    end

    subgraph DB["SQL Server"]
        MSSQL_DB[("Bases multiples<br/>dev-11 · DATA_VALEO · ...")]
    end

    SPA -->|"HTTP REST"| MW
    SPA <-->|"WS Events"| WSS
    MW --> Router
    Router --> Routes
    Routes --> Services
    GDS -.->|"implements"| MS
    MS --> Cache
    MS --> MSSQL_DB
    AR --> AS

    style Client fill:#e8f5e9,stroke:#2e7d32,color:#000
    style Server fill:#e3f2fd,stroke:#1565c0,color:#000
    style DB fill:#fce4ec,stroke:#c62828,color:#000
```

---

## 3 — Arborescence des fichiers

```mermaid
graph TB
    Root["node.js-graphe/"]
    
    subgraph BE["backend-nodejs/"]
        BE_SRC["src/"]
        BE_IDX["index.ts<br/>(Server + WS + Routes)"]
        BE_MODELS["models/"]
        BE_GRAPH_TS["graph.ts<br/>(Types partagés)"]
        BE_ROUTES["routes/"]
        BE_R1["graphRoutes.ts"]
        BE_R2["databaseRoutes.ts"]
        BE_R3["algorithmRoutes.ts"]
        BE_R4["cmdbRoutes.ts"]
        BE_SERVICES["services/"]
        BE_S1["GraphDatabaseService.ts<br/>(Interface)"]
        BE_S2["MssqlService.ts<br/>(~800 lignes)"]
        BE_S3["AlgorithmService.ts<br/>(14 algorithmes)"]
        BE_S4["MermaidParser.ts"]
    end
    
    subgraph FE["frontend-graph-viewer/"]
        FE_SRC["src/"]
        FE_APP["App.tsx<br/>(~20 useState)"]
        FE_COMP["components/"]
        FE_C1["SigmaGraphViewer.tsx<br/>(~1700 lignes)"]
        FE_C2["ForceGraph3DViewer.tsx"]
        FE_C3["ImpactAnalysis.tsx"]
        FE_C4["AlgorithmPanel.tsx"]
        FE_C5["SimulationPanel.tsx"]
        FE_C6["SqlQueryPanel.tsx"]
        FE_C7["GraphList.tsx"]
        FE_C8["ClassificationFilterPanel.tsx"]
        FE_C9["GraphFormModal.tsx"]
        FE_HOOKS["hooks/"]
        FE_H1["useTheme.ts"]
        FE_H2["useWebSocket.ts"]
        FE_SVC["services/"]
        FE_SVC1["api.ts<br/>(6 namespaces)"]
        FE_SVC2["graphTransform.ts"]
        FE_SVC3["nodePositionCache.ts"]
        FE_TYPES["types/"]
        FE_T1["graph.ts"]
    end

    Root --> BE
    Root --> FE
    BE --> BE_SRC
    BE_SRC --> BE_IDX
    BE_SRC --> BE_MODELS --> BE_GRAPH_TS
    BE_SRC --> BE_ROUTES
    BE_ROUTES --> BE_R1
    BE_ROUTES --> BE_R2
    BE_ROUTES --> BE_R3
    BE_ROUTES --> BE_R4
    BE_SRC --> BE_SERVICES
    BE_SERVICES --> BE_S1
    BE_SERVICES --> BE_S2
    BE_SERVICES --> BE_S3
    BE_SERVICES --> BE_S4
    FE --> FE_SRC
    FE_SRC --> FE_APP
    FE_SRC --> FE_COMP
    FE_COMP --> FE_C1
    FE_COMP --> FE_C2
    FE_COMP --> FE_C3
    FE_COMP --> FE_C4
    FE_COMP --> FE_C5
    FE_COMP --> FE_C6
    FE_COMP --> FE_C7
    FE_COMP --> FE_C8
    FE_COMP --> FE_C9
    FE_SRC --> FE_HOOKS
    FE_HOOKS --> FE_H1
    FE_HOOKS --> FE_H2
    FE_SRC --> FE_SVC
    FE_SVC --> FE_SVC1
    FE_SVC --> FE_SVC2
    FE_SVC --> FE_SVC3
    FE_SRC --> FE_TYPES --> FE_T1
```

---

## 4 — Modèle de données

```mermaid
erDiagram
    GRAPHS ||--o{ GRAPH_NODES : contient
    GRAPHS ||--o{ GRAPH_EDGES : contient
    GRAPH_NODES ||--o{ GRAPH_EDGES : "source_id"
    GRAPH_NODES ||--o{ GRAPH_EDGES : "target_id"

    GRAPHS {
        int id PK
        varchar title
        text description
        varchar graph_type
        int node_count
        int edge_count
        datetime created_at
    }
    
    GRAPH_NODES {
        int id PK
        varchar graph_id FK
        varchar node_id UK
        varchar label
        varchar node_type
        nvarchar_max properties "JSON"
    }
    
    GRAPH_EDGES {
        int id PK
        varchar graph_id FK
        varchar source_id FK
        varchar target_id FK
        varchar label
        varchar edge_type
        nvarchar_max properties "JSON"
    }
```

### Types TypeScript partagés

```mermaid
classDiagram
    class GraphNode {
        +string id
        +string label
        +string node_type
        +Record~string,any~ properties
    }

    class GraphEdge {
        +string? id
        +string source
        +string target
        +string? label
        +string edge_type
        +Record~string,any~ properties
    }

    class GraphData {
        +GraphNode[] nodes
        +GraphEdge[] edges
    }

    class GraphSummary {
        +string id
        +string title
        +string description
        +string graph_type
        +number node_count
        +number edge_count
    }

    class GraphStats {
        +number node_count
        +number edge_count
        +Record~string,number~ node_types
        +number average_degree
    }

    class ImpactResult {
        +string sourceNodeId
        +ImpactedNode[] impactedNodes
        +number depth
        +number threshold
        +number elapsed_ms
        +string engine
    }

    class AlgorithmResult {
        +string algorithm
        +number elapsed_ms
        +number nodeCount
        +number edgeCount
        +TraversalResult | ShortestPathResult | CentralityResult | CommunityResult result
    }

    GraphData *-- GraphNode
    GraphData *-- GraphEdge
    ImpactResult *-- "0..*" ImpactedNode
```

---

## 5 — Flux de requêtes HTTP

```mermaid
sequenceDiagram
    participant Browser as 🖥️ Navigateur
    participant Axios as Axios Client
    participant Express as Express Server
    participant MW as Middleware
    participant Route as Route Handler
    participant Cache as NodeCache
    participant Service as MssqlService
    participant MSSQL as SQL Server

    Browser->>Axios: Action utilisateur
    Axios->>Express: HTTP Request + Headers
    Express->>MW: CORS → Compression → JSON Parser → Pino Logger
    MW->>Route: resolveEngine(req) → injecte dbService
    
    alt Cache HIT
        Route->>Cache: get(graph:db:id)
        Cache-->>Route: GraphData (cached)
        Route-->>Browser: 200 + X-Cache: HIT
    else Cache MISS
        Route->>Service: getGraph(id, db)
        Service->>MSSQL: Promise.all([nodes, edges])
        MSSQL-->>Service: Resultsets
        Service->>Cache: set(key, data, TTL=300s)
        Service-->>Route: GraphData
        Route-->>Browser: 200 + X-Cache: MISS
    end
```

---

## 6 — Séquence de chargement initial

```mermaid
sequenceDiagram
    participant App as App.tsx
    participant API as api.ts
    participant BE as Backend :8080
    participant WS as WebSocket /ws

    Note over App: Mount (useEffect [])
    
    App->>API: engineApi.getEngines()
    API->>BE: GET /api/engines
    BE-->>API: {available: ["mssql"], default: "mssql"}
    API-->>App: setSelectedEngine("mssql")

    Note over App: useEffect [selectedEngine]
    
    App->>API: databaseApi.listDatabases("mssql")
    API->>BE: GET /api/databases?engine=mssql
    BE-->>API: [{name: "dev-11", default: true}, ...]
    API-->>App: setSelectedDatabase("dev-11")

    Note over App: useEffect [selectedDatabase]
    
    App->>API: graphApi.listGraphs("dev-11", "mssql")
    API->>BE: GET /api/graphs?database=dev-11
    BE-->>API: GraphSummary[]
    API-->>App: setGraphs(list)

    Note over App: Auto-sélection du premier graphe

    App->>API: graphApi.getGraph(id, "dev-11")
    API->>BE: GET /api/graphs/{id}?database=dev-11
    BE-->>API: GraphData + Headers (X-Cache, X-Response-Time, ...)
    API-->>App: setRawGraphData(data)

    Note over App: Rendu du viewer actif (Sigma / 3D / ...)

    App->>WS: Connect ws://host:8080/ws
    WS-->>App: {type: "connected", engines: ["mssql"]}
    
    Note over WS,App: Écoute: graph:created / graph:deleted → refresh
```

---

## 7 — Chaîne useEffect en cascade

```mermaid
flowchart TD
    Mount["🚀 Montage App.tsx"] -->|"useEffect([])"| LoadEngines["loadEngines()"]
    LoadEngines -->|"GET /api/engines"| SetEngine["setSelectedEngine('mssql')"]
    
    SetEngine -->|"useEffect([selectedEngine])"| ResetDB["setSelectedDatabase('')"]
    ResetDB --> LoadDBs["loadDatabases()"]
    LoadDBs -->|"GET /api/databases"| SetDB["setSelectedDatabase('dev-11')"]
    
    SetDB -->|"useEffect([selectedDatabase])"| LoadGraphs["loadGraphs()"]
    LoadGraphs -->|"GET /api/graphs"| SetGraphs["setGraphs(list)"]
    SetGraphs --> AutoSelect["Auto-sélection graphe"]
    
    AutoSelect --> HandleSelect["handleSelectGraph(id)"]
    HandleSelect -->|"GET /api/graphs/:id"| SetData["setRawGraphData(data)"]
    SetData --> Timing["setTimingBreakdown(...)"]
    
    SetData --> Render["Rendu Viewer"]
    Render -->|"onRenderComplete(ms)"| UpdateTiming["Mise à jour temps total"]

    WS["WebSocket Event<br/>graph:created / deleted"] -.->|"callback"| LoadGraphs

    style Mount fill:#4caf50,color:#fff
    style SetEngine fill:#2196f3,color:#fff
    style SetDB fill:#ff9800,color:#fff
    style SetData fill:#9c27b0,color:#fff
    style WS fill:#f44336,color:#fff
```

---

## 8 — Endpoints REST

```mermaid
graph LR
    subgraph Graphs["/api/graphs"]
        G_LIST["GET /<br/>Lister"]
        G_GET["GET /:id<br/>Charger données"]
        G_POST["POST /<br/>Créer"]
        G_DELETE["DELETE /:id<br/>Supprimer"]
        G_STATS["GET /:id/stats<br/>Statistiques"]
        G_START["GET /:id/starting-node<br/>Nœud racine"]
        G_NEIGH["GET /:id/nodes/:nodeId/neighbors<br/>Voisinage (CTE récursif)"]
        G_IMPACT["POST /:id/impact<br/>Analyse d'impact"]
        G_BENCH["GET /:id/benchmark<br/>Benchmark perf"]
    end
    
    subgraph Algos["/api/graphs/:id/algorithms"]
        A_LIST["GET /<br/>Lister 14 algos"]
        A_RUN["POST /<br/>Exécuter"]
    end

    subgraph DBs["/api/databases"]
        D_LIST["GET /<br/>Lister bases"]
        D_CREATE["POST /<br/>Créer base"]
        D_DELETE["DELETE /:name<br/>Supprimer"]
        D_STATS["GET /:name/stats<br/>Stats base"]
    end

    subgraph CMDB["/api/cmdb"]
        C_IMPORT["POST /import<br/>Import EVO_DATA"]
        C_VALEO["POST /import-valeo<br/>Import DATA_VALEO"]
        C_VIEW["GET /view-valeo<br/>Aperçu (lecture seule)"]
    end

    subgraph Optim["/api/optim"]
        O_CACHE["GET /cache/stats"]
        O_CLEAR["DELETE /cache"]
        O_IDX_GET["GET /indexes/covering"]
        O_IDX_POST["POST /indexes/covering"]
        O_IDX_DEL["DELETE /indexes/covering"]
        O_STATUS["GET /status"]
    end

    subgraph System["System"]
        S_HEALTH["GET /api/health"]
        S_ENGINES["GET /api/engines"]
        S_QUERY["POST /api/query<br/>SQL brut"]
    end
```

---

## 9 — Pipeline GET /api/graphs/:id

```mermaid
flowchart TD
    REQ["GET /api/graphs/:id<br/>?nocache · ?format · ?enrich · ?stream · ?compress"] 
    
    REQ --> CHECK_CACHE{"nocache=true ?"}
    
    CHECK_CACHE -->|"Non"| CACHE_LOOKUP["NodeCache.get(graph:db:id)"]
    CACHE_LOOKUP --> HIT{"Cache HIT ?"}
    HIT -->|"Oui"| DATA_CACHED["GraphData (mémoire)"]
    HIT -->|"Non"| SQL_QUERY
    
    CHECK_CACHE -->|"Oui"| SQL_QUERY["SQL Server<br/>Promise.all([nodes, edges])"]
    SQL_QUERY --> PARSE["JSON.parse(properties)<br/>par ligne"]
    PARSE --> CACHE_SET["Cache.set(key, data, 300s)"]
    CACHE_SET --> DATA_FRESH["GraphData (frais)"]
    
    DATA_CACHED --> ENRICH_CHECK{"enrich=true ?"}
    DATA_FRESH --> ENRICH_CHECK
    
    ENRICH_CHECK -->|"Oui"| EASYVISTA["Enrichir via EasyVista<br/>CI_* → AM_ASSET"]
    ENRICH_CHECK -->|"Non"| FORMAT
    EASYVISTA --> FORMAT

    FORMAT{"format=?"}
    FORMAT -->|"msgpack"| MSGPACK["Encoder MessagePack<br/>(~24% plus petit)"]
    FORMAT -->|"forjson"| FORJSON["SQL FOR JSON PATH<br/>(JSON côté serveur)"]
    FORMAT -->|"stream"| STREAM["NDJSON Chunked<br/>(Transfer-Encoding)"]
    FORMAT -->|"json (défaut)"| JSON["JSON.stringify()"]
    
    MSGPACK --> COMPRESS
    FORJSON --> COMPRESS
    JSON --> COMPRESS
    
    COMPRESS{"compress=?"}
    COMPRESS -->|"brotli"| BROTLI["Brotli (qualité 0-11)"]
    COMPRESS -->|"défaut"| GZIP["Gzip (niveau 6)"]
    COMPRESS -->|"nocompress=true"| RAW["Pas de compression"]
    
    BROTLI --> HEADERS
    GZIP --> HEADERS
    RAW --> HEADERS
    STREAM --> HEADERS
    
    HEADERS["Headers de réponse<br/>X-Cache · X-Response-Time<br/>X-Engine · X-Format<br/>X-Compression · X-Content-Length-Raw"]
    HEADERS --> RESPONSE["200 OK → Client"]

    style REQ fill:#1565c0,color:#fff
    style RESPONSE fill:#2e7d32,color:#fff
    style EASYVISTA fill:#ff6f00,color:#fff
    style MSGPACK fill:#6a1b9a,color:#fff
    style BROTLI fill:#00838f,color:#fff
```

---

## 10 — Analyse d'impact

### Flux global

```mermaid
sequenceDiagram
    participant User as 👤 Utilisateur
    participant UI as ImpactAnalysis.tsx
    participant API as api.ts
    participant BE as graphRoutes.ts
    participant SVC as MssqlService
    participant SQL as SQL Server

    User->>UI: Sélectionne un nœud source
    User->>UI: Configure depth (1-15) + threshold (0-100%)
    User->>UI: Clic "Analyser l'impact"
    
    UI->>API: graphApi.computeImpact(graphId, nodeId, depth, db, engine, threshold)
    API->>BE: POST /api/graphs/:id/impact
    
    alt threshold = 0 (propagation totale)
        BE->>SVC: computeImpact(graphId, nodeId, depth)
        SVC->>SQL: WITH Impact AS (CTE récursif)<br/>parcours BFS sortant
        SQL-->>SVC: Nœuds impactés + niveaux
    else threshold > 0 (propagation conditionnelle)
        BE->>SVC: computeImpactWithThreshold(...)
        SVC->>SQL: Charger graphe complet en mémoire
        SQL-->>SVC: Tous les nœuds + arêtes
        Note over SVC: BFS en mémoire :<br/>Un nœud est impacté si<br/>≥ threshold% de ses parents<br/>entrants sont impactés
    end
    
    SVC-->>BE: ImpactResult
    BE-->>API: {sourceNodeId, impactedNodes[], depth, threshold, elapsed_ms}
    API-->>UI: Résultat
    
    UI->>UI: Visualisation :<br/>🟢 Sain · 🟡 Bloquant · 🔴 Impacté
    
    Note over UI: Code couleur par niveau :<br/>Niveau 1 = rouge vif<br/>Niveau 2+ = rouge décroissant
```

### Logique BFS avec seuil

```mermaid
flowchart TD
    START["Nœud source S"] --> QUEUE["File BFS : [(S, niveau 0)]"]
    QUEUE --> LOOP{"File non vide ?"}
    
    LOOP -->|"Oui"| DEQUEUE["Extraire (nœud N, niveau L)"]
    DEQUEUE --> NEIGHBORS["Trouver voisins sortants de N"]
    NEIGHBORS --> FOR_EACH["Pour chaque voisin V"]
    
    FOR_EACH --> ALREADY{"V déjà visité ?"}
    ALREADY -->|"Oui"| FOR_EACH
    ALREADY -->|"Non"| CHECK_DEPTH{"L+1 ≤ maxDepth ?"}
    CHECK_DEPTH -->|"Non"| FOR_EACH
    
    CHECK_DEPTH -->|"Oui"| THRESHOLD_CHECK{"threshold > 0 ?"}
    
    THRESHOLD_CHECK -->|"Non"| MARK["Marquer V impacté (niveau L+1)<br/>Ajouter à la file"]
    
    THRESHOLD_CHECK -->|"Oui"| COMPUTE_PCT["Calculer :<br/>parents impactés de V / total parents de V"]
    COMPUTE_PCT --> PCT_CHECK{"% ≥ threshold ?"}
    PCT_CHECK -->|"Oui"| MARK
    PCT_CHECK -->|"Non"| SKIP["V non impacté<br/>(propagation bloquée)"]
    SKIP --> FOR_EACH
    
    MARK --> FOR_EACH
    LOOP -->|"Non"| RESULT["Retourner ImpactResult<br/>{impactedNodes[], depth, elapsed_ms}"]

    style START fill:#f44336,color:#fff
    style RESULT fill:#4caf50,color:#fff
    style MARK fill:#ff9800,color:#fff
    style SKIP fill:#9e9e9e,color:#fff
```

---

## 11 — Algorithmes de graphe

```mermaid
graph TB
    subgraph Traversal["🔍 Parcours"]
        BFS["BFS<br/>Breadth-First Search"]
        DFS["DFS<br/>Depth-First Search"]
    end

    subgraph ShortestPath["📏 Plus court chemin"]
        DIJKSTRA["Dijkstra<br/>(pondéré)"]
        BIDIR["BFS Bidirectionnel<br/>(non pondéré)"]
    end

    subgraph Centrality["⭐ Centralité"]
        DEGREE["Degré"]
        BETWEEN["Betweenness<br/>(Brandes)"]
        CLOSE["Closeness<br/>(Wasserman-Faust)"]
        PAGERANK["PageRank<br/>(itératif)"]
    end

    subgraph Community["🏘️ Communautés"]
        LOUVAIN["Louvain<br/>(modularité)"]
        LABEL["Label Propagation"]
        WEAKCC["Composantes<br/>connexes (faibles)"]
        STRONGCC["Composantes<br/>fortement connexes<br/>(Tarjan)"]
    end

    subgraph Other["🔧 Autres"]
        TOPO["Tri topologique<br/>(Kahn)"]
        CASCADE["Cascading Failure<br/>(simulation panne)"]
    end

    INPUT["GraphData<br/>{nodes[], edges[]}"] --> ADJ["Construction<br/>listes d'adjacence<br/>(outgoing + incoming)"]
    
    ADJ --> Traversal
    ADJ --> ShortestPath
    ADJ --> Centrality
    ADJ --> Community
    ADJ --> Other

    style INPUT fill:#1565c0,color:#fff
    style Traversal fill:#e8f5e9,stroke:#2e7d32
    style ShortestPath fill:#e3f2fd,stroke:#1565c0
    style Centrality fill:#fff3e0,stroke:#e65100
    style Community fill:#f3e5f5,stroke:#6a1b9a
    style Other fill:#fce4ec,stroke:#c62828
```

---

## 12 — Exécution d'un algorithme

```mermaid
sequenceDiagram
    participant Panel as AlgorithmPanel.tsx
    participant API as algorithmApi
    participant Route as algorithmRoutes.ts
    participant Algo as AlgorithmService
    participant SVC as MssqlService
    participant SQL as SQL Server

    Panel->>Panel: Sélection algorithme + paramètres<br/>(sourceNode, targetNode, depth, ...)
    Panel->>API: runAlgorithm(graphId, "pagerank", params)
    API->>Route: POST /api/graphs/:id/algorithms
    
    Route->>Route: Validation :<br/>algorithme valide ?<br/>sourceNode requis ?
    
    Route->>SVC: getGraph(graphId, db, bypassCache=true)
    SVC->>SQL: SELECT nodes + edges
    SQL-->>SVC: GraphData (frais)
    SVC-->>Route: {nodes[], edges[]}
    
    Route->>Algo: run(algorithm, graphData, params)
    
    Note over Algo: 1. Construire AdjList<br/>(outgoing + incoming + nodes Set)
    Note over Algo: 2. Exécuter algorithme<br/>(tout en mémoire, O(V+E) à O(V²))
    Note over Algo: 3. Mesurer elapsed_ms
    
    Algo-->>Route: AlgorithmResult
    Route-->>API: {algorithm, elapsed_ms, nodeCount, edgeCount, result}
    API-->>Panel: Affichage résultats

    alt type = "traversal"
        Panel->>Panel: Liste nœuds visités par niveau
    else type = "shortestPath"
        Panel->>Panel: Chemin + coût + nœuds explorés
    else type = "centrality"
        Panel->>Panel: Top 100 scores + stats (min/max/avg/median)
    else type = "community"
        Panel->>Panel: Communautés + modularité
    else type = "topologicalSort"
        Panel->>Panel: Ordre + détection cycles
    end
```

---

## 13 — Import CMDB

```mermaid
flowchart LR
    subgraph Source["Sources EasyVista"]
        EVO["EVO_DATA<br/>(schema 40000)"]
        VALEO["DATA_VALEO<br/>(schema 50004)"]
    end

    subgraph Import["Processus d'import"]
        LOAD_CI["1. Charger CIs<br/>AM_ASSET"]
        LOAD_CLASS["2. Joindre classification<br/>AM_UN_CLASSIFICATION"]
        LOAD_REL["3. Charger relations<br/>CONFIGURATION_ITEM_LINK"]
        FILTER["4. Filtrer arêtes<br/>(CIs importés uniquement)"]
        CREATE["5. Créer graphe<br/>cmdb_timestamp_random"]
    end

    subgraph Modes["Modes DATA_VALEO"]
        DEFAULT["default<br/>Sélection alphabétique"]
        CLUSTER["cluster<br/>Top N hubs + voisins"]
        CONNECTED["connected<br/>Top N par degré total"]
        SUBGRAPH_M["subgraph<br/>Par types classification"]
    end

    subgraph Output["Résultat"]
        GRAPH[("Graphe créé<br/>dans dev-11")]
        WS_EVT["WebSocket<br/>graph:created"]
    end

    EVO -->|"POST /api/cmdb/import"| LOAD_CI
    VALEO -->|"POST /api/cmdb/import-valeo"| LOAD_CI
    VALEO -->|"GET /api/cmdb/view-valeo"| Modes

    LOAD_CI --> LOAD_CLASS --> LOAD_REL --> FILTER --> CREATE
    Modes --> LOAD_CI
    CREATE --> GRAPH
    CREATE --> WS_EVT

    style EVO fill:#fff3e0,stroke:#e65100
    style VALEO fill:#e8f5e9,stroke:#2e7d32
    style GRAPH fill:#e3f2fd,stroke:#1565c0
    style WS_EVT fill:#fce4ec,stroke:#c62828
```

### Propriétés d'un nœud CMDB importé

```mermaid
graph LR
    NODE["GraphNode CMDB"]
    NODE --- ID["id: CI_12345"]
    NODE --- LABEL["label: Server-ABC"]
    NODE --- TYPE["node_type: Serveur"]
    NODE --- PROPS["properties:"]
    PROPS --- P1["asset_id: 12345"]
    PROPS --- P2["nom: Server-ABC"]
    PROPS --- P3["nDeCI: WIN-ABC123"]
    PROPS --- P4["type_id: 318"]
    PROPS --- P5["type_label: Serveur"]
    PROPS --- P6["family_label: Ressource Matérielle"]
    PROPS --- P7["classification_level: 1"]

    style NODE fill:#1565c0,color:#fff
```

---

## 14 — WebSocket

```mermaid
sequenceDiagram
    participant Client1 as Client A
    participant Client2 as Client B
    participant WSS as WebSocket Server /ws
    participant Routes as Route Handler

    Note over Client1,WSS: Connexion initiale
    Client1->>WSS: ws://host:8080/ws
    WSS-->>Client1: {type: "connected", engines: ["mssql"]}
    
    Client2->>WSS: ws://host:8080/ws
    WSS-->>Client2: {type: "connected", engines: ["mssql"]}

    Note over Client1,Routes: Client A crée un graphe
    Client1->>Routes: POST /api/graphs
    Routes->>Routes: Créer graphe en BDD
    Routes->>WSS: broadcast({type: "graph:created", graphId, title})
    
    WSS-->>Client1: {type: "graph:created", graphId: "g123"}
    WSS-->>Client2: {type: "graph:created", graphId: "g123"}
    
    Note over Client1,Client2: Les deux clients rafraîchissent leur liste

    Note over Client2,Routes: Client B supprime un graphe
    Client2->>Routes: DELETE /api/graphs/g123
    Routes->>WSS: broadcast({type: "graph:deleted", graphId: "g123"})
    
    WSS-->>Client1: {type: "graph:deleted", graphId: "g123"}
    WSS-->>Client2: {type: "graph:deleted", graphId: "g123"}

    Note over Client1: Déconnexion / Reconnexion
    Client1--xWSS: Connexion perdue
    Note over Client1: useWebSocket: retry dans 3s
    Client1->>WSS: Reconnexion automatique
    WSS-->>Client1: {type: "connected"}
```

---

## 15 — Architecture Frontend

```mermaid
graph TB
    subgraph AppRoot["App.tsx (State Root — ~20 useState)"]
        direction TB
        STATE["État global :<br/>graphs · selectedGraphId · rawGraphData<br/>filteredGraphData · viewerType · selectedDatabase<br/>selectedEngine · error · loading · timings"]
    end

    subgraph Header["Header"]
        ENGINE_SEL["Sélecteur Engine"]
        DB_SEL["Sélecteur Database"]
        VIEWER_BTN["Boutons Viewer"]
        THEME["Toggle Thème 🌙/☀️"]
        PERF["Temps de chargement"]
    end

    subgraph Sidebar["Sidebar gauche"]
        GRAPHLIST["GraphList<br/>Liste des graphes"]
        MODAL["GraphFormModal<br/>(Créer via Mermaid)"]
    end

    subgraph ViewerArea["Zone Viewer (React.lazy + Suspense)"]
        SIGMA["SigmaGraphViewer<br/>WebGL · ForceAtlas2"]
        THREE_D["ForceGraph3DViewer<br/>Three.js · Physique 3D"]
        IMPACT["ImpactAnalysis<br/>Analyse d'impact serveur"]
        ALGO["AlgorithmPanel<br/>14 algorithmes"]
        SIMUL["SimulationPanel<br/>Benchmark multi-combo"]
        SQL_P["SqlQueryPanel<br/>Requêtes SQL brutes"]
    end

    subgraph RightPanel["Sidebar droite"]
        CLASSIF["ClassificationFilterPanel<br/>Filtre par node_type"]
    end

    subgraph SharedServices["Services partagés"]
        API_SVC["api.ts<br/>(6 namespaces Axios)"]
        TRANSFORM["graphTransform.ts<br/>(couleurs · tailles adaptatives)"]
        POS_CACHE["nodePositionCache.ts<br/>(localStorage positions)"]
    end

    subgraph Hooks["Hooks"]
        USE_THEME["useTheme()"]
        USE_WS["useWebSocket()"]
    end

    AppRoot --> Header
    AppRoot --> Sidebar
    AppRoot --> ViewerArea
    AppRoot --> RightPanel
    AppRoot --> Hooks

    GRAPHLIST -->|"onSelectGraph"| AppRoot
    CLASSIF -->|"onFilteredData"| AppRoot
    
    ViewerArea --> SharedServices
    SIGMA --> TRANSFORM
    SIGMA --> POS_CACHE
    THREE_D --> TRANSFORM
    IMPACT --> API_SVC
    ALGO --> API_SVC
    SQL_P --> API_SVC

    style AppRoot fill:#1a237e,color:#fff
    style ViewerArea fill:#e8eaf6,stroke:#3f51b5
    style SharedServices fill:#e0f7fa,stroke:#00838f
```

---

## 16 — Viewers interchangeables

```mermaid
flowchart TD
    VT["viewerType (état App.tsx)"]
    
    VT -->|"'sigma'"| SIGMA["SigmaGraphViewer<br/>━━━━━━━━━━━━━━━<br/>📦 sigma 3.0 + graphology<br/>🖼️ Rendu WebGL<br/>📐 Layout ForceAtlas2<br/>💾 Cache positions localStorage<br/>📊 Panneau liste nœuds<br/>🔍 exploreNode() navigation<br/>━━━━━━━━━━━━━━━<br/>~1700 lignes"]
    
    VT -->|"'3d'"| THREE["ForceGraph3DViewer<br/>━━━━━━━━━━━━━━━<br/>📦 react-force-graph-3d + Three.js<br/>🖼️ Rendu WebGL 3D<br/>⚛️ Simulation physique forces<br/>🎯 Click → focus caméra<br/>━━━━━━━━━━━━━━━"]
    
    VT -->|"'impact'"| IMPACT["ImpactAnalysis<br/>━━━━━━━━━━━━━━━<br/>📡 POST /api/graphs/:id/impact<br/>🟢 Sain · 🟡 Bloquant · 🔴 Impacté<br/>📏 depth 1-15 · threshold 0-100%<br/>━━━━━━━━━━━━━━━"]
    
    VT -->|"'algorithms'"| ALGO["AlgorithmPanel<br/>━━━━━━━━━━━━━━━<br/>📡 POST /algorithms<br/>14 algorithmes en mémoire<br/>BFS · Dijkstra · PageRank · Louvain · ...<br/>━━━━━━━━━━━━━━━"]
    
    VT -->|"'simulation'"| SIMUL["SimulationPanel<br/>━━━━━━━━━━━━━━━<br/>⚡ Benchmark multi-combo<br/>Cache vs SQL · JSON vs MsgPack<br/>Gzip vs Brotli<br/>━━━━━━━━━━━━━━━"]
    
    VT -->|"'sql'"| SQL["SqlQueryPanel<br/>━━━━━━━━━━━━━━━<br/>💻 Éditeur SQL brut<br/>📊 Résultats en tableau<br/>━━━━━━━━━━━━━━━"]

    DATA["rawGraphData / filteredGraphData"]
    DATA -->|"GraphData"| SIGMA
    DATA -->|"GraphData"| THREE
    DATA -->|"GraphData"| IMPACT
    DATA -->|"GraphData"| ALGO

    style VT fill:#ff6f00,color:#fff
    style SIGMA fill:#1b5e20,color:#fff
    style THREE fill:#0d47a1,color:#fff
    style IMPACT fill:#b71c1c,color:#fff
    style ALGO fill:#4a148c,color:#fff
    style SIMUL fill:#e65100,color:#fff
    style SQL fill:#263238,color:#fff
```

### Rendu adaptatif selon la taille du graphe

```mermaid
graph LR
    subgraph Seuils["Seuils adaptatifs (nodeCount)"]
        S1["< 500 nœuds<br/>━━━━━━━━━━━━<br/>Labels complets<br/>Arêtes épaisses<br/>val = 10"]
        S2["500 – 2 000<br/>━━━━━━━━━━━━<br/>Labels moyens<br/>Arêtes normales<br/>val = 6"]
        S3["2 000 – 5 000<br/>━━━━━━━━━━━━<br/>Labels réduits<br/>Arêtes fines<br/>val = 4"]
        S4["5 000 – 10 000<br/>━━━━━━━━━━━━<br/>Labels minimaux<br/>val = 2"]
        S5["> 10 000<br/>━━━━━━━━━━━━<br/>Pas de labels<br/>Arêtes ultra-fines<br/>val = 1"]
    end
    
    S1 --> S2 --> S3 --> S4 --> S5

    style S1 fill:#4caf50,color:#fff
    style S2 fill:#8bc34a,color:#000
    style S3 fill:#ff9800,color:#000
    style S4 fill:#ff5722,color:#fff
    style S5 fill:#f44336,color:#fff
```

---

## 17 — Cache & Performance

```mermaid
flowchart TB
    subgraph Layers["Couches d'optimisation"]
        direction TB
        
        L1["1️⃣ Covering Indexes SQL<br/>IX_graph_nodes_covering<br/>IX_graph_edges_covering<br/>━━━━━━━━━━━━━━━━━<br/>Gain : ~50% sur requêtes SQL"]
        
        L2["2️⃣ Cache In-Memory (NodeCache)<br/>Clé : graph:{database}:{graphId}<br/>TTL : 300s (5 min)<br/>Bypass : ?nocache=true<br/>━━━━━━━━━━━━━━━━━<br/>Gain : ~50x vs SQL"]
        
        L3["3️⃣ Requêtes Parallèles<br/>Promise.all([nodes, edges])<br/>━━━━━━━━━━━━━━━━━<br/>Gain : ~2x vs séquentiel"]
        
        L4["4️⃣ MessagePack (binaire)<br/>@msgpack/msgpack<br/>━━━━━━━━━━━━━━━━━<br/>Gain : ~24% taille vs JSON"]
        
        L5["5️⃣ Compression réseau<br/>Gzip (défaut, niveau 6)<br/>Brotli (optionnel, qualité 0-11)<br/>━━━━━━━━━━━━━━━━━<br/>Gain : variable (~70-85%)"]
        
        L6["6️⃣ FOR JSON PATH<br/>JSON construit côté SQL Server<br/>━━━━━━━━━━━━━━━━━<br/>Évite JSON.parse par ligne"]
        
        L7["7️⃣ Streaming NDJSON<br/>Transfer-Encoding: chunked<br/>━━━━━━━━━━━━━━━━━<br/>TTFB amélioré gros graphes"]
    end

    L1 --> L2 --> L3 --> L4 --> L5

    subgraph Monitoring["Monitoring"]
        CACHE_STATS["GET /optim/cache/stats<br/>{hits, misses, bypasses, keys}"]
        OPTIM_STATUS["GET /optim/status<br/>{gzip, cache, indexes, msgpack, ...}"]
        BENCHMARK["GET /graphs/:id/benchmark<br/>SQL vs Cache vs JSON vs MsgPack"]
        HEADERS["Headers de réponse :<br/>X-Cache · X-Response-Time<br/>X-Compression · X-Format"]
    end

    style L1 fill:#1565c0,color:#fff
    style L2 fill:#2e7d32,color:#fff
    style L3 fill:#e65100,color:#fff
    style L4 fill:#6a1b9a,color:#fff
    style L5 fill:#00838f,color:#fff
    style L6 fill:#4e342e,color:#fff
    style L7 fill:#37474f,color:#fff
```

---

## 18 — Schéma SQL Server

```mermaid
flowchart TD
    subgraph SQLServer["SQL Server"]
        subgraph MasterDB["master"]
            SYS_DB["sys.databases<br/>(liste bases)"]
        end
        
        subgraph UserDB["Base utilisateur (ex: dev-11)"]
            GRAPHS_T["dbo.graphs<br/>━━━━━━━━━━━━━━━<br/>id VARCHAR PK<br/>title VARCHAR<br/>description TEXT<br/>graph_type VARCHAR<br/>node_count INT<br/>edge_count INT<br/>created_at DATETIME"]
            
            NODES_T["dbo.graph_nodes<br/>━━━━━━━━━━━━━━━<br/>id INT IDENTITY PK<br/>graph_id VARCHAR FK<br/>node_id VARCHAR<br/>label VARCHAR<br/>node_type VARCHAR<br/>properties NVARCHAR(MAX)"]
            
            EDGES_T["dbo.graph_edges<br/>━━━━━━━━━━━━━━━<br/>id INT IDENTITY PK<br/>graph_id VARCHAR FK<br/>source_id VARCHAR<br/>target_id VARCHAR<br/>label VARCHAR<br/>edge_type VARCHAR<br/>properties NVARCHAR(MAX)"]
            
            IDX1["IX_graph_nodes_covering<br/>(graph_id) INCLUDE (node_id, label,<br/>node_type, properties)"]
            IDX2["IX_graph_edges_covering<br/>(graph_id) INCLUDE (id, source_id,<br/>target_id, label, edge_type, properties)"]
        end
        
        subgraph CMDB_DB["DATA_VALEO / EVO_DATA"]
            AM_ASSET["AM_ASSET<br/>(CIs / Actifs)"]
            AM_CLASS["AM_UN_CLASSIFICATION<br/>(Familles / Types)"]
            CI_LINK["CONFIGURATION_ITEM_LINK<br/>(Relations entre CIs)"]
        end
    end

    GRAPHS_T -->|"1:N"| NODES_T
    GRAPHS_T -->|"1:N"| EDGES_T
    IDX1 -.->|"couvre"| NODES_T
    IDX2 -.->|"couvre"| EDGES_T
    
    AM_ASSET -->|"JOIN"| AM_CLASS
    AM_ASSET -->|"FK"| CI_LINK

    style MasterDB fill:#ffecb3,stroke:#ff8f00
    style UserDB fill:#e3f2fd,stroke:#1565c0
    style CMDB_DB fill:#e8f5e9,stroke:#2e7d32
```

### Contraintes MSSQL

```mermaid
graph LR
    C1["⚠️ Limite 2100 paramètres<br/>→ Batch 500 nœuds<br/>→ Batch 400 arêtes"]
    C2["⚠️ CTE MAXRECURSION 200<br/>→ Profondeur limitée<br/>pour voisinage/impact"]
    C3["⚠️ Pool par base<br/>Map‹string, ConnectionPool›<br/>Max 10 connexions<br/>Idle timeout 30s"]
    C4["⚠️ Request timeout<br/>600 000 ms (10 min)<br/>Pour gros imports"]

    style C1 fill:#fff3e0,stroke:#e65100
    style C2 fill:#fff3e0,stroke:#e65100
    style C3 fill:#fff3e0,stroke:#e65100
    style C4 fill:#fff3e0,stroke:#e65100
```

---

## 19 — Gestion multi-bases

```mermaid
sequenceDiagram
    participant UI as Frontend
    participant API as Backend
    participant Pool as Pool Manager
    participant SQL as SQL Server

    UI->>API: GET /api/databases
    API->>SQL: SELECT FROM sys.databases<br/>(exclut master, tempdb, model, msdb)
    SQL-->>API: [{name: "dev-11"}, {name: "DATA_VALEO"}, ...]
    API-->>UI: databases[]

    Note over UI: L'utilisateur change de base

    UI->>API: GET /api/graphs?database=DATA_VALEO
    API->>Pool: getPool("DATA_VALEO")
    
    alt Pool existant
        Pool-->>API: ConnectionPool (réutilisé)
    else Nouveau pool
        Pool->>SQL: new ConnectionPool(config + database)
        Pool->>SQL: ensureTables() — CREATE IF NOT EXISTS
        SQL-->>Pool: Tables prêtes
        Pool-->>API: ConnectionPool (nouveau)
    end
    
    API->>SQL: SELECT * FROM graphs (via pool)
    SQL-->>API: GraphSummary[]
    API-->>UI: Liste des graphes de DATA_VALEO

    Note over UI: Création d'une nouvelle base

    UI->>API: POST /api/databases {name: "test-db"}
    API->>SQL: CREATE DATABASE [test-db]
    API->>Pool: getPool("test-db") → ensureTables()
    API-->>UI: {message: "Created", name: "test-db"}

    Note over UI: Suppression d'une base

    UI->>API: DELETE /api/databases/test-db
    API->>API: Vérification : pas default/protégée
    API->>SQL: ALTER DATABASE SET SINGLE_USER + DROP
    API->>Pool: pool.close() + pools.delete("test-db")
    API-->>UI: {message: "Deleted"}
```

---

## Résumé des librairies par rôle

```mermaid
mindmap
    root((Graph Visualizer))
        Backend
            Express 4.18
                Routes REST
                Middleware
            mssql 12.2
                Connection Pools
                CTE récursifs
                FOR JSON PATH
            ws 8.19
                Événements temps réel
            node-cache 5.1
                TTL 5 min
                Bypass nocache
            pino 8.16
                Logging HTTP
                SQL query log
            compression 1.8
                Gzip niveau 6
            msgpack 3.1
                Sérialisation binaire
            dotenv
                Variables env
        Frontend
            React 18.2
                useState ×20
                useEffect cascade
                React.lazy
            Vite 5.0
                HMR
                Build prod
            TypeScript 5.3
                Strict mode
                ES2020
            sigma 3.0
                WebGL rendu
                ForceAtlas2
            graphology 0.26
                Structure graphe
            three.js 0.183
                Rendu 3D
            react-force-graph-3d
                Physique forces
            Axios 1.6
                Client HTTP
                Intercepteurs
            msgpack 3.1
                Décodage binaire
```
