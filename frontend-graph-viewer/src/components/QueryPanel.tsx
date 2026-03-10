import { useState, useCallback, useRef, useEffect } from 'react';
import { graphApi, RawQueryResult, EngineType } from '../services/api';
import type { GraphSummary } from '../types/graph';
import './QueryPanel.css';

interface QueryPanelProps {
  graphId?: string;
  database?: string;
  engine?: string;
}

interface QueryExample {
  label: string;
  description: string;
  query: string;
  engine: 'neo4j' | 'memgraph' | 'mssql' | 'all';
}

// ===== Exemples de requêtes prédéfinies =====

const CYPHER_EXAMPLES: QueryExample[] = [
  {
    label: ' Compter les nœuds',
    description: 'Nombre total de nœuds dans la base',
    query: `MATCH (n:GraphNode) RETURN count(n) AS nodeCount`,
    engine: 'neo4j',
  },
  {
    label: ' Compter les relations',
    description: 'Nombre total de relations',
    query: `MATCH ()-[r:CONNECTED_TO]->() RETURN count(r) AS edgeCount`,
    engine: 'neo4j',
  },
  {
    label: ' Lister les graphes',
    description: 'Identifiants uniques de tous les graphes',
    query: `MATCH (n:GraphNode) RETURN DISTINCT n.graph_id AS graphId, count(n) AS nodes ORDER BY nodes DESC`,
    engine: 'neo4j',
  },
  {
    label: ' Types de nœuds',
    description: 'Distribution des types de nœuds',
    query: `MATCH (n:GraphNode) RETURN n.node_type AS type, count(n) AS count ORDER BY count DESC LIMIT 20`,
    engine: 'neo4j',
  },
  {
    label: ' Top 10 nœuds connectés',
    description: 'Les 10 nœuds avec le plus de relations sortantes',
    query: `MATCH (n:GraphNode)-[r:CONNECTED_TO]->()
RETURN n.node_id AS nodeId, n.label AS label, count(r) AS outDegree
ORDER BY outDegree DESC LIMIT 10`,
    engine: 'neo4j',
  },
  {
    label: ' Voisins d\'un nœud',
    description: 'Voisins directs du nœud C0_N0 (profondeur 1)',
    query: `MATCH (source:GraphNode {node_id: 'C0_N0'})-[:CONNECTED_TO]->(neighbor:GraphNode)
WHERE source.graph_id = neighbor.graph_id
RETURN neighbor.node_id AS nodeId, neighbor.label AS label, neighbor.node_type AS type`,
    engine: 'neo4j',
  },
  {
    label: ' Impact depth=3',
    description: 'Nœuds impactés à profondeur 3 depuis C0_N0 (traversée variable-length)',
    query: `MATCH path = (source:GraphNode {node_id: 'C0_N0'})-[:CONNECTED_TO*1..3]->(n:GraphNode)
WHERE source.graph_id = n.graph_id
RETURN n.node_id AS nodeId, min(length(path)) AS level
ORDER BY level, nodeId`,
    engine: 'neo4j',
  },
  {
    label: ' Chemin le plus court',
    description: 'Plus court chemin entre deux nœuds (C0_N0 → C1_N0)',
    query: `MATCH path = shortestPath(
  (a:GraphNode {node_id: 'C0_N0'})-[:CONNECTED_TO*..10]-(b:GraphNode {node_id: 'C1_N0'})
)
WHERE a.graph_id = b.graph_id
RETURN [n IN nodes(path) | n.node_id] AS path, length(path) AS distance`,
    engine: 'neo4j',
  },
  {
    label: ' Degré moyen',
    description: 'Degré sortant moyen des nœuds',
    query: `MATCH (n:GraphNode)
OPTIONAL MATCH (n)-[r:CONNECTED_TO]->()
WITH n, count(r) AS degree
RETURN avg(degree) AS avgDegree, max(degree) AS maxDegree, min(degree) AS minDegree`,
    engine: 'neo4j',
  },
  {
    label: ' Nœuds isolés',
    description: 'Nœuds sans aucune relation',
    query: `MATCH (n:GraphNode)
WHERE NOT (n)-[:CONNECTED_TO]-() 
RETURN n.node_id AS nodeId, n.label AS label LIMIT 20`,
    engine: 'neo4j',
  },
  // ===== Exemples récursifs — comparaison de performance =====
  {
    label: ' Récursif depth=5',
    description: ' Neo4j: ~30ms |  MSSQL: ~300ms — traversée BFS profondeur 5',
    query: `MATCH path = (source:GraphNode {node_id: 'C0_N0'})-[:CONNECTED_TO*1..5]->(n:GraphNode)
WHERE source.graph_id = n.graph_id
RETURN n.node_id AS nodeId, min(length(path)) AS level
ORDER BY level, nodeId`,
    engine: 'neo4j',
  },
  {
    label: ' Récursif depth=8',
    description: ' Neo4j: ~97ms |  MSSQL: ~18 637ms — divergence exponentielle',
    query: `MATCH path = (source:GraphNode {node_id: 'C0_N0'})-[:CONNECTED_TO*1..8]->(n:GraphNode)
WHERE source.graph_id = n.graph_id
RETURN n.node_id AS nodeId, min(length(path)) AS level
ORDER BY level, nodeId`,
    engine: 'neo4j',
  },
  {
    label: ' BFS nœuds/niveau',
    description: 'Compte les nœuds impactés par niveau de profondeur (BFS)',
    query: `MATCH path = (source:GraphNode {node_id: 'C0_N0'})-[:CONNECTED_TO*1..6]->(n:GraphNode)
WHERE source.graph_id = n.graph_id
WITH n, min(length(path)) AS level
RETURN level, count(n) AS nodesAtLevel
ORDER BY level`,
    engine: 'neo4j',
  },
  {
    label: ' Composante connexe',
    description: 'Tous les nœuds accessibles depuis C0_N0 (BFS illimité)',
    query: `MATCH path = (source:GraphNode {node_id: 'C0_N0'})-[:CONNECTED_TO*]->(n:GraphNode)
WHERE source.graph_id = n.graph_id
RETURN count(DISTINCT n) AS reachableNodes, max(length(path)) AS maxDepth`,
    engine: 'neo4j',
  },
  {
    label: ' Explosion chemins',
    description: 'Chemins vs nœuds uniques par niveau — visualise l\'explosion combinatoire',
    query: `MATCH path = (source:GraphNode {node_id: 'C0_N0'})-[:CONNECTED_TO*1..4]->(n:GraphNode)
WHERE source.graph_id = n.graph_id
WITH length(path) AS depth, count(path) AS totalPaths, count(DISTINCT n) AS uniqueNodes
RETURN depth, totalPaths, uniqueNodes, totalPaths - uniqueNodes AS redundantPaths
ORDER BY depth`,
    engine: 'neo4j',
  },
];

