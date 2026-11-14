import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { once } from "node:events";

import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";

let folder: string;
let server: Server;
let base: string;
let disconnect: () => Promise<void>;

beforeAll(async () => {
  folder = await mkdtemp(join(process.cwd(), "prisma", "test-budget-"));
  process.env.DATABASE_URL = `file:${join(folder, "test.db").replaceAll("\\", "/")}`;
  const sqlite = new DatabaseSync(join(folder, "test.db"));
  try {
    sqlite.exec(
      await readFile(
        "prisma/migrations/202611130001_initial/migration.sql",
        "utf8",
      ),
    );
  } finally {
    sqlite.close();
  }
  const { app } = await import("../server/app.js");
  const { db } = await import("../server/db.js");
  disconnect = () => db.$disconnect();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Сервер не запустился");
  base = `http://127.0.0.1:${address.port}/api/v1`;
}, 30000);

afterAll(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  if (disconnect) await disconnect();
  if (folder) await rm(folder, { recursive: true, force: true });
});

async function call(
  path: string,
  method = "GET",
  body?: unknown,
  status = 200,
) {
  const response = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status, await response.clone().text()).toBe(status);
  if (status !== 204) return (await response.json()).data;
}

test("доход, расход, перевод, редактирование и удаление пересчитывают остатки", async () => {
  const source = await call(
    "/accounts",
    "POST",
    { name: "Карта", type: "DEBIT", openingBalanceKopecks: 0 },
    201,
  );
  const target = await call(
    "/accounts",
    "POST",
    { name: "Накопления", type: "SAVINGS", openingBalanceKopecks: 0 },
    201,
  );
  const income = await call(
    "/categories",
    "POST",
    { name: "Зарплата", type: "INCOME", color: "#123456", icon: "+" },
    201,
  );
  const expense = await call(
    "/categories",
    "POST",
    { name: "Продукты", type: "EXPENSE", color: "#123456", icon: "−" },
    201,
  );
  const entry = { accountId: source.id, date: "2026-11-13" };
  await call(
    "/transactions",
    "POST",
    { ...entry, type: "INCOME", amountKopecks: 1000000, categoryId: income.id },
    201,
  );
  const purchase = await call(
    "/transactions",
    "POST",
    {
      ...entry,
      type: "EXPENSE",
      amountKopecks: 250000,
      categoryId: expense.id,
      note: "Покупка",
    },
    201,
  );
  await call(
    "/transactions",
    "POST",
    {
      ...entry,
      type: "TRANSFER",
      amountKopecks: 300000,
      destinationAccountId: target.id,
    },
    201,
  );
  await call(
    "/transactions",
    "POST",
    {
      ...entry,
      type: "TRANSFER",
      amountKopecks: 1,
      destinationAccountId: source.id,
    },
    400,
  );
  expect(await call("/accounts")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: source.id, balanceKopecks: 450000 }),
      expect.objectContaining({ id: target.id, balanceKopecks: 300000 }),
    ]),
  );
  expect(await call(`/transactions?accountId=${target.id}`)).toMatchObject({
    total: 1,
  });
  expect(
    await call("/transactions?search=Покупка&min=250000&max=250000"),
  ).toMatchObject({ total: 1 });
  await call(`/transactions/${purchase.id}`, "PATCH", {
    date: "2026-12-01",
    amountKopecks: 400000,
  });
  expect(
    await call("/transactions?type=EXPENSE&from=2026-11-01&to=2026-11-30"),
  ).toMatchObject({ total: 0 });
  expect(await call("/accounts")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: source.id, balanceKopecks: 300000 }),
    ]),
  );
  await call(`/transactions/${purchase.id}`, "DELETE", undefined, 204);
  await call(`/transactions/${purchase.id}`, "DELETE", undefined, 404);
  expect(await call("/accounts")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: source.id, balanceKopecks: 700000 }),
    ]),
  );
  await call(`/accounts/${source.id}`, "PATCH", { isActive: false });
  await call(
    "/transactions",
    "POST",
    { ...entry, type: "INCOME", amountKopecks: 1, categoryId: income.id },
    400,
  );
});

test("лимиты по месяцам, ноль и исключение переводов из отчёта", async () => {
  const category = await call(
    "/categories",
    "POST",
    { name: "Транспорт", type: "EXPENSE", color: "#334455", icon: "Т" },
    201,
  );
  const source = await call(
    "/accounts",
    "POST",
    { name: "Наличные", type: "CASH", openingBalanceKopecks: 0 },
    201,
  );
  await call(
    "/transactions",
    "POST",
    {
      type: "EXPENSE",
      accountId: source.id,
      categoryId: category.id,
      date: "2026-11-14",
      amountKopecks: 800,
    },
    201,
  );
  const november = await call("/budgets/2026-11", "PUT", [
    { categoryId: category.id, limitKopecks: 1000 },
  ]);
  expect(november[0]).toMatchObject({
    percent: 80,
    remainingKopecks: 200,
    status: "warning",
  });
  const december = await call("/budgets/2026-12", "PUT", [
    { categoryId: category.id, limitKopecks: 0 },
  ]);
  expect(december[0]).toMatchObject({ percent: null, spentKopecks: 0 });
  const reached = await call("/budgets/2026-11", "PUT", [
    { categoryId: category.id, limitKopecks: 400 },
  ]);
  expect(reached[0]).toMatchObject({
    percent: 200,
    remainingKopecks: -400,
    status: "reached",
  });
  const summary = await call("/dashboard?month=2026-11");
  expect(summary).toMatchObject({ income: 1000000, expense: 800, net: 999200 });
  expect(summary.flow).toHaveLength(6);
});

