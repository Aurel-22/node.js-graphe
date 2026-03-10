-- ============================================================================
-- 12_blocking_relations.sql — Relations bloquantes (impact critique)
-- Les relations BLOCKING=1 forment un sous-graphe de dépendances critiques
-- ============================================================================

-- A. Combien de relations bloquantes ?
SELECT
  COUNT(*)                                                     AS total_blocking,
  COUNT(DISTINCT l.PARENT_CI_ID)                               AS distinct_parents,
  COUNT(DISTINCT l.CHILD_CI_ID)                                AS distinct_children,
  COUNT(DISTINCT l.PARENT_CI_ID) + COUNT(DISTINCT l.CHILD_CI_ID) AS approx_nodes
FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l
WHERE l.BLOCKING = 1;

-- B. Distribution des types de relations bloquantes
SELECT
  r.REFERENCE_FR          AS relation_type,
  COUNT(*)                AS nb_blocking
FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l
LEFT JOIN [DATA_VALEO].[50004].AM_REFERENCE r
  ON r.REFERENCE_ID = l.RELATION_TYPE_ID
WHERE l.BLOCKING = 1
GROUP BY r.REFERENCE_FR
ORDER BY nb_blocking DESC;

-- C. Top 20 CIs les plus impactants (parents bloquants)
SELECT TOP 20
  a.ASSET_ID,
  a.NETWORK_IDENTIFIER     AS nom,
  uc.UN_CLASSIFICATION_FR  AS categorie,
  COUNT(*)                 AS nb_children_blocked
FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l
INNER JOIN [DATA_VALEO].[50004].AM_ASSET a ON l.PARENT_CI_ID = a.ASSET_ID
INNER JOIN [DATA_VALEO].[50004].AM_CATALOG c ON a.CATALOG_ID = c.CATALOG_ID
INNER JOIN [DATA_VALEO].[50004].AM_UN_CLASSIFICATION uc
  ON c.UN_CLASSIFICATION_ID = uc.UN_CLASSIFICATION_ID
WHERE l.BLOCKING = 1 AND a.IS_CI = 1
GROUP BY a.ASSET_ID, a.NETWORK_IDENTIFIER, uc.UN_CLASSIFICATION_FR
ORDER BY nb_children_blocked DESC;
