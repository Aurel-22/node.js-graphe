# Copilot Instructions for Neo4j Graph Viewer (Full Stack)

## Overview

Full-stack Neo4j graph visualization with multi-database and triple rendering engine support:

- **backend-nodejs/**: Express + TypeScript REST API with Neo4j driver, Mermaid parser
- **frontend-graph-viewer/**: React + Vite with react-force-graph-2d, Sigma.js/Graphology, G6/AntV

## Architecture & Critical Data Flow

### Backend Service Layer Pattern

- **Neo4jService** (`backend-nodejs/src/services/Neo4jService.ts`): Core service with `getSession(database?)` for multi-db
- All methods accept optional `database` parameter for multi-tenancy
- Sessions auto-managed per database: `this.driver.session({ database: database || 'neo4j' })`
- **Initialization**: Server auto-creates example graphs on startup (`createExampleGraph()`, `createXLargeTestGraph()`)

### Frontend-Backend Communication

- **API client**: `frontend-graph-viewer/src/services/api.ts` with Axios wrapper
- **Base URL**: Hardcoded to `http://127.0.0.1:8080/api` (not configurable)
- **Query params**: All endpoints accept `?database=name` for multi-db queries
- **Types sync**: Keep `frontend/src/types/graph.ts` and `backend/src/models/graph.ts` aligned

### Graph Rendering Strategy

- **Size thresholds**: < 1K nodes → react-force-graph-2d, 1K-10K → Sigma.js, > 10K → G6
- **Adaptive config**: Node size, label visibility, drag behavior auto-adjust by graph size in each viewer
- **Color generation**: `generateColorFromString()` creates deterministic colors from node types (23-color palette)
- **Performance**: G6 renders 20K+ nodes in 450-600ms (see `G6GraphViewer.tsx` performance.now() timing)

## Essential Developer Workflows

### Backend Development

```bash
cd backend-nodejs
npm install
cp .env.example .env  # Edit NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
npm run dev           # tsx watch mode (hot reload)
```

### Frontend Development

```bash
cd frontend-graph-viewer
npm install
npm run dev           # Vite dev server on :5173
```

### Neo4j Setup (Required)

- Neo4j 5.x must be running on `neo4j://127.0.0.1:7687`
- Default credentials: `neo4j/Aurelien22` (change in `.env`)
- Backend initializes constraints/indexes on startup

### Testing Multi-Database

```bash
# Backend auto-creates 'neo4j' (default) + 'graph1' on init
# Frontend database selector in header switches between them
# API: GET /api/graphs?database=graph1
```

## Project-Specific Conventions

### Type System Patterns

- **GraphNode**: Always has `id`, `label`, `node_type`, `properties: Record<string, any>`
- **GraphEdge**: `source`, `target`, `edge_type`, optional `label`, `properties`
- **Transform layer**: `frontend/src/services/graphTransform.ts` converts to engine-specific formats

### Mermaid Parser Rules

- Parses flowchart/graph syntax in `MermaidParser.ts`
- Infers node types from IDs: `start` prefix → "start", `end` → "end", else "process"
- Supports arrows: `-->`, `-.->`, `==>` with optional labels `|text|`
- Node definitions: `A[Label]`, `B((Circle))`, `C{Diamond}`

### API Endpoint Pattern

All routes in `backend-nodejs/src/routes/`:

- Query param extraction: `req.query.database as string | undefined`
- Pass to service: `await neo4jService.method(params, database)`
- Error handling via Express error middleware

### Frontend Service Layer

- **graphApi**: CRUD operations (`listGraphs`, `getGraph`, `getGraphStats`, `getNodeNeighbors`)
- **databaseApi**: Multi-db management (`listDatabases`, `createDatabase`, `deleteDatabase`)
- **Error handling**: Axios interceptor not implemented; errors bubble to components

## Integration Points

### Neo4j Driver Usage

- Import: `import neo4j from "neo4j-driver"`
- Integer handling: Use `neo4j.int()` for counts to avoid precision issues
- Session cleanup: Always `await session.close()` in finally blocks
- Constraints: Graph ID uniqueness, node graph_id+node_id index (see `initialize()`)

### Graph Visualization Engines

- **react-force-graph-2d**: Import from `react-force-graph-2d`, uses D3 force simulation
- **Sigma.js**: WebGL renderer, requires `graphology` for graph data structure, ForceAtlas2 layout
- **G6 (AntV)**: Import `{ Graph }` from `@antv/g6`, v5 API with `data: { nodes, edges }` format

### Performance Optimization Patterns

- **Label toggling**: Hide labels when `nodeCount >= 5000` (saves 40-50% render time)
- **Node size**: Scale down from 16px → 12px → 8px as graph grows
- **Drag disable**: Turn off when `nodeCount >= 10000` for smoother interaction
- **Layout iteration**: Sigma uses 500 iterations for < 5K nodes, 300 for larger graphs

## Key Files Reference

- **Backend entry**: `backend-nodejs/src/index.ts` (app setup, Neo4j init, routes)
- **Neo4j service**: `backend-nodejs/src/services/Neo4jService.ts` (761 lines, core data logic)
- **Graph routes**: `backend-nodejs/src/routes/graphRoutes.ts` (RESTful endpoints)
- **Frontend API**: `frontend-graph-viewer/src/services/api.ts` (Axios client)
- **G6 viewer**: `frontend-graph-viewer/src/components/G6GraphViewer.tsx` (performance champion)
- **Type defs**: Sync `frontend/src/types/graph.ts` ↔ `backend/src/models/graph.ts`

## Documentation Map

- **MULTI_DATABASE_GUIDE.md**: Database switching, stats, management APIs
- **G6_INTEGRATION.md**: G6 v5 setup, adaptive config, 20K+ node optimization
- **SIGMA_OPTIMIZATION.md**: Sigma.js WebGL tweaks, ForceAtlas2 tuning
- **backend-nodejs/API_EXAMPLES.md**: cURL examples for all endpoints
- **backend-nodejs/NEO4J_MIGRATION.md**: ArangoDB → Neo4j migration notes

## Common Tasks

- **Add new node type**: Update `inferNodeType()` in `MermaidParser.ts`, sync types in both repos
- **New API endpoint**: Add to routes, update `api.ts`, document in `API_EXAMPLES.md`
- **Change default DB**: Set `defaultDatabase` in `Neo4jService.ts` constructor
- **Adjust performance**: Tweak thresholds in viewer components (search for `nodeCount >`)

---

For deep dives: Read guides above. For quick ref: Check package.json scripts in each folder.
