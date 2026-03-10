-- ============================================================================
-- 10_degree_distribution.sql — Distribution des degrés de connectivité
-- Combien de CIs ont 0, 1-5, 5-20, 20-100, 100-500, 500+ edges
-- ============================================================================

WITH degree AS (
  SELECT a.ASSET_ID, ISNULL(edge_cnt.total_edges, 0) AS total_edges
  FROM [DATA_VALEO].[50004].AM_ASSET a
  LEFT JOIN (
    SELECT id, SUM(c) AS total_edges FROM (
      SELECT PARENT_CI_ID AS id, COUNT(*) AS c
      FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK GROUP BY PARENT_CI_ID
      UNION ALL
      SELECT CHILD_CI_ID AS id, COUNT(*) AS c
      FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK GROUP BY CHILD_CI_ID
    ) x GROUP BY id
  ) edge_cnt ON edge_cnt.id = a.ASSET_ID
  WHERE a.IS_CI = 1
)
SELECT
  CASE
    WHEN total_edges = 0     THEN '0 edges (isolés)'
    WHEN total_edges <= 5    THEN '1-5 edges'
    WHEN total_edges <= 20   THEN '6-20 edges'
    WHEN total_edges <= 100  THEN '21-100 edges'
    WHEN total_edges <= 500  THEN '101-500 edges'
    WHEN total_edges <= 1000 THEN '501-1000 edges'
    ELSE '1000+ edges'
  END AS tranche,
  COUNT(*) AS nb_ci,
  MIN(total_edges) AS min_edges,
  MAX(total_edges) AS max_edges,
  AVG(total_edges) AS avg_edges
FROM degree
GROUP BY
  CASE
    WHEN total_edges = 0     THEN '0 edges (isolés)'
    WHEN total_edges <= 5    THEN '1-5 edges'
    WHEN total_edges <= 20   THEN '6-20 edges'
    WHEN total_edges <= 100  THEN '21-100 edges'
    WHEN total_edges <= 500  THEN '101-500 edges'
    WHEN total_edges <= 1000 THEN '501-1000 edges'
    ELSE '1000+ edges'
  END
ORDER BY MIN(total_edges);
