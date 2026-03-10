-- ============================================================================
-- 15_bfs_from_hub.sql — BFS depuis un hub : nœuds atteignables par profondeur
-- Simule un parcours en largeur depuis les nœuds les plus connectés
-- Utile pour mesurer la taille du composant connexe
-- ============================================================================

-- Profondeur 1, 2, 3 depuis le CI le plus connecté
DECLARE @hub_id INT;
SELECT TOP 1 @hub_id = id
FROM (
  SELECT id, SUM(c) AS edge_count FROM (
    SELECT PARENT_CI_ID AS id, COUNT(*) AS c
    FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK GROUP BY PARENT_CI_ID
    UNION ALL
    SELECT CHILD_CI_ID AS id, COUNT(*) AS c
    FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK GROUP BY CHILD_CI_ID
  ) x GROUP BY id
) ranked ORDER BY edge_count DESC;

-- Profondeur 1 : voisins directs
WITH depth1 AS (
  SELECT DISTINCT neighbor_id FROM (
    SELECT CHILD_CI_ID AS neighbor_id
    FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK WHERE PARENT_CI_ID = @hub_id
    UNION
    SELECT PARENT_CI_ID
    FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK WHERE CHILD_CI_ID = @hub_id
  ) x
)
SELECT 
  @hub_id AS hub_id,
  (SELECT a.NETWORK_IDENTIFIER FROM [DATA_VALEO].[50004].AM_ASSET a WHERE a.ASSET_ID = @hub_id) AS hub_name,
  1 AS depth,
  (SELECT COUNT(*) FROM depth1) AS reachable_nodes,
  (SELECT COUNT(*) FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l
   WHERE (l.PARENT_CI_ID = @hub_id OR l.PARENT_CI_ID IN (SELECT neighbor_id FROM depth1))
     AND (l.CHILD_CI_ID = @hub_id OR l.CHILD_CI_ID IN (SELECT neighbor_id FROM depth1))
  ) AS edges_in_subgraph;
