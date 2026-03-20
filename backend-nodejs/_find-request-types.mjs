import sql from "mssql";

const pool = await sql.connect({
  server: "devenv-dev-ded-033-smo.intra.evlabs.net",
  port: 1433,
  user: "sa",
  password: "Easyvista964158Certif",
  database: "devenv_dev_ded_033_EVO_DATA40000",
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 60000,
});

// 1. Find all SD_CATALOG types to understand categories (Service, Incident, Changement)
console.log("=== SD_CATALOG hierarchy (top levels) ===");
const cats = await pool.request().query(`
  SELECT SD_CATALOG_ID, TITLE_FR, LEVEL, PARENT_CATALOG_ID, CODE
  FROM [40000].SD_CATALOG
  WHERE LEVEL <= 2
  ORDER BY LEVEL, TITLE_FR
`);
cats.recordset.forEach(c => console.log(`  L${c.LEVEL} ID=${c.SD_CATALOG_ID} Parent=${c.PARENT_CATALOG_ID} Code=${c.CODE} "${c.TITLE_FR}"`));

// 2. Count requests per top-level catalog category
console.log("\n=== Request counts per catalog title (top 30) ===");
const counts = await pool.request().query(`
  SELECT c.TITLE_FR, COUNT(*) AS cnt
  FROM [40000].SD_REQUEST r
  JOIN [40000].SD_CATALOG c ON c.SD_CATALOG_ID = r.SD_CATALOG_ID
  GROUP BY c.TITLE_FR
  ORDER BY cnt DESC
`);
counts.recordset.forEach(r => console.log(`  ${r.cnt}\t${r.TITLE_FR}`));

// 3. Try grouping by parent catalog 
console.log("\n=== Request counts by parent catalog ===");
const parentCounts = await pool.request().query(`
  SELECT 
    COALESCE(parent.TITLE_FR, c.TITLE_FR) AS category,
    COUNT(*) AS cnt
  FROM [40000].SD_REQUEST r
  JOIN [40000].SD_CATALOG c ON c.SD_CATALOG_ID = r.SD_CATALOG_ID
  LEFT JOIN [40000].SD_CATALOG parent ON parent.SD_CATALOG_ID = c.PARENT_CATALOG_ID
  GROUP BY COALESCE(parent.TITLE_FR, c.TITLE_FR)
  ORDER BY cnt DESC
`);
parentCounts.recordset.forEach(r => console.log(`  ${r.cnt}\t${r.category}`));

// 4. Check if there's a "type" column in SD_REQUEST or a separate type table
console.log("\n=== SD_REQUEST columns with TYPE ===");
const typeCols = await pool.request().query(`
  SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = '40000' AND TABLE_NAME = 'SD_REQUEST'
  AND COLUMN_NAME LIKE '%TYPE%'
`);
typeCols.recordset.forEach(c => console.log("  -", c.COLUMN_NAME));

// 5. Count by RFC prefix (R=Change, I=Incident, S=Service?)
console.log("\n=== Request counts by RFC_NUMBER prefix ===");
const rfcCounts = await pool.request().query(`
  SELECT LEFT(RFC_NUMBER, 1) AS prefix, COUNT(*) AS cnt
  FROM [40000].SD_REQUEST
  WHERE RFC_NUMBER IS NOT NULL
  GROUP BY LEFT(RFC_NUMBER, 1)
  ORDER BY cnt DESC
`);
rfcCounts.recordset.forEach(r => console.log(`  ${r.prefix}: ${r.cnt}`));

await pool.close();
