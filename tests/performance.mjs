import console from "node:console";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";

const folder = mkdtempSync(join(tmpdir(), "budget-performance-"));
const file = join(folder, "benchmark.db");
const database = new DatabaseSync(file);
database.exec(
  readFileSync("prisma/migrations/202611130001_initial/migration.sql", "utf8"),
);
const account = randomUUID();
const category = randomUUID();
database
  .prepare(
    "INSERT INTO Account (id,name,type,openingBalanceKopecks) VALUES (?, ?, ?, ?)",
  )
  .run(account, "Карта", "DEBIT", 0);
database
  .prepare(
    "INSERT INTO Category (id,name,type,color,icon) VALUES (?, ?, ?, ?, ?)",
  )
  .run(category, "Продукты", "EXPENSE", "#2563eb", "●");
const insert = database.prepare(
  'INSERT INTO "Transaction" (id,type,amountKopecks,date,accountId,categoryId) VALUES (?, ?, ?, ?, ?, ?)',
);
database.exec("BEGIN");
for (let index = 0; index < 10000; index++) {
  insert.run(
    randomUUID(),
    "EXPENSE",
    index + 1,
    `2026-11-${String((index % 30) + 1).padStart(2, "0")}`,
    account,
    category,
  );
}
database.exec("COMMIT");
database.close();

process.env.DATABASE_URL = `file:${file.replaceAll("\\", "/")}`;
const { app } = await import("../dist/server/app.js");
const { db } = await import("../dist/server/db.js");
const server = await new Promise((resolve) => {
  const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
});
try {
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  for (const path of [
    "/dashboard?month=2026-11",
    "/transactions",
    "/accounts",
    "/budgets/2026-11",
    "/analytics?from=2026-11-01&to=2026-11-30",
  ]) {
    const start = performance.now();
    const response = await globalThis.fetch(base + path);
    await response.json();
    const elapsed = Math.round(performance.now() - start);
    console.log(`${path} — ${elapsed} мс`);
    if (!response.ok || elapsed > 2000) process.exitCode = 1;
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  await db.$disconnect();
  rmSync(file);
  rmdirSync(folder);
}
