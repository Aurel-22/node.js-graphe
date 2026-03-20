import { useState, useCallback, useRef, lazy, Suspense } from 'react';
import { graphApi } from '../services/api';
import type { GraphData } from '../types/graph';
import './SqlQueryPanel.css';

const SigmaGraphViewer = lazy(() => import('./SigmaGraphViewer'));

interface SqlQueryPanelProps {
  database?: string;
  engine?: string;
}

const DEFAULT_QUERY = `-- Requête BFS bidirectionnelle : exploration de graphe depuis un asset
-- Table 1 → Nodes (ASSET_ID, NETWORK_IDENTIFIER, CI_STATUS, Level)
-- Table 2 → Links (PARENT_CI_ID, CHILD_CI_ID, LINK_NAME, BLOCKING)

DECLARE @StartAssetId BIGINT = 100003;
DECLARE @MaxLevels INT = 2;

CREATE TABLE #Visited (ASSET_ID BIGINT PRIMARY KEY);
CREATE TABLE #Frontier (ASSET_ID BIGINT PRIMARY KEY);
CREATE TABLE #Next (ASSET_ID BIGINT PRIMARY KEY);

INSERT INTO #Frontier (ASSET_ID) VALUES (@StartAssetId);
INSERT INTO #Visited (ASSET_ID) VALUES (@StartAssetId);

DECLARE @Level INT = 0;

WHILE @Level < @MaxLevels
BEGIN
    SET @Level += 1;

    -- Explore children (parent → child)
    INSERT INTO #Next (ASSET_ID)
    SELECT DISTINCT link.CHILD_CI_ID
    FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK link
    INNER JOIN #Frontier f ON f.ASSET_ID = link.PARENT_CI_ID
    WHERE link.CHILD_CI_ID NOT IN (SELECT ASSET_ID FROM #Visited);

    -- Explore parents (child → parent)
    INSERT INTO #Next (ASSET_ID)
    SELECT DISTINCT link.PARENT_CI_ID
    FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK link
    INNER JOIN #Frontier f ON f.ASSET_ID = link.CHILD_CI_ID
    WHERE link.PARENT_CI_ID NOT IN (SELECT ASSET_ID FROM #Visited)
      AND link.PARENT_CI_ID NOT IN (SELECT ASSET_ID FROM #Next);

    IF (SELECT COUNT(*) FROM #Next) = 0 BREAK;

    INSERT INTO #Visited (ASSET_ID)
    SELECT ASSET_ID FROM #Next;

    TRUNCATE TABLE #Frontier;
    INSERT INTO #Frontier (ASSET_ID)
    SELECT ASSET_ID FROM #Next;
    TRUNCATE TABLE #Next;
END

-- Table 1 : Nodes
SELECT
    a.ASSET_ID,
    a.NETWORK_IDENTIFIER,
    s.CI_STATUS_FR AS CI_STATUS,
    CASE
        WHEN a.ASSET_ID = @StartAssetId THEN 0
        ELSE NULL
    END AS Level
FROM [DATA_VALEO].[50004].AM_ASSET a
INNER JOIN #Visited v ON v.ASSET_ID = a.ASSET_ID
LEFT JOIN [DATA_VALEO].[50004].CMDB_CI_STATUS s ON s.CI_STATUS_ID = a.CI_STATUS_ID;

-- Table 2 : Links (tous les liens entre noeuds visités, dans les deux sens)
SELECT
    link.PARENT_CI_ID,
    link.CHILD_CI_ID,
    link.RELATION_TYPE_ID,
    link.BLOCKING,
    r.REFERENCE_FR AS LINK_NAME
FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK link
LEFT JOIN [DATA_VALEO].[50004].AM_REFERENCE r ON r.REFERENCE_ID = link.RELATION_TYPE_ID
WHERE link.PARENT_CI_ID IN (SELECT ASSET_ID FROM #Visited)
  AND link.CHILD_CI_ID IN (SELECT ASSET_ID FROM #Visited);

DROP TABLE #Visited;
DROP TABLE #Frontier;
DROP TABLE #Next;`;

type ViewMode = 'graph' | 'table';

