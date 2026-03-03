# Copilot Instructions — Graph Visualizer

## Architecture Overview

Monorepo with two independent apps communicating via REST:

- **`backend-nodejs/`** — Express + TypeScript API (port 8080). Multi-engine graph database abstraction supporting Neo4j, Memgraph, MSSQL, and ArangoDB simultaneously. Engine selected per-request via `?engine=` query param.
- **`frontend-graph-viewer/`** — React 18 + Vite + TypeScript SPA (port 5173). 7 interchangeable graph visualization engines + 1 impact analysis tool. No state library — all state in `App.tsx` via hooks.

## Backend Patterns

### Multi-Engine Strategy Pattern

All database engines implement `GraphDatabaseService` interface (`src/services/GraphDatabaseService.ts`). Key methods: `createGraph`, `getGraph`, `listGraphs`, `deleteGraph`, `getNodeNeighbors`, `computeImpact`, `listDatabases`.

- `Neo4jService` — Bolt 5.x via `neo4j-driver@5.28.3` (NOT v6), Cypher queries, full multi-database, `UNWIND` batch inserts (500/batch)
- `MemgraphService` — **extends `Neo4jService`**, overrides driver (Bolt 4.x via `neo4j-driver@4.4.x` aliased as `neo4j-driver-memgraph`), no auth, single-database only. Overrides `computeImpact` using `size(relationships(path))` (Memgraph lacks `length()`)
- `MssqlService` — `mssql@12.2.0`, relational tables (`graphs`, `graph_nodes`, `graph_edges` with FK + `ON DELETE CASCADE`), CTE recursive traversal for `getNodeNeighbors`/`computeImpact`, batch INSERT (500 nodes / 400 edges due to SQL Server 2100 param limit)
- `ArangoService` — AQL queries via `arangojs`, 3 collections: `graphs`, `graph_nodes`, `graph_edges`

Engines are registered conditionally in `src/index.ts` based on env vars (`NEO4J_URI`, `MEMGRAPH_URI`, `MSSQL_HOST`, `ARANGO_URL`). The `resolveEngine` middleware injects the service onto `(req as any).dbService`.

### Key Conventions

- **ESM only** — `"type": "module"` in package.json, `.ts` imports use `.js` extensions
- **Dev command** — `npm run dev` kills port 8080 then runs `tsx watch src/index.ts`
- **Type-check** — `npm run typecheck` runs `tsc --noEmit`
- **Caching** — `NodeCache` with 5-min TTL. Cache key: `graph:<database>:<graphId>`. Bypass via `?nocache=true`. Stats at `GET /optim/cache/stats`
- **Parallel queries** — `getGraph()` runs node + edge queries in `Promise.all()` for Neo4j, MSSQL, and ArangoDB
- **Performance headers** — responses include `X-Cache`, `X-Response-Time`, `X-Engine`, `X-Parallel-Queries`
- **Graph creation** — `POST /api/graphs` accepts either `mermaid_code` (parsed by `MermaidParser`) or direct `nodes[]` + `edges[]` arrays (for large batch imports)
- **Impact analysis** — `POST /api/graphs/:id/impact` with `{nodeId, depth}` body returns `ImpactResult` (server-side BFS with elapsed_ms). Frontend compares client BFS (graphology) vs server timing
- **Docker networking** — All database containers use `--network=host` (required when HTTP proxy blocks Docker bridge)

### Adding a New Database Engine

1. Implement `GraphDatabaseService` interface in `src/services/` (including `computeImpact`)
2. Add conditional initialization in `src/index.ts` based on a new env var
3. Register in the `engines` record with a string key

### Engine-Specific Caveats

- **Memgraph**: no composite indexes, no `length(path)` function, no multi-database. `createGraph` via `UNWIND` is ~23× slower than Neo4j for 10K nodes
- **MSSQL**: CTE recursive traversal grows exponentially with depth — cap at 3-4 in production. `MAXRECURSION 200` safety net. 2100 param limit constrains batch sizes
- **Neo4j**: use `bolt://` for standalone, `neo4j://` for cluster. Driver v5.28.3 required (v6 incompatible)

## Frontend Patterns

### Visualization Engines

`ViewerType` union: `'force-graph' | '3d' | 'sigma' | 'g6' | 'd3' | 'cytoscape' | 'vis-network' | 'impact'`

Each viewer is a self-contained component in `src/components/`. Toggle buttons in the header switch `viewerType` state.

- **Two data paths**: `GraphViewer` (force-graph 2D) receives pre-transformed `ForceGraphData`; all other viewers receive raw `GraphData` and transform internally
- **Adaptive rendering**: every viewer adjusts node sizes, label visibility, and physics based on `nodeCount` thresholds (<500, 500–2k, 2k–5k, 5k–10k, >10k)
- **Impact Analysis**: `ImpactAnalysis.tsx` uses `graphology` + Sigma + ForceAtlas2, client-side BFS propagation, comparison panel with `graphApi.computeImpact()` server-side timing

