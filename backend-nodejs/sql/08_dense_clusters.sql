-- ============================================================================
-- 08_dense_clusters.sql — Recherche de clusters denses
-- Cherche des groupes de CIs fortement interconnectés
-- Stratégie : partir des nœuds les plus connectés et compter les edges
--             entre leurs voisins directs
-- ============================================================================

-- A. CIs connectés au top-10 hub → combien de nœuds et edges dans leur voisinage ?
WITH top_hubs AS (
  SELECT TOP 10 id, edge_count
  FROM (
    SELECT id, SUM(c) AS edge_count FROM (
      SELECT PARENT_CI_ID AS id, COUNT(*) AS c
      FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK GROUP BY PARENT_CI_ID
      UNION ALL
      SELECT CHILD_CI_ID AS id, COUNT(*) AS c
      FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK GROUP BY CHILD_CI_ID
    ) x GROUP BY id
  ) ranked
  ORDER BY edge_count DESC
),
neighbors AS (
  SELECT DISTINCT neighbor_id
  FROM (
    SELECT l.CHILD_CI_ID AS neighbor_id
    FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l
    WHERE l.PARENT_CI_ID IN (SELECT id FROM top_hubs)
    UNION
    SELECT l.PARENT_CI_ID
    FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l
    WHERE l.CHILD_CI_ID IN (SELECT id FROM top_hubs)
    UNION
    SELECT id FROM top_hubs
  ) combined
)
SELECT
  (SELECT COUNT(*) FROM neighbors)    AS total_nodes_in_cluster,
  COUNT(*)                            AS edges_in_cluster
FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l
WHERE l.PARENT_CI_ID IN (SELECT neighbor_id FROM neighbors)
  AND l.CHILD_CI_ID IN (SELECT neighbor_id FROM neighbors);
