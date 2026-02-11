# 🗄️ Mode Multi-Database Neo4j - Guide Complet

Le système supporte maintenant le mode **multi-database** de Neo4j pour simuler un environnement cluster.

---

## ✅ Ce qui a été implémenté

### 1. **Backend - Support Multi-Database**

#### Neo4jService mis à jour
- Méthode `getSession(database?)` pour gérer les sessions par database
- Toutes les méthodes acceptent maintenant un paramètre `database` optionnel
- Nouvelles méthodes de gestion des databases :
  - `listDatabases()` - Liste toutes les databases Neo4j
  - `createDatabase(name)` - Crée une nouvelle database
  - `deleteDatabase(name)` - Supprime une database
  - `getDatabaseStats(name)` - Statistiques d'une database

#### Nouvelles Routes API
```typescript
GET    /api/databases              // Liste toutes les databases
POST   /api/databases              // Créer une database
DELETE /api/databases/:name        // Supprimer une database
GET    /api/databases/:name/stats  // Statistiques d'une database
```

#### Routes Graphes Mises à Jour
Toutes les routes acceptent maintenant `?database=nom` :
```typescript
GET    /api/graphs?database=graph1
GET    /api/graphs/:id?database=graph1
POST   /api/graphs?database=graph1
DELETE /api/graphs/:id?database=graph1
```

### 2. **Frontend - Sélecteur de Database**

#### Nouveau Composant UI
- **Sélecteur dans le header** entre le titre et le toggle de visualisation
- Affiche toutes les databases disponibles
- Indique la database par défaut
- Recharge automatiquement les graphes au changement de database

#### API Frontend
```typescript
// databaseApi
listDatabases()
createDatabase(name)
deleteDatabase(name)
getDatabaseStats(name)

// graphApi mis à jour
listGraphs(database?)
getGraph(id, database?)
getGraphStats(id, database?)
```

---

## 🚀 Utilisation

### Créer des Databases

#### Via Cypher (Neo4j Browser)
```cypher
// Créer des databases
CREATE DATABASE graph1;
CREATE DATABASE graph2;
CREATE DATABASE graph3;

// Lister les databases
SHOW DATABASES;

// Basculer entre databases
:use graph1
:use graph2
```

#### Via API REST
```bash
# Créer une database
curl -X POST http://127.0.0.1:8080/api/databases \
  -H "Content-Type: application/json" \
  -d '{"name": "graph1"}'

# Lister les databases
curl http://127.0.0.1:8080/api/databases

# Supprimer une database
curl -X DELETE http://127.0.0.1:8080/api/databases/graph1

# Stats d'une database
curl http://127.0.0.1:8080/api/databases/graph1/stats
```

### Utiliser dans le Frontend

1. **Ouvrir l'application** : http://localhost:5173
2. **Sélectionner une database** dans le dropdown du header
3. **Les graphes se chargent automatiquement** pour la database sélectionnée
4. **Basculer entre databases** pour comparer différents datasets

---

## 📋 Scénarios d'Utilisation

### Scénario 1 : Environnements Séparés

```cypher
// Development
CREATE DATABASE dev;
:use dev
// Charger données de test

// Staging
CREATE DATABASE staging;
:use staging
// Charger données pré-production

// Production
CREATE DATABASE prod;
:use prod
// Charger données réelles
```

**Frontend** : Basculer entre dev/staging/prod avec le sélecteur

### Scénario 2 : Projets Multiples

```cypher
CREATE DATABASE project_alpha;
CREATE DATABASE project_beta;
CREATE DATABASE project_gamma;
```

Chaque projet a ses propres graphes isolés.

### Scénario 3 : Versioning de Données

```cypher
CREATE DATABASE graphs_v1;
CREATE DATABASE graphs_v2;
CREATE DATABASE graphs_v3;
```

Maintenir plusieurs versions de datasets pour comparaison.

---

## 🎯 Fonctionnalités Avancées

### 1. Isolation Complète des Données

Chaque database est **complètement isolée** :
- Nœuds séparés
- Relations séparées
- Graphes séparés
- Aucune fuite de données entre databases

### 2. Performance

- Pas d'impact sur les performances
- Chaque database fonctionne indépendamment
- Requêtes optimisées par database

### 3. API Flexible

```bash
# Créer un graphe dans une database spécifique
curl -X POST "http://127.0.0.1:8080/api/graphs?database=project_alpha" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Graph",
    "description": "Example",
    "mermaid_code": "graph TD\nA-->B",
    "graph_type": "flowchart"
  }'

# Lister les graphes d'une database
curl "http://127.0.0.1:8080/api/graphs?database=project_alpha"
```

---

## 📊 Monitoring et Statistiques

### Stats par Database

```bash
curl http://127.0.0.1:8080/api/databases/graph1/stats
```

Retourne :
```json
{
  "nodeCount": 20011,
  "relationshipCount": 87059,
  "graphCount": 2
}
```

### Dashboard Frontend

