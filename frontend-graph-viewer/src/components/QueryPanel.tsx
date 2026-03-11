import { useState, useCallback, useRef, useEffect } from 'react';
import { graphApi, RawQueryResult } from '../services/api';
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
}

// ===== Exemples de requêtes SQL prédéfinies =====

const SQL_EXAMPLES: QueryExample[] = [
  {
    label: ' Compter les nœuds',
    description: 'Nombre total de nœuds par graphe',
    query: `SELECT graph_id, COUNT(*) AS node_count
FROM graph_nodes
GROUP BY graph_id
ORDER BY node_count DESC`,
  },
  {
    label: ' Compter les arêtes',
    description: 'Nombre total d\'arêtes par graphe',
    query: `SELECT graph_id, COUNT(*) AS edge_count
FROM graph_edges
GROUP BY graph_id
ORDER BY edge_count DESC`,
  },
  {
    label: ' Lister les graphes',
    description: 'Métadonnées de tous les graphes avec comptage',
    query: `SELECT g.id AS graph_id, g.title, g.graph_type,
       (SELECT COUNT(*) FROM graph_nodes n WHERE n.graph_id = g.id) AS nodes,
       (SELECT COUNT(*) FROM graph_edges e WHERE e.graph_id = g.id) AS edges
FROM graphs g
ORDER BY nodes DESC`,
  },
  {
    label: ' Types de nœuds',
    description: 'Distribution des types de nœuds',
    query: `SELECT TOP 20 node_type, COUNT(*) AS cnt
FROM graph_nodes
GROUP BY node_type
ORDER BY cnt DESC`,
  },
  {
    label: ' Top 10 nœuds connectés',
    description: 'Les 10 nœuds avec le plus de relations sortantes',
    query: `SELECT TOP 10 n.node_id, n.label, COUNT(e.target_id) AS out_degree
FROM graph_nodes n
JOIN graph_edges e ON e.graph_id = n.graph_id AND e.source_id = n.node_id
GROUP BY n.node_id, n.label
ORDER BY out_degree DESC`,
  },
  {
    label: ' Voisins d\'un nœud',
    description: 'Voisins directs du nœud le plus connecté (JOIN simple)',
    query: `DECLARE @gid NVARCHAR(255) = 'GRAPH_ID_HERE';
-- Nœud avec le plus de relations sortantes
DECLARE @startNode NVARCHAR(255) = (
  SELECT TOP 1 source_id FROM graph_edges WHERE graph_id = @gid
  Group BY source_id ORDER BY COUNT(*) DESC
);

SELECT n.node_id, n.label, n.node_type, e.edge_type
FROM graph_edges e
JOIN graph_nodes n ON n.graph_id = e.graph_id AND n.node_id = e.target_id
WHERE e.graph_id = @gid AND e.source_id = @startNode`,
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
  },
  // ===== Exemples récursifs =====
  {
    label: ' CTE depth=5',
    description: 'CTE récursive profondeur 5',
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
  },
  {
    label: ' CTE depth=8',
    description: 'CTE récursive profondeur 8 — explosion exponentielle',
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
  },
  {
    label: ' Profondeur max par nœud',
    description: 'Top 50 nœuds les plus connectés avec leur profondeur max atteignable. BFS set-based simultané (rapide).',
    query: `DECLARE @gid NVARCHAR(255) = 'GRAPH_ID_HERE';

-- Top 50 nœuds les plus connectés (ajuster le TOP N si besoin)
CREATE TABLE #sources (node_id NVARCHAR(255) PRIMARY KEY, label NVARCHAR(500));
INSERT INTO #sources
SELECT TOP 50 n.node_id, n.label
FROM graph_nodes n
LEFT JOIN graph_edges e ON e.graph_id = @gid AND e.source_id = n.node_id
WHERE n.graph_id = @gid
GROUP BY n.node_id, n.label
ORDER BY COUNT(e.target_id) DESC;

-- BFS simultané depuis toutes les sources en parallèle
CREATE TABLE #visited (
  source_id NVARCHAR(255), node_id NVARCHAR(255), lvl INT,
  PRIMARY KEY (source_id, node_id)
);
CREATE TABLE #frontier (
  source_id NVARCHAR(255), node_id NVARCHAR(255),
  PRIMARY KEY (source_id, node_id)
);

INSERT INTO #visited  SELECT node_id, node_id, 0 FROM #sources;
INSERT INTO #frontier SELECT node_id, node_id FROM #sources;

DECLARE @d INT = 1;
WHILE EXISTS (SELECT 1 FROM #frontier)
BEGIN
  INSERT INTO #visited (source_id, node_id, lvl)
  SELECT DISTINCT f.source_id, e.target_id, @d
  FROM #frontier f
  JOIN graph_edges e ON e.graph_id = @gid AND e.source_id = f.node_id
  WHERE NOT EXISTS (
    SELECT 1 FROM #visited v
    WHERE v.source_id = f.source_id AND v.node_id = e.target_id
  );

  TRUNCATE TABLE #frontier;
  INSERT INTO #frontier SELECT source_id, node_id FROM #visited WHERE lvl = @d;
  SET @d = @d + 1;
END

SELECT s.node_id AS nodeId, s.label, ISNULL(MAX(v.lvl), 0) AS maxDepth
FROM #sources s
LEFT JOIN #visited v ON v.source_id = s.node_id
GROUP BY s.node_id, s.label
ORDER BY maxDepth DESC, s.node_id;

DROP TABLE #frontier; DROP TABLE #visited; DROP TABLE #sources;`,
  },
];

