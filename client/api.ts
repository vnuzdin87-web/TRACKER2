export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? "Ошибка запроса.");
  return result.data as T;
}

export function cents(value: string): number {
  const match = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error("Введите сумму с точностью до двух знаков.");
  const absolute =
    BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  const amount = match[1] ? -absolute : absolute;
  if (amount < -2147483648n || amount > 2147483647n)
    throw new Error("Сумма вне допустимого диапазона.");
  return Number(amount);
}

export const money = (value: number) =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(
    value / 100,
  );

export const inputMoney = (value: number) => (value / 100).toFixed(2);
export const accountNames = {
  CASH: "Наличные",
  DEBIT: "Дебетовая карта",
  SAVINGS: "Накопительный счёт",
  OTHER: "Прочее",
};
export const entryNames = {
  INCOME: "Доход",
  EXPENSE: "Расход",
  TRANSFER: "Перевод",
};
export type Account = {
  id: string;
  name: string;
  type: keyof typeof accountNames;
  openingBalanceKopecks: number;
  isActive: boolean;
  balanceKopecks?: number;
};
export type Category = {
  id: string;
  name: string;
  type: "INCOME" | "EXPENSE";
  color: string;
  icon: string;
  isArchived: boolean;
};
