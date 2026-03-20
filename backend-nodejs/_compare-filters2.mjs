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

// CIs avec le plus de requêtes — comparaison des 4 filtres
const r = await pool.request().query(`
  SELECT 
    a.NETWORK_IDENTIFIER AS CI,
    SUM(CASE WHEN LEFT(r.RFC_NUMBER,1)='I' THEN 1 ELSE 0 END) AS I_total,
    SUM(CASE WHEN LEFT(r.RFC_NUMBER,1)='I' AND r.STATUS_ID NOT IN (8,18) THEN 1 ELSE 0 END) AS I_actif,
    SUM(CASE WHEN LEFT(r.RFC_NUMBER,1)='I' AND r.END_DATE_UT IS NULL THEN 1 ELSE 0 END) AS I_encours,

    SUM(CASE WHEN LEFT(r.RFC_NUMBER,1)='R' THEN 1 ELSE 0 END) AS R_total,
    SUM(CASE WHEN LEFT(r.RFC_NUMBER,1)='R' AND r.STATUS_ID NOT IN (8,18) THEN 1 ELSE 0 END) AS R_actif,
    SUM(CASE WHEN LEFT(r.RFC_NUMBER,1)='R' AND r.END_DATE_UT IS NULL THEN 1 ELSE 0 END) AS R_encours,

    SUM(CASE WHEN LEFT(r.RFC_NUMBER,1)='S' THEN 1 ELSE 0 END) AS S_total,
    SUM(CASE WHEN LEFT(r.RFC_NUMBER,1)='S' AND r.STATUS_ID NOT IN (8,18) THEN 1 ELSE 0 END) AS S_actif,
    SUM(CASE WHEN LEFT(r.RFC_NUMBER,1)='S' AND r.END_DATE_UT IS NULL THEN 1 ELSE 0 END) AS S_encours,

    COUNT(*) AS total_all
  FROM [40000].SD_REQUEST r
  JOIN [40000].AM_ASSET a ON r.CI_ID = a.ASSET_ID
  WHERE LEFT(r.RFC_NUMBER, 1) IN ('I', 'R', 'S')
  GROUP BY a.NETWORK_IDENTIFIER
  ORDER BY COUNT(*) DESC
`);

console.log('=== Top 20 CIs par nombre de requêtes ===\n');
console.log(
  'CI'.padEnd(25),
  'I_tot'.padEnd(7), 'I_act'.padEnd(7), 'I_enc'.padEnd(7),
  'R_tot'.padEnd(7), 'R_act'.padEnd(7), 'R_enc'.padEnd(7),
  'S_tot'.padEnd(7), 'S_act'.padEnd(7), 'S_enc'.padEnd(7),
  'TOTAL'
);
console.log('-'.repeat(110));

for (const row of r.recordset.slice(0, 20)) {
  console.log(
    (row.CI || '(null)').padEnd(25),
    String(row.I_total).padEnd(7), String(row.I_actif).padEnd(7), String(row.I_encours).padEnd(7),
    String(row.R_total).padEnd(7), String(row.R_actif).padEnd(7), String(row.R_encours).padEnd(7),
    String(row.S_total).padEnd(7), String(row.S_actif).padEnd(7), String(row.S_encours).padEnd(7),
    String(row.total_all)
  );
}

// Nombre de CIs distincts
console.log(`\nNombre de CIs avec requêtes: ${r.recordset.length}`);

// Aussi vérifier: combien de SD_REQUEST n'ont PAS de CI_ID
const noCI = await pool.request().query(`
  SELECT COUNT(*) AS nb FROM [40000].SD_REQUEST WHERE CI_ID IS NULL OR CI_ID = 0
`);
console.log(`Requêtes sans CI_ID: ${noCI.recordset[0].nb}`);

const withCI = await pool.request().query(`
  SELECT COUNT(*) AS nb FROM [40000].SD_REQUEST WHERE CI_ID IS NOT NULL AND CI_ID > 0
`);
console.log(`Requêtes avec CI_ID: ${withCI.recordset[0].nb}`);

await pool.close();
