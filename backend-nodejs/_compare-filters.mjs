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

// === 1. SANS filtre (ta requête actuelle) ===
const noFilter = await pool.request().query(`
  SELECT 
    a.NETWORK_IDENTIFIER AS CI,
    CASE LEFT(r.RFC_NUMBER, 1)
        WHEN 'I' THEN 'Incident'
        WHEN 'R' THEN 'Changement'
        WHEN 'S' THEN 'Service'
    END AS Type,
    COUNT(*) AS Nb
  FROM [40000].SD_REQUEST r
  JOIN [40000].AM_ASSET a ON r.CI_ID = a.ASSET_ID
  WHERE LEFT(r.RFC_NUMBER, 1) IN ('I', 'R', 'S')
  GROUP BY a.NETWORK_IDENTIFIER, LEFT(r.RFC_NUMBER, 1)
`);

// === 2. Filtre STATUS_ID NOT IN (8,18) — exclure Clôturé + Annulé ===
const filterStatus = await pool.request().query(`
  SELECT 
    a.NETWORK_IDENTIFIER AS CI,
    CASE LEFT(r.RFC_NUMBER, 1)
        WHEN 'I' THEN 'Incident'
        WHEN 'R' THEN 'Changement'
        WHEN 'S' THEN 'Service'
    END AS Type,
    COUNT(*) AS Nb
  FROM [40000].SD_REQUEST r
  JOIN [40000].AM_ASSET a ON r.CI_ID = a.ASSET_ID
  WHERE LEFT(r.RFC_NUMBER, 1) IN ('I', 'R', 'S')
    AND r.STATUS_ID NOT IN (8, 18)
  GROUP BY a.NETWORK_IDENTIFIER, LEFT(r.RFC_NUMBER, 1)
`);

// === 3. Filtre END_DATE_UT IS NULL — seulement en cours ===
const filterEndDate = await pool.request().query(`
  SELECT 
    a.NETWORK_IDENTIFIER AS CI,
    CASE LEFT(r.RFC_NUMBER, 1)
        WHEN 'I' THEN 'Incident'
        WHEN 'R' THEN 'Changement'
        WHEN 'S' THEN 'Service'
    END AS Type,
    COUNT(*) AS Nb
  FROM [40000].SD_REQUEST r
  JOIN [40000].AM_ASSET a ON r.CI_ID = a.ASSET_ID
  WHERE LEFT(r.RFC_NUMBER, 1) IN ('I', 'R', 'S')
    AND r.END_DATE_UT IS NULL
  GROUP BY a.NETWORK_IDENTIFIER, LEFT(r.RFC_NUMBER, 1)
`);

// === 4. Filtre STATUS_ID = 12 (En cours uniquement) ===
const filterEnCours = await pool.request().query(`
  SELECT 
    a.NETWORK_IDENTIFIER AS CI,
    CASE LEFT(r.RFC_NUMBER, 1)
        WHEN 'I' THEN 'Incident'
        WHEN 'R' THEN 'Changement'
        WHEN 'S' THEN 'Service'
    END AS Type,
    COUNT(*) AS Nb
  FROM [40000].SD_REQUEST r
  JOIN [40000].AM_ASSET a ON r.CI_ID = a.ASSET_ID
  WHERE LEFT(r.RFC_NUMBER, 1) IN ('I', 'R', 'S')
    AND r.STATUS_ID = 12
  GROUP BY a.NETWORK_IDENTIFIER, LEFT(r.RFC_NUMBER, 1)
`);

// Agréger par CI pour comparaison
function aggregate(rows) {
  const map = {};
  for (const r of rows) {
    if (!map[r.CI]) map[r.CI] = { Incident: 0, Changement: 0, Service: 0, Total: 0 };
    map[r.CI][r.Type] = r.Nb;
    map[r.CI].Total += r.Nb;
  }
  return map;
}

const agg0 = aggregate(noFilter.recordset);
const agg1 = aggregate(filterStatus.recordset);
const agg2 = aggregate(filterEndDate.recordset);
const agg3 = aggregate(filterEnCours.recordset);

// Afficher les CIs connus côte à côte
const knownCIs = ['SRV_14-F', 'SRV_15-F', 'SRV_WEB-F', 'SRV-12-F', 'BDD-SQL-FR', 'AV_FR'];
const allCIs = [...new Set([...Object.keys(agg0)])].sort();
const displayCIs = knownCIs.filter(ci => agg0[ci]);

console.log('=== Comparaison pour les CIs connus ===\n');
console.log('CI'.padEnd(20), 'Type'.padEnd(12), 'Sans filtre'.padEnd(14), 'NOT(Clôt+Ann)'.padEnd(16), 'END_DATE NULL'.padEnd(16), 'STATUS=EnCours');
console.log('-'.repeat(95));

for (const ci of displayCIs) {
  for (const type of ['Incident', 'Changement', 'Service']) {
    const v0 = agg0[ci]?.[type] || 0;
    const v1 = agg1[ci]?.[type] || 0;
    const v2 = agg2[ci]?.[type] || 0;
    const v3 = agg3[ci]?.[type] || 0;
    if (v0 > 0) {
      console.log(ci.padEnd(20), type.padEnd(12), String(v0).padEnd(14), String(v1).padEnd(16), String(v2).padEnd(16), String(v3));
    }
  }
  console.log('');
}

// Totaux globaux
function totalByType(rows) {
  const t = { Incident: 0, Changement: 0, Service: 0 };
  for (const r of rows) t[r.Type] += r.Nb;
  return t;
}
const t0 = totalByType(noFilter.recordset);
const t1 = totalByType(filterStatus.recordset);
const t2 = totalByType(filterEndDate.recordset);
const t3 = totalByType(filterEnCours.recordset);

console.log('\n=== TOTAUX GLOBAUX ===');
console.log('Type'.padEnd(14), 'Sans filtre'.padEnd(14), 'NOT(Clôt+Ann)'.padEnd(16), 'END_DATE NULL'.padEnd(16), 'STATUS=EnCours');
console.log('-'.repeat(78));
for (const type of ['Incident', 'Changement', 'Service']) {
  console.log(type.padEnd(14), String(t0[type]).padEnd(14), String(t1[type]).padEnd(16), String(t2[type]).padEnd(16), String(t3[type]));
}
console.log('TOTAL'.padEnd(14), String(t0.Incident+t0.Changement+t0.Service).padEnd(14), String(t1.Incident+t1.Changement+t1.Service).padEnd(16), String(t2.Incident+t2.Changement+t2.Service).padEnd(16), String(t3.Incident+t3.Changement+t3.Service));

await pool.close();
