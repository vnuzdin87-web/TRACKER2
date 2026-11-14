import { createHash } from "node:crypto";
import { Router } from "express";
import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { db } from "./db.js";
import { endpoint, HttpError, invalid } from "./http.js";
import { balances, transactionBody, validateEntry } from "./transactions.js";

export const exchange = Router();
const headings = [
  "Тип",
  "Сумма",
  "Дата",
  "Счёт",
  "Категория",
  "Счёт получателя",
  "Комментарий",
  "ID счёта",
  "ID категории",
  "ID счёта получателя",
];
const types = {
  INCOME: "Доход",
  EXPENSE: "Расход",
  TRANSFER: "Перевод",
} as const;
const accountTypes = {
  CASH: "Наличные",
  DEBIT: "Дебетовая карта",
  SAVINGS: "Накопительный счёт",
  OTHER: "Прочее",
};
const goalStatuses = {
  ACTIVE: "В процессе",
  ACHIEVED: "Достигнута",
  ARCHIVED: "В архиве",
};
const localDate = (value: string) => value.split("-").reverse().join(".");
const safeText = (value: string) =>
  /^[\s\uFEFF]*[=+\-@]/u.test(value) || /^[\t\r\n']/u.test(value)
    ? "'" + value
    : value;
const undoSafeText = (value: string) =>
  value.startsWith("'") && safeText(value.slice(1)) === value
    ? value.slice(1)
    : value;
const escape = (value: string) => '"' + value.replaceAll('"', '""') + '"';

exchange.get(
  "/export",
  endpoint(async (request, response) => {
    const format = z.enum(["csv", "xlsx"]).parse(request.query.format);
    const [entries, accounts, categories, budgets, goals] =
      await db.$transaction(async (tx) =>
        Promise.all([
          tx.transaction.findMany({
            include: {
              account: true,
              category: true,
              destinationAccount: true,
            },
            orderBy: [{ date: "asc" }, { id: "asc" }],
          }),
          balances(tx),
          tx.category.findMany(),
          tx.budget.findMany({ include: { category: true } }),
          tx.goal.findMany({ include: { account: true, contributions: true } }),
        ]),
      );
    const rows = entries.map(
      (item) =>
        [
          types[item.type],
          item.amountKopecks / 100,
          localDate(item.date),
          item.account.name,
          item.category?.name ?? "",
          item.destinationAccount?.name ?? "",
          item.note,
          item.accountId,
          item.categoryId ?? "",
          item.destinationAccountId ?? "",
        ] as const,
    );
    if (format === "csv") {
      const content = [
        headings.map(escape).join(";"),
        ...rows.map((row) =>
          row
            .map((value) =>
              escape(
                typeof value === "number"
                  ? value.toFixed(2).replace(".", ",")
                  : safeText(value),
              ),
            )
            .join(";"),
        ),
      ].join("\r\n");
      response
        .attachment("my-budget.csv")
        .type("text/csv; charset=utf-8")
        .send("\uFEFF" + content);
      return;
    }

    const workbook = new ExcelJS.Workbook();
    function sheet(
      title: string,
      header: string[],
      data: (string | number)[][],
      moneyColumns: number[] = [],
    ) {
      const page = workbook.addWorksheet(title, {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      page.addRow(header);
      page.getRow(1).font = { bold: true };
      page.addRows(data);
      page.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: header.length },
      };
      header.forEach((label, index) => {
        page.getColumn(index + 1).width = Math.max(
          18,
          Math.min(32, label.length + 3),
        );
      });
      moneyColumns.forEach((column) => {
        page.getColumn(column).numFmt = "#,##0.00";
      });
    }
    sheet(
      "Операции",
      headings,
      rows.map((row) => [...row]),
      [2],
    );
    sheet(
      "Счета",
      ["Название", "Тип", "Начальный баланс", "Баланс", "Активен"],
      accounts.map((item) => [
        item.name,
        accountTypes[item.type],
        item.openingBalanceKopecks / 100,
        item.balanceKopecks / 100,
        item.isActive ? "Да" : "Нет",
      ]),
      [3, 4],
    );
    sheet(
      "Категории",
      ["Название", "Тип", "Цвет", "Иконка", "В архиве"],
      categories.map((item) => [
        item.name,
        types[item.type],
        item.color,
        item.icon,
        item.isArchived ? "Да" : "Нет",
      ]),
    );
    sheet(
      "Бюджеты",
      ["Категория", "Месяц", "Лимит"],
      budgets.map((item) => [
        item.category.name,
        item.month,
        item.limitKopecks / 100,
      ]),
      [3],
    );
    sheet(
      "Цели",
      ["Цель", "Срок", "Сумма цели", "Накоплено", "Статус", "Счёт"],
      goals.map((item) => [
        item.name,
        localDate(item.deadline),
        item.targetKopecks / 100,
        item.contributions.reduce(
          (sum, entry) => sum + entry.amountKopecks,
          0,
        ) / 100,
        goalStatuses[item.status],
        item.account?.name ?? "",
      ]),
      [3, 4],
    );
    const income = entries.reduce(
      (sum, item) => sum + (item.type === "INCOME" ? item.amountKopecks : 0),
      0,
    );
    const expense = entries.reduce(
      (sum, item) => sum + (item.type === "EXPENSE" ? item.amountKopecks : 0),
      0,
    );
    sheet(
      "Сводка",
      ["Показатель", "Сумма"],
      [
        ["Доходы", income / 100],
        ["Расходы", expense / 100],
        ["Денежный поток", (income - expense) / 100],
        [
          "Баланс активных счетов",
          accounts
            .filter((item) => item.isActive)
            .reduce((sum, item) => sum + item.balanceKopecks, 0) / 100,
        ],
      ],
      [2],
    );
    response
      .attachment("my-budget.xlsx")
      .send(Buffer.from(await workbook.xlsx.writeBuffer()));
  }),
);

exchange.post(
  ["/import/csv", "/import/csv/preview"],
  endpoint(async (request) => {
    const { csv, token, includeDuplicates } = z
      .strictObject({
        csv: z.string().min(1).max(8_000_000),
        token: z.string().optional(),
        includeDuplicates: z.boolean().optional(),
      })
      .parse(request.body);
    let rows: { record: string[]; info: { lines: number } }[];
    try {
      rows = parse(csv, {
        delimiter: ";",
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        info: true,
      }) as unknown as typeof rows;
    } catch {
      invalid("Проверьте разделитель и кавычки CSV.");
    }
    if (!rows.length || rows[0].record.join(";") !== headings.join(";"))
      invalid("Используйте заголовки из экспорта CSV.");
    if (rows.length > 10001)
      invalid("В одном файле допускается до 10 000 операций.");

    return db.$transaction(
      async (tx) => {
        const preview = request.path.endsWith("/preview");
        const candidates: {
          row: number;
          data: z.infer<typeof transactionBody>;
          duplicate: boolean;
          account: string;
          category?: string;
          destination?: string;
        }[] = [];
        const fingerprint = (item: z.infer<typeof transactionBody>) =>
          JSON.stringify([
            item.type,
            item.date,
            item.amountKopecks,
            item.accountId,
            item.categoryId,
            item.destinationAccountId,
            item.note.trim(),
          ]);
        const tracking = preview || token !== undefined;
        const seen = new Set(
          tracking
            ? (
                await tx.transaction.findMany({
                  select: {
                    type: true,
                    date: true,
                    amountKopecks: true,
                    accountId: true,
                    categoryId: true,
                    destinationAccountId: true,
                    note: true,
                  },
                })
              ).map(fingerprint)
            : [],
        );
        const errors: { row: number; message: string }[] = [];
        const [accounts, categories] = await Promise.all([
          tx.account.findMany(),
          tx.category.findMany(),
        ]);
        const accountIds = new Set(accounts.map((item) => item.id));
        const categoryIds = new Set(categories.map((item) => item.id));
        for (const { record, info } of rows.slice(1)) {
          try {
            if (record.length !== headings.length)
              invalid("Неверное число полей.");
            const [
              label,
              amount,
              date,
              source,
              category,
              target,
              note,
              sourceId,
              categoryId,
              targetId,
            ] = record.map(undoSafeText);
            const type = Object.entries(types).find(
              ([, value]) => label === value,
            )?.[0];
            if (!type) invalid("Неизвестный тип операции.");
            const match = /^(\d+)[,.](\d{2})$/.exec(amount);
            if (!match) invalid("Укажите сумму с двумя знаками после запятой.");
            const dateMatch = /^\d{2}\.\d{2}\.\d{4}$/.test(date);
            if (!dateMatch) invalid("Укажите дату в формате ДД.ММ.ГГГГ.");
            const account = (id: string, label: string) => {
              if (accountIds.has(id)) return id;
              if (!label) return null;
              const matches = accounts.filter(
                (item) => item.name === label && item.isActive,
              );
              return matches.length === 1 ? matches[0].id : null;
            };
            const data = transactionBody.parse({
              type,
              amountKopecks: Number(BigInt(match[1]) * 100n + BigInt(match[2])),
              date: date.split(".").reverse().join("-"),
              accountId: account(sourceId, source),
              categoryId: categoryIds.has(categoryId)
                ? categoryId
                : (categories.find(
                    (item) =>
                      item.name === category &&
                      item.type === type &&
                      !item.isArchived,
                  )?.id ?? null),
              destinationAccountId: account(targetId, target),
              note,
            });
            await validateEntry(tx, data);

            const key = fingerprint(data);
            const duplicate = seen.has(key);
            seen.add(key);
            candidates.push({
              row: info.lines,
              data,
              duplicate,
              account: accounts.find((item) => item.id === data.accountId)!
                .name,
              category: categories.find((item) => item.id === data.categoryId)
                ?.name,
              destination: accounts.find(
                (item) => item.id === data.destinationAccountId,
              )?.name,
            });
          } catch (error) {
            if (
              !(error instanceof z.ZodError) &&
              !(
                error instanceof Error &&
                "status" in error &&
                error.status === 400
              )
            )
              throw error;
            errors.push({
              row: info.lines,
              message:
                error instanceof z.ZodError
                  ? "Проверьте сумму, дату, счёт и категорию."
                  : error.message,
            });
          }
        }
        const revision = createHash("sha256")
          .update(JSON.stringify({ candidates, errors }))
          .digest("hex");
        if (preview) {
          return {
            token: revision,
            errors,
            rows: candidates.map(
              ({ row, data, duplicate, account, category, destination }) => ({
                row,
                duplicate,
                account,
                category,
                destination,
                date: data.date,
                type: data.type,
                amountKopecks: data.amountKopecks,
                note: data.note,
              }),
            ),
          };
        }
        if (token !== undefined && token !== revision) {
          throw new HttpError(
            409,
            "CSV_CHANGED",
            "Данные изменились. Повторите проверку CSV.",
          );
        }
        const accepted = candidates.filter(
          (item) => !tracking || includeDuplicates || !item.duplicate,
        );
        if (accepted.length)
          await tx.transaction.createMany({
            data: accepted.map((item) => item.data),
          });
        return {
          imported: accepted.length,
          skipped: candidates.length - accepted.length,
          errors,
        };
      },
      { timeout: 120000 },
    );
  }),
);
