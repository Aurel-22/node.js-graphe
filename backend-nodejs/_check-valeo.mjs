import sql from 'mssql';
import dotenv from 'dotenv';
dotenv.config();

const pool = new sql.ConnectionPool({
  server: process.env.MSSQL_HOST,
  port: parseInt(process.env.MSSQL_PORT),
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  database: 'DATA_VALEO',
  options: { encrypt: false, trustServerCertificate: true }
});
await pool.connect();
const res = await pool.request().query("SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_NAME");
console.log(JSON.stringify(res.recordset, null, 2));
await pool.close();
