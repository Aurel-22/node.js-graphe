-- ============================================================================
-- 05_top_connected_nodes.sql — Top 50 nœuds les plus connectés
-- CIs avec le plus de relations (entrantes + sortantes)
-- ============================================================================

SELECT TOP 50
  a.ASSET_ID,
  a.NETWORK_IDENTIFIER              AS nom,
  a.ASSET_TAG                       AS nDeCI,
  uc.UN_CLASSIFICATION_FR           AS categorie,
  CASE WHEN a.IS_SERVICE = 1 THEN 'Service' ELSE 'CI' END AS type,
  edge_cnt.total_edges,
  edge_cnt.as_parent,
  edge_cnt.as_child
FROM [DATA_VALEO].[50004].AM_ASSET a
INNER JOIN [DATA_VALEO].[50004].AM_CATALOG c
  ON a.CATALOG_ID = c.CATALOG_ID
INNER JOIN [DATA_VALEO].[50004].AM_UN_CLASSIFICATION uc
  ON c.UN_CLASSIFICATION_ID = uc.UN_CLASSIFICATION_ID
INNER JOIN (
  SELECT id, SUM(as_parent) AS as_parent, SUM(as_child) AS as_child,
         SUM(as_parent) + SUM(as_child) AS total_edges
  FROM (
    SELECT PARENT_CI_ID AS id, COUNT(*) AS as_parent, 0 AS as_child
    FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK GROUP BY PARENT_CI_ID
    UNION ALL
    SELECT CHILD_CI_ID AS id, 0, COUNT(*)
    FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK GROUP BY CHILD_CI_ID
  ) x GROUP BY id
) edge_cnt ON edge_cnt.id = a.ASSET_ID
WHERE a.IS_CI = 1
ORDER BY edge_cnt.total_edges DESC;
