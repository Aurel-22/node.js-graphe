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

// Exemples par préfixe
for (const prefix of ['R', 'I', 'S', 'E', 'P', '0']) {
  const r = await pool.request().query(
    `SELECT TOP 5 RFC_NUMBER FROM [40000].SD_REQUEST WHERE RFC_NUMBER LIKE '${prefix}%' ORDER BY RFC_NUMBER`
  );
  console.log(`=== Prefix '${prefix}' (exemples) ===`);
  r.recordset.forEach(row => console.log('  ', row.RFC_NUMBER));
}

// Distribution
const dist = await pool.request().query(`
  SELECT LEFT(RFC_NUMBER,1) AS prefix, COUNT(*) AS nb,
         MIN(RFC_NUMBER) AS min_val, MAX(RFC_NUMBER) AS max_val
  FROM [40000].SD_REQUEST
  GROUP BY LEFT(RFC_NUMBER,1)
  ORDER BY nb DESC
`);
console.log('\n=== Distribution par préfixe ===');
console.table(dist.recordset);

await pool.close();
