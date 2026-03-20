import sql from "mssql";
import dotenv from "dotenv";
dotenv.config();

const pool = await sql.connect({
  server: process.env.MSSQL_HOST,
  port: parseInt(process.env.MSSQL_PORT),
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  database: "devenv_dev_ded_033_EVO_DATA40000",
  options: { encrypt: false, trustServerCertificate: true },
  connectionTimeout: 15000,
  requestTimeout: 60000,
});

const S = "40000";

// 1. Total rows in AM_ASSET_CHARACTERISTICS in EVO_DATA
const total = await pool.request().query(`
  SELECT COUNT(*) as total FROM [${S}].AM_ASSET_CHARACTERISTICS
`);
console.log("=== EVO_DATA (40000) - Total AM_ASSET_CHARACTERISTICS rows ===");
console.log(total.recordset[0].total);

// 2. All capacity characteristics defined
const chars = await pool.request().query(`
  SELECT CHARACTERISTIC_ID, CHARACTERISTIC_FR, CHARACTERISTIC_EN, IS_CAPACITY
  FROM [${S}].AM_CHARACTERISTICS
  WHERE IS_CAPACITY = 1
`);
console.log("\n=== Capacity characteristics defined ===");
console.log(JSON.stringify(chars.recordset, null, 2));

// 3. All assets that have capacity data WITH exceeded status
const exceeded = await pool.request().query(`
  SELECT 
    a.ASSET_ID, a.NETWORK_IDENTIFIER, a.ASSET_TAG,
    ch.CHARACTERISTIC_FR,
    ac.CAPACITY_VALUE, ac.MIN_TARGET, ac.MAX_TARGET,
    CASE WHEN ac.CAPACITY_VALUE > ac.MAX_TARGET THEN 'EXCEEDED' ELSE 'OK' END AS status
  FROM [${S}].AM_ASSET_CHARACTERISTICS ac
  JOIN [${S}].AM_CHARACTERISTICS ch ON ac.CHARACTERISTIC_ID = ch.CHARACTERISTIC_ID
  JOIN [${S}].AM_ASSET a ON a.ASSET_ID = ac.ASSET_ID
  WHERE ch.IS_CAPACITY = 1 AND ac.CAPACITY_VALUE IS NOT NULL
  ORDER BY a.NETWORK_IDENTIFIER, ch.CHARACTERISTIC_FR
`);
console.log("\n=== ALL assets with capacity data ===");
console.log(`${exceeded.recordset.length} records`);
console.log(JSON.stringify(exceeded.recordset, null, 2));

// 4. Summary: which assets have exceeded capacity
const exceededOnly = exceeded.recordset.filter(r => r.status === 'EXCEEDED');
console.log(`\n=== EXCEEDED capacity: ${exceededOnly.length} records ===`);
console.log(JSON.stringify(exceededOnly, null, 2));

// 5. Now check DATA_VALEO too
const pool2 = await sql.connect({
  server: process.env.MSSQL_HOST,
  port: parseInt(process.env.MSSQL_PORT),
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  database: "DATA_VALEO",
  options: { encrypt: false, trustServerCertificate: true },
  connectionTimeout: 15000,
  requestTimeout: 60000,
});

const total2 = await pool2.request().query(`
  SELECT COUNT(*) as total FROM [50004].AM_ASSET_CHARACTERISTICS
`);
console.log("\n=== DATA_VALEO (50004) - Total AM_ASSET_CHARACTERISTICS rows ===");
console.log(total2.recordset[0].total);

const chars2 = await pool2.request().query(`
  SELECT CHARACTERISTIC_ID, CHARACTERISTIC_FR, IS_CAPACITY
  FROM [50004].AM_CHARACTERISTICS WHERE IS_CAPACITY = 1
`);
console.log("\n=== DATA_VALEO - IS_CAPACITY characteristics ===");
console.log(JSON.stringify(chars2.recordset, null, 2));

await pool.close();
await pool2.close();