export default function SqlQueryPanel({ database = 'DATA_VALEO', engine }: SqlQueryPanelProps) {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [recordsets, setRecordsets] = useState<Record<string, any>[][] | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('graph');
  const [tableTab, setTableTab] = useState(0);
  const [queryKey, setQueryKey] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const executeQuery = useCallback(async () => {
    if (!query.trim() || executing) return;
    setExecuting(true);
    setError(null);
    setGraphData(null);
    setQueryKey(k => k + 1);
    setRecordsets(null);
    setElapsedMs(null);

    try {
      const result = await graphApi.executeGraphQuery(query, database, engine as any);

      if (result.error) {
        setError(result.error);
        setExecuting(false);
        return;
      }

      // Filter out empty recordsets produced by INSERT/TRUNCATE/WHILE statements
      const nonEmpty = result.recordsets.filter((rs) => rs.length > 0);
      setRecordsets(nonEmpty);
      setElapsedMs(result.elapsed_ms);

      // Map recordsets to GraphData: use the last two non-empty recordsets (nodes + edges)
      if (nonEmpty.length >= 2) {
        const nodesRs = nonEmpty[nonEmpty.length - 2];
        const edgesRs = nonEmpty[nonEmpty.length - 1];

        // Auto-detect column mapping for nodes
        const nodeIdCol = findColumn(nodesRs[0], ['ASSET_ID', 'ID', 'NODE_ID', 'id']);
        const nodeLabelCol = findColumn(nodesRs[0], ['NETWORK_IDENTIFIER', 'LABEL', 'NAME', 'label', 'name']);
        const nodeTypeCol = findColumn(nodesRs[0], ['CI_STATUS', 'NODE_TYPE', 'TYPE', 'type', 'node_type']);

        // Auto-detect column mapping for edges
        const sourceCol = findColumn(edgesRs[0], ['PARENT_CI_ID', 'SOURCE', 'SOURCE_ID', 'source', 'from']);
        const targetCol = findColumn(edgesRs[0], ['CHILD_CI_ID', 'TARGET', 'TARGET_ID', 'target', 'to']);
        const edgeLabelCol = findColumn(edgesRs[0], ['LINK_NAME', 'LABEL', 'EDGE_TYPE', 'label', 'type']);

        if (nodeIdCol && sourceCol && targetCol) {
          const nodes = nodesRs.map((row) => ({
            id: String(row[nodeIdCol]),
            label: nodeLabelCol ? (row[nodeLabelCol] || String(row[nodeIdCol])) : String(row[nodeIdCol]),
            node_type: nodeTypeCol ? (row[nodeTypeCol] || 'default') : 'default',
            properties: { ...row },
          }));

          const edges = edgesRs.map((row, i) => ({
            id: `e-${i}`,
            source: String(row[sourceCol]),
            target: String(row[targetCol]),
            label: edgeLabelCol ? (row[edgeLabelCol] || undefined) : undefined,
            edge_type: edgeLabelCol ? (row[edgeLabelCol] || 'link') : 'link',
            properties: { ...row },
          }));

          setGraphData({ nodes, edges });
        } else {
          // Columns not recognized — show as table
          setViewMode('table');
        }
      } else if (nonEmpty.length >= 1) {
        setViewMode('table');
      }
    } catch (err: any) {
      setError(err.message || 'Execution failed');
    } finally {
      setExecuting(false);
    }
  }, [query, database, engine, executing]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      executeQuery();
    }
  }, [executeQuery]);

  return (
    <div className="sql-query-panel">
      <div className="sql-query-top">
        <div className="sql-query-top-header">
          <h3>SQL Queries</h3>
          {engine && <span className="sql-query-engine-badge">{engine}</span>}
          {database && <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>{database}</span>}
        </div>

        <textarea
          ref={textareaRef}
          className="sql-query-textarea"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="SQL query (Ctrl+Enter to execute)"
          spellCheck={false}
          rows={8}
        />

        <div className="sql-query-actions">
          <button
            className="sql-execute-btn"
            onClick={executeQuery}
            disabled={executing || !query.trim()}
          >
            {executing ? '⏳ Executing...' : '▶ Execute (Ctrl+Enter)'}
          </button>

          {error && <span className="sql-query-status error">❌ {error}</span>}

          {elapsedMs !== null && !error && (
            <span className="sql-query-timing">
              ⏱ {elapsedMs} ms — {recordsets ? recordsets.length : 0} recordset(s)
              {graphData && ` — ${graphData.nodes.length} nodes, ${graphData.edges.length} edges`}
            </span>
          )}

          {graphData && (
            <div className="sql-view-toggle">
              <button className={viewMode === 'graph' ? 'active' : ''} onClick={() => setViewMode('graph')}>
                Graph
              </button>
              <button className={viewMode === 'table' ? 'active' : ''} onClick={() => setViewMode('table')}>
                Table
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="sql-query-results">
        {!recordsets && !error && (
          <div className="sql-empty-state">
            <span style={{ fontSize: '2rem' }}>🔍</span>
            <span>Exécutez une requête multi-tables pour visualiser le graphe</span>
            <span style={{ fontSize: '0.75rem' }}>Table 1 → Nodes | Table 2 → Edges</span>
          </div>
        )}

        {viewMode === 'graph' && graphData && (
          <div className="sql-graph-container">
            <Suspense fallback={<div className="sql-empty-state"><div className="spinner"></div></div>}>
              <SigmaGraphViewer data={graphData} graphId={`sql-query-${queryKey}`} />
            </Suspense>
          </div>
        )}

        {viewMode === 'table' && recordsets && recordsets.length > 0 && (
          <>
            {recordsets.length > 1 && (
              <div className="sql-recordset-tabs">
                {recordsets.map((rs, i) => (
                  <button
                    key={i}
                    className={tableTab === i ? 'active' : ''}
                    onClick={() => setTableTab(i)}
                  >
                    Table {i + 1} ({rs.length} rows)
                  </button>
                ))}
              </div>
            )}
            <div className="sql-table-container">
              <ResultTable rows={recordsets[tableTab] || []} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ResultTable({ rows }: { rows: Record<string, any>[] }) {
  if (rows.length === 0) return <div className="sql-empty-state">No rows</div>;
  const columns = Object.keys(rows[0]);
  return (
    <table className="sql-result-table">
      <thead>
        <tr>{columns.map((col) => <th key={col}>{col}</th>)}</tr>
      </thead>
      <tbody>
        {rows.slice(0, 1000).map((row, i) => (
          <tr key={i}>
            {columns.map((col) => (
              <td key={col}>{row[col] != null ? String(row[col]) : ''}</td>
            ))}
          </tr>
        ))}
        {rows.length > 1000 && (
          <tr><td colSpan={columns.length} style={{ textAlign: 'center', color: '#8b949e' }}>
            ... {rows.length - 1000} more rows
          </td></tr>
        )}
      </tbody>
    </table>
  );
}

/** Find the first matching column name from a row object. */
function findColumn(row: Record<string, any> | undefined, candidates: string[]): string | null {
  if (!row) return null;
  const keys = Object.keys(row);
  for (const c of candidates) {
    const found = keys.find((k) => k.toLowerCase() === c.toLowerCase());
    if (found) return found;
  }
  return null;
}
