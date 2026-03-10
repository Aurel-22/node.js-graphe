-- ============================================================================
-- 03_relation_types.sql — Distribution des types de relations
-- Montre quels types de liens sont les plus fréquents
-- ============================================================================

SELECT TOP 30
  r.REFERENCE_FR                   AS relation_type,
  l.RELATION_TYPE_ID,
  COUNT(*)                         AS nb_links,
  SUM(CASE WHEN l.BLOCKING = 1 THEN 1 ELSE 0 END) AS nb_blocking
FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l
LEFT JOIN [DATA_VALEO].[50004].AM_REFERENCE r
  ON r.REFERENCE_ID = l.RELATION_TYPE_ID
GROUP BY r.REFERENCE_FR, l.RELATION_TYPE_ID
ORDER BY nb_links DESC;
