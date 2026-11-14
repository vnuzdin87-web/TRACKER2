import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

process.env.DATABASE_URL ??= `file:${resolve("prisma/budget.db").replaceAll("\\", "/")}`;
const result = spawnSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  {
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