const SQL_EXAMPLES: QueryExample[] = [
  {
    label: ' Compter les nœuds',
    description: 'Nombre total de nœuds par graphe',
    query: `SELECT graph_id, COUNT(*) AS node_count
FROM graph_nodes
GROUP BY graph_id
ORDER BY node_count DESC`,
    engine: 'mssql',
  },
  {
    label: ' Compter les arêtes',
    description: 'Nombre total d\'arêtes par graphe',
    query: `SELECT graph_id, COUNT(*) AS edge_count
FROM graph_edges
GROUP BY graph_id
ORDER BY edge_count DESC`,
    engine: 'mssql',
  },
  {
    label: ' Lister les graphes',
    description: 'Métadonnées de tous les graphes avec comptage',
    query: `SELECT g.id AS graph_id, g.title, g.graph_type,
       (SELECT COUNT(*) FROM graph_nodes n WHERE n.graph_id = g.id) AS nodes,
       (SELECT COUNT(*) FROM graph_edges e WHERE e.graph_id = g.id) AS edges
FROM graphs g
ORDER BY nodes DESC`,
    engine: 'mssql',
  },
  {
    label: ' Types de nœuds',
    description: 'Distribution des types de nœuds',
    query: `SELECT TOP 20 node_type, COUNT(*) AS cnt
FROM graph_nodes
GROUP BY node_type
ORDER BY cnt DESC`,
    engine: 'mssql',
  },
  {
    label: ' Top 10 nœuds connectés',
    description: 'Les 10 nœuds avec le plus de relations sortantes',
    query: `SELECT TOP 10 n.node_id, n.label, COUNT(e.target_id) AS out_degree
FROM graph_nodes n
JOIN graph_edges e ON e.graph_id = n.graph_id AND e.source_id = n.node_id
GROUP BY n.node_id, n.label
ORDER BY out_degree DESC`,
    engine: 'mssql',
  },
  {
    label: ' Voisins d\'un nœud',
    description: 'Voisins directs du nœud le plus connecté (JOIN simple)',
    query: `DECLARE @gid NVARCHAR(255) = 'GRAPH_ID_HERE';
-- Nœud avec le plus de relations sortantes
DECLARE @startNode NVARCHAR(255) = (
  SELECT TOP 1 source_id FROM graph_edges WHERE graph_id = @gid
  GROUP BY source_id ORDER BY COUNT(*) DESC
);

SELECT n.node_id, n.label, n.node_type, e.edge_type
FROM graph_edges e
JOIN graph_nodes n ON n.graph_id = e.graph_id AND n.node_id = e.target_id
WHERE e.graph_id = @gid AND e.source_id = @startNode`,
    engine: 'mssql',
  },
  {
    label: ' Impact CTE depth=3',
    description: 'Traversée CTE récursive depuis le nœud le plus connecté (profondeur 3)',
    query: `-- Cliquer sur un chip ci-dessus pour choisir un graphe
DECLARE @gid NVARCHAR(255) = 'GRAPH_ID_HERE';
-- Nœud de départ = celui avec le plus de relations sortantes
DECLARE @startNode NVARCHAR(255) = (
  SELECT TOP 1 source_id FROM graph_edges WHERE graph_id = @gid
  GROUP BY source_id ORDER BY COUNT(*) DESC
);

WITH Impact AS (
  SELECT node_id, 0 AS lvl
  FROM graph_nodes
  WHERE graph_id = @gid AND node_id = @startNode

  UNION ALL

  SELECT n.node_id, i.lvl + 1
  FROM Impact i
  JOIN graph_edges e ON e.graph_id = @gid AND e.source_id = i.node_id
  JOIN graph_nodes n ON n.graph_id = @gid AND n.node_id = e.target_id
  WHERE i.lvl < 3
)
SELECT node_id AS nodeId, MIN(lvl) AS level
FROM Impact
WHERE node_id <> @startNode
GROUP BY node_id
ORDER BY level, node_id
OPTION (MAXRECURSION 200)`,
    engine: 'mssql',
  },
  {
    label: ' Degré moyen',
    description: 'Degré sortant moyen des nœuds',
    query: `SELECT
  AVG(CAST(deg AS FLOAT)) AS avg_degree,
  MAX(deg) AS max_degree,
  MIN(deg) AS min_degree
FROM (
  SELECT n.node_id, COUNT(e.target_id) AS deg
  FROM graph_nodes n
  LEFT JOIN graph_edges e ON e.graph_id = n.graph_id AND e.source_id = n.node_id
  GROUP BY n.node_id
) sub`,
    engine: 'mssql',
  },
  {
    label: ' Nœuds isolés',
    description: 'Nœuds sans aucune relation',
    query: `SELECT TOP 20 n.node_id, n.label
FROM graph_nodes n
WHERE NOT EXISTS (
  SELECT 1 FROM graph_edges e
  WHERE e.graph_id = n.graph_id
    AND (e.source_id = n.node_id OR e.target_id = n.node_id)
)`,
    engine: 'mssql',
  },
  {
    label: ' Taille de la base',
    description: 'Lignes + taille physique sur disque (KB) par table',
    query: `-- Lignes par table
SELECT 'graphs' AS tbl, COUNT(*) AS rows_count FROM graphs
UNION ALL SELECT 'graph_nodes', COUNT(*) FROM graph_nodes
UNION ALL SELECT 'graph_edges', COUNT(*) FROM graph_edges;

-- Taille physique (KB) — quantifie la taille réelle de la base SQL
SELECT
  t.name AS table_name,
  p.rows AS row_count,
  CAST(SUM(a.total_pages) * 8 AS FLOAT) AS total_kb,
  CAST(SUM(a.used_pages)  * 8 AS FLOAT) AS used_kb
FROM sys.tables t
INNER JOIN sys.indexes i ON t.object_id = i.object_id
INNER JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
GROUP BY t.name, p.rows
ORDER BY total_kb DESC`,
    engine: 'mssql',
  },
  // ===== Exemples récursifs — comparaison de performance =====
  {
    label: ' CTE depth=5',
    description: ' MSSQL: ~300-637ms |  Neo4j: ~30ms — CTE récursive profondeur 5',
    query: `DECLARE @gid NVARCHAR(255) = 'GRAPH_ID_HERE';
DECLARE @startNode NVARCHAR(255) = (
  SELECT TOP 1 source_id FROM graph_edges WHERE graph_id = @gid
  GROUP BY source_id ORDER BY COUNT(*) DESC
);

WITH Impact AS (
  SELECT node_id, 0 AS lvl
  FROM graph_nodes WHERE graph_id = @gid AND node_id = @startNode
  UNION ALL
  SELECT n.node_id, i.lvl + 1
  FROM Impact i
  JOIN graph_edges e ON e.graph_id = @gid AND e.source_id = i.node_id
  JOIN graph_nodes n ON n.graph_id = @gid AND n.node_id = e.target_id
  WHERE i.lvl < 5
)
SELECT node_id AS nodeId, MIN(lvl) AS level
FROM Impact WHERE node_id <> @startNode
GROUP BY node_id ORDER BY level, node_id
OPTION (MAXRECURSION 200)`,
    engine: 'mssql',
  },
  {
    label: ' CTE depth=8',
    description: ' MSSQL: ~4-18 secondes |  Neo4j: ~7-97ms — explosion exponentielle',
    query: `DECLARE @gid NVARCHAR(255) = 'GRAPH_ID_HERE';
DECLARE @startNode NVARCHAR(255) = (
  SELECT TOP 1 source_id FROM graph_edges WHERE graph_id = @gid
  GROUP BY source_id ORDER BY COUNT(*) DESC
);

WITH Impact AS (
  SELECT node_id, 0 AS lvl
  FROM graph_nodes WHERE graph_id = @gid AND node_id = @startNode
  UNION ALL
  SELECT n.node_id, i.lvl + 1
  FROM Impact i
  JOIN graph_edges e ON e.graph_id = @gid AND e.source_id = i.node_id
  JOIN graph_nodes n ON n.graph_id = @gid AND n.node_id = e.target_id
  WHERE i.lvl < 8
)
SELECT node_id AS nodeId, MIN(lvl) AS level
FROM Impact WHERE node_id <> @startNode
GROUP BY node_id ORDER BY level, node_id
OPTION (MAXRECURSION 200)`,
    engine: 'mssql',
  },
  {
    label: ' BFS nœuds/niveau',
    description: 'Nœuds impactés par niveau de profondeur — croissance exponentielle visible',
    query: `DECLARE @gid NVARCHAR(255) = 'GRAPH_ID_HERE';
DECLARE @startNode NVARCHAR(255) = (
  SELECT TOP 1 source_id FROM graph_edges WHERE graph_id = @gid
  GROUP BY source_id ORDER BY COUNT(*) DESC
);

WITH Impact AS (
  SELECT node_id, 0 AS lvl
  FROM graph_nodes WHERE graph_id = @gid AND node_id = @startNode
  UNION ALL
  SELECT n.node_id, i.lvl + 1
  FROM Impact i
  JOIN graph_edges e ON e.graph_id = @gid AND e.source_id = i.node_id
  JOIN graph_nodes n ON n.graph_id = @gid AND n.node_id = e.target_id
  WHERE i.lvl < 5
)
SELECT lvl AS depth, COUNT(DISTINCT node_id) AS nodes_at_level
FROM Impact WHERE node_id <> @startNode
GROUP BY lvl ORDER BY lvl
OPTION (MAXRECURSION 200)`,
    engine: 'mssql',
  },
  {
    label: ' Explosion chemins CTE',
    description: 'Nombre de lignes brutes vs nœuds uniques — montre pourquoi UNION ALL explose',
    query: `DECLARE @gid NVARCHAR(255) = 'GRAPH_ID_HERE';
DECLARE @startNode NVARCHAR(255) = (
  SELECT TOP 1 source_id FROM graph_edges WHERE graph_id = @gid
  GROUP BY source_id ORDER BY COUNT(*) DESC
);

WITH AllPaths AS (
  SELECT node_id, 0 AS lvl
  FROM graph_nodes WHERE graph_id = @gid AND node_id = @startNode
  UNION ALL
  SELECT n.node_id, i.lvl + 1
  FROM AllPaths i
  JOIN graph_edges e ON e.graph_id = @gid AND e.source_id = i.node_id
  JOIN graph_nodes n ON n.graph_id = @gid AND n.node_id = e.target_id
  WHERE i.lvl < 4
)
-- Lignes brutes (avant GROUP BY) vs nœuds uniques (après)
SELECT
  lvl AS depth,
  COUNT(*) AS raw_rows,
  COUNT(DISTINCT node_id) AS unique_nodes,
  COUNT(*) - COUNT(DISTINCT node_id) AS wasted_rows
FROM AllPaths WHERE node_id <> @startNode
GROUP BY lvl ORDER BY lvl
OPTION (MAXRECURSION 200)`,
    engine: 'mssql',
  },
  {
    label: ' BFS optimisé',
    description: 'CTE avec déduplication par niveau — 10-50× plus rapide que la CTE naïve',
    query: `DECLARE @gid NVARCHAR(255) = 'GRAPH_ID_HERE';
DECLARE @startNode NVARCHAR(255) = (
  SELECT TOP 1 source_id FROM graph_edges WHERE graph_id = @gid
  GROUP BY source_id ORDER BY COUNT(*) DESC
);
DECLARE @maxDepth INT = 8;

CREATE TABLE #frontier (node_id NVARCHAR(255) PRIMARY KEY);
CREATE TABLE #visited  (node_id NVARCHAR(255) PRIMARY KEY, lvl INT);
INSERT INTO #frontier VALUES (@startNode);
INSERT INTO #visited  VALUES (@startNode, 0);

DECLARE @d INT = 1;
WHILE @d <= @maxDepth AND EXISTS (SELECT 1 FROM #frontier)
BEGIN
  INSERT INTO #visited (node_id, lvl)
  SELECT DISTINCT e.target_id, @d
  FROM #frontier f
  JOIN graph_edges e ON e.graph_id = @gid AND e.source_id = f.node_id
  WHERE NOT EXISTS (SELECT 1 FROM #visited v WHERE v.node_id = e.target_id);

  TRUNCATE TABLE #frontier;
  INSERT INTO #frontier SELECT node_id FROM #visited WHERE lvl = @d;
  SET @d = @d + 1;
END

SELECT node_id AS nodeId, lvl AS level FROM #visited
WHERE node_id <> @startNode ORDER BY level, node_id;
DROP TABLE #frontier; DROP TABLE #visited;`,
    engine: 'mssql',
  },
];

