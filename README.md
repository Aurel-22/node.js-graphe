# 🌐 Neo4j Graph Viewer - Full Stack Application

Application full-stack pour visualiser et gérer des graphes Neo4j avec support multi-database et double moteur de rendu.

[![Neo4j](https://img.shields.io/badge/Neo4j-5.x-blue.svg)](https://neo4j.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.2-blue.svg)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

---

## 🚀 Fonctionnalités

### Backend (Node.js + Express + TypeScript)
- ✅ **API REST complète** pour la gestion de graphes
- ✅ **Support Neo4j 5.x** avec driver officiel
- ✅ **Multi-Database** - Simulation de cluster avec plusieurs databases
- ✅ **Parser Mermaid** - Génération de graphes depuis code Mermaid
- ✅ **CRUD complet** - Création, lecture, mise à jour, suppression de graphes
- ✅ **Statistiques** - Comptage de nœuds, relations, graphes par database

### Frontend (React + TypeScript + Vite)
- ✅ **Triple moteur de rendu** :
  - **react-force-graph-2d** - Physique interactive avec zoom/pan
  - **Sigma.js 3.x + Graphology** - Performance optimale pour grands graphes
  - **G6 (AntV)** - Rendu ultra-rapide pour graphes massifs (20 000+ nœuds)
- ✅ **Sélecteur de database** - Basculement instantané entre databases
- ✅ **Palette de 23 couleurs** - Types de nœuds avec génération dynamique
- ✅ **Légendes dynamiques** - Affichage des types avec compteurs
- ✅ **Performance** - Optimisations pour 20 000+ nœuds (450-600ms de rendu avec G6)
- ✅ **Mesure du temps de rendu** - Monitoring en temps réel

---

## 📋 Prérequis

- **Node.js** 18+ ([Télécharger](https://nodejs.org/))
- **Neo4j** 5.x ([Télécharger](https://neo4j.com/download/))
- **Git** ([Télécharger](https://git-scm.com/))

---

## 🔧 Installation

### 1. Cloner le repository

```bash
git clone https://github.com/Aurel-22/node.js-graphe.git
cd node.js-graphe
```

### 2. Installation Backend

```bash
cd backend-nodejs
npm install
```

Créer un fichier `.env` :
```env
NEO4J_URI=neo4j://127.0.0.1:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=Aurelien22
PORT=8080
```

Compiler et démarrer :
```bash
npm run build
npm start
```

Backend disponible sur : **http://127.0.0.1:8080**

### 3. Installation Frontend

```bash
cd frontend-graph-viewer
npm install
npm run dev
```

Frontend disponible sur : **http://localhost:5173**

---

## 📖 Documentation

### Guides Principaux
- **[MULTI_DATABASE_GUIDE.md](MULTI_DATABASE_GUIDE.md)** - Guide complet du mode multi-database
- **[backend-nodejs/NEO4J_MIGRATION.md](backend-nodejs/NEO4J_MIGRATION.md)** - Migration ArangoDB → Neo4j
- **[backend-nodejs/README.md](backend-nodejs/README.md)** - Documentation API backend
- **[frontend-graph-viewer/README.md](frontend-graph-viewer/README.md)** - Documentation frontend

### Guides Avancés
- **[frontend-graph-viewer/G6_INTEGRATION.md](frontend-graph-viewer/G6_INTEGRATION.md)** - Intégration et optimisation G6 (AntV)
- **[frontend-graph-viewer/SIGMA_OPTIMIZATION.md](frontend-graph-viewer/SIGMA_OPTIMIZATION.md)** - Optimisation Sigma.js
- **[frontend-graph-viewer/VISUALIZATION_GUIDE.md](frontend-graph-viewer/VISUALIZATION_GUIDE.md)** - Comparaison des moteurs de rendu
- **[backend-nodejs/API_EXAMPLES.md](backend-nodejs/API_EXAMPLES.md)** - Exemples d'utilisation API

---

## 🎯 Architecture

```
node.js-graphe/
├── backend-nodejs/           # Backend Node.js + Express
│   ├── src/
│   │   ├── config/           # Configuration Neo4j
│   │   ├── models/           # Modèles TypeScript
│   │   ├── routes/           # Routes API (graphes + databases)
│   │   └── services/         # Services (Neo4j, Parser Mermaid)
│   ├── dist/                 # Code compilé
│   └── package.json
│
└── frontend-graph-viewer/    # Frontend React + Vite
    ├── src/
    │   ├── components/       # Composants React (GraphViewer, SigmaGraphViewer, G6GraphViewer)
    │   ├── services/         # API client, transformations
    │   └── types/            # Types TypeScript
    └── package.json
```

---

## 🔗 API Endpoints

### Graphes

```http
GET    /api/graphs?database=neo4j           # Liste des graphes
GET    /api/graphs/:id?database=neo4j       # Détails d'un graphe
POST   /api/graphs?database=neo4j           # Créer un graphe
DELETE /api/graphs/:id?database=neo4j       # Supprimer un graphe
GET    /api/graphs/:id/stats?database=neo4j # Statistiques d'un graphe
```

### Databases

```http
GET    /api/databases              # Liste toutes les databases
POST   /api/databases              # Créer une database
DELETE /api/databases/:name        # Supprimer une database
GET    /api/databases/:name/stats  # Stats d'une database
```

---

## 🌟 Utilisation

### 1. Créer des Databases

**Via Neo4j Browser** :
```cypher
CREATE DATABASE development;
CREATE DATABASE testing;
CREATE DATABASE production;

SHOW DATABASES;
```

**Via API REST** :
```bash
curl -X POST http://127.0.0.1:8080/api/databases \
  -H "Content-Type: application/json" \
  -d '{"name": "development"}'
```

### 2. Créer un Graphe

```bash
curl -X POST "http://127.0.0.1:8080/api/graphs?database=development" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My Graph",
    "description": "Test graph",
    "mermaid_code": "graph TD\n  A[Start] --> B[Process]\n  B --> C[End]",
    "graph_type": "flowchart"
  }'
```

### 3. Visualiser dans le Frontend

1. Ouvrir **http://localhost:5173**
2. Sélectionner une database dans le dropdown
3. Choisir un graphe dans la liste
4. Basculer entre **Force Graph**, **Sigma.js** et **G6 (AntV)** pour comparer

---

## 📊 Performances

### Tests sur 20 000 Nœuds

| Moteur de Rendu       | Temps de Rendu | Interactivité | Mémoire    |
|-----------------------|----------------|---------------|------------|
| **G6 (AntV)**         | **450-600ms**  | ⭐⭐⭐⭐⭐       | ⭐⭐⭐⭐⭐      |
| **Sigma.js**          | 500ms          | ⭐⭐⭐⭐        | ⭐⭐⭐⭐       |
| **Force Graph 2D**    | 2000-3000ms    | ⭐⭐⭐           | ⭐⭐⭐         |

### Optimisations G6 (Recommandé pour grands graphes)

- **Temps de rendu** : **450-600ms** pour 20 000 nœuds
- **Algorithme** : D3-Force avec optimisations GPU
- **Node sizing adaptatif** : 8-16px selon la taille du graphe
- **Labels conditionnels** : Désactivés pour graphes > 5000 nœuds
- **Interactions adaptatives** : Drag-node désactivé pour graphes > 10 000 nœuds

### Optimisations Sigma.js

- **Temps de rendu** : 3000ms → **500ms** pour 20 000 nœuds (amélioration de 83%)
- **Algorithme** : ForceAtlas2 avec Barnes-Hut simulation
- **Iterations adaptatives** : 5-50 selon la taille du graphe
- **Désactivation labels** : Pour graphes > 5000 nœuds
- **Gestion mémoire** : Libération explicite des ressources

### Comparaison des Moteurs

| Critère                | Force Graph 2D | Sigma.js       | G6 (AntV)      |
|------------------------|----------------|----------------|----------------|
| **Petits graphes (<100)** | ⭐⭐⭐⭐⭐     | ⭐⭐⭐⭐       | ⭐⭐⭐⭐       |
| **Grands graphes (>5k)**  | ⭐⭐⭐         | ⭐⭐⭐⭐⭐     | ⭐⭐⭐⭐⭐     |
| **Graphes massifs (>20k)**| ⭐⭐           | ⭐⭐⭐⭐       | ⭐⭐⭐⭐⭐     |
| **Interactivité**         | ⭐⭐⭐⭐⭐     | ⭐⭐⭐⭐       | ⭐⭐⭐⭐⭐     |
| **Performance**           | ⭐⭐⭐         | ⭐⭐⭐⭐⭐     | ⭐⭐⭐⭐⭐     |
| **Personnalisation**      | ⭐⭐⭐⭐       | ⭐⭐⭐⭐⭐     | ⭐⭐⭐⭐⭐     |

**Recommandations** :
- **< 1 000 nœuds** : Force Graph 2D (interactivité maximale)
- **1 000 - 10 000** : Sigma.js ou G6 (bon équilibre)
- **> 10 000 nœuds** : **G6 (AntV)** (performances optimales)

---

## 🎨 Fonctionnalités Visuelles

### Palette de Couleurs

23 types de nœuds prédéfinis + génération dynamique :
- **Classes** : person, organization, location, event, document
- **Technique** : server, database, api, service, component
- **Conceptuel** : concept, category, tag, attribute
- **Processus** : process, task, decision, action, state
- **Système** : system, module, function

### Légendes Interactives

- Affichage automatique des types présents
- Compteur de nœuds par type
- Synchronisation entre les deux moteurs de rendu
- Mise à jour dynamique

---

## 🔒 Sécurité

- ✅ Protection des databases système (`neo4j`, `system`)
- ✅ Validation des noms de databases (regex stricte)
- ✅ Gestion des erreurs transactionnelles Neo4j
- ✅ CORS configuré pour développement

---

## 🐛 Dépannage

### Backend ne démarre pas

```bash
# Vérifier Neo4j
neo4j status

# Tester la connexion
cd backend-nodejs
node test-neo4j-connection.js
```

### Frontend n'affiche pas les graphes

1. Ouvrir la console développeur (F12)
2. Vérifier que le backend répond : http://127.0.0.1:8080/api/graphs
3. Vérifier la database sélectionnée

### Performance lente

Pour graphes > 10 000 nœuds :
- Utiliser **Sigma.js**
- Vérifier les index Neo4j :
  ```cypher
  CREATE INDEX graph_id_index FOR (g:Graph) ON (g.graphId);
  ```

---

## 🚀 Roadmap

### Version 2.0
- [ ] Interface de création/suppression de databases depuis le frontend
- [ ] Import/Export de graphes (JSON, GraphML, Cypher)
- [ ] Éditeur Mermaid intégré avec prévisualisation
- [ ] Clonage de databases
- [ ] Comparaison visuelle de 2 databases côte-à-côte

### Version 3.0
- [ ] Authentification utilisateurs
- [ ] Gestion des permissions par database
- [ ] Historique des modifications
- [ ] WebSocket pour mises à jour temps réel
- [ ] Clustering automatique de graphes

---

## 👥 Contribution

Les contributions sont les bienvenues !

1. Fork le projet
2. Créer une branche (`git checkout -b feature/amazing-feature`)
3. Commit les changements (`git commit -m 'Add amazing feature'`)
4. Push vers la branche (`git push origin feature/amazing-feature`)
5. Ouvrir une Pull Request

---

## 📝 Licence

Ce projet est sous licence MIT.

---

## 🙏 Remerciements

- **Neo4j** - Base de données graphe
- **Sigma.js** - Rendu de graphes performant
- **react-force-graph** - Visualisation interactive
- **Graphology** - Manipulation de graphes JavaScript
- **Vite** - Build tool ultra-rapide

---

## 📧 Contact

**Aurélien BARRE** - barreau@esisar.inpg.fr

**Repository** : [https://github.com/Aurel-22/node.js-graphe](https://github.com/Aurel-22/node.js-graphe)

---

**⭐ Si ce projet vous a aidé, n'hésitez pas à le star sur GitHub !**
