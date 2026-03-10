-- ============================================================================
-- 11_subgraph_simulations.sql — Simulations de sous-graphes avec filtres
-- Pour chaque combinaison de filtres, estime le nombre de nœuds et edges
-- ============================================================================

-- A. Top N CIs les plus connectés → combien d'edges INTERNES ?
-- Simulation pour N = 100, 500, 1000, 2000, 5000, 10000
WITH ranked_ci AS (
  SELECT id, edge_count,
    ROW_NUMBER() OVER (ORDER BY edge_count DESC) AS rn
  FROM (
    SELECT id, SUM(c) AS edge_count FROM (
      SELECT PARENT_CI_ID AS id, COUNT(*) AS c
      FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK GROUP BY PARENT_CI_ID
      UNION ALL
      SELECT CHILD_CI_ID AS id, COUNT(*) AS c
      FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK GROUP BY CHILD_CI_ID
    ) x GROUP BY id
  ) ranked
)
SELECT
  100 AS top_n,
  (SELECT COUNT(*) FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l
   WHERE l.PARENT_CI_ID IN (SELECT id FROM ranked_ci WHERE rn <= 100)
     AND l.CHILD_CI_ID IN (SELECT id FROM ranked_ci WHERE rn <= 100)) AS internal_edges

UNION ALL SELECT
  500,
  (SELECT COUNT(*) FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l
   WHERE l.PARENT_CI_ID IN (SELECT id FROM ranked_ci WHERE rn <= 500)
     AND l.CHILD_CI_ID IN (SELECT id FROM ranked_ci WHERE rn <= 500))

UNION ALL SELECT
  1000,
  (SELECT COUNT(*) FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l
   WHERE l.PARENT_CI_ID IN (SELECT id FROM ranked_ci WHERE rn <= 1000)
     AND l.CHILD_CI_ID IN (SELECT id FROM ranked_ci WHERE rn <= 1000))

UNION ALL SELECT
  2000,
  (SELECT COUNT(*) FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l
   WHERE l.PARENT_CI_ID IN (SELECT id FROM ranked_ci WHERE rn <= 2000)
     AND l.CHILD_CI_ID IN (SELECT id FROM ranked_ci WHERE rn <= 2000))

UNION ALL SELECT
  5000,
  (SELECT COUNT(*) FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l
   WHERE l.PARENT_CI_ID IN (SELECT id FROM ranked_ci WHERE rn <= 5000)
     AND l.CHILD_CI_ID IN (SELECT id FROM ranked_ci WHERE rn <= 5000))

UNION ALL SELECT
  10000,
  (SELECT COUNT(*) FROM [DATA_VALEO].[50004].CONFIGURATION_ITEM_LINK l
   WHERE l.PARENT_CI_ID IN (SELECT id FROM ranked_ci WHERE rn <= 10000)
     AND l.CHILD_CI_ID IN (SELECT id FROM ranked_ci WHERE rn <= 10000))

ORDER BY top_n;
