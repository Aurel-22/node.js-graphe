-- ============================================================================
-- 04_edge_density_by_category.sql — Densité d'edges par catégorie de CI
-- Pour chaque catégorie, combien de relations impliquent ses CIs
-- Aide à trouver les catégories les plus interconnectées
-- ============================================================================

SELECT TOP 30
  uc.UN_CLASSIFICATION_FR          AS categorie,
  COUNT(DISTINCT a.ASSET_ID)       AS nb_ci,
  COUNT(DISTINCT l.PARENT_CI_ID) + COUNT(DISTINCT l2.CHILD_CI_ID) AS ci_with_edges,
  (SELECT COUNT(*) FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK lx
   WHERE lx.PARENT_CI_ID IN (
     SELECT ax.ASSET_ID FROM [DATA_VALEO].[50004].AM_ASSET ax
     INNER JOIN [DATA_VALEO].[50004].AM_CATALOG cx ON ax.CATALOG_ID = cx.CATALOG_ID
     WHERE cx.UN_CLASSIFICATION_ID = uc.UN_CLASSIFICATION_ID AND ax.IS_CI = 1
   )
  ) AS edges_as_parent
FROM [DATA_VALEO].[50004].AM_ASSET a
INNER JOIN [DATA_VALEO].[50004].AM_CATALOG c
  ON a.CATALOG_ID = c.CATALOG_ID
INNER JOIN [DATA_VALEO].[50004].AM_UN_CLASSIFICATION uc
  ON c.UN_CLASSIFICATION_ID = uc.UN_CLASSIFICATION_ID
LEFT JOIN [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l
  ON l.PARENT_CI_ID = a.ASSET_ID
LEFT JOIN [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l2
  ON l2.CHILD_CI_ID = a.ASSET_ID
WHERE a.IS_CI = 1
GROUP BY uc.UN_CLASSIFICATION_FR, uc.UN_CLASSIFICATION_ID
ORDER BY nb_ci DESC;
