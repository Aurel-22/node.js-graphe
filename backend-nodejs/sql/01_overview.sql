-- ============================================================================
-- 01_overview.sql — Vue d'ensemble DATA_VALEO
-- Comptages globaux : CIs, relations, catégories, localisations
-- ============================================================================

-- 1. Comptages globaux
SELECT
  (SELECT COUNT(*) FROM [DATA_VALEO].[50004].AM_ASSET)                           AS total_assets,
  (SELECT COUNT(*) FROM [DATA_VALEO].[50004].AM_ASSET WHERE IS_CI = 1)           AS total_ci,
  (SELECT COUNT(*) FROM [DATA_VALEO].[50004].AM_ASSET WHERE IS_CI = 1 AND IS_SERVICE = 1) AS ci_services,
  (SELECT COUNT(*) FROM [DATA_VALEO].[50004].AM_ASSET WHERE IS_CI = 1 AND IS_SERVICE = 0) AS ci_non_services,
  (SELECT COUNT(*) FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK)            AS total_links,
  (SELECT COUNT(*) FROM [DATA_VALEO].[50004].AM_LOCATION)                        AS total_locations,
  (SELECT COUNT(*) FROM [DATA_VALEO].[50004].AM_CATALOG)                         AS total_catalogs,
  (SELECT COUNT(*) FROM [DATA_VALEO].[50004].AM_UN_CLASSIFICATION)               AS total_classifications;
