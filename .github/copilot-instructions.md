# Copilot Instructions — Graph Visualizer

## Architecture Overview

Monorepo with two independent apps communicating via REST:

- **`backend-nodejs/`** — Express + TypeScript API (port 8080). Multi-engine graph database abstraction supporting Neo4j, Memgraph, and ArangoDB simultaneously. Engine selected per-request via `?engine=` query param.
- **`frontend-graph-viewer/`** — React 18 + Vite + TypeScript SPA (port 5173). 7 interchangeable graph visualization engines + 1 impact analysis tool. No state library — all state in `App.tsx` via hooks.

## Backend Patterns

### Multi-Engine Strategy Pattern

All database engines implement `GraphDatabaseService` interface (`src/services/GraphDatabaseService.ts`). Key methods: `createGraph`, `getGraph`, `listGraphs`, `deleteGraph`, `getNodeNeighbors`, `listDatabases`.

- `Neo4jService` — Bolt 5.x via `neo4j-driver`, full multi-database support
- `MemgraphService` — **extends `Neo4jService`**, overrides driver (Bolt 4.x via `neo4j-driver@4.4.x` aliased as `neo4j-driver-memgraph`), no auth, single-database only
- `ArangoService` — AQL queries via `arangojs`, 3 collections: `graphs`, `graph_nodes`, `graph_edges`

Engines are registered conditionally in `src/index.ts` based on env vars (`NEO4J_URI`, `MEMGRAPH_URI`, `ARANGO_URL`). The `resolveEngine` middleware injects the service onto `(req as any).dbService`.

### Key Conventions

- **ESM only** — `"type": "module"` in package.json, `.ts` imports use `.js` extensions
- **Dev command** — `npm run dev` kills port 8080 then runs `tsx watch src/index.ts`
- **Caching** — `NodeCache` with 5-min TTL. Cache key: `graph:<database>:<graphId>`. Bypass via `?nocache=true`. Stats at `GET /optim/cache/stats`
- **Parallel queries** — `getGraph()` runs node + edge queries in `Promise.all()` for Neo4j and ArangoDB
- **Performance headers** — responses include `X-Cache`, `X-Response-Time`, `X-Engine`, `X-Parallel-Queries`
- **Mermaid parsing** — `MermaidParser` static class converts flowchart syntax to nodes/edges on `POST /api/graphs`
- **Validation** — `zod` for request validation in routes
- **Batch inserts** — ArangoDB uses `collection.import()` in chunks of 5000

### Adding a New Database Engine

1. Implement `GraphDatabaseService` interface in `src/services/`
2. Add conditional initialization in `src/index.ts` based on a new env var
3. Register in the `engines` record with a string key

## Frontend Patterns

### Visualization Engines

`ViewerType` union: `'force-graph' | '3d' | 'sigma' | 'g6' | 'd3' | 'cytoscape' | 'vis-network' | 'impact'`

Each viewer is a self-contained component in `src/components/`. Toggle buttons in the header switch `viewerType` state.

- **Two data paths**: `GraphViewer` (force-graph 2D) receives pre-transformed `ForceGraphData`; all other viewers receive raw `GraphData` and transform internally
- **Adaptive rendering**: every viewer adjusts node sizes, label visibility, and physics based on `nodeCount` thresholds (<500, 500–2k, 2k–5k, 5k–10k, >10k)

### API Layer

`src/services/api.ts` — axios client targeting `http://127.0.0.1:8080/api`. All calls accept optional `database` and `engine` query params. `GraphLoadResult` captures server timing and cache metadata from response headers.

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
ARANGO_URL=http://127.0.0.1:8529    # Optional ArangoDB
```

Comment/uncomment URI lines to enable/disable engines. At least one engine must be active.

### Docker — Database Engines

```bash
# Neo4j (standalone, bolt on 7687, web UI on 7474)
docker run -d --name neo4j -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=neo4j/neo4j-pi11 neo4j:latest

# Memgraph (bolt on 7688, no auth)
docker run -d --name memgraph --network=host memgraph/memgraph --bolt-port 7688
```

## Data Model

Shared between backend and frontend (`models/graph.ts` / `types/graph.ts`):

- `GraphNode` — `{id, label, node_type, properties}`
- `GraphEdge` — `{source, target, label?, edge_type, properties}`
- `GraphData` — `{nodes[], edges[]}`
- `GraphSummary` — list metadata with `node_count`, `edge_count`
