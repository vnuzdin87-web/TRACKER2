import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "./db.js";
import { accountBody, categoryBody } from "./directories.js";
import {
  color,
  date,
  endpoint,
  invalid,
  kopecks,
  month,
  name,
  positive,
  uuid,
} from "./http.js";
import { transactionBody } from "./transactions.js";

export const backup = Router();
export const settingsFields = z.strictObject({
  currency: z.literal("RUB"),
  theme: z.enum(["light", "dark"]),
  locale: z.literal("ru-RU"),
  weekStartsOn: z.number().int().min(1).max(7),
});
export const settingsId = "72e70341-78fc-4fe7-83c7-30c5a043a29a";
const settingsDefault = {
  id: settingsId,
  currency: "RUB",
  theme: "light",
  locale: "ru-RU",
  weekStartsOn: 1,
};
const timed = { id: uuid, createdAt: z.iso.datetime() };
const schema = z.strictObject({
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  accounts: z.array(accountBody.extend({ ...timed, isActive: z.boolean() })),
  categories: z.array(
    categoryBody.extend({ id: uuid, isArchived: z.boolean() }),
  ),
  transactions: z.array(transactionBody.extend(timed)),
  budgets: z.array(
    z.strictObject({
      id: uuid,
      categoryId: uuid,
      month,
      limitKopecks: kopecks.nonnegative(),
    }),
  ),
  goals: z.array(
    z.strictObject({
      id: uuid,
      name,
      targetKopecks: positive,
      deadline: date,
      status: z.enum(["ACTIVE", "ARCHIVED", "ACHIEVED"]),
      description: z.string().max(1000),
      color,
      accountId: uuid.nullable(),
    }),
  ),
  contributions: z.array(
    z.strictObject({ id: uuid, goalId: uuid, amountKopecks: positive, date }),
  ),
  settings: z.array(settingsFields.extend({ id: uuid })).max(1),
});

function unique(items: string[]) {
  if (new Set(items).size !== items.length)
    invalid("В копии обнаружены повторяющиеся записи.");
}

function verify(raw: unknown) {
  const data = schema.parse(raw);
  for (const group of [
    data.accounts,
    data.categories,
    data.transactions,
    data.budgets,
    data.goals,
    data.contributions,
    data.settings,
  ]) {
    unique(group.map((item) => item.id));
  }
  unique(data.categories.map((item) => JSON.stringify([item.type, item.name])));
  unique(data.budgets.map((item) => item.categoryId + item.month));
  const accounts = new Map(data.accounts.map((item) => [item.id, item]));
  const categories = new Map(data.categories.map((item) => [item.id, item]));
  const goals = new Set(data.goals.map((item) => item.id));
  for (const item of data.transactions) {
    if (!accounts.has(item.accountId))
      invalid("Операция ссылается на отсутствующий счёт.");
    if (item.type === "TRANSFER") {
      if (
        item.categoryId ||
        !item.destinationAccountId ||
        item.destinationAccountId === item.accountId ||
        !accounts.has(item.destinationAccountId)
      ) {
        invalid("В копии есть некорректный перевод.");
      }
    } else if (
      !item.categoryId ||
      item.destinationAccountId ||
      categories.get(item.categoryId)?.type !== item.type
    ) {
      invalid("Категория не соответствует типу операции.");
    }
  }
  for (const item of data.budgets) {
    if (categories.get(item.categoryId)?.type !== "EXPENSE")
      invalid("Лимит ссылается на некорректную категорию.");
  }
  const savings = new Map<string, number>();
  for (const item of data.contributions) {
    if (!goals.has(item.goalId))
      invalid("Взнос ссылается на отсутствующую цель.");
    savings.set(
      item.goalId,
      (savings.get(item.goalId) ?? 0) + item.amountKopecks,
    );
  }
  for (const item of data.goals) {
    if (item.accountId && !accounts.has(item.accountId))
      invalid("Цель ссылается на отсутствующий счёт.");
    if (
      item.status !== "ARCHIVED" &&
      (item.status === "ACHIEVED") !==
        (savings.get(item.id) ?? 0) >= item.targetKopecks
    ) {
      invalid("Статус цели не соответствует сумме взносов.");
    }
  }
  return data;
}

function token(data: ReturnType<typeof verify>) {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

backup.get(
  "/backup",
  endpoint(async (_request, response) => {
    const [
      accounts,
      categories,
      transactions,
      budgets,
      goals,
      contributions,
      settings,
    ] = await db.$transaction([
      db.account.findMany(),
      db.category.findMany(),
      db.transaction.findMany(),
      db.budget.findMany(),
      db.goal.findMany(),
      db.goalContribution.findMany(),
      db.settings.findMany(),
    ]);
    response
      .attachment("my-budget-backup.json")
      .json({
        version: 1,
        exportedAt: new Date().toISOString(),
        accounts,
        categories,
        transactions,
        budgets,
        goals,
        contributions,
        settings,
      });
  }),
);

backup.post(
  "/restore/preview",
  endpoint(async (request) => {
    const data = verify(request.body);
    return {
      token: token(data),
      exportedAt: data.exportedAt,
      counts: {
        accounts: data.accounts.length,
        categories: data.categories.length,
        transactions: data.transactions.length,
        budgets: data.budgets.length,
        goals: data.goals.length,
        contributions: data.contributions.length,
        settings: data.settings.length,
      },
    };
  }),
);

backup.post(
  "/restore/confirm",
  endpoint(async (request) => {
    const body = z
      .strictObject({
        token: z.string().regex(/^[a-f0-9]{64}$/),
        backup: z.unknown(),
      })
      .parse(request.body);
    const data = verify(body.backup);
    if (body.token !== token(data))
      invalid("Файл изменился. Повторите предварительную проверку.");
    await db.$transaction(
      async (tx) => {
        await tx.goalContribution.deleteMany();
        await tx.goal.deleteMany();
        await tx.budget.deleteMany();
        await tx.transaction.deleteMany();
        await tx.category.deleteMany();
        await tx.account.deleteMany();
        await tx.settings.deleteMany();
        await tx.account.createMany({ data: data.accounts });
        await tx.category.createMany({ data: data.categories });
        await tx.transaction.createMany({ data: data.transactions });
        await tx.budget.createMany({ data: data.budgets });
        await tx.goal.createMany({ data: data.goals });
        await tx.goalContribution.createMany({ data: data.contributions });
        await tx.settings.createMany({ data: data.settings });
      },
      { timeout: 30000 },
    );
    return { restored: true };
  }),
);

backup.get(
  "/settings",
  endpoint(async () => (await db.settings.findFirst()) ?? settingsDefault),
);
backup.patch(
  "/settings",
  endpoint((request) =>
    db.$transaction(async (tx) => {
      const patch = settingsFields.partial().parse(request.body);
      const current = await tx.settings.findFirst();
      return tx.settings.upsert({
        where: { id: current?.id ?? settingsId },
        create: { ...settingsDefault, ...patch },
        update: patch,
      });
    }),
  ),
);
