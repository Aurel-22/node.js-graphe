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

// 1. Colonnes STATUS / DATE dans SD_REQUEST
const cols = await pool.request().query(`
  SELECT COLUMN_NAME, DATA_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = '40000' AND TABLE_NAME = 'SD_REQUEST'
    AND (COLUMN_NAME LIKE '%STATUS%' OR COLUMN_NAME LIKE '%CLOS%' OR COLUMN_NAME LIKE '%CLOSE%'
         OR COLUMN_NAME LIKE '%DATE%' OR COLUMN_NAME LIKE '%DONE%' OR COLUMN_NAME LIKE '%ACTIVE%'
         OR COLUMN_NAME LIKE '%ARCHIV%' OR COLUMN_NAME LIKE '%DELETE%' OR COLUMN_NAME LIKE '%END%'
         OR COLUMN_NAME LIKE '%RESOLV%' OR COLUMN_NAME LIKE '%CANCEL%')
  ORDER BY COLUMN_NAME
`);
console.log('=== Colonnes filtrage SD_REQUEST ===');
console.table(cols.recordset);

// 2. Distribution par STATUS_ID
const statDist = await pool.request().query(`
  SELECT r.STATUS_ID, s.STATUS_FR, COUNT(*) AS nb
  FROM [40000].SD_REQUEST r
  LEFT JOIN [40000].SD_STATUS s ON r.STATUS_ID = s.STATUS_ID
  GROUP BY r.STATUS_ID, s.STATUS_FR
  ORDER BY nb DESC
`);
console.log('\n=== Distribution par STATUS ===');
console.table(statDist.recordset);

// 3. Y a-t-il un champ CLOSED / END_DATE_UT ?
const closedCheck = await pool.request().query(`
  SELECT TOP 1 * FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = '40000' AND TABLE_NAME = 'SD_REQUEST'
    AND COLUMN_NAME IN ('CLOSED', 'END_DATE_UT', 'CLOSE_DATE_UT', 'CLOSED_DATE_UT', 'DONE_DATE_UT')
`);
console.log('\n=== Champ close/end trouvé ===');
console.table(closedCheck.recordset);

// 4. Compter les requêtes avec END_DATE_UT null vs non-null
try {
  const endDate = await pool.request().query(`
    SELECT 
      CASE WHEN END_DATE_UT IS NULL THEN 'En cours' ELSE 'Terminée' END AS etat,
      COUNT(*) AS nb
    FROM [40000].SD_REQUEST
    GROUP BY CASE WHEN END_DATE_UT IS NULL THEN 'En cours' ELSE 'Terminée' END
  `);
  console.log('\n=== END_DATE_UT null vs non-null ===');
  console.table(endDate.recordset);
} catch(e) { console.log('END_DATE_UT not found'); }

// 5. Vérifier CLOSE_DATE_UT
try {
  const closeDate = await pool.request().query(`
    SELECT 
      CASE WHEN CLOSE_DATE_UT IS NULL THEN 'Ouverte' ELSE 'Clôturée' END AS etat,
      COUNT(*) AS nb
    FROM [40000].SD_REQUEST
    GROUP BY CASE WHEN CLOSE_DATE_UT IS NULL THEN 'Ouverte' ELSE 'Clôturée' END
  `);
  console.log('\n=== CLOSE_DATE_UT null vs non-null ===');
  console.table(closeDate.recordset);
} catch(e) { console.log('CLOSE_DATE_UT not found'); }

// 6. Combien par CI et type SANS les clôturées (STATUS = terminé/clos)
const statusNames = statDist.recordset.map(r => r.STATUS_FR);
const closedStatuses = statusNames.filter(s => s && (s.match(/cl[oô]tur/i) || s.match(/termin/i) || s.match(/ferm/i) || s.match(/annul/i) || s.match(/production/i) || s.match(/rejet/i)));
console.log('\n=== Statuts potentiellement "terminés" ===', closedStatuses);

// 7. Check for a REQUEST_AREA or REQUEST_TYPE column
const areaCol = await pool.request().query(`
  SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = '40000' AND TABLE_NAME = 'SD_REQUEST'
    AND (COLUMN_NAME LIKE '%AREA%' OR COLUMN_NAME LIKE '%TYPE%' OR COLUMN_NAME LIKE '%REQUEST_TYPE%')
  ORDER BY COLUMN_NAME
`);
console.log('\n=== Colonnes AREA/TYPE ===');
console.table(areaCol.recordset);

await pool.close();
