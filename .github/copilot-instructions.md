# Copilot Instructions — Graph Visualizer

## Architecture

Monorepo with two independent apps communicating via REST + WebSocket:

- **`backend-nodejs/`** — Express + TypeScript API (port 8080). MSSQL-backed graph database with `GraphDatabaseService` interface (designed for future multi-engine support).
- **`frontend-graph-viewer/`** — React 18 + Vite + TypeScript SPA (port 5173). 10 interchangeable views (6 graph viewers + impact analysis + level explorer + query panel + algorithm panel). All state in `App.tsx` via ~20 `useState` hooks — no Redux/Zustand.

## Dev Workflow

```bash
cd backend-nodejs && npm run dev      # tsx watch, port 8080
cd frontend-graph-viewer && npm run dev  # Vite, port 5173
```

- `npm run typecheck` (backend) — `tsc --noEmit`
- **No tests exist** — `npm test` is a no-op placeholder in both packages
- **No .eslintrc/.prettierrc** — linting script exists but no config file

## Backend Patterns

### Module System

- **ESM only** (`"type": "module"`). All `.ts` imports use **`.js` extensions**:
  ```typescript
  import { MssqlService } from "./services/MssqlService.js";
  ```
- TypeScript strict mode, target ES2022, output to `dist/`

### Engine Architecture

`GraphDatabaseService` interface (`src/services/GraphDatabaseService.ts`) defines the contract. Currently only `MssqlService` implements it. The `resolveEngine` middleware injects `dbService` on each request. Code has comments for planned `?engine=` multi-engine selection but only MSSQL is active.

**To add a new engine:**
1. Implement `GraphDatabaseService` in `src/services/`
2. Add conditional init in `src/index.ts` based on new env var
3. Register in the `engines` record

### Route Structure

| File | Mount | Key endpoints |
|------|-------|---------------|
| `graphRoutes.ts` | `/api` | CRUD graphs, impact, neighbors, benchmark |
| `databaseRoutes.ts` | `/api/databases` | List/create/delete databases |
| `algorithmRoutes.ts` | `/api` | `POST /api/graphs/:id/algorithms` — 14 algorithms |
| `cmdbRoutes.ts` | `/api/cmdb` | EasyVista CMDB import |
| **Inline in index.ts** | `/api` | `POST /api/query`, `GET /api/health`, `GET /api/engines` |

Route files export **factory functions** receiving `(service, broadcast?)` → `Router`.

### AlgorithmService (`src/services/AlgorithmService.ts`)

Pure in-memory graph algorithm engine. Builds adjacency lists from `GraphData`, runs: BFS, DFS, Bidirectional BFS, Dijkstra, Degree/Betweenness/Closeness centrality, PageRank, Louvain, Label Propagation, Connected/Strongly Connected Components, Topological Sort, Cascading Failure simulation.

### WebSocket

`ws` server on `/ws`. Broadcasts `graph:created`, `graph:deleted` events. `broadcast()` passed to route factories.

### Caching

`NodeCache` with 5-min TTL. Key: `graph:<database>:<graphId>`. Bypass: `?nocache=true`. Stats: `GET /optim/cache/stats`. Compression bypass: `?nocompress=true`.

### Error Handling

Routes use `try/catch` → `next(error)`. Global handler in `index.ts` returns `{error: message}`. Logging is **inconsistent**: pino in `index.ts`, `console.log/error` in services.

### MSSQL Constraints

- 2100 param limit → batch 500 nodes / 400 edges
- CTE `MAXRECURSION 200`
- Lazy connection pools per database via `Map<string, ConnectionPool>`

## Frontend Patterns

### Viewer Components (all in `src/components/`)

`ViewerType` union: `'force-graph' | '3d' | 'sigma' | 'cosmos' | 'd3' | 'vis-network' | 'impact' | 'query' | 'algorithms' | 'explorer'`

| Viewer | Component | Library |
|--------|-----------|---------|
| `force-graph` | `GraphViewer` | react-force-graph-2d |
| `3d` | `ForceGraph3DViewer` | react-force-graph-3d |
| `sigma` | `SigmaGraphViewer` | sigma + graphology |
| `cosmos` | `CosmosViewer` | @cosmograph/react (GPU) |
| `d3` | `D3GraphViewer` | d3 |
| `vis-network` | `VisNetworkViewer` | vis-network |
| `impact` | `ImpactAnalysis` | — |
| `query` | `QueryPanel` | — |
| `algorithms` | `AlgorithmPanel` | — |
| `explorer` | `LevelExplorer` | — |

- **Two data paths**: `GraphViewer` receives pre-transformed `ForceGraphData`; all others receive raw `GraphData`
- **Adaptive rendering**: viewers adjust labels/physics/sizes by `nodeCount` thresholds (<500, 500–2k, 2k–5k, 5k–10k, >10k)
- `SigmaGraphViewer.tsx` (~1700 lines) is the largest — progressive loading with node list panel, `exploreNode()`, ForceAtlas2, position caching in localStorage via `nodePositionCache.ts`
- **Disabled/unused viewer deps**: `@antv/g6` (G6 button hidden), `cytoscape` (no component exists)

### State Flow in App.tsx

Cascading `useEffect` chain (order matters):
1. Mount → `loadEngines()` → sets `selectedEngine`
2. `[selectedEngine]` → `loadDatabases()` → sets `selectedDatabase`
3. `[selectedDatabase]` → `loadGraphs()` → auto-selects first graph

Cross-component: `OptimPanel` uses `window.__optimSetLastLoad` global callback (not props/context).

### API Client (`src/services/api.ts`)

Axios client. Namespaces: `graphApi`, `cmdbApi`, `databaseApi`, `optimApi`, `engineApi`, `algorithmApi`. All methods accept optional `database` and `engine` query params. `getGraph()` extracts perf headers (`X-Cache`, `X-Response-Time`, etc.) into `GraphLoadResult`.

### Hooks

- `useTheme` — dark/light toggle via localStorage + `data-theme` attribute
- `useWebSocket` — auto-reconnecting WS, 3s reconnect

### Conventions

- **No path aliases** — all imports are relative, no barrel files
- **Color system** in `graphTransform.ts`: 30+ `NODE_COLORS` + deterministic HSL hash fallback
- **CSS co-location**: each component has a paired `.css` file
- Frontend imports can use `.tsx` extensions (`allowImportingTsExtensions: true`)

## Data Model

Shared types (`backend: src/models/graph.ts` / `frontend: src/types/graph.ts`):

- `GraphNode` — `{id, label, node_type, properties}`
- `GraphEdge` — `{source, target, label?, edge_type, properties}`
- `GraphData` — `{nodes[], edges[]}`
- `GraphSummary` — list metadata with `node_count`, `edge_count`
- `ImpactResult` — `{sourceNodeId, impactedNodes[{nodeId, level}], depth, elapsed_ms, engine}`

Algorithm results use a discriminated union: `TraversalResult | ShortestPathResult | CentralityResult | CommunityResult | TopologicalSortResult`

## Environment Variables

Backend env vars in `.env`:

| Variable | Purpose | Required |
|----------|---------|----------|
| `MSSQL_HOST/PORT/USER/PASSWORD/DATABASE` | SQL Server connection | Yes |
| `SERVER_PORT` | API port (default 8080) | No |
| `SERVER_HOST` | Bind address (default 127.0.0.1) | No |
| `LOG_LEVEL` | pino level (default "info") | No |

Request size limit: `express.json({ limit: "50mb" })`
