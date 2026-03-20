import sql from 'mssql';

const config = {
  server: 'devenv-dev-ded-033-smo.intra.evlabs.net',
  port: 1433,
  user: 'sa',
  password: 'Easyvista964158Certif',
  database: 'devenv_dev_ded_033_EVO_DATA40000',
  options: { encrypt: false, trustServerCertificate: true }
};

const pool = await sql.connect(config);

// 1. Toutes les colonnes booléennes / flag dans SD_REQUEST
const flags = await pool.request().query(`
  SELECT COLUMN_NAME, DATA_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = '40000' AND TABLE_NAME = 'SD_REQUEST'
    AND (COLUMN_NAME LIKE '%DELET%' OR COLUMN_NAME LIKE '%ARCHIV%' 
         OR COLUMN_NAME LIKE '%HIDDEN%' OR COLUMN_NAME LIKE '%VISIBLE%'
         OR COLUMN_NAME LIKE '%TEMPLATE%' OR COLUMN_NAME LIKE '%TEST%'
         OR COLUMN_NAME LIKE '%ACTIV%' OR COLUMN_NAME LIKE '%ENABL%'
         OR COLUMN_NAME LIKE '%VALID%' OR COLUMN_NAME LIKE '%DRAFT%'
         OR COLUMN_NAME LIKE '%PUBLISH%' OR COLUMN_NAME LIKE '%INTERNAL%'
         OR COLUMN_NAME LIKE '%IS_%' OR COLUMN_NAME LIKE '%FLAG%'
         OR COLUMN_NAME LIKE '%CANCELED%' OR COLUMN_NAME LIKE '%CLOSED%'
         OR COLUMN_NAME LIKE '%MERGED%' OR COLUMN_NAME LIKE '%DUPLICAT%'
         OR COLUMN_NAME LIKE '%PARENT%' OR COLUMN_NAME LIKE '%CHILD%'
         OR COLUMN_NAME LIKE '%LINKED%' OR COLUMN_NAME LIKE '%ORIGIN%'
         OR COLUMN_NAME LIKE '%MAJOR%' OR COLUMN_NAME LIKE '%MINOR%'
         OR COLUMN_NAME LIKE '%E_%')
  ORDER BY COLUMN_NAME
`);
console.log('=== Colonnes flag/filtre SD_REQUEST ===');
console.table(flags.recordset);

// 2. Toutes les colonnes bit (booléen)
const bits = await pool.request().query(`
  SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = '40000' AND TABLE_NAME = 'SD_REQUEST' AND DATA_TYPE = 'bit'
  ORDER BY COLUMN_NAME
`);
console.log('\n=== Colonnes BIT ===');
console.table(bits.recordset);

// 3. Distribution de chaque colonne bit
for (const row of bits.recordset) {
  const col = row.COLUMN_NAME;
  const dist = await pool.request().query(
    `SELECT [${col}], COUNT(*) AS nb FROM [40000].SD_REQUEST GROUP BY [${col}] ORDER BY nb DESC`
  );
  console.log(`\n--- ${col} ---`);
  console.table(dist.recordset);
}

// 4. Colonnes int suspectes (pourraient être des filtres)
const intCols = await pool.request().query(`
  SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = '40000' AND TABLE_NAME = 'SD_REQUEST'
    AND DATA_TYPE IN ('int','smallint','tinyint')
    AND (COLUMN_NAME LIKE '%REQUEST_AREA%' OR COLUMN_NAME LIKE '%CATALOG%' 
         OR COLUMN_NAME LIKE '%DOMAIN%' OR COLUMN_NAME LIKE '%SCOPE%'
         OR COLUMN_NAME LIKE '%LEVEL%' OR COLUMN_NAME LIKE '%PRIORITY%'
         OR COLUMN_NAME LIKE '%SEVERITY%' OR COLUMN_NAME LIKE '%URGENCY%'
         OR COLUMN_NAME LIKE '%IMPACT%' OR COLUMN_NAME LIKE 'PM_%')
  ORDER BY COLUMN_NAME
`);
console.log('\n=== Colonnes int suspectes ===');
for (const row of intCols.recordset) {
  const col = row.COLUMN_NAME;
  const dist = await pool.request().query(
    `SELECT TOP 10 [${col}], COUNT(*) AS nb FROM [40000].SD_REQUEST GROUP BY [${col}] ORDER BY nb DESC`
  );
  console.log(`\n--- ${col} ---`);
  console.table(dist.recordset);
}

// 5. Check SD_REQUEST_AREA link
const areaTable = await pool.request().query(`
  SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = '40000' AND TABLE_NAME = 'SD_REQUEST'
    AND COLUMN_NAME LIKE '%AREA%'
  ORDER BY COLUMN_NAME
`);
console.log('\n=== Colonnes AREA ===');
console.table(areaTable.recordset);

// 6. Vérifier REQUEST_ID vs SD_REQUEST_ID (sous-requêtes liées?)
const idCols = await pool.request().query(`
  SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = '40000' AND TABLE_NAME = 'SD_REQUEST'
    AND COLUMN_NAME LIKE '%REQUEST_ID%'
  ORDER BY COLUMN_NAME
`);
console.log('\n=== Colonnes REQUEST_ID ===');
console.table(idCols.recordset);

// 7. Distribution PARENT_REQUEST_ID
try {
  const parent = await pool.request().query(`
    SELECT 
      CASE WHEN PARENT_REQUEST_ID IS NULL OR PARENT_REQUEST_ID = 0 THEN 'Racine' ELSE 'Sous-requête' END AS type,
      COUNT(*) AS nb
    FROM [40000].SD_REQUEST
    GROUP BY CASE WHEN PARENT_REQUEST_ID IS NULL OR PARENT_REQUEST_ID = 0 THEN 'Racine' ELSE 'Sous-requête' END
  `);
  console.log('\n=== PARENT_REQUEST_ID ===');
  console.table(parent.recordset);
} catch(e) { console.log('PARENT_REQUEST_ID not found'); }

await pool.close();
