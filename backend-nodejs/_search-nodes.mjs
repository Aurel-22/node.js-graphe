import sql from "mssql";
import dotenv from "dotenv";
dotenv.config();

const DB = "devenv_dev_ded_033_EVO_DATA40000";
const S = "40000";

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
const NODES = ['AV-FR', 'SRV_15-F', 'SRV_WEB-F', 'SRV-12-F', 'SRV_14-F'];
const namesList = NODES.map(n => `'${n}'`).join(',');

// 1. Find these assets in AM_ASSET
const assets = await pool.request().query(`
  SELECT a.ASSET_ID, a.NETWORK_IDENTIFIER, a.ASSET_TAG, a.CI_VERSION, a.IS_SERVICE, a.IS_CI,
    a.CI_STATUS_ID, a.CATALOG_ID, a.E_COST, a.REMOVED_DATE,
    cs.CI_STATUS_FR, cs.CI_STATUS_EN
  FROM [${S}].AM_ASSET a
  LEFT JOIN [${S}].CMDB_CI_STATUS cs ON a.CI_STATUS_ID = cs.CI_STATUS_ID
  WHERE a.NETWORK_IDENTIFIER IN (${namesList})
`);
console.log("=== Assets found ===");
console.log(JSON.stringify(assets.recordset, null, 2));

if (assets.recordset.length === 0) {
  // Try LIKE search
  console.log("\nExact match failed, trying LIKE search...");
  for (const name of NODES) {
    const like = await pool.request().query(`
      SELECT TOP 5 ASSET_ID, NETWORK_IDENTIFIER, ASSET_TAG FROM [${S}].AM_ASSET
      WHERE NETWORK_IDENTIFIER LIKE '%${name}%'
    `);
    console.log(`\n  LIKE '%${name}%': ${like.recordset.length} results`);
    if (like.recordset.length > 0) console.log(JSON.stringify(like.recordset, null, 2));
  }
}

const assetIds = assets.recordset.map(a => a.ASSET_ID);
if (assetIds.length > 0) {
  const idList = assetIds.join(',');

  // 2. Classification info
  const classif = await pool.request().query(`
    SELECT a.ASSET_ID, a.NETWORK_IDENTIFIER,
      uc.UN_CLASSIFICATION_FR AS type_label, uc.UN_CLASSIFICATION_ID AS type_id,
      parent_uc.UN_CLASSIFICATION_FR AS family_label
    FROM [${S}].AM_ASSET a
    JOIN [${S}].AM_CATALOG cat ON a.CATALOG_ID = cat.CATALOG_ID
    JOIN [${S}].AM_UN_CLASSIFICATION uc ON cat.UN_CLASSIFICATION_ID = uc.UN_CLASSIFICATION_ID
    LEFT JOIN [${S}].AM_UN_CLASSIFICATION parent_uc ON uc.PARENT_UN_CLASSIFICATION_ID = parent_uc.UN_CLASSIFICATION_ID
    WHERE a.ASSET_ID IN (${idList})
  `);
  console.log("\n=== Classification ===");
  console.log(JSON.stringify(classif.recordset, null, 2));

  // 3. Unavailability status
  const unavail = await pool.request().query(`
    SELECT u.ASSET_ID, u.UNAVAILABILITY_ID, u.START_DATE, u.END_DATE
    FROM [${S}].CMDB_UNAVAILABILITY u
    WHERE u.ASSET_ID IN (${idList})
  `);
  console.log("\n=== Unavailability records ===");
  console.log(JSON.stringify(unavail.recordset, null, 2));

  // 4. Characteristics (capacity)
  const chars = await pool.request().query(`
    SELECT ac.ASSET_ID, ac.CAPACITY_VALUE, ac.MIN_TARGET, ac.MAX_TARGET, ac.DATA_1,
      ch.CHARACTERISTIC_FR, ch.CHARACTERISTIC_EN, ch.IS_CAPACITY
    FROM [${S}].AM_ASSET_CHARACTERISTICS ac
    JOIN [${S}].AM_CHARACTERISTICS ch ON ac.CHARACTERISTIC_ID = ch.CHARACTERISTIC_ID
    WHERE ac.ASSET_ID IN (${idList})
  `);
  console.log("\n=== Asset Characteristics (capacity) ===");
  console.log(JSON.stringify(chars.recordset, null, 2));

  // 5. Relations (edges)
  const links = await pool.request().query(`
    SELECT l.PARENT_CI_ID, l.CHILD_CI_ID, l.BLOCKING,
      r.REFERENCE_FR AS relation_label,
      p.NETWORK_IDENTIFIER AS parent_name,
      c.NETWORK_IDENTIFIER AS child_name
    FROM [${S}].CONFIGURATION_ITEM_LINK l
    LEFT JOIN [${S}].AM_REFERENCE r ON r.REFERENCE_ID = l.RELATION_TYPE_ID
    LEFT JOIN [${S}].AM_ASSET p ON p.ASSET_ID = l.PARENT_CI_ID
    LEFT JOIN [${S}].AM_ASSET c ON c.ASSET_ID = l.CHILD_CI_ID
    WHERE l.PARENT_CI_ID IN (${idList}) OR l.CHILD_CI_ID IN (${idList})
  `);
  console.log("\n=== Relations (edges) ===");
  console.log(`${links.recordset.length} relations found`);
  console.log(JSON.stringify(links.recordset, null, 2));

  // 6. Full AM_ASSET record (all columns)
  const fullAsset = await pool.request().query(`
    SELECT * FROM [${S}].AM_ASSET WHERE ASSET_ID IN (${idList})
  `);
  console.log("\n=== Full AM_ASSET records (all columns) ===");
  for (const row of fullAsset.recordset) {
    console.log(`\n--- ${row.NETWORK_IDENTIFIER} (ASSET_ID=${row.ASSET_ID}) ---`);
    const nonNull = {};
    for (const [k, v] of Object.entries(row)) {
      if (v !== null && v !== undefined && v !== '' && v !== 0) nonNull[k] = v;
    }
    console.log(JSON.stringify(nonNull, null, 2));
  }
}

await pool.close();
