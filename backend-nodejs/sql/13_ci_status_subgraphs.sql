-- ============================================================================
-- 13_ci_status_subgraphs.sql — Sous-graphes par statut CI
-- Filtre par CI_STATUS pour trouver des graphes de CIs actifs vs retired
-- ============================================================================

-- A. Edges entre CIs de même statut
SELECT
  cs_p.CI_STATUS_FR               AS statut_parent,
  cs_c.CI_STATUS_FR               AS statut_child,
  COUNT(*)                        AS nb_links
FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l
INNER JOIN [DATA_VALEO].[50004].AM_ASSET ap ON l.PARENT_CI_ID = ap.ASSET_ID
LEFT JOIN [DATA_VALEO].[50004].CMDB_CI_STATUS cs_p ON ap.CI_STATUS_ID = cs_p.CI_STATUS_ID
INNER JOIN [DATA_VALEO].[50004].AM_ASSET ac ON l.CHILD_CI_ID = ac.ASSET_ID
LEFT JOIN [DATA_VALEO].[50004].CMDB_CI_STATUS cs_c ON ac.CI_STATUS_ID = cs_c.CI_STATUS_ID
WHERE ap.IS_CI = 1 AND ac.IS_CI = 1
GROUP BY cs_p.CI_STATUS_FR, cs_c.CI_STATUS_FR
ORDER BY nb_links DESC;

-- B. Simulation : graphe des CIs avec statut "Deployed" uniquement
SELECT
  (SELECT COUNT(DISTINCT a.ASSET_ID) 
   FROM [DATA_VALEO].[50004].AM_ASSET a
   INNER JOIN [DATA_VALEO].[50004].CMDB_CI_STATUS cs ON a.CI_STATUS_ID = cs.CI_STATUS_ID
   WHERE a.IS_CI = 1 AND cs.CI_STATUS_FR LIKE '%deploy%'
  ) AS nb_deployed_ci,
  COUNT(*) AS edges_between_deployed
FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l
WHERE EXISTS (
  SELECT 1 FROM [DATA_VALEO].[50004].AM_ASSET a
  INNER JOIN [DATA_VALEO].[50004].CMDB_CI_STATUS cs ON a.CI_STATUS_ID = cs.CI_STATUS_ID
  WHERE a.ASSET_ID = l.PARENT_CI_ID AND a.IS_CI = 1 AND cs.CI_STATUS_FR LIKE '%deploy%'
)
AND EXISTS (
  SELECT 1 FROM [DATA_VALEO].[50004].AM_ASSET a
  INNER JOIN [DATA_VALEO].[50004].CMDB_CI_STATUS cs ON a.CI_STATUS_ID = cs.CI_STATUS_ID
  WHERE a.ASSET_ID = l.CHILD_CI_ID AND a.IS_CI = 1 AND cs.CI_STATUS_FR LIKE '%deploy%'
);
