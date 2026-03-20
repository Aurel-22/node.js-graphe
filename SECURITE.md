# Guide de Sécurisation — Graph Visualizer

> Audit de sécurité et recommandations pour l'application Express + React (Graph Visualizer).
> Dernière mise à jour : mars 2026

---

## Table des matières

1. [Résumé des vulnérabilités](#1-résumé-des-vulnérabilités)
2. [Injection SQL](#2-injection-sql)
3. [Cross-Site Scripting (XSS)](#3-cross-site-scripting-xss)
4. [Cross-Site Request Forgery (CSRF)](#4-cross-site-request-forgery-csrf)
5. [Authentification et Autorisation](#5-authentification-et-autorisation)
6. [Configuration CORS](#6-configuration-cors)
7. [HTTPS / TLS](#7-https--tls)
8. [En-têtes de sécurité HTTP (Helmet)](#8-en-têtes-de-sécurité-http-helmet)
9. [Rate Limiting (limitation de débit)](#9-rate-limiting-limitation-de-débit)
10. [Gestion des secrets et variables d'environnement](#10-gestion-des-secrets-et-variables-denvironnement)
11. [Fuite d'informations dans les erreurs](#11-fuite-dinformations-dans-les-erreurs)
12. [WebSocket non protégé](#12-websocket-non-protégé)
13. [SSRF (Server-Side Request Forgery)](#13-ssrf-server-side-request-forgery)
14. [Validation des entrées](#14-validation-des-entrées)
15. [Dépendances et composants vulnérables](#15-dépendances-et-composants-vulnérables)
16. [Journalisation et monitoring](#16-journalisation-et-monitoring)
17. [Checklist récapitulative](#17-checklist-récapitulative)

---

## 1. Résumé des vulnérabilités

| Sévérité | Problème | Localisation |
|----------|----------|-------------|
| 🔴 **CRITIQUE** | Exécution SQL brute sans restriction | `POST /api/query`, `POST /api/query/graph` |
| 🔴 **CRITIQUE** | Interpolation de string dans les requêtes SQL (noms de BDD) | `MssqlService.createDatabase()`, `deleteDatabase()` |
| 🟠 **HAUTE** | Aucune authentification / autorisation | Toutes les routes |
| 🟠 **HAUTE** | Mot de passe SA en clair dans `.env` (potentiellement versionné) | `backend-nodejs/.env` |
| 🟠 **HAUTE** | CORS ouvert à toutes les origines | `index.ts` — `app.use(cors())` |
| 🟠 **HAUTE** | Pas de HTTPS | `http.createServer(app)` |
| 🟡 **MOYENNE** | Aucun en-tête de sécurité HTTP (pas de Helmet) | `index.ts` |
| 🟡 **MOYENNE** | Aucun rate limiting | Toutes les routes |
| 🟡 **MOYENNE** | Messages d'erreur SQL renvoyés au client | Handlers catch → `res.json({ error })` |
| 🟡 **MOYENNE** | WebSocket ouvert sans authentification | `/ws` |
| 🟡 **MOYENNE** | Pas de protection CSRF | API REST |
| 🟡 **MOYENNE** | SSRF potentiel dans les routes CMDB | `cmdbRoutes.ts` (appels externes EasyVista) |
| 🟢 **BASSE** | Pas d'audit logging structuré | Mélange `pino` / `console.log` |

---

## 2. Injection SQL

### 2.1 Problème actuel

**Deux vecteurs critiques identifiés :**

#### A. Exécution de requête SQL brute (`POST /api/query`)

```typescript
// index.ts — VULNÉRABLE
app.post("/api/query", resolveEngine, async (req, res, next) => {
  const { query } = req.body;
  // ❌ Aucune validation — exécution directe de l'entrée utilisateur
  const result = await service.executeRawQuery(query.trim(), database);
});
```

Un attaquant peut envoyer n'importe quel SQL :
```sql
-- Suppression de données
DROP TABLE graph_nodes; DROP TABLE graph_edges;

-- Exfiltration de données
SELECT * FROM sys.sql_logins;

-- Exécution de commandes système (si xp_cmdshell activé)
EXEC xp_cmdshell 'whoami';
```

#### B. Interpolation de noms dans les opérations de BDD (`MssqlService`)

```typescript
// MssqlService.ts — VULNÉRABLE
async createDatabase(databaseName: string): Promise<void> {
  const safeName = databaseName.replace(/[^a-zA-Z0-9_]/g, "");
  // ❌ Interpolation de string malgré le "nettoyage"
  await pool.request().query(`CREATE DATABASE [${safeName}]`);
}
```

### 2.2 Comment corriger

#### Option 1 — Supprimer les endpoints de requête brute (recommandé)

Si le `SqlQueryPanel` n'est pas destiné à la production, supprimer les routes :

```typescript
// ❌ SUPPRIMER ces routes en production
// app.post("/api/query", ...)
// app.post("/api/query/graph", ...)
```

#### Option 2 — Restreindre strictement les requêtes autorisées

Si la fonctionnalité est nécessaire, ajouter :

```typescript
import { parse } from 'pgsql-ast-parser'; // ou un parser SQL compatible MSSQL

function validateQuery(query: string): { valid: boolean; reason?: string } {
  const upper = query.trim().toUpperCase();

  // 1. N'autoriser que les SELECT
  if (!upper.startsWith('SELECT')) {
    return { valid: false, reason: 'Seules les requêtes SELECT sont autorisées' };
  }

  // 2. Interdire les mots-clés dangereux
  const forbidden = [
    'DROP', 'DELETE', 'INSERT', 'UPDATE', 'ALTER', 'CREATE', 'EXEC',
    'EXECUTE', 'XP_', 'SP_', 'TRUNCATE', 'GRANT', 'REVOKE', 'DENY',
    'MERGE', 'BACKUP', 'RESTORE', 'SHUTDOWN', 'RECONFIGURE',
    'OPENROWSET', 'OPENDATASOURCE', 'BULK'
  ];

  for (const word of forbidden) {
    // Recherche en mot entier (pas dans les noms de colonne)
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    if (regex.test(query)) {
      return { valid: false, reason: `Mot-clé interdit détecté : ${word}` };
    }
  }

  // 3. Limiter la durée d'exécution
  // Ajouter SET LOCK_TIMEOUT et QUERY_GOVERNOR_COST_LIMIT côté serveur

  return { valid: true };
}

// Appliquer dans la route
app.post("/api/query", requireAuth, queryLimiter, async (req, res, next) => {
  const { query } = req.body;
  const validation = validateQuery(query);
  if (!validation.valid) {
    return res.status(403).json({ error: validation.reason });
  }

  // Exécuter avec un timeout de 10 secondes
  const result = await service.executeRawQuery(query, database);
  res.json(result);
});
```

#### Pour les noms de BDD — utiliser une whitelist stricte

```typescript
async createDatabase(databaseName: string): Promise<void> {
  // Validation stricte du nom (lettres, chiffres, underscore, tiret)
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(databaseName)) {
    throw new Error(
      'Nom de base invalide : lettres, chiffres, _ et - uniquement, ' +
      'doit commencer par une lettre, 64 caractères max.'
    );
  }

  const pool = await this.getMasterPool();
  // Utiliser un paramètre pour la vérification d'existence
  const exists = await pool.request()
    .input('dbName', sql.NVarChar, databaseName)
    .query(`SELECT 1 FROM sys.databases WHERE name = @dbName`);

  if (exists.recordset.length === 0) {
    // L'interpolation est acceptable ici UNIQUEMENT grâce à la whitelist regex
    await pool.request().query(`CREATE DATABASE [${databaseName}]`);
  }
}
```

#### Utiliser systématiquement les requêtes paramétrées

```typescript
// ❌ MAUVAIS — interpolation de string
const result = await pool.request()
  .query(`SELECT * FROM graph_nodes WHERE graph_id = '${graphId}'`);

// ✅ BON — requête paramétrée
const result = await pool.request()
  .input('graphId', sql.NVarChar, graphId)
  .query(`SELECT * FROM graph_nodes WHERE graph_id = @graphId`);
```

### 2.3 Packages utiles

```bash
cd backend-nodejs
npm install --save express-validator  # validation d'entrées
```

---

## 3. Cross-Site Scripting (XSS)

### 3.1 Problème actuel

Le frontend React offre une bonne protection de base contre le XSS grâce à l'échappement automatique JSX. Cependant des risques demeurent :

- **Labels de nœuds** affichés sans sanitisation dans les viewers graphiques
- **Propriétés de nœuds** (`node.properties`) potentiellement affichées en HTML brut
- **Résultats de requête SQL** rendus dans le `SqlQueryPanel` — des données malveillantes en BDD pourraient contenir du JavaScript

### 3.2 Comment corriger

#### A. Côté backend — Sanitiser les données en sortie

```bash
npm install dompurify isomorphic-dompurify
```

```typescript
import createDOMPurify from 'isomorphic-dompurify';
const DOMPurify = createDOMPurify();

// Sanitiser les labels et propriétés avant de les envoyer au frontend
function sanitizeGraphData(data: GraphData): GraphData {
  return {
    nodes: data.nodes.map(n => ({
      ...n,
      label: DOMPurify.sanitize(n.label),
      properties: n.properties
        ? Object.fromEntries(
            Object.entries(n.properties).map(([k, v]) => [
              DOMPurify.sanitize(k),
              typeof v === 'string' ? DOMPurify.sanitize(v) : v
            ])
          )
        : undefined,
    })),
    edges: data.edges.map(e => ({
      ...e,
      label: e.label ? DOMPurify.sanitize(e.label) : undefined,
    })),
  };
}
```

#### B. Côté frontend — Ne jamais utiliser `dangerouslySetInnerHTML`

```tsx
// ❌ JAMAIS
<div dangerouslySetInnerHTML={{ __html: node.label }} />

// ✅ React échappe automatiquement
<div>{node.label}</div>
```

#### C. Content Security Policy (CSP)

Voir la section Helmet ci-dessous — le CSP empêche l'exécution de scripts inline injectés.

---

## 4. Cross-Site Request Forgery (CSRF)

### 4.1 Problème actuel

L'API n'a aucune protection CSRF. Un site malveillant peut forger des requêtes POST/DELETE vers l'API si un utilisateur est connecté (cookies de session).

### 4.2 Comment corriger

#### Option 1 — Token CSRF (sessions avec cookies)

Si vous utilisez des cookies de session :

```bash
npm install csurf cookie-parser
# Note : csurf est déprécié, préférer csrf-csrf ou lusca
npm install csrf-csrf
```

```typescript
import { doubleCsrf } from "csrf-csrf";

const { doubleCsrfProtection, generateToken } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET!,
  cookieName: "__csrf",
  cookieOptions: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  },
  getTokenFromRequest: (req) => req.headers["x-csrf-token"] as string,
});

// Appliquer sur les routes modifiantes
app.use(doubleCsrfProtection);

// Endpoint pour obtenir un token CSRF
app.get("/api/csrf-token", (req, res) => {
  res.json({ token: generateToken(req, res) });
});
```

Côté frontend :
```typescript
// api.ts
const csrfToken = await axios.get('/api/csrf-token').then(r => r.data.token);
axios.defaults.headers.common['X-CSRF-Token'] = csrfToken;
```

#### Option 2 — Authentification par token Bearer (recommandé)

Si vous utilisez des tokens JWT dans le header `Authorization: Bearer <token>` (pas de cookies), le CSRF est naturellement mitigé car les navigateurs n'envoient pas automatiquement ce header.

#### Bonnes pratiques complémentaires

```typescript
// Cookies avec attribut SameSite
app.use(cookieParser());
app.use((req, res, next) => {
  res.cookie('session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict', // empêche l'envoi cross-site
    maxAge: 3600000,    // 1h
  });
  next();
});
```

---

## 5. Authentification et Autorisation

### 5.1 Problème actuel

**Aucune authentification n'existe.** Toutes les routes sont publiques :
- N'importe qui peut supprimer des bases de données (`DELETE /api/databases/:name`)
- N'importe qui peut exécuter du SQL brut (`POST /api/query`)
- N'importe qui peut supprimer des graphes (`DELETE /api/graphs/:id`)

### 5.2 Comment implémenter (JWT)

#### Installation

```bash
npm install jsonwebtoken bcryptjs
npm install -D @types/jsonwebtoken @types/bcryptjs
```

#### Middleware d'authentification

```typescript
// src/middleware/auth.ts
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

export interface AuthPayload {
  userId: string;
  role: 'admin' | 'editor' | 'viewer';
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthPayload;
    (req as any).user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

export function requireRole(...roles: AuthPayload['role'][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as AuthPayload | undefined;
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    next();
  };
}
```

#### Appliquer sur les routes

```typescript
// index.ts
import { requireAuth, requireRole } from './middleware/auth.js';

// Routes en lecture — authentification requise
app.use("/api", requireAuth, resolveEngine, graphRoutes(service, broadcast));

// Routes destructrices — rôle admin requis
app.use("/api/databases", requireAuth, requireRole('admin'),
  createDatabaseRoutes(service));

// Requête SQL brute — admin uniquement
app.post("/api/query", requireAuth, requireRole('admin'), ...);

// Routes en lecture seule — viewer suffit
app.get("/api/graphs", requireAuth, requireRole('viewer', 'editor', 'admin'), ...);
```

#### Variables d'environnement à ajouter

```env
JWT_SECRET=<clé-aléatoire-de-256-bits-minimum>
JWT_EXPIRATION=1h
```

Générer une clé sécurisée :
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## 6. Configuration CORS

### 6.1 Problème actuel

```typescript
// ❌ Accepte TOUTES les origines
app.use(cors({
  exposedHeaders: ['X-Cache', 'X-Response-Time', ...],
}));
```

### 6.2 Comment corriger

```typescript
app.use(cors({
  // Restreindre aux origines autorisées
  origin: (origin, callback) => {
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
      .split(',')
      .map(o => o.trim());

    // Autoriser les requêtes sans origin (outils comme Postman, curl en dev)
    if (!origin && process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    if (origin && allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Origine non autorisée par CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  exposedHeaders: [
    'X-Cache', 'X-Response-Time', 'X-Parallel-Queries',
    'X-Content-Length-Raw', 'Content-Length', 'X-Engine',
    'X-Compression', 'X-Brotli-Size'
  ],
  maxAge: 86400, // cache preflight pendant 24h
}));
```

**`.env` à ajouter :**
```env
ALLOWED_ORIGINS=http://localhost:5173,https://graphviz.votredomaine.com
```

---

## 7. HTTPS / TLS

### 7.1 Problème actuel

Toute la communication se fait en HTTP clair (`http.createServer(app)`). Les données SQL, mots de passe, et données de graphe transitent en clair sur le réseau.

### 7.2 Comment corriger

#### Option A — HTTPS natif Node.js

```typescript
import https from 'https';
import fs from 'fs';

let server: http.Server | https.Server;

if (process.env.NODE_ENV === 'production') {
  const sslOptions = {
    key: fs.readFileSync(process.env.TLS_KEY_PATH!),
    cert: fs.readFileSync(process.env.TLS_CERT_PATH!),
  };
  server = https.createServer(sslOptions, app);
} else {
  server = http.createServer(app);
}
```

**`.env` à ajouter :**
```env
TLS_KEY_PATH=/etc/ssl/private/server.key
TLS_CERT_PATH=/etc/ssl/certs/server.crt
```

#### Option B — Reverse proxy (recommandé en production)

Utiliser **Nginx** ou **Caddy** devant Express pour le TLS :

```nginx
# /etc/nginx/sites-available/graphviz
server {
    listen 443 ssl http2;
    server_name graphviz.votredomaine.com;

    ssl_certificate     /etc/letsencrypt/live/graphviz.votredomaine.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/graphviz.votredomaine.com/privkey.pem;

    # En-têtes de sécurité
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Redirection HTTP → HTTPS
server {
    listen 80;
    server_name graphviz.votredomaine.com;
    return 301 https://$host$request_uri;
}
```

---

## 8. En-têtes de sécurité HTTP (Helmet)

### 8.1 Problème actuel

Aucun en-tête de sécurité HTTP n'est défini. Le navigateur n'a aucune directive pour se protéger contre le XSS, le clickjacking, ou le sniffing MIME.

### 8.2 Comment corriger

```bash
cd backend-nodejs
npm install helmet
```

```typescript
import helmet from 'helmet';

// Ajouter AVANT les routes
app.use(helmet({
  // Content Security Policy — empêche l'exécution de scripts non autorisés
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],        // Pas de scripts inline
      styleSrc: ["'self'", "'unsafe-inline'"],  // CSS inline pour les viewers
      imgSrc: ["'self'", "data:", "blob:"],     // Images pour les graphes
      connectSrc: ["'self'", "ws://localhost:8080", "wss://localhost:8080"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],   // Empêche le clickjacking
    },
  },
  // Strict-Transport-Security — force HTTPS
  hsts: {
    maxAge: 63072000, // 2 ans
    includeSubDomains: true,
    preload: true,
  },
  // X-Content-Type-Options: nosniff
  noSniff: true,
  // X-Frame-Options: DENY
  frameguard: { action: 'deny' },
  // Referrer-Policy
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // Désactive X-Powered-By: Express
  hidePoweredBy: true,
}));
```

### En-têtes ajoutés par Helmet

| En-tête | Valeur | Protection |
|---------|--------|------------|
| `Content-Security-Policy` | directives ci-dessus | XSS, injection de scripts |
| `Strict-Transport-Security` | `max-age=63072000` | Force HTTPS (HSTS) |
| `X-Content-Type-Options` | `nosniff` | Empêche le MIME sniffing |
| `X-Frame-Options` | `DENY` | Empêche le clickjacking |
| `X-XSS-Protection` | `0` | Désactive le filtre XSS du navigateur (les CSP le remplacent) |
| `Referrer-Policy` | `strict-origin…` | Limite les infos du referer |
| `X-Powered-By` | (supprimé) | Masque la technologie serveur |

---

## 9. Rate Limiting (limitation de débit)

### 9.1 Problème actuel

Aucune limite de requêtes. Un attaquant peut :
- Lancer des milliers de requêtes SQL lourdes (`POST /api/query`)
- Brute-forcer les noms de BDD / identifiants de graphe
- Provoquer un déni de service (DoS) sur le serveur MSSQL

### 9.2 Comment corriger

```bash
npm install express-rate-limit
```

```typescript
import rateLimit from 'express-rate-limit';

// Limite globale — 200 requêtes / 15 min par IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez plus tard' },
});

// Limite stricte pour les opérations coûteuses
const heavyLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 10,               // 10 requêtes / minute
  message: { error: 'Limite de requêtes atteinte pour cette opération' },
});

// Limite pour les opérations destructrices
const destructiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Trop d\'opérations destructrices' },
});

// Appliquer
app.use('/api', globalLimiter);
app.post('/api/query', heavyLimiter, ...);
app.post('/api/query/graph', heavyLimiter, ...);
app.post('/api/graphs/:id/algorithms', heavyLimiter, ...);
app.delete('/api/databases/:name', destructiveLimiter, ...);
app.delete('/api/graphs/:id', destructiveLimiter, ...);
```

---

## 10. Gestion des secrets et variables d'environnement

### 10.1 Problème actuel

Le fichier `.env` contient le mot de passe SA de SQL Server en clair. S'il est versionné dans Git, tout contributeur y a accès, et il persiste dans l'historique Git même après suppression.

```env
# ❌ Mot de passe en clair, compte SA (sysadmin)
MSSQL_USER=sa
MSSQL_PASSWORD=Easyvista964158Certif
```

### 10.2 Comment corriger

#### 1. Ajouter `.env` au `.gitignore` **immédiatement**

```gitignore
# .gitignore
.env
.env.local
.env.*.local
*.key
*.pem
```

#### 2. Fournir un `.env.example` sans valeurs sensibles

```env
# .env.example — copier en .env et remplir les valeurs
MSSQL_HOST=localhost
MSSQL_PORT=1433
MSSQL_USER=
MSSQL_PASSWORD=
MSSQL_DATABASE=graph_db
SERVER_PORT=8080
SERVER_HOST=127.0.0.1
LOG_LEVEL=info

# Sécurité
JWT_SECRET=
ALLOWED_ORIGINS=http://localhost:5173
CSRF_SECRET=
```

#### 3. Purger le `.env` de l'historique Git

```bash
# Avec git-filter-repo (recommandé)
pip install git-filter-repo
git filter-repo --invert-paths --path backend-nodejs/.env

# OU avec BFG Repo Cleaner
bfg --delete-files .env
git reflog expire --expire=now --all && git gc --prune=now --aggressive
```

#### 4. Changer le mot de passe SQL Server

Après avoir purgé l'historique, **changer immédiatement** le mot de passe SA car il est compromis.

#### 5. Ne pas utiliser le compte SA

Créer un compte SQL dédié avec les permissions minimales :

```sql
-- Sur SQL Server
CREATE LOGIN graph_app WITH PASSWORD = '<mot-de-passe-fort>';
USE [graph_db];
CREATE USER graph_app FOR LOGIN graph_app;
ALTER ROLE db_datareader ADD MEMBER graph_app;
ALTER ROLE db_datawriter ADD MEMBER graph_app;
-- NE PAS donner sysadmin, db_owner, etc.
```

#### 6. En production — utiliser un gestionnaire de secrets

- **Azure Key Vault** (si infra Azure)
- **HashiCorp Vault**
- **AWS Secrets Manager**
- **Docker secrets** (si conteneurisé)
- **Variables d'environnement CI/CD** (GitLab CI, GitHub Actions, etc.)

---

## 11. Fuite d'informations dans les erreurs

### 11.1 Problème actuel

Les erreurs SQL sont renvoyées directement au client :

```typescript
// ❌ Le message d'erreur MSSQL est exposé
catch (error: any) {
  res.status(400).json({
    error: error.message || "Query execution failed",
  });
}
```

Un attaquant peut exploiter ces messages pour comprendre la structure de la BDD.

### 11.2 Comment corriger

```typescript
// Gestionnaire d'erreur global — index.ts
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  // Logger l'erreur complète en interne
  logger.error({
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
  });

  // Renvoyer un message générique au client
  const statusCode = (err as any).statusCode || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  res.status(statusCode).json({
    error: isProduction
      ? 'Une erreur interne est survenue'
      : err.message,  // En dev, on peut garder le détail
    ...(isProduction ? {} : { stack: err.stack }),
  });
});
```

---

## 12. WebSocket non protégé

### 12.1 Problème actuel

Le endpoint WebSocket (`/ws`) accepte toute connexion sans authentification et diffuse les événements `graph:created` / `graph:deleted` à tous les clients connectés.

### 12.2 Comment corriger

```typescript
import jwt from 'jsonwebtoken';
import { WebSocketServer, WebSocket } from 'ws';

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  // Vérifier le token JWT dans les query params ou le premier message
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    ws.close(4001, 'Token manquant');
    return;
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!);
    (ws as any).user = payload;
    logger.info(`WebSocket client connecté: ${(payload as any).userId}`);
    ws.send(JSON.stringify({ type: "connected", engines: ["mssql"] }));
  } catch {
    ws.close(4003, 'Token invalide');
    return;
  }
});
```

Côté frontend :
```typescript
// useWebSocket.ts
const ws = new WebSocket(`ws://localhost:8080/ws?token=${authToken}`);
```

---

## 13. SSRF (Server-Side Request Forgery)

### 13.1 Problème actuel

Le module `cmdbRoutes.ts` effectue des appels HTTP vers une API EasyVista externe. Si l'URL est configurable ou dépend d'une entrée utilisateur, un attaquant pourrait rediriger ces requêtes vers des services internes (réseau intranet, métadonnées cloud, etc.).

### 13.2 Comment corriger

```typescript
import { URL } from 'url';

function validateExternalUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);

    // N'autoriser que HTTPS
    if (url.protocol !== 'https:') return false;

    // Bloquer les adresses internes
    const blockedPatterns = [
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2\d|3[01])\./,
      /^192\.168\./,
      /^0\./,
      /localhost/i,
      /\.internal$/i,
      /metadata\.google/i,    // GCP metadata
      /169\.254\.169\.254/,   // AWS metadata
    ];

    const hostname = url.hostname;
    for (const pattern of blockedPatterns) {
      if (pattern.test(hostname)) return false;
    }

    // Whitelist des domaines autorisés
    const allowedDomains = (process.env.CMDB_ALLOWED_DOMAINS || '')
      .split(',')
      .filter(Boolean);

    if (allowedDomains.length > 0) {
      return allowedDomains.some(d => hostname.endsWith(d));
    }

    return true;
  } catch {
    return false;
  }
}
```

---

## 14. Validation des entrées

### 14.1 Problème actuel

La validation des entrées est minimale et incohérente. Quelques `typeof query !== 'string'` mais aucune validation structurée des :
- IDs de graphe
- Noms de BDD
- Paramètres d'algorithme (`startNodeId`, `depth`, `hubs`)
- Corps de requête (création de graphe)

### 14.2 Comment corriger avec express-validator

```bash
npm install express-validator
```

```typescript
import { body, param, query, validationResult } from 'express-validator';

// Middleware de validation
function validate(req: Request, res: Response, next: NextFunction) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
}

// Exemples d'utilisation dans les routes
router.get('/graphs/:id',
  param('id').isString().trim().notEmpty().isLength({ max: 100 }),
  query('database').optional().isString().trim().isLength({ max: 64 }),
  validate,
  async (req, res) => { /* ... */ }
);

router.post('/graphs',
  body('name').isString().trim().notEmpty().isLength({ max: 200 }),
  body('nodes').isArray({ min: 0, max: 50000 }),
  body('nodes.*.id').isString().notEmpty(),
  body('nodes.*.label').isString().notEmpty().isLength({ max: 500 }),
  body('edges').isArray({ min: 0, max: 100000 }),
  body('edges.*.source').isString().notEmpty(),
  body('edges.*.target').isString().notEmpty(),
  validate,
  async (req, res) => { /* ... */ }
);

router.post('/graphs/:id/impact',
  param('id').isString().trim().notEmpty(),
  body('sourceNodeId').isString().trim().notEmpty(),
  body('depth').optional().isInt({ min: 1, max: 50 }),
  validate,
  async (req, res) => { /* ... */ }
);

router.post('/graphs/:id/algorithms',
  param('id').isString().trim().notEmpty(),
  body('algorithm').isIn([
    'bfs', 'dfs', 'dijkstra', 'bidirectional-bfs',
    'degree-centrality', 'betweenness-centrality', 'closeness-centrality',
    'pagerank', 'louvain', 'label-propagation',
    'connected-components', 'strongly-connected-components',
    'topological-sort', 'cascading-failure'
  ]),
  body('startNodeId').optional().isString(),
  body('endNodeId').optional().isString(),
  validate,
  async (req, res) => { /* ... */ }
);

router.delete('/databases/:name',
  param('name')
    .isString()
    .trim()
    .matches(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
    .withMessage('Nom de BDD invalide'),
  validate,
  async (req, res) => { /* ... */ }
);
```

---

## 15. Dépendances et composants vulnérables

### 15.1 Problème actuel

Le `package.json` n'inclut aucun outil de sécurité (pas de `helmet`, `express-rate-limit`, etc.) et aucun audit automatique n'est en place.

### 15.2 Comment corriger

#### Audit régulier des dépendances

```bash
# Vérifier les vulnérabilités connues
npm audit

# Corriger automatiquement si possible
npm audit fix

# Audit détaillé uniquement des failles critiques/hautes
npm audit --audit-level=high
```

#### Automatiser avec un script npm

```json
{
  "scripts": {
    "security:audit": "npm audit --audit-level=moderate",
    "security:check": "npm audit && npm outdated"
  }
}
```

#### En CI/CD — bloquer le build en cas de vulnérabilité critique

```yaml
# .github/workflows/security.yml
name: Security Check
on: [push, pull_request]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
        working-directory: backend-nodejs
      - run: npm audit --audit-level=high
        working-directory: backend-nodejs
```

#### Packages de sécurité à installer

```bash
cd backend-nodejs
npm install helmet express-rate-limit express-validator
npm install -D npm-audit-resolver
```

---

## 16. Journalisation et monitoring

### 16.1 Problème actuel

La journalisation est incohérente : `pino` dans `index.ts`, `console.log`/`console.error` dans les services. Aucune trace d'audit pour les opérations sensibles.

### 16.2 Comment corriger

#### Standardiser sur pino partout

```typescript
// src/utils/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // En production, format JSON pour les outils d'agrégation
  ...(process.env.NODE_ENV === 'production' ? {} : {
    transport: { target: 'pino-pretty' },
  }),
});
```

#### Journaliser les opérations sensibles

```typescript
// Audit logging pour les actions critiques
function auditLog(action: string, details: Record<string, unknown>, req: Request) {
  logger.info({
    type: 'AUDIT',
    action,
    user: (req as any).user?.userId || 'anonymous',
    ip: req.ip,
    timestamp: new Date().toISOString(),
    ...details,
  });
}

// Exemples d'utilisation
router.delete('/databases/:name', async (req, res) => {
  auditLog('DATABASE_DELETE', { database: req.params.name }, req);
  await service.deleteDatabase(req.params.name);
  res.json({ message: 'Database deleted' });
});

router.post('/query', async (req, res) => {
  auditLog('RAW_QUERY', {
    queryLength: req.body.query?.length,
    database: req.query.database,
  }, req);
  // ...
});
```

#### Événements à journaliser obligatoirement

| Événement | Niveau | Données |
|-----------|--------|---------|
| Echec d'authentification | `warn` | IP, user-agent |
| Requête SQL brute | `info` | userId, taille requête, database |
| Création/suppression de BDD | `info` | userId, nom de BDD |
| Suppression de graphe | `info` | userId, graphId |
| Erreur 5xx | `error` | Stack trace, path, method |
| Rate limit atteint | `warn` | IP, endpoint |

---

## 17. Checklist récapitulative

### Actions immédiates (priorité critique)

- [ ] **Restreindre ou supprimer** `POST /api/query` et `POST /api/query/graph`
- [ ] **Changer le mot de passe SA** de SQL Server
- [ ] **Ajouter `.env` au `.gitignore`** et purger l'historique Git
- [ ] **Créer un compte SQL dédié** avec permissions minimales (pas SA)
- [ ] **Installer et configurer Helmet** pour les en-têtes de sécurité

### Actions prioritaires (haute sévérité)

- [ ] **Implémenter l'authentification JWT** sur toutes les routes
- [ ] **Ajouter le RBAC** (admin / editor / viewer)
- [ ] **Restreindre les origines CORS** aux domaines autorisés
- [ ] **Activer HTTPS** (reverse proxy ou certificat direct)
- [ ] **Utiliser des requêtes paramétrées** partout (plus d'interpolation SQL)

### Actions recommandées (moyenne sévérité)

- [ ] **Installer express-rate-limit** et configurer des limites par route
- [ ] **Ajouter express-validator** avec validation sur chaque route
- [ ] **Masquer les erreurs SQL** en production (messages génériques)
- [ ] **Protéger le WebSocket** avec authentification par token
- [ ] **Valider les URLs externes** dans les routes CMDB (anti-SSRF)
- [ ] **Ajouter une protection CSRF** si utilisation de cookies de session

### Actions de maintenance continue

- [ ] **Lancer `npm audit`** à chaque mise à jour de dépendances
- [ ] **Standardiser la journalisation** sur pino (supprimer les `console.log`)
- [ ] **Ajouter un pipeline CI** avec vérification de sécurité
- [ ] **Effectuer des tests de pénétration** réguliers

---

### Packages de sécurité récapitulatifs

```bash
cd backend-nodejs

# En-têtes de sécurité
npm install helmet

# Rate limiting
npm install express-rate-limit

# Validation d'entrées
npm install express-validator

# Authentification
npm install jsonwebtoken bcryptjs
npm install -D @types/jsonwebtoken @types/bcryptjs

# Protection CSRF (si cookies)
npm install csrf-csrf

# Sanitisation HTML
npm install isomorphic-dompurify
npm install -D @types/dompurify
```