export default function QueryPanel({ graphId, database }: QueryPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RawQueryResult[]>([]);
  const [running, setRunning] = useState(false);
  const [graphList, setGraphList] = useState<GraphSummary[]>([]);
  const [activeGraphId, setActiveGraphId] = useState<string | undefined>(graphId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync activeGraphId when parent selection changes
  useEffect(() => {
    setActiveGraphId(graphId);
  }, [graphId]);

  // Load graph list on mount or when database changes
  useEffect(() => {
    graphApi.listGraphs(database, 'mssql')
      .then(setGraphList)
      .catch(() => setGraphList([]));
  }, [database]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [query]);

  const executeQuery = useCallback(async () => {
    if (!query.trim()) return;
    setRunning(true);
    setResults([]);

    try {
      const t0 = performance.now();
      const result = await graphApi.executeQuery(query, database, 'mssql');
      result.totalMs = Math.round(performance.now() - t0);
      setResults([result]);
    } catch (err: any) {
      setResults([{
        rows: [],
        elapsed_ms: 0,
        rowCount: 0,
        engine: 'mssql',
        error: err.message || 'Execution failed',
      }]);
    } finally {
      setRunning(false);
    }
  }, [query, database]);

  const loadExample = useCallback((example: QueryExample) => {
    let q = example.query;
    const gid = activeGraphId;
    if (gid) {
      q = q.replace(/GRAPH_ID_HERE/g, gid);
    }
    setQuery(q);
  }, [activeGraphId]);

  /** Replace all graph IDs in the current query with the new one */
  const swapGraphId = useCallback((newId: string) => {
    setActiveGraphId(newId);
    setQuery((prev) => {
      if (!prev.trim()) return prev;
      let q = prev;
      // SQL: graph_id = 'old_id'
      q = q.replace(/(graph_id\s*=\s*)'[^']*'/g, `$1'${newId}'`);
      // SQL: @gid NVARCHAR... = '...'
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
          🟦 SQL Query
          <span className="query-engine-badge">mssql</span>
        </h2>
        <p className="query-hint">
          Exécutez des requêtes SQL sur Microsoft SQL Server
          {' '}—{' '}
          <kbd>Ctrl+Enter</kbd> pour exécuter
        </p>
      </div>

      {/* Examples */}
      <div className="query-examples">
        <span className="examples-label">Exemples :</span>
        <div className="examples-grid">
          {SQL_EXAMPLES.map((ex, i) => (
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
          placeholder="SELECT TOP 10 * FROM graph_nodes"
          spellCheck={false}
          rows={4}
        />
        <div className="query-actions">
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
        </div>
      )}
    </div>
  );
}