Le sélecteur affiche :
- Nom de la database
- Statut (online/offline)
- Indicateur de database par défaut

---

## 🔧 Configuration

### Neo4j Configuration

Pour activer le mode multi-database (déjà activé par défaut sur Neo4j 4+) :

**neo4j.conf** (si besoin) :
```conf
# Activer multi-database
dbms.default_database=neo4j
dbms.databases.seed_from_uri_providers=*
```

### Backend Configuration

Aucune configuration supplémentaire nécessaire. Le système détecte automatiquement les databases disponibles.

---

## ⚠️ Limitations et Bonnes Pratiques

### Limitations

1. **Neo4j Community Edition** : 1 database active à la fois (mais peut créer plusieurs)
2. **Neo4j Enterprise Edition** : Databases multiples actives simultanément
3. **Databases système** : `neo4j` et `system` ne peuvent pas être supprimées

### Bonnes Pratiques

1. **Nommage** : Utiliser des noms descriptifs (ex: `project_name_env`)
2. **Nettoyage** : Supprimer les databases inutilisées régulièrement
3. **Backup** : Sauvegarder chaque database séparément
4. **Permissions** : Gérer les accès par database en production

---

## 🐛 Dépannage

### Database non listée

**Problème** : La database créée n'apparaît pas dans le sélecteur

**Solutions** :
1. Vérifier que la database est `online` : `SHOW DATABASES`
2. Rafraîchir la page
3. Vérifier les logs backend

### Erreur "Cannot connect to database"

**Problème** : Impossible de se connecter à une database

**Solutions** :
1. Vérifier que Neo4j est démarré
2. Vérifier que la database existe : `SHOW DATABASES`
3. Vérifier les permissions utilisateur

### Performance lente

**Problème** : Lenteur lors du basculement entre databases

**Solutions** :
1. Normal pour la première requête (chargement en mémoire)
2. Optimiser les index dans chaque database
3. Augmenter la mémoire allouée à Neo4j

---

## 🚀 Prochaines Évolutions Possibles

### Fonctionnalités Futures

1. **Création de Database depuis le Frontend**
   - Modal pour créer une nouvelle database
   - Validation du nom
   - Feedback temps réel

2. **Gestion Avancée**
   - Cloner une database
   - Migrer des graphes entre databases
   - Import/Export par database

3. **Monitoring Amélioré**
   - Taille de chaque database
   - Utilisation mémoire
   - Performance metrics

4. **Comparaison de Databases**
   - Vue côte-à-côte de 2 databases
   - Diff des graphes
   - Merge de données

---

## 📝 Exemples Pratiques

### Exemple 1 : Setup Complet

```bash
# 1. Créer des databases via Cypher
cypher-shell -u neo4j -p Aurelien22 << EOF
CREATE DATABASE development;
CREATE DATABASE testing;
CREATE DATABASE production;
SHOW DATABASES;
EOF

# 2. Créer des graphes dans chaque database
# Development
curl -X POST "http://127.0.0.1:8080/api/graphs?database=development" \
  -H "Content-Type: application/json" \
  -d @test_graph.json

# Testing
curl -X POST "http://127.0.0.1:8080/api/graphs?database=testing" \
  -H "Content-Type: application/json" \
  -d @test_graph.json

# Production
curl -X POST "http://127.0.0.1:8080/api/graphs?database=production" \
  -H "Content-Type: application/json" \
  -d @prod_graph.json

# 3. Utiliser le frontend pour visualiser
# Ouvrir http://localhost:5173
# Sélectionner la database dans le dropdown
```

### Exemple 2 : Migration de Données

```cypher
// Copier des données d'une database à une autre
:use source_db
MATCH (n)
WITH collect(n) as nodes
CALL apoc.export.json.data(nodes, [], null, {stream: true})
YIELD data
RETURN data;

:use target_db
// Importer les données exportées
```

---

## 🎓 Ressources

### Documentation Neo4j
- [Multi-Database](https://neo4j.com/docs/operations-manual/current/manage-databases/)
- [CREATE DATABASE](https://neo4j.com/docs/cypher-manual/current/administration/databases/#administration-databases-create-database)
- [SHOW DATABASES](https://neo4j.com/docs/cypher-manual/current/administration/databases/#administration-databases-show-databases)

### Code Source
- Backend: `backend-nodejs/src/services/Neo4jService.ts`
- Routes: `backend-nodejs/src/routes/databaseRoutes.ts`
- Frontend: `frontend-graph-viewer/src/App.tsx`
- API: `frontend-graph-viewer/src/services/api.ts`

---

## ✅ Checklist de Validation

- [x] Backend supporte multi-database
- [x] Routes API créées pour databases
- [x] Frontend avec sélecteur de database
- [x] Graphes chargés par database
- [x] Isolation complète des données
- [x] API REST fonctionnelle
- [x] Documentation complète

---

**🎉 Le mode multi-database est opérationnel !**

Vous pouvez maintenant gérer plusieurs databases Neo4j et simuler un environnement cluster directement depuis l'interface web.
