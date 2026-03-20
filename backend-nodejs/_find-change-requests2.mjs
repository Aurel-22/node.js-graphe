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

// 1. SD_CATALOG columns
const catCols = await pool.request().query(`
  SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = '40000' AND TABLE_NAME = 'SD_CATALOG'
  ORDER BY ORDINAL_POSITION
`);
console.log("SD_CATALOG columns:", catCols.recordset.map(c => c.COLUMN_NAME).join(", "));

// 2. SD_STATUS columns  
const stCols = await pool.request().query(`
  SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = '40000' AND TABLE_NAME = 'SD_STATUS'
  ORDER BY ORDINAL_POSITION
`);
console.log("SD_STATUS columns:", stCols.recordset.map(c => c.COLUMN_NAME).join(", "));

// 3. Get SD_REQUEST for BDD-SQL-FR (CI_ID=18782)
const requests = await pool.request().query(`
  SELECT r.REQUEST_ID, r.RFC_NUMBER, r.SUBMIT_DATE_UT,
    s.STATUS_FR, r.STATUS_ID, r.SD_CATALOG_ID,
    r.DESCRIPTION, r.RISK_DESCRIPTION, r.REQUIRED_DOWNTIME,
    r.REQUESTED_CHANGE_DATE_START, r.REQUESTED_CHANGE_DATE_END,
    r.PLANNED_CHANGE_DATE_START, r.PLANNED_CHANGE_DATE_END,
    r.CHANGE_OUTCOME, r.IMPACT_ID
  FROM [40000].SD_REQUEST r
  LEFT JOIN [40000].SD_STATUS s ON s.STATUS_ID = r.STATUS_ID
  WHERE r.CI_ID = 18782
  ORDER BY r.REQUEST_ID
`);
console.log("\nSD_REQUEST for BDD-SQL-FR:", requests.recordset.length, "rows");
requests.recordset.forEach(r => console.log(JSON.stringify(r, null, 2)));

// 4. Also check V_SD_REQUEST_CI for all requests linked to this CI
const vci = await pool.request().query(`
  SELECT v.request_id, r.RFC_NUMBER, r.SD_CATALOG_ID, r.STATUS_ID,
    s.STATUS_FR
  FROM [40000].V_SD_REQUEST_CI v
  JOIN [40000].SD_REQUEST r ON r.REQUEST_ID = v.request_id
  LEFT JOIN [40000].SD_STATUS s ON s.STATUS_ID = r.STATUS_ID
  WHERE v.asset_id = 18782
`);
console.log("\nV_SD_REQUEST_CI for BDD-SQL-FR:", vci.recordset.length, "rows");
vci.recordset.forEach(r => console.log(JSON.stringify(r)));

// 5. What is SD_CATALOG_ID for "Demande de changement"?
const catalogs = await pool.request().query(`
  SELECT TOP 20 SD_CATALOG_ID, TITLE_FR, SD_CATALOG_TYPE_ID
  FROM [40000].SD_CATALOG
  WHERE TITLE_FR LIKE '%change%' OR TITLE_FR LIKE '%demande%'
  ORDER BY SD_CATALOG_ID
`);
console.log("\nSD_CATALOG entries with change/demande:", catalogs.recordset.length);
catalogs.recordset.forEach(c => console.log(` ID=${c.SD_CATALOG_ID} Type=${c.SD_CATALOG_TYPE_ID} Title="${c.TITLE_FR}"`));

await pool.close();
