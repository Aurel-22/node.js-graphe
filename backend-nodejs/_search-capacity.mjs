import sql from "mssql";
import dotenv from "dotenv";
dotenv.config();

const DB = "devenv_dev_ded_033_EVO_DATA40000";
const SCHEMA = "40000";

const config = {
  server: process.env.MSSQL_HOST,
  port: parseInt(process.env.MSSQL_PORT),
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  database: DB,
  options: { encrypt: false, trustServerCertificate: true },
  connectionTimeout: 15000,
  requestTimeout: 60000,
};

const pool = await sql.connect(config);

// 1. Search for tables with capacity/exceeded-related names
const tables = await pool.request().query(`
  SELECT TABLE_SCHEMA, TABLE_NAME 
  FROM INFORMATION_SCHEMA.TABLES 
  WHERE TABLE_NAME LIKE '%CAPACI%' 
     OR TABLE_NAME LIKE '%EXCEED%' 
     OR TABLE_NAME LIKE '%CAPACITY%' 
     OR TABLE_NAME LIKE '%THRESHOLD%' 
     OR TABLE_NAME LIKE '%LIMIT%' 
     OR TABLE_NAME LIKE '%ALERT%' 
     OR TABLE_NAME LIKE '%WARNING%' 
     OR TABLE_NAME LIKE '%OVERLOAD%'
     OR TABLE_NAME LIKE '%SATUR%'
  ORDER BY TABLE_NAME
`);
console.log("=== Tables matching capacity/exceeded keywords ===");
console.log(JSON.stringify(tables.recordset, null, 2));

// 2. Structure of AM_ASSET_CHARACTERISTICS
const acCols = await pool.request().query(`
  SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
  FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = '50004' AND TABLE_NAME = 'AM_ASSET_CHARACTERISTICS'
  ORDER BY ORDINAL_POSITION
`);
console.log("\n=== AM_ASSET_CHARACTERISTICS columns ===");
console.log(JSON.stringify(acCols.recordset, null, 2));

// 3. Structure of AM_CHARACTERISTICS
const charCols = await pool.request().query(`
  SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
  FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = '50004' AND TABLE_NAME = 'AM_CHARACTERISTICS'
  ORDER BY ORDINAL_POSITION
`);
console.log("\n=== AM_CHARACTERISTICS columns ===");
console.log(JSON.stringify(charCols.recordset, null, 2));

// 4. Structure of METRIC_ALERT
const maCols = await pool.request().query(`
  SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
  FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = '50004' AND TABLE_NAME = 'METRIC_ALERT'
  ORDER BY ORDINAL_POSITION
`);
console.log("\n=== METRIC_ALERT columns ===");
console.log(JSON.stringify(maCols.recordset, null, 2));

// 5. All records in AM_ASSET_CHARACTERISTICS
const acTotal = await pool.request().query(`
  SELECT COUNT(*) as total FROM [50004].AM_ASSET_CHARACTERISTICS
`);
console.log("\n=== Total rows in AM_ASSET_CHARACTERISTICS ===");
console.log(JSON.stringify(acTotal.recordset, null, 2));

// 5b. All characteristics marked as IS_CAPACITY
const capChars = await pool.request().query(`
  SELECT CHARACTERISTIC_ID, CHARACTERISTIC_FR, CHARACTERISTIC_EN, IS_CAPACITY, MEASURE_UNIT_ID
  FROM [50004].AM_CHARACTERISTICS
  WHERE IS_CAPACITY = 1
`);
console.log("\n=== Characteristics marked as IS_CAPACITY ===");
console.log(JSON.stringify(capChars.recordset, null, 2));

// 5c. Any AM_ASSET_CHARACTERISTICS with non-null values
const acNonNull = await pool.request().query(`
  SELECT TOP 20 * FROM [50004].AM_ASSET_CHARACTERISTICS
  WHERE CAPACITY_VALUE IS NOT NULL OR MAX_TARGET IS NOT NULL OR DATA_1 IS NOT NULL
`);
console.log("\n=== AM_ASSET_CHARACTERISTICS with any non-null data ===");
console.log(JSON.stringify(acNonNull.recordset, null, 2));

