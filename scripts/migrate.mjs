import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stdout.write("DATABASE_URL is not configured; skipping migrations for demo mode.\n");
  process.exit(0);
}
const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const sql = await readFile(resolve("db/migrations/001_initial.sql"), "utf8");
  await pool.query(sql);
  await pool.query("INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING", ["001_initial"]);
  process.stdout.write("Applied database migrations.\n");
} finally {
  await pool.end();
}
