-- ============================================================================
-- 06_subgraph_by_category_pair.sql — Densité des liens ENTRE catégories
-- Montre quelles paires de catégories sont les plus connectées
-- Permet de trouver les sous-graphes les plus denses naturellement
-- ============================================================================

SELECT TOP 40
  uc_parent.UN_CLASSIFICATION_FR   AS cat_parent,
  uc_child.UN_CLASSIFICATION_FR    AS cat_child,
  COUNT(*)                         AS nb_links
FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l
INNER JOIN [DATA_VALEO].[50004].AM_ASSET ap ON l.PARENT_CI_ID = ap.ASSET_ID
INNER JOIN [DATA_VALEO].[50004].AM_CATALOG cp ON ap.CATALOG_ID = cp.CATALOG_ID
INNER JOIN [DATA_VALEO].[50004].AM_UN_CLASSIFICATION uc_parent 
  ON cp.UN_CLASSIFICATION_ID = uc_parent.UN_CLASSIFICATION_ID
INNER JOIN [DATA_VALEO].[50004].AM_ASSET ac ON l.CHILD_CI_ID = ac.ASSET_ID
INNER JOIN [DATA_VALEO].[50004].AM_CATALOG cc ON ac.CATALOG_ID = cc.CATALOG_ID
INNER JOIN [DATA_VALEO].[50004].AM_UN_CLASSIFICATION uc_child 
  ON cc.UN_CLASSIFICATION_ID = uc_child.UN_CLASSIFICATION_ID
WHERE ap.IS_CI = 1 AND ac.IS_CI = 1
GROUP BY uc_parent.UN_CLASSIFICATION_FR, uc_child.UN_CLASSIFICATION_FR
ORDER BY nb_links DESC;
