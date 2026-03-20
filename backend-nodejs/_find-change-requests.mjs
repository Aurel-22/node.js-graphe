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

// 1. Find tables related to change requests
console.log("=== Tables containing CHANGE, RFC, REQUEST, DEMAND ===");
const tables = await pool.request().query(`
  SELECT TABLE_NAME 
  FROM INFORMATION_SCHEMA.TABLES 
  WHERE TABLE_SCHEMA = '40000' 
    AND (TABLE_NAME LIKE '%CHANGE%' 
      OR TABLE_NAME LIKE '%RFC%' 
      OR TABLE_NAME LIKE '%REQUEST%' 
      OR TABLE_NAME LIKE '%DEMAND%')
  ORDER BY TABLE_NAME
`);
tables.recordset.forEach(t => console.log(" -", t.TABLE_NAME));

// 2. Also search for columns mentioning "change" across all tables
console.log("\n=== Columns containing CHANGE or RFC ===");
const cols = await pool.request().query(`
  SELECT TABLE_NAME, COLUMN_NAME 
  FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = '40000' 
    AND (COLUMN_NAME LIKE '%CHANGE%' OR COLUMN_NAME LIKE '%RFC%')
  ORDER BY TABLE_NAME, COLUMN_NAME
`);
cols.recordset.forEach(c => console.log(` - ${c.TABLE_NAME}.${c.COLUMN_NAME}`));

// 3. Find the ASSET_ID for BDD-SQL-FR (try variants)
console.log("\n=== BDD-SQL-FR asset info ===");
const asset = await pool.request().query(`
  SELECT ASSET_ID, NETWORK_IDENTIFIER, ASSET_TAG 
  FROM [40000].AM_ASSET 
  WHERE NETWORK_IDENTIFIER LIKE '%BDD%SQL%FR%' OR NETWORK_IDENTIFIER LIKE '%BDD-SQL%'
`);
asset.recordset.forEach(a => console.log(` ASSET_ID: ${a.ASSET_ID}, Name: ${a.NETWORK_IDENTIFIER}`));

if (asset.recordset.length > 0) {
  const assetId = asset.recordset[0].ASSET_ID;

  // 4. If there's a change/RFC table, look for records linked to this asset
  for (const t of tables.recordset) {
    try {
      // Check if table has ASSET_ID column
      const hasCols = await pool.request().query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = '40000' AND TABLE_NAME = '${t.TABLE_NAME}'
        AND COLUMN_NAME LIKE '%ASSET%'
      `);
      if (hasCols.recordset.length > 0) {
        const colName = hasCols.recordset[0].COLUMN_NAME;
        const rows = await pool.request().query(`
          SELECT TOP 5 * FROM [40000].[${t.TABLE_NAME}] WHERE [${colName}] = ${assetId}
        `);
        if (rows.recordset.length > 0) {
          console.log(`\n=== ${t.TABLE_NAME} records for BDD-SQL-FR (${colName}=${assetId}) ===`);
          console.log(`Found: ${rows.recordset.length} rows`);
          console.log(JSON.stringify(rows.recordset[0], null, 2));
        }
      }
    } catch (e) {
      // skip
    }
  }

  // 5. Also search in SD_REQUEST (Service Desk) which often links to assets
  console.log("\n=== Searching SD_REQUEST for BDD-SQL-FR ===");
  try {
    const sd = await pool.request().query(`
      SELECT TOP 5 r.RFC_NUMBER, r.REQUEST_ID, r.SUBJECT_FR, r.STATUS_FR, r.CATALOG_REQUEST_FR
      FROM [40000].SD_REQUEST r
      WHERE r.ASSET_ID = ${assetId}
      ORDER BY r.REQUEST_ID DESC
    `);
    if (sd.recordset.length > 0) {
      console.log(`Found ${sd.recordset.length} requests`);
      sd.recordset.forEach(r => console.log(JSON.stringify(r)));
    } else {
      console.log("No SD_REQUEST rows for this asset");
    }
  } catch (e) {
    console.log("SD_REQUEST query failed:", e.message);
    
    // Try to find the right column names
    const sdCols = await pool.request().query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = '40000' AND TABLE_NAME = 'SD_REQUEST'
      AND (COLUMN_NAME LIKE '%ASSET%' OR COLUMN_NAME LIKE '%CI%' OR COLUMN_NAME LIKE '%SUBJECT%' OR COLUMN_NAME LIKE '%RFC%' OR COLUMN_NAME LIKE '%STATUS%' OR COLUMN_NAME LIKE '%CATALOG%' OR COLUMN_NAME LIKE '%TYPE%')
      ORDER BY COLUMN_NAME
    `);
    console.log("SD_REQUEST relevant columns:", sdCols.recordset.map(c => c.COLUMN_NAME));
  }
}

await pool.close();
