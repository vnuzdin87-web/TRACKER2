import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "./db.js";
import { date, endpoint, invalid, missing, positive, uuid } from "./http.js";

export const transactions = Router();
export const entryType = z.enum(["INCOME", "EXPENSE", "TRANSFER"]);
const transactionFields = z.strictObject({
  type: entryType,
  amountKopecks: positive,
  date,
  accountId: uuid,
  categoryId: uuid.nullable(),
  destinationAccountId: uuid.nullable(),
  note: z.string().max(500),
});
export const transactionBody = transactionFields.extend({
  categoryId: transactionFields.shape.categoryId.default(null),
  destinationAccountId:
    transactionFields.shape.destinationAccountId.default(null),
  note: transactionFields.shape.note.default(""),
});
type Entry = z.infer<typeof transactionBody>;

export async function validateEntry(
  tx: Prisma.TransactionClient,
  entry: Entry,
  old?: Entry,
) {
  const source = await tx.account.findUnique({
    where: { id: entry.accountId },
  });
  if (!source || (!source.isActive && old?.accountId !== source.id))
    invalid("Выберите активный исходный счёт.");
  if (entry.type === "TRANSFER") {
    if (
      entry.categoryId ||
      !entry.destinationAccountId ||
      entry.destinationAccountId === entry.accountId
    ) {
      invalid("Для перевода укажите два разных счёта.");
    }
    const destination = await tx.account.findUnique({
      where: { id: entry.destinationAccountId },
    });
    if (
      !destination ||
      (!destination.isActive && old?.destinationAccountId !== destination.id)
    ) {
      invalid("Выберите активный счёт получателя.");
    }
  } else {
    if (!entry.categoryId || entry.destinationAccountId)
      invalid("Укажите категорию операции.");
    const category = await tx.category.findUnique({
      where: { id: entry.categoryId },
    });
    if (
      !category ||
      category.type !== entry.type ||
      (category.isArchived && old?.categoryId !== category.id)
    ) {
      invalid("Выберите подходящую активную категорию.");
    }
  }
}

export async function balances(tx: Prisma.TransactionClient = db) {
  const [accounts, outgoing, incoming] = await Promise.all([
    tx.account.findMany({ orderBy: { createdAt: "asc" } }),
    tx.transaction.groupBy({
      by: ["accountId", "type"],
      _sum: { amountKopecks: true },
    }),
    tx.transaction.groupBy({
      by: ["destinationAccountId"],
      where: { type: "TRANSFER" },
      _sum: { amountKopecks: true },
    }),
  ]);
  const totals = new Map(
    accounts.map((account) => [account.id, account.openingBalanceKopecks]),
  );
  for (const row of outgoing) {
    const sign = row.type === "INCOME" ? 1 : -1;
    totals.set(
      row.accountId,
      (totals.get(row.accountId) ?? 0) + sign * (row._sum.amountKopecks ?? 0),
    );
  }
  for (const row of incoming) {
    if (row.destinationAccountId)
      totals.set(
        row.destinationAccountId,
        (totals.get(row.destinationAccountId) ?? 0) +
          (row._sum.amountKopecks ?? 0),
      );
  }
  return accounts.map((account) => ({
    ...account,
    balanceKopecks: totals.get(account.id)!,
  }));
}

const query = z.strictObject({
  from: date.optional(),
  to: date.optional(),
  type: entryType.optional(),
  categoryId: uuid.optional(),
  accountId: uuid.optional(),
  min: z.coerce.number().int().nonnegative().optional(),
  max: z.coerce.number().int().nonnegative().optional(),
  search: z.string().max(500).optional(),
  sort: z.enum(["date", "amountKopecks"]).default("date"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const entryInclude = {
  account: true,
  category: true,
  destinationAccount: true,
} as const;

transactions.get(
  "/transactions",
  endpoint(async (request) => {
    const q = query.parse(request.query);
    if (
      (q.from && q.to && q.from > q.to) ||
      (q.min !== undefined && q.max !== undefined && q.min > q.max)
    ) {
      invalid("Проверьте границы диапазона.");
    }
    const where: Prisma.TransactionWhereInput = {
      date: { gte: q.from, lte: q.to },
      type: q.type,
      categoryId: q.categoryId,
      amountKopecks: { gte: q.min, lte: q.max },
      note: q.search ? { contains: q.search } : undefined,
      OR: q.accountId
        ? [{ accountId: q.accountId }, { destinationAccountId: q.accountId }]
        : undefined,
    };
    const [items, total] = await db.$transaction([
      db.transaction.findMany({
        where,
        include: entryInclude,
        orderBy: [{ [q.sort]: q.order }, { id: q.order }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.transaction.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }),
);

transactions.get(
  "/transactions/:id",
  endpoint(
    async (request) =>
      (await db.transaction.findUnique({
        where: { id: uuid.parse(request.params.id) },
        include: entryInclude,
      })) ?? missing(),
  ),
);

transactions.post(
  "/transactions",
  endpoint(
    (request) =>
      db.$transaction(async (tx) => {
        const data = transactionBody.parse(request.body);
        await validateEntry(tx, data);
        return tx.transaction.create({ data, include: entryInclude });
      }),
    201,
  ),
);

transactions.patch(
  "/transactions/:id",
  endpoint((request) =>
    db.$transaction(async (tx) => {
      const id = uuid.parse(request.params.id);
      const old =
        (await tx.transaction.findUnique({ where: { id } })) ?? missing();
      const {
        type,
        amountKopecks,
        date,
        accountId,
        categoryId,
        destinationAccountId,
        note,
      } = old;
      const patch = transactionFields.partial().parse(request.body);
      const data = transactionBody.parse({
        type,
        amountKopecks,
        date,
        accountId,
        categoryId,
        destinationAccountId,
        note,
        ...patch,
      });
      await validateEntry(tx, data, old);
      return tx.transaction.update({
        where: { id },
        data,
        include: entryInclude,
      });
    }),
  ),
);

transactions.delete(
  "/transactions/:id",
  endpoint(
    (request) =>
      db.transaction.delete({ where: { id: uuid.parse(request.params.id) } }),
    204,
  ),
);