test("взнос меняет статус цели и оставляет остатки без изменений", async () => {
  const accounts = await call("/accounts");
  const savings = accounts.find(
    (item: { type: string }) => item.type === "SAVINGS",
  );
  const goal = await call(
    "/goals",
    "POST",
    {
      name: "Отпуск",
      targetKopecks: 50000,
      deadline: "2027-01-01",
      color: "#2255aa",
      accountId: savings.id,
    },
    201,
  );
  const result = await call(
    `/goals/${goal.id}/contributions`,
    "POST",
    { date: "2026-11-15", amountKopecks: 55000 },
    201,
  );
  expect(result).toMatchObject({
    status: "ACHIEVED",
    savedKopecks: 55000,
    percent: 110,
  });
  const path = `/goals/${goal.id}/contributions/${result.contributions[0].id}`;
  const edited = await call(path, "PATCH", { amountKopecks: 40000 });
  expect(edited).toMatchObject({ status: "ACTIVE", savedKopecks: 40000 });
  await call(path, "DELETE", undefined, 204);
  expect(await call("/goals")).toEqual([
    expect.objectContaining({ savedKopecks: 0 }),
  ]);
  expect(await call("/accounts")).toEqual(accounts);
});

test("аналитика считает предыдущий период и остатки на дату", async () => {
  const report = await call("/analytics?from=2026-11-13&to=2026-11-14");
  expect(report).toMatchObject({
    income: 1000000,
    expense: 800,
    average: 400,
    previousFrom: "2026-11-11",
    previousTo: "2026-11-12",
    incomeChange: null,
  });
  const savings = report.accounts.find(
    (item: { name: string }) => item.name === "Накопления",
  );
  expect(report.history[0].balances[savings.id]).toBe(300000);
});

test("резервная копия восстанавливает связи и отклоняет изменённый файл", async () => {
  const response = await fetch(base + "/backup");
  expect(response.status).toBe(200);
  const backup = await response.json();
  const before = await call("/accounts");
  const preview = await call("/restore/preview", "POST", backup);
  expect(preview.counts.transactions).toBe(3);
  await call("/restore/preview", "POST", { ...backup, accounts: [] }, 400);
  await call(
    "/restore/confirm",
    "POST",
    {
      token: preview.token,
      backup: {
        ...backup,
        settings: [],
        exportedAt: "2026-11-13T00:00:00.000Z",
      },
    },
    400,
  );
  await call(`/accounts/${before[0].id}`, "PATCH", { name: "После копии" });
  await call("/restore/confirm", "POST", { token: preview.token, backup });
  expect(await call("/accounts")).toEqual(before);
  expect((await call("/transactions")).total).toBe(3);
});

test("CSV экранирует формулы и сообщает об ошибке строки, XLSX содержит отчёт", async () => {
  const entries = await call("/transactions");
  const purchase = entries.items.find(
    (item: { type: string }) => item.type === "EXPENSE",
  );
  await call(`/transactions/${purchase.id}`, "PATCH", { note: "=1+1" });
  const csvResponse = await fetch(base + "/export?format=csv");
  const bytes = new Uint8Array(await csvResponse.arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
  const csv = new TextDecoder().decode(bytes);
  expect(csv).toContain("'=1+1");
  const header = csv.split("\r\n")[0];
  const purchaseLine = csv.split("\r\n").find((line) => line.includes("'=1+1"));
  expect(
    await call("/import/csv", "POST", {
      csv: [header, purchaseLine, "ошибка"].join("\r\n"),
    }),
  ).toMatchObject({
    imported: 1,
    errors: [{ row: 3 }],
  });
  expect(
    await call("/import/csv", "POST", { csv: "другой формат" }, 400),
  ).toBeUndefined();
  const xlsx = await fetch(base + "/export?format=xlsx");
  expect(xlsx.status).toBe(200);
  expect([...new Uint8Array(await xlsx.arrayBuffer()).slice(0, 2)]).toEqual([
    80, 75,
  ]);
  expect(
    await call("/settings", "PATCH", { theme: "dark", weekStartsOn: 7 }),
  ).toMatchObject({ theme: "dark", weekStartsOn: 7 });
});
