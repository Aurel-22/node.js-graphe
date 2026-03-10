/**
 * run-sql-exploration.mjs — Exécute les scripts SQL d'exploration de DATA_VALEO
 * et affiche les résultats de manière lisible dans la console.
 *
 * Usage : node run-sql-exploration.mjs [numéro]
 *   Sans argument : exécute tous les scripts (01 à 15)
 *   Avec numéro(s): node run-sql-exploration.mjs 01 05 10
 */

import fs from "fs";
import path from "path";

const API_URL = "http://127.0.0.1:8080/api/query?engine=mssql&database=DATA_VALEO";
const SQL_DIR = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "sql");

async function runQuery(sqlText) {
  // Split multi-statement SQL by ";" at top level, run them as one batch
  const resp = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: sqlText }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${err}`);
  }
  return resp.json();
}

function formatTable(rows) {
  if (!rows || rows.length === 0) return "  (aucun résultat)\n";

  const cols = Object.keys(rows[0]);
  // Compute column widths
  const widths = cols.map((col) =>
    Math.max(col.length, ...rows.map((r) => String(r[col] ?? "NULL").length))
  );

  let out = "";
  // Header
  out += "  " + cols.map((c, i) => c.padEnd(widths[i])).join(" │ ") + "\n";
  out += "  " + widths.map((w) => "─".repeat(w)).join("─┼─") + "\n";
  // Rows
  for (const row of rows) {
    out +=
      "  " +
      cols
        .map((c, i) => {
          const val = row[c] ?? "NULL";
          return typeof val === "number"
            ? String(val).padStart(widths[i])
            : String(val).padEnd(widths[i]);
        })
        .join(" │ ") +
      "\n";
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);

  // List SQL files
  const allFiles = fs
    .readdirSync(SQL_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const filesToRun =
    args.length > 0
      ? allFiles.filter((f) => args.some((a) => f.startsWith(a.padStart(2, "0"))))
      : allFiles;

  if (filesToRun.length === 0) {
    console.error("Aucun script SQL trouvé. Fichiers disponibles:", allFiles);
    process.exit(1);
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  EXPLORATION DATA_VALEO — ${filesToRun.length} scripts`);
  console.log(`${"═".repeat(70)}\n`);

  for (const file of filesToRun) {
    const filePath = path.join(SQL_DIR, file);
    const sqlContent = fs.readFileSync(filePath, "utf-8");

    // Extract title from first comment line
    const titleMatch = sqlContent.match(/--\s*(\d+\w*\.sql\s*—\s*.+)/);
    const title = titleMatch ? titleMatch[1] : file;

    console.log(`\n╔${"═".repeat(68)}╗`);
    console.log(`║ ${title.padEnd(67)}║`);
    console.log(`╚${"═".repeat(68)}╝`);

    // Split by statement-ending pattern (GO or double newline separator)
    // For simplicity, run the entire file as a single query
    // The API supports multi-statement queries
    try {
      const t0 = Date.now();

      // Split multi-part SQL files by the separator comments (sections A, B, C...)
      // For files with DECLARE/WITH/SET, run as single batch
      const hasDeclare = /\bDECLARE\b/i.test(sqlContent);
      
      if (hasDeclare) {
        // Run as single batch
        const result = await runQuery(sqlContent);
        const elapsed = Date.now() - t0;
        if (result.rows) {
          console.log(formatTable(result.rows));
        }
        console.log(`  ⏱  ${elapsed}ms (${result.rowCount} rows)`);
      } else {
        // Split by section comments (-- A., -- B., -- C.)
        // or just by ";" followed by SELECT
        const statements = sqlContent
          .split(/;\s*\n\s*\n/)
          .map((s) => s.trim())
          .filter((s) => s && !s.startsWith("--") && /SELECT/i.test(s));

        if (statements.length === 0) {
          // Fallback: run the whole thing
          const result = await runQuery(sqlContent);
          const elapsed = Date.now() - t0;
          if (result.rows) console.log(formatTable(result.rows));
          console.log(`  ⏱  ${elapsed}ms (${result.rowCount} rows)`);
        } else {
          for (let i = 0; i < statements.length; i++) {
            const stmt = statements[i];
            // Extract section label
            const sectionMatch = stmt.match(/--\s*([A-Z])\.\s*(.+)/);
            if (sectionMatch) {
              console.log(`\n  ── ${sectionMatch[1]}. ${sectionMatch[2]} ──`);
            }

            try {
              const result = await runQuery(stmt);
              const elapsed = Date.now() - t0;
              if (result.rows) console.log(formatTable(result.rows));
              console.log(`  ⏱  ${elapsed}ms (${result.rowCount} rows)`);
            } catch (err) {
              console.log(`  ❌ Erreur: ${err.message}`);
            }
          }
        }
      }
    } catch (err) {
      console.log(`  ❌ Erreur: ${err.message}`);
    }
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log("  Exploration terminée !");
  console.log(`${"═".repeat(70)}\n`);
}

main().catch(console.error);