### SigmaGraphViewer Progressive Mode

Progressive mode (`SigmaGraphViewer.tsx`) starts with an **empty graph** and a clickable **node list panel** (left sidebar). For graphs with >100 nodes, a deterministic 100-node sample (Fisher-Yates shuffle, seeded by `graphId`) is displayed; smaller graphs show all nodes.

- **Node list panel** — search/filter by id/label/type, colored dot per `node_type`, monospace id, explored nodes show green checkmark
- **`exploreNode(nodeId)`** — clicking a node in the list adds it + its direct neighbors (outgoing + upstream) to the Sigma graph, adds edges between visible nodes, runs ForceAtlas2 layout
- **`loadNextLevel()`** — expands all frontier nodes by one depth level (existing behavior, still available via "Next level" button)
- **State**: `exploredNodes` (Set of clicked nodeIds), `nodeListFilter` (search string), `visibleNodes` (Set of displayed nodeIds)
- **`resetToStart()`** — clears graph, resets `exploredNodes`, `nodeListFilter`, `visibleNodes`, `currentDepth`

### API Layer

`src/services/api.ts` — axios client targeting `http://127.0.0.1:8080/api`. All calls accept optional `database` and `engine` query params. `GraphLoadResult` captures server timing and cache metadata from response headers. `ImpactResult` type mirrors backend model.

### State Flow

Engine selector → `loadDatabases()` → sets `selectedDatabase` → triggers `loadGraphs()`. This chain is controlled by 3 `useEffect` hooks in `App.tsx`; order matters to avoid redundant fetches.

### Conventions

- **Color system** — centralized in `graphTransform.ts` with 30+ `NODE_COLORS` + deterministic HSL hash fallback. `SigmaGraphViewer` maps 250+ node types to Iconify SVG icons.
- **Performance instrumentation** — every viewer tracks `performance.now()` breakdowns. `FpsCounter` renders a canvas sparkline.
- **No proxy** — frontend calls backend directly via CORS (configured in backend)
- **No shared state bus** — `OptimPanel` uses `window.__optimSetLastLoad` callback to communicate with `App`

## Dev Workflow

```bash
# Backend (terminal 1)
cd backend-nodejs && npm run dev    # auto-restarts on changes, port 8080

# Frontend (terminal 2)
cd frontend-graph-viewer && npm run dev   # Vite dev server, port 5173
```

### Environment Config (`.env`)

```env
NEO4J_URI=bolt://127.0.0.1:7687     # bolt:// for standalone, neo4j:// for cluster
NEO4J_USER=neo4j
NEO4J_PASSWORD=neo4j-pi11
MEMGRAPH_URI=bolt://127.0.0.1:7688  # Memgraph on different port, no auth
MSSQL_HOST=127.0.0.1                # SQL Server
MSSQL_PORT=1433
MSSQL_USER=sa
MSSQL_PASSWORD=YourPassword123!
MSSQL_DATABASE=graph_db
ARANGO_URL=http://127.0.0.1:8529    # Optional ArangoDB
```

Comment/uncomment URI/HOST lines to enable/disable engines. At least one engine must be active.

### Docker — Database Engines

```bash
# Neo4j v5.26.0 (NOT latest — latest pulls 2026.x which breaks) — use --network=host
docker run -d --name neo4j --network=host -e NEO4J_AUTH=neo4j/neo4j-pi11 neo4j:5.26.0

# Memgraph (bolt on 7688, no auth)
docker run -d --name memgraph --network=host memgraph/memgraph --bolt-port 7688

# MSSQL Server 2022 (port 1433)
docker run -d --name mssql --network=host -e ACCEPT_EULA=Y -e SA_PASSWORD=YourPassword123! mcr.microsoft.com/mssql/server:2022-latest
```

### Bulk Graph Generation

```bash
cd backend-nodejs
node create-engine-graphs.mjs --engine=neo4j              # 1K,2K,5K,10K graphs
node create-engine-graphs.mjs --engine=mssql --database=graph_db
```

## Data Model

Shared between backend and frontend (`models/graph.ts` / `types/graph.ts`):

- `GraphNode` — `{id, label, node_type, properties}`
- `GraphEdge` — `{source, target, label?, edge_type, properties}`
- `GraphData` — `{nodes[], edges[]}`
- `GraphSummary` — list metadata with `node_count`, `edge_count`
- `ImpactResult` — `{sourceNodeId, impactedNodes[{nodeId, level}], depth, elapsed_ms, engine}`
- `CreateGraphRequest` — `{title, description, graph_type, mermaid_code?}` or `{..., nodes[], edges[]}`
