import { Router } from "express";
import { z } from "zod";
import { db } from "./db.js";
import { date, endpoint, invalid } from "./http.js";
import { summarize } from "./reports.js";

export const analytics = Router();
const day = 86400000;
const timestamp = (value: string) => Date.parse(value + "T00:00:00Z");
const isoDate = (value: number) => new Date(value).toISOString().slice(0, 10);

analytics.get(
  "/analytics",
  endpoint((request) =>
    db.$transaction(async (tx) => {
      const { from, to } = z
        .strictObject({ from: date, to: date })
        .parse(request.query);
      const start = timestamp(from);
      const end = timestamp(to);
      const days = (end - start) / day + 1;
      if (days < 1 || days > 3660)
        invalid("Выберите период от одного дня до десяти лет.");
      if (start - days * day < timestamp("0001-01-01"))
        invalid("Период сравнения выходит за допустимые даты.");
      const previousFrom = isoDate(start - days * day);
      const previousTo = isoDate(start - day);
      const [accounts, entries] = await Promise.all([
        tx.account.findMany({ orderBy: { name: "asc" } }),
        tx.transaction.findMany({
          where: { date: { lte: to } },
          orderBy: { date: "asc" },
          select: {
            date: true,
            type: true,
            amountKopecks: true,
            accountId: true,
            destinationAccountId: true,
            category: { select: { id: true, name: true, color: true } },
          },
        }),
      ]);
      const current = entries.filter((item) => item.date >= from);
      const previous = entries.filter(
        (item) => item.date >= previousFrom && item.date <= previousTo,
      );
      const { flow, expenses } = summarize(
        current,
        from.slice(0, 7),
        to.slice(0, 7),
      );
      const total = (items: typeof entries, type: string) =>
        items.reduce(
          (sum, item) => sum + (item.type === type ? item.amountKopecks : 0),
          0,
        );
      const income = total(current, "INCOME");
      const expense = total(current, "EXPENSE");
      const previousIncome = total(previous, "INCOME");
      const previousExpense = total(previous, "EXPENSE");
      const compare = (value: number, old: number) =>
        old === 0 ? null : ((value - old) * 100) / old;

      const balances = new Map(
        accounts.map((account) => [account.id, account.openingBalanceKopecks]),
      );
      const history: { date: string; balances: Record<string, number> }[] = [];
      function apply(entry: (typeof entries)[number]) {
        const sign = entry.type === "INCOME" ? 1 : -1;
        balances.set(
          entry.accountId,
          (balances.get(entry.accountId) ?? 0) + sign * entry.amountKopecks,
        );
        if (entry.destinationAccountId) {
          balances.set(
            entry.destinationAccountId,
            (balances.get(entry.destinationAccountId) ?? 0) +
              entry.amountKopecks,
          );
        }
      }
      let index = 0;
      while (index < entries.length && entries[index].date < from)
        apply(entries[index++]);
      for (let cursor = start; cursor <= end; cursor += day) {
        const value = isoDate(cursor);
        while (index < entries.length && entries[index].date === value)
          apply(entries[index++]);
        history.push({ date: value, balances: Object.fromEntries(balances) });
      }
      return {
        flow,
        expenses,
        top: expenses.slice(0, 5),
        income,
        expense,
        average: Math.round(expense / days),
        previousFrom,
        previousTo,
        previousIncome,
        previousExpense,
        incomeChange: compare(income, previousIncome),
        expenseChange: compare(expense, previousExpense),
        accounts: accounts.map(({ id, name }) => ({ id, name })),
        history,
      };
    }),
  ),
);
