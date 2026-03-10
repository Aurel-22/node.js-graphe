-- ============================================================================
-- 02_categories.sql — Distribution des CIs par catégorie (UN_CLASSIFICATION)
-- Montre quelles catégories ont le plus de CIs IS_CI=1
-- ============================================================================

SELECT TOP 40
  uc.UN_CLASSIFICATION_FR          AS categorie,
  COUNT(*)                         AS nb_ci,
  SUM(CASE WHEN a.IS_SERVICE = 1 THEN 1 ELSE 0 END)  AS nb_services,
  SUM(CASE WHEN a.IS_SERVICE = 0 THEN 1 ELSE 0 END)  AS nb_non_services
FROM [DATA_VALEO].[50004].AM_ASSET a
INNER JOIN [DATA_VALEO].[50004].AM_CATALOG c
  ON a.CATALOG_ID = c.CATALOG_ID
INNER JOIN [DATA_VALEO].[50004].AM_UN_CLASSIFICATION uc
  ON c.UN_CLASSIFICATION_ID = uc.UN_CLASSIFICATION_ID
WHERE a.IS_CI = 1
GROUP BY uc.UN_CLASSIFICATION_FR
ORDER BY nb_ci DESC;
