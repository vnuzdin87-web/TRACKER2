import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "./db.js";
import { endpoint, invalid, kopecks, month, uuid } from "./http.js";
import { balances, entryInclude } from "./transactions.js";

export const reports = Router();

export function shiftMonth(value: string, shift: number) {
  const [year, monthNumber] = value.split("-").map(Number);
  const total = year * 12 + monthNumber - 1 + shift;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((((total % 12) + 12) % 12) + 1).padStart(2, "0")}`;
}

export function budgetUsage(limit: number, spent: number) {
  const percent = limit === 0 ? null : (spent * 100) / limit;
  const status =
    spent >= limit ? "reached" : spent * 5 >= limit * 4 ? "warning" : "normal";
  return {
    spentKopecks: spent,
    remainingKopecks: limit - spent,
    percent,
    status,
  };
}

export async function budgetList(tx: Prisma.TransactionClient, value: string) {
  const [limits, spending] = await Promise.all([
    tx.budget.findMany({
      where: { month: value },
      include: { category: true },
      orderBy: { category: { name: "asc" } },
    }),
    tx.transaction.groupBy({
      by: ["categoryId"],
      where: { type: "EXPENSE", date: { startsWith: value + "-" } },
      _sum: { amountKopecks: true },
    }),
  ]);
  const totals = new Map(
    spending.map((item) => [item.categoryId, item._sum.amountKopecks ?? 0]),
  );
  return limits.map((item) => ({
    ...item,
    ...budgetUsage(item.limitKopecks, totals.get(item.categoryId) ?? 0),
  }));
}

reports.get(
  "/budgets/:month",
  endpoint((request) => budgetList(db, month.parse(request.params.month))),
);
const limitBody = z
  .array(
    z.strictObject({ categoryId: uuid, limitKopecks: kopecks.nonnegative() }),
  )
  .max(1000);

reports.put(
  "/budgets/:month",
  endpoint((request) =>
    db.$transaction(async (tx) => {
      const value = month.parse(request.params.month);
      const limits = limitBody.parse(request.body);
      const ids = limits.map((item) => item.categoryId);
      if (new Set(ids).size !== ids.length)
        invalid("Укажите один лимит на категорию.");
      const categories = await tx.category.findMany({
        where: { id: { in: ids }, type: "EXPENSE" },
      });
      const existing = await tx.budget.findMany({
        where: { month: value },
        select: { categoryId: true },
      });
      const existingIds = new Set(existing.map((item) => item.categoryId));
      if (
        categories.length !== ids.length ||
        categories.some((item) => item.isArchived && !existingIds.has(item.id))
      ) {
        invalid("Выберите активные категории расходов.");
      }
      await tx.budget.deleteMany({
        where: { month: value, categoryId: { notIn: ids } },
      });
      for (const item of limits) {
        await tx.budget.upsert({
          where: {
            categoryId_month: { categoryId: item.categoryId, month: value },
          },
          create: { ...item, month: value },
          update: { limitKopecks: item.limitKopecks },
        });
      }
      return budgetList(tx, value);
    }),
  ),
);

export type Flow = { month: string; income: number; expense: number };
export type ExpenseSlice = {
  id: string;
  name: string;
  color: string;
  amount: number;
};
export type ReportEntry = {
  date: string;
  type: string;
  amountKopecks: number;
  category: { id: string; name: string; color: string } | null;
};

export function summarize(entries: ReportEntry[], first: string, last: string) {
  const byMonth = new Map<string, Flow>();
  const byCategory = new Map<string, ExpenseSlice>();
  for (let value = first; value <= last; value = shiftMonth(value, 1)) {
    byMonth.set(value, { month: value, income: 0, expense: 0 });
  }
  for (const entry of entries) {
    const flow = byMonth.get(entry.date.slice(0, 7));
    if (!flow) continue;
    if (entry.type === "INCOME") flow.income += entry.amountKopecks;
    if (entry.type === "EXPENSE") {
      flow.expense += entry.amountKopecks;
      if (entry.category) {
        const { id, name, color } = entry.category;
        const amount = (byCategory.get(id)?.amount ?? 0) + entry.amountKopecks;
        byCategory.set(id, { id, name, color, amount });
      }
    }
  }
  return {
    flow: [...byMonth.values()],
    expenses: [...byCategory.values()].sort((a, b) => b.amount - a.amount),
  };
}

reports.get(
  "/dashboard",
  endpoint((request) =>
    db.$transaction(async (tx) => {
      const value = month.parse(request.query.month);
      const first = shiftMonth(value, -5);
      const [accounts, entries, recent, budgets] = await Promise.all([
        balances(tx),
        tx.transaction.findMany({
          where: {
            date: { gte: first + "-01", lte: value + "-31" },
            type: { not: "TRANSFER" },
          },
          select: {
            date: true,
            type: true,
            amountKopecks: true,
            category: { select: { id: true, name: true, color: true } },
          },
        }),
        tx.transaction.findMany({
          include: entryInclude,
          orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          take: 5,
        }),
        budgetList(tx, value),
      ]);
      const { flow } = summarize(entries, first, value);
      const { expenses } = summarize(
        entries.filter((entry) => entry.date.startsWith(value)),
        value,
        value,
      );
      const current = flow.at(-1)!;
      const balance = accounts.reduce(
        (sum, account) => sum + (account.isActive ? account.balanceKopecks : 0),
        0,
      );
      return {
        balance,
        income: current.income,
        expense: current.expense,
        net: current.income - current.expense,
        flow,
        expenses,
        recent,
        budgets,
      };
    }),
  ),
);
