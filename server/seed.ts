import { db } from "./db.js";

const income = ["Зарплата", "Подработка", "Подарки", "Проценты", "Прочее"];
const expenses = [
  "Продукты",
  "Жильё",
  "Транспорт",
  "Здоровье",
  "Развлечения",
  "Покупки",
  "Образование",
  "Прочее",
];
const palette = [
  "#2563eb",
  "#7c3aed",
  "#0891b2",
  "#be185d",
  "#c2410c",
  "#166534",
  "#475569",
  "#92400e",
];

try {
  await db.$transaction([
    ...income.map((name, index) =>
      db.category.upsert({
        where: { type_name: { type: "INCOME", name } },
        create: { type: "INCOME", name, color: palette[index], icon: "+" },
        update: {},
      }),
    ),
    ...expenses.map((name, index) =>
      db.category.upsert({
        where: { type_name: { type: "EXPENSE", name } },
        create: { type: "EXPENSE", name, color: palette[index], icon: "−" },
        update: {},
      }),
    ),
  ]);
} finally {
  await db.$disconnect();
}
