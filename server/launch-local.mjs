import console from "node:console";
import process from "node:process";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const stamp = "dist/.local-build";
if (["--check-build", "--record-build"].includes(process.argv[2])) {
  const hash = createHash("sha256");
  function add(path) {
    hash.update(JSON.stringify(path));
    hash.update(createHash("sha256").update(readFileSync(path)).digest());
  }
  for (const path of [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vite.config.ts",
    "prisma/schema.prisma",
  ])
    add(path);
  for (const folder of ["client", "server"]) {
    for (const file of readdirSync(folder, {
      recursive: true,
      withFileTypes: true,
    })
      .filter((file) => file.isFile())
      .map((file) => join(file.parentPath, file.name))
      .sort())
      add(file);
  }
  const revision = hash.digest("hex");
  if (process.argv[2] === "--record-build") {
    writeFileSync(stamp, revision);
    process.exit(0);
  }
  process.exit(
    ["dist/client/index.html", "dist/server/app.js", stamp].every(existsSync) &&
      readFileSync(stamp, "utf8") === revision
      ? 0
      : 1,
  );
}

const { app } = await import("../dist/server/app.js");

const host = "127.0.0.1";
const preferredPort = 3000;
const url = (port) => "http://" + host + ":" + port;

const buildScript = readFileSync("dist/client/index.html", "utf8").match(
  /src="([^"]+\.js)"/,
)?.[1];

async function isBudget(port) {
  try {
    const options = { signal: globalThis.AbortSignal.timeout(1500) };
    const page = await globalThis.fetch(url(port), options);
    if (!page.ok || !buildScript || !(await page.text()).includes(buildScript))
      return false;
    const probe = await globalThis.fetch(
      url(port) + "/api/v1/import/csv/preview",
      {
        signal: globalThis.AbortSignal.timeout(1500),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    return (
      probe.status === 400 &&
      (await probe.json()).error?.code === "VALIDATION_ERROR"
    );
  } catch {
    return false;
  }
}

function open(port) {
  console.log("Мой бюджет: " + url(port));
  if (process.env.BUDGET_NO_BROWSER === "1") return;
  const browser = spawn("cmd.exe", ["/d", "/c", "start", "", url(port)], {
    stdio: "ignore",
    windowsHide: true,
  });
  browser.on("error", () =>
    console.log("Откройте указанный адрес в браузере."),
  );
  browser.on("exit", (code) => {
    if (code !== 0) console.log("Откройте указанный адрес в браузере.");
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

const server = createServer(app);
let port;
let reused = false;
for (const candidate of [preferredPort, preferredPort + 1, 0]) {
  try {
    port = await listen(server, candidate);
    break;
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
    if (await isBudget(candidate)) {
      port = candidate;
      reused = true;
      break;
    }
  }
}

if (port !== undefined) {
  if (reused) console.log("Мой бюджет уже запущен.");
  else console.log("Для остановки нажмите Ctrl+C или закройте это окно.");
  open(port);
}
