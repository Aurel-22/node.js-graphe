# Copilot Instructions for Neo4j Graph Viewer (Full Stack)

## Overview
This project is a full-stack application for visualizing and managing Neo4j graphs, supporting multi-database and multiple rendering engines. It consists of two main parts:
- **backend-nodejs/**: Node.js + Express + TypeScript REST API for Neo4j graph management
- **frontend-graph-viewer/**: React + TypeScript + Vite frontend for interactive graph visualization

## Architecture & Data Flow
- **Backend** exposes REST endpoints for CRUD operations, statistics, and Mermaid parsing (see `backend-nodejs/src/routes/` and `services/`).
- **Frontend** fetches graph data from the backend and renders it using one of three engines: react-force-graph-2d, Sigma.js (Graphology), or G6 (AntV).
- **Multi-database**: Backend simulates multiple Neo4j databases; frontend allows switching between them.
- **Mermaid support**: Backend parses Mermaid code to generate graphs.

## Key Developer Workflows
- **Backend**
  - Install: `cd backend-nodejs && npm install`
  - Build: `npm run build`
  - Start (prod): `npm start`
  - Start (dev): `npm run dev`
  - Configure Neo4j in `.env` (see `.env.example`)
- **Frontend**
  - Install: `cd frontend-graph-viewer && npm install`
  - Start: `npm run dev`
  - Access at http://localhost:5173

## Project-Specific Patterns & Conventions
- **API**: All endpoints are under `/api/` (see `backend-nodejs/src/routes/`).
- **TypeScript**: Used throughout both backend and frontend. Types for graphs are in `frontend-graph-viewer/src/types/graph.ts` and `backend-nodejs/src/models/graph.ts`.
- **Graph Rendering**: Choose engine in frontend UI; see `G6GraphViewer.tsx`, `SigmaGraphViewer.tsx`, `GraphViewer.tsx`.
- **Color Palette**: 23 dynamic node colors, see frontend components for implementation.
- **Performance**: Optimized for 20,000+ nodes (see `frontend-graph-viewer/SIGMA_OPTIMIZATION.md`, `G6_INTEGRATION.md`).
- **Mermaid Parsing**: Implemented in `backend-nodejs/src/services/MermaidParser.ts`.

## Integration Points
- **Neo4j**: Backend connects via `neo4j-driver` (see `.env` and `Neo4jService.ts`).
- **Frontend/Backend**: Communicate via REST; see `frontend-graph-viewer/src/services/api.ts` for API client.

## Documentation & Guides
- **backend-nodejs/README.md**: Backend API, setup, and config
- **frontend-graph-viewer/README.md**: Frontend usage and structure
- **MULTI_DATABASE_GUIDE.md**: Multi-database support
- **IMPACT_ANALYSIS_GUIDE.md**: Impact analysis features
- **G6_INTEGRATION.md**, **SIGMA_OPTIMIZATION.md**: Rendering engine details

## Examples
- To add a new graph type, update backend models and routes, then extend frontend renderers.
- For new API endpoints, add to `backend-nodejs/src/routes/` and document in `API_EXAMPLES.md`.

---
For more, see the main READMEs and guides listed above. Keep instructions concise and focused on this codebase's actual patterns and workflows.
