import process from "node:process";
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const folder = mkdtempSync(join(tmpdir(), "budget-browser-"));
const file = join(folder, "browser.db");
const db = new DatabaseSync(file);
try {
  db.exec(
    readFileSync(
      "prisma/migrations/202611130001_initial/migration.sql",
      "utf8",
    ),
  );
} finally {
  db.close();
}
process.env.DATABASE_URL = `file:${file.replaceAll("\\", "/")}`;

const { app } = await import("../../dist/server/app.js");
const { db: prisma } = await import("../../dist/server/db.js");
const server = app.listen(3100, "127.0.0.1");
process.once("SIGTERM", () =>
  server.close(async () => {
    await prisma.$disconnect();
    rmSync(file, { force: true });
    rmdirSync(folder);
  }),
);