export default function QueryPanel({ graphId, database, engine }: QueryPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RawQueryResult[]>([]);
  const [running, setRunning] = useState(false);
  const [runBoth, setRunBoth] = useState(false);
  const [graphList, setGraphList] = useState<GraphSummary[]>([]);
  const [activeGraphId, setActiveGraphId] = useState<string | undefined>(graphId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const currentEngine = (engine || 'neo4j') as EngineType;
  const isCypher = currentEngine === 'neo4j' || currentEngine === 'memgraph';
  const examples = isCypher ? CYPHER_EXAMPLES : SQL_EXAMPLES;

  // Sync activeGraphId when parent selection changes
  useEffect(() => {
    setActiveGraphId(graphId);
  }, [graphId]);

  // Load graph list on mount or when database/engine changes
  useEffect(() => {
    graphApi.listGraphs(database, currentEngine)
      .then(setGraphList)
      .catch(() => setGraphList([]));
  }, [database, currentEngine]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [query]);

  /** Adapt a Cypher query for Memgraph (no length() function) */
  const adaptForMemgraph = useCallback((q: string) => {
    return q
      .replace(/\blength\(path\)/g, 'size(relationships(path))')
      .replace(/\blength\(([a-zA-Z_][a-zA-Z0-9_]*)\)/g, 'size(relationships($1))');
  }, []);

  const executeQuery = useCallback(async () => {
    if (!query.trim()) return;
    setRunning(true);
    setResults([]);

    try {
      if (runBoth) {
        // Run on both engines in parallel for comparison
        const engines: EngineType[] = [];
        if (isCypher) {
          // Run the Cypher query on neo4j and memgraph
          engines.push('neo4j', 'memgraph');
        } else {
          // Can't run SQL on Neo4j — run only on MSSQL
          engines.push('mssql');
        }

        const promises = engines.map(async (eng) => {
          const t0 = performance.now();
          // Memgraph doesn't support length(path) — auto-substitute on the fly
          const q = eng === 'memgraph' ? adaptForMemgraph(query) : query;
          const r = await graphApi.executeQuery(q, database, eng);
          r.totalMs = Math.round(performance.now() - t0);
          return r;
        });
        const allResults = await Promise.all(promises);
        setResults(allResults);
      } else {
        const t0 = performance.now();
        const q = currentEngine === 'memgraph' ? adaptForMemgraph(query) : query;
        const result = await graphApi.executeQuery(q, database, currentEngine);
        result.totalMs = Math.round(performance.now() - t0);
        setResults([result]);
      }
    } catch (err: any) {
      setResults([{
        rows: [],
        elapsed_ms: 0,
        rowCount: 0,
        engine: currentEngine,
        error: err.message || 'Execution failed',
      }]);
    } finally {
      setRunning(false);
    }
  }, [query, database, currentEngine, runBoth, isCypher, adaptForMemgraph]);

  const loadExample = useCallback((example: QueryExample) => {
    let q = example.query;
    const gid = activeGraphId;
    // Replace graph ID placeholder if we have a selected graph
    if (gid) {
      q = q.replace(/GRAPH_ID_HERE/g, gid);
      // For Cypher queries involving a specific graph, inject graph_id filter
      if (example.engine === 'neo4j') {
        q = q.replace(
          /\(n:GraphNode\)/g,
          `(n:GraphNode {graph_id: '${gid}'})`
        );
      }
    }
    // Memgraph doesn't support length(path) — auto-substitute
    if (currentEngine === 'memgraph') {
      q = adaptForMemgraph(q);
    }
    setQuery(q);
  }, [activeGraphId, currentEngine, adaptForMemgraph]);

  /** Replace all graph IDs in the current query with the new one */
  const swapGraphId = useCallback((newId: string) => {
    setActiveGraphId(newId);
    setQuery((prev) => {
      if (!prev.trim()) return prev;
      let q = prev;
      // Cypher: {graph_id: 'old_id'} → {graph_id: 'new_id'}
      q = q.replace(/\{graph_id:\s*'[^']*'\}/g, `{graph_id: '${newId}'}`);
      // SQL: graph_id = 'old_id' or graph_id = @gid with DECLARE @gid = (SELECT TOP 1 ...)
      q = q.replace(/(graph_id\s*=\s*)'[^']*'/g, `$1'${newId}'`);
      // SQL: @gid NVARCHAR... = 'old' or DECLARE @gid ... = (SELECT TOP 1 graph_id FROM graphs)
      q = q.replace(
        /DECLARE\s+@gid\s+NVARCHAR\(\d+\)\s*=\s*\([^)]+\)/gi,
        `DECLARE @gid NVARCHAR(255) = '${newId}'`
      );
      // Also replace GRAPH_ID_HERE
      q = q.replace(/GRAPH_ID_HERE/g, newId);
      return q;
    });
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      executeQuery();
    }
  }, [executeQuery]);

  return (
    <div className="query-panel">
      <div className="query-panel-header">
        <h2>
          {isCypher ? '🔷 Cypher Query' : '🟦 SQL Query'}
          <span className="query-engine-badge">{currentEngine}</span>
        </h2>
        <p className="query-hint">
          {isCypher
            ? 'Exécutez des requêtes Cypher sur Neo4j / Memgraph'
            : 'Exécutez des requêtes SQL sur Microsoft SQL Server'}
          {' '}—{' '}
          <kbd>Ctrl+Enter</kbd> pour exécuter
        </p>
      </div>

      {/* Examples */}
      <div className="query-examples">
        <span className="examples-label">Exemples :</span>
        <div className="examples-grid">
          {examples.map((ex, i) => (
            <button
              key={i}
              className="example-btn"
              onClick={() => loadExample(ex)}
              title={ex.description}
            >
              {ex.label}
            </button>
          ))}
        </div>
      </div>

      {/* Graph IDs */}
      {graphList.length > 0 && (
        <div className="query-graph-ids">
          <span className="examples-label">Graphes disponibles (clic = injecter l'ID dans la requête) :</span>
          <div className="graph-id-list">
            {graphList.map((g) => (
              <button
                key={g.id}
                className={`graph-id-chip ${g.id === activeGraphId ? 'active' : ''}`}
                onClick={() => swapGraphId(g.id)}
                title={`${g.title || g.id} — ${g.node_count ?? '?'} nœuds / ${g.edge_count ?? '?'} arêtes\nClic = remplacer l'ID dans la requête`}
              >
                <span className="graph-id-name">{g.id}</span>
                <span className="graph-id-meta">{g.node_count ?? '?'}n</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Editor */}
      <div className="query-editor">
        <textarea
          ref={textareaRef}
          className="query-textarea"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isCypher
            ? "MATCH (n) RETURN n LIMIT 10"
            : "SELECT TOP 10 * FROM graph_nodes"
          }
          spellCheck={false}
          rows={4}
        />
        <div className="query-actions">
          {isCypher && (
            <label className="run-both-toggle" title="Exécuter sur Neo4j ET Memgraph pour comparer les temps">
              <input
                type="checkbox"
                checked={runBoth}
                onChange={(e) => setRunBoth(e.target.checked)}
              />
              Comparer Neo4j / Memgraph
            </label>
          )}
          <button
            className="execute-btn"
            onClick={executeQuery}
            disabled={running || !query.trim()}
          >
            {running ? '⏳ Exécution...' : '▶ Exécuter'}
          </button>
          {query && (
            <button className="clear-btn" onClick={() => { setQuery(''); setResults([]); }}>
              ✕ Effacer
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="query-results">
          {results.map((result, idx) => (
            <div key={idx} className={`result-block ${result.error ? 'result-error' : ''}`}>
              <div className="result-header">
                <span className="result-engine">{result.engine}</span>
                <span className="result-timing">
                  {result.error
                    ? '❌ Erreur'
                    : `✅ ${result.rowCount} ligne${result.rowCount !== 1 ? 's' : ''} — DB: ${result.elapsed_ms} ms | Total: ${result.totalMs ?? '?'} ms`}
                </span>
              </div>

              {result.error ? (
                <div className="result-error-message">{result.error}</div>
              ) : result.rows.length > 0 ? (
                <div className="result-table-wrapper">
                  <table className="result-table">
                    <thead>
                      <tr>
                        {Object.keys(result.rows[0]).map((col) => (
                          <th key={col}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.slice(0, 200).map((row, ri) => (
                        <tr key={ri}>
                          {Object.values(row).map((val, ci) => (
                            <td key={ci}>
                              {val === null
                                ? <span className="null-value">NULL</span>
                                : typeof val === 'object'
                                  ? JSON.stringify(val)
                                  : String(val)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.rows.length > 200 && (
                    <div className="result-truncated">
                      ⚠️ Tronqué : {result.rows.length - 200} lignes supplémentaires non affichées
                    </div>
                  )}
                </div>
              ) : (
                <div className="result-empty">Aucun résultat</div>
              )}
            </div>
          ))}

          {/* Comparison summary when running on both engines */}
          {results.length > 1 && !results.some(r => r.error) && (
            <div className="comparison-summary">
              <h3>⚡ Comparaison</h3>
              <div className="comparison-bars">
                {results.map((r, i) => {
                  const maxTime = Math.max(...results.map(rr => rr.elapsed_ms));
                  const pct = maxTime > 0 ? (r.elapsed_ms / maxTime) * 100 : 100;
                  return (
                    <div key={i} className="comparison-row">
                      <span className="comparison-engine">{r.engine}</span>
                      <div className="comparison-bar-track">
                        <div
                          className={`comparison-bar-fill ${i === 0 ? 'bar-primary' : 'bar-secondary'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="comparison-time">{r.elapsed_ms} ms</span>
                      <span className="comparison-rows">{r.rowCount} lignes</span>
                    </div>
                  );
                })}
              </div>
              {results.length === 2 && (
                <div className="comparison-ratio">
                  Ratio : {results[0].elapsed_ms > 0 && results[1].elapsed_ms > 0
                    ? `${(Math.max(results[0].elapsed_ms, results[1].elapsed_ms) /
                        Math.min(results[0].elapsed_ms, results[1].elapsed_ms)).toFixed(1)}×`
                    : 'N/A'}
                  {' '}— le plus rapide : <strong>
                    {results[0].elapsed_ms <= results[1].elapsed_ms
                      ? results[0].engine
                      : results[1].engine}
                  </strong>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
