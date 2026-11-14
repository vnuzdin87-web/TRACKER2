import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, money } from "./api.js";
import { ExpenseChart, FlowChart } from "./reports.js";
import type { Flow, Slice } from "./reports.js";
import { today } from "./transactions.js";

type AnalyticsData = {
  flow: Flow[];
  expenses: Slice[];
  top: Slice[];
  income: number;
  expense: number;
  average: number;
  previousFrom: string;
  previousTo: string;
  previousIncome: number;
  previousExpense: number;
  incomeChange: number | null;
  expenseChange: number | null;
  accounts: { id: string; name: string }[];
  history: { date: string; balances: Record<string, number> }[];
};
const colors = [
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#7c3aed",
  "#d97706",
  "#0891b2",
];
const comparison = (value: number | null) =>
  value === null
    ? "Нет базы для сравнения"
    : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 1, signDisplay: "exceptZero" })}%`;

export function Analytics() {
  const last = today();
  const first = last.slice(0, 7) + "-01";
  const [range, setRange] = useState({ from: first, to: last });
  const [data, setData] = useState<AnalyticsData>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<AnalyticsData>(`/analytics?from=${range.from}&to=${range.to}`)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [range]);

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    setData(undefined);
    setRange({ from: String(form.get("from")), to: String(form.get("to")) });
  }

  return (
    <>
      <h1>Аналитика</h1>
      <form className="card filters" onSubmit={apply}>
        <label>
          С даты
          <input name="from" type="date" defaultValue={first} required />
        </label>
        <label>
          По дату
          <input name="to" type="date" defaultValue={last} required />
        </label>
        <div>
          <button className="primary">Показать</button>
        </div>
      </form>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status">Загрузка…</p>}
      {data && (
        <>
          <div className="metrics">
            <section className="card metric">
              <span>Доходы</span>
              <strong>{money(data.income)}</strong>
              <small>{comparison(data.incomeChange)}</small>
            </section>
            <section className="card metric">
              <span>Расходы</span>
              <strong>{money(data.expense)}</strong>
              <small>{comparison(data.expenseChange)}</small>
            </section>
            <section className="card metric">
              <span>Средние расходы в день</span>
              <strong>{money(data.average)}</strong>
            </section>
          </div>
          <section className="card">
            <h2>Предыдущий период</h2>
            <p>
              {data.previousFrom} — {data.previousTo}
            </p>
            <p>
              Доходы {money(data.previousIncome)} · Расходы{" "}
              {money(data.previousExpense)}
            </p>
          </section>
          <div className="report-grid">
            <section className="card">
              <h2>Доходы и расходы по месяцам</h2>
              <FlowChart flow={data.flow} />
            </section>
            <section className="card">
              <h2>Структура расходов</h2>
              <ExpenseChart expenses={data.expenses} />
            </section>
            <section className="card">
              <h2>Топ-5 категорий расходов</h2>
              {!data.top.length && <p>За период нет расходов.</p>}
              <ol className="rows">
                {data.top.map((item) => (
                  <li key={item.id}>
                    <span>{item.name}</span>
                    <strong>{money(item.amount)}</strong>
                  </li>
                ))}
              </ol>
            </section>
            <section className="card">
              <h2>Динамика остатков</h2>
              {data.accounts.length === 0 ? (
                <p>Счетов пока нет.</p>
              ) : (
                <div className="chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.history} accessibilityLayer>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="date"
                        minTickGap={32}
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis
                        tickFormatter={(value) => String(value / 100)}
                        width={62}
                      />
                      <Tooltip formatter={(value) => money(Number(value))} />
                      <Legend />
                      {data.accounts.map((item, index) => (
                        <Line
                          key={item.id}
                          name={item.name}
                          dataKey={`balances.${item.id}`}
                          stroke={colors[index % colors.length]}
                          dot={data.history.length === 1}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
