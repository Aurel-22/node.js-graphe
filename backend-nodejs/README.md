# Graph Visualizer Backend - Node.js

Backend Node.js/TypeScript pour le Graph Visualizer, remplaçant le backend Rust avec les mêmes fonctionnalités et API REST.

## 📋 Stack Technique

- **Runtime**: Node.js 18+ (LTS)
- **Framework**: Express 4.x avec TypeScript
- **Database**: Neo4j (driver `neo4j-driver` 5.x)
- **Parser**: Regex TypeScript pour Mermaid
- **Logging**: `pino` avec `pino-http`
- **Validation**: `zod` pour les requêtes

## 🚀 Installation

### Prérequis

- Node.js 18+ (LTS)
- Neo4j 5.x installé et en cours d'exécution sur `neo4j://127.0.0.1:7687`

### Étapes d'installation

```bash
# Installer les dépendances
npm install

# Configurer les variables d'environnement
cp .env.example .env
# Éditer .env si nécessaire

# Démarrer en mode développement
npm run dev

# Ou compiler et démarrer en production
npm run build
npm start
```

## 🔧 Configuration

Fichier `.env`:

```env
# Neo4j Configuration
NEO4J_URI=neo4j://127.0.0.1:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=Aurelien22

# Server Configuration
SERVER_HOST=127.0.0.1
SERVER_PORT=8080
NODE_ENV=development
LOG_LEVEL=info
```

## 📡 API Endpoints

### Health Check

```
GET /api/health
```

### Lister tous les graphes

```
GET /api/graphs
```

Réponse:
```json
[
  {
    "id": "example",
    "title": "Example Workflow",
    "description": "A demonstration workflow",
    "graph_type": "flowchart",
    "node_count": 11,
    "edge_count": 14
  }
]
```

### Obtenir un graphe spécifique

```
GET /api/graphs/:id
```

Réponse:
```json
{
  "nodes": [
    {
      "id": "A",
      "label": "Start",
      "node_type": "start",
      "properties": {}
    }
  ],
  "edges": [
    {
      "id": "123",
      "source": "A",
      "target": "B",
      "label": "Start",
      "edge_type": "next",
      "properties": {}
    }
  ]
}
```

### Obtenir les statistiques d'un graphe

```
GET /api/graphs/:id/stats
```

Réponse:
```json
{
  "node_count": 11,
  "edge_count": 14,
  "node_types": {
    "start": 1,
    "process": 7,
    "decision": 1,
    "end": 1,
    "error": 1
  },
  "average_degree": 1.27
}
```

### Créer un nouveau graphe

```
POST /api/graphs
Content-Type: application/json

{
  "title": "Mon Graphe",
  "description": "Description du graphe",
  "graph_type": "flowchart",
  "mermaid_code": "graph TD\n  A[Start] --> B[Process]\n  B --> C{Decision}\n  C -->|Yes| D[End]"
}
```

Réponse:
```json
{
  "id": "graph_1234567890_abc123",
  "title": "Mon Graphe",
  "description": "Description du graphe",
  "graph_type": "flowchart",
  "node_count": 4,
  "edge_count": 3,
  "created_at": "2026-02-11T12:34:56.789Z"
}
```

### Supprimer un graphe

```
DELETE /api/graphs/:id
```

Réponse: 204 No Content

## 🧪 Graphes de Test

Le backend crée automatiquement deux graphes de test au démarrage:

1. **example**: Un workflow de démonstration avec 11 nœuds
2. **xlarge_test**: Un graphe dense avec 20,000 nœuds pour les tests de performance

## 📂 Structure du Projet

```
backend-nodejs/
├── package.json              # Dépendances et scripts
├── tsconfig.json             # Configuration TypeScript
├── .env                      # Variables d'environnement
├── src/
│   ├── index.ts              # Point d'entrée du serveur
│   ├── models/
│   │   └── graph.ts          # Interfaces TypeScript
│   ├── services/
│   │   ├── Neo4jService.ts      # Service base de données
│   │   └── MermaidParser.ts     # Parser Mermaid
│   └── routes/
│       └── graphRoutes.ts    # Routes API REST
└── dist/                     # Code compilé (généré)
```

## 🔄 Format Mermaid Supporté

Le parser supporte les syntaxes Mermaid suivantes:

### Types de nœuds

```mermaid
A[Process]           # Rectangle
B((Start/End))       # Cercle
C{Decision}          # Losange
D(Rounded)           # Rectangle arrondi
```

### Types de connexions

```mermaid
A --> B              # Flèche simple
A -->|Label| B       # Flèche avec label
A --- B              # Ligne simple
A ---|Label| B       # Ligne avec label
A ==> B              # Flèche épaisse
A -.-> B             # Flèche pointillée
A -.->|Label| B      # Flèche pointillée avec label
```

## 🛠️ Développement

### Mode développement avec hot-reload

```bash
npm run dev
```

### Compilation

```bash
npm run build
```

### Démarrage en production

```bash
npm start
```

## 🔍 Logging

Le backend utilise `pino` pour le logging structuré:

- **Niveau**: Configuré via `LOG_LEVEL` dans `.env` (debug, info, warn, error)
- **Format**: JSON structuré en production
- **HTTP**: Toutes les requêtes HTTP sont loggées automatiquement

## ⚡ Performance

- Support de graphes jusqu'à 20,000+ nœuds
- Requêtes AQL optimisées
- Parsing Mermaid efficient avec regex
- Limite de payload: 50MB

## 🔗 Compatibilité

Ce backend est **100% compatible** avec le frontend React existant. Toutes les routes API et formats de réponse sont identiques au backend Rust original.

## 📝 Licence

MIT
