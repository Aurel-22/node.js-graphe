-- ============================================================================
-- 07_subgraph_by_location.sql — Densité de graphe par localisation
-- Combien de CIs et relations par site/localisation
-- ============================================================================

SELECT TOP 30
  loc.LOCATION_FR                  AS localisation,
  loc.LOCATION_ID,
  COUNT(DISTINCT a.ASSET_ID)       AS nb_ci,
  (
    SELECT COUNT(*) 
    FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l
    WHERE l.PARENT_CI_ID IN (
      SELECT ax.ASSET_ID FROM [DATA_VALEO].[50004].AM_ASSET ax 
      WHERE ax.LOCATION_ID = loc.LOCATION_ID AND ax.IS_CI = 1
    )
    AND l.CHILD_CI_ID IN (
      SELECT ax.ASSET_ID FROM [DATA_VALEO].[50004].AM_ASSET ax 
      WHERE ax.LOCATION_ID = loc.LOCATION_ID AND ax.IS_CI = 1
    )
  ) AS edges_internes
FROM [DATA_VALEO].[50004].AM_ASSET a
INNER JOIN [DATA_VALEO].[50004].AM_LOCATION loc
  ON a.LOCATION_ID = loc.LOCATION_ID
WHERE a.IS_CI = 1
GROUP BY loc.LOCATION_FR, loc.LOCATION_ID
HAVING COUNT(DISTINCT a.ASSET_ID) >= 100
ORDER BY nb_ci DESC;