// 6. Search ALL tables for columns containing "capacity" or "exceeded" in their DATA
// Check if any table name contains something related to CI status or monitoring
const allTables = await pool.request().query(`
  SELECT TABLE_SCHEMA, TABLE_NAME 
  FROM INFORMATION_SCHEMA.TABLES 
  WHERE TABLE_SCHEMA = '50004'
    AND (TABLE_NAME LIKE '%CMDB%' OR TABLE_NAME LIKE '%CI_%' OR TABLE_NAME LIKE '%MONITOR%' OR TABLE_NAME LIKE '%METRIC%' OR TABLE_NAME LIKE '%PERF%')
  ORDER BY TABLE_NAME
`);
console.log("\n=== CMDB/CI/Monitoring related tables ===");
console.log(JSON.stringify(allTables.recordset, null, 2));

// 7. METRIC_ALERT - look for capacity-related alerts
const maAll = await pool.request().query(`
  SELECT METRIC_ALERT_ID, NAME_FR, NAME_EN, [CONDITION], ALERT_COLOR
  FROM [50004].METRIC_ALERT
  WHERE NAME_FR LIKE '%capaci%' OR NAME_EN LIKE '%capaci%' 
     OR NAME_FR LIKE '%exceed%' OR NAME_EN LIKE '%exceed%'
     OR NAME_FR LIKE '%dépass%' OR NAME_FR LIKE '%satur%'
`);
console.log("\n=== METRIC_ALERT about capacity ===");
console.log(JSON.stringify(maAll.recordset, null, 2));

// 8. AM_LICENSE_REPORTING columns and sample
const lrCols = await pool.request().query(`
  SELECT COLUMN_NAME, DATA_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'AM_LICENSE_REPORTING' AND TABLE_SCHEMA = '50004'
`);
console.log("\n=== AM_LICENSE_REPORTING columns ===");
console.log(JSON.stringify(lrCols.recordset, null, 2));

const lrSample = await pool.request().query(`
  SELECT TOP 5 * FROM [50004].AM_LICENSE_REPORTING
`);
console.log("\n=== AM_LICENSE_REPORTING sample ===");
console.log(JSON.stringify(lrSample.recordset, null, 2));

// 9. V_STAT_LICENSE columns and sample
const slCols = await pool.request().query(`
  SELECT COLUMN_NAME, DATA_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'V_STAT_LICENSE' AND TABLE_SCHEMA = '50004'
`);
console.log("\n=== V_STAT_LICENSE columns ===");
console.log(JSON.stringify(slCols.recordset, null, 2));

const slSample = await pool.request().query(`
  SELECT TOP 5 * FROM [50004].V_STAT_LICENSE
`);
console.log("\n=== V_STAT_LICENSE sample ===");
console.log(JSON.stringify(slSample.recordset, null, 2));

// 10. V_AM_ASSET_CONSUMPTION columns and sample 
const acCons = await pool.request().query(`
  SELECT COLUMN_NAME, DATA_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'V_AM_ASSET_CONSUMPTION' AND TABLE_SCHEMA = '50004'
`);
console.log("\n=== V_AM_ASSET_CONSUMPTION columns ===");
console.log(JSON.stringify(acCons.recordset, null, 2));

const acConsSample = await pool.request().query(`
  SELECT TOP 5 * FROM [50004].V_AM_ASSET_CONSUMPTION
`);
console.log("\n=== V_AM_ASSET_CONSUMPTION sample ===");
console.log(JSON.stringify(acConsSample.recordset, null, 2));

// 11. V_STOCK_CONSUMABLE
const scSample = await pool.request().query(`
  SELECT TOP 5 * FROM [50004].V_STOCK_CONSUMABLE
`);
console.log("\n=== V_STOCK_CONSUMABLE sample ===");
console.log(JSON.stringify(scSample.recordset, null, 2));

// 12. V_LICENSE_REPORTING_ASSET sample
const lraSample = await pool.request().query(`
  SELECT TOP 3 * FROM [50004].V_LICENSE_REPORTING_ASSET
`);
console.log("\n=== V_LICENSE_REPORTING_ASSET sample ===");
console.log(JSON.stringify(lraSample.recordset, null, 2));

await pool.close();
