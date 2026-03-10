-- ============================================================================
-- 14_service_dependency_graph.sql — Graphe des dépendances de services
-- IS_SERVICE=1 : focus sur les services métier et leurs interconnexions
-- ============================================================================

-- A. Vue d'ensemble des services
SELECT
  (SELECT COUNT(*) FROM [DATA_VALEO].[50004].AM_ASSET WHERE IS_CI = 1 AND IS_SERVICE = 1) AS nb_services,
  COUNT(*) AS edges_service_to_service
FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l
WHERE EXISTS (SELECT 1 FROM [DATA_VALEO].[50004].AM_ASSET a WHERE a.ASSET_ID = l.PARENT_CI_ID AND a.IS_CI = 1 AND a.IS_SERVICE = 1)
  AND EXISTS (SELECT 1 FROM [DATA_VALEO].[50004].AM_ASSET a WHERE a.ASSET_ID = l.CHILD_CI_ID AND a.IS_CI = 1 AND a.IS_SERVICE = 1);

-- B. Services → leur infra (service parent, CI non-service child)
SELECT
  COUNT(*) AS edges_service_to_infra,
  COUNT(DISTINCT l.PARENT_CI_ID) AS distinct_services,
  COUNT(DISTINCT l.CHILD_CI_ID) AS distinct_infra
FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l
WHERE EXISTS (SELECT 1 FROM [DATA_VALEO].[50004].AM_ASSET a WHERE a.ASSET_ID = l.PARENT_CI_ID AND a.IS_CI = 1 AND a.IS_SERVICE = 1)
  AND EXISTS (SELECT 1 FROM [DATA_VALEO].[50004].AM_ASSET a WHERE a.ASSET_ID = l.CHILD_CI_ID AND a.IS_CI = 1 AND a.IS_SERVICE = 0);

-- C. Top 20 services les plus connectés (entrantes + sortantes)
SELECT TOP 20
  a.ASSET_ID,
  a.NETWORK_IDENTIFIER AS nom,
  uc.UN_CLASSIFICATION_FR AS categorie,
  edge_cnt.total_edges,
  edge_cnt.as_parent,
  edge_cnt.as_child
FROM [DATA_VALEO].[50004].AM_ASSET a
INNER JOIN [DATA_VALEO].[50004].AM_CATALOG c ON a.CATALOG_ID = c.CATALOG_ID
INNER JOIN [DATA_VALEO].[50004].AM_UN_CLASSIFICATION uc 
  ON c.UN_CLASSIFICATION_ID = uc.UN_CLASSIFICATION_ID
INNER JOIN (
  SELECT id, SUM(p) AS as_parent, SUM(ch) AS as_child, SUM(p)+SUM(ch) AS total_edges FROM (
    SELECT PARENT_CI_ID AS id, COUNT(*) AS p, 0 AS ch
    FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK GROUP BY PARENT_CI_ID
    UNION ALL
    SELECT CHILD_CI_ID, 0, COUNT(*)
    FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK GROUP BY CHILD_CI_ID
  ) x GROUP BY id
) edge_cnt ON edge_cnt.id = a.ASSET_ID
WHERE a.IS_CI = 1 AND a.IS_SERVICE = 1
ORDER BY edge_cnt.total_edges DESC;
