import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, cents, entryNames, inputMoney, money } from "./api.js";
import type { Category } from "./api.js";
import { today } from "./transactions.js";
import type { Entry } from "./transactions.js";

export type Flow = { month: string; income: number; expense: number };
export type Slice = { id: string; name: string; color: string; amount: number };
type Limit = {
  id: string;
  categoryId: string;
  category: Category;
  limitKopecks: number;
  spentKopecks: number;
  remainingKopecks: number;
  percent: number | null;
  status: "normal" | "warning" | "reached";
};
type Summary = {
  balance: number;
  income: number;
  expense: number;
  net: number;
  flow: Flow[];
  expenses: Slice[];
  recent: Entry[];
  budgets: Limit[];
};

const statuses = {
  normal: "В пределах лимита",
  warning: "Приближение к лимиту",
  reached: "Лимит достигнут",
};
const chartAmount = (value: unknown) => money(Number(value));

export function FlowChart({ flow }: { flow: Flow[] }) {
  if (!flow.some((item) => item.income || item.expense))
    return <p>За период нет доходов и расходов.</p>;
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={flow} accessibilityLayer>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={(value) => String(value / 100)} width={62} />
          <Tooltip formatter={chartAmount} />
          <Legend />
          <Bar
            name="Доходы"
            dataKey="income"
            fill="#16a34a"
            radius={[4, 4, 0, 0]}
          />
          <Bar
            name="Расходы"
            dataKey="expense"
            fill="#dc2626"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ExpenseChart({ expenses }: { expenses: Slice[] }) {
  if (!expenses.length) return <p>За период нет расходов.</p>;
  return (
    <>
      <div className="chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart accessibilityLayer>
            <Tooltip formatter={chartAmount} />
            <Pie
              data={expenses.map((item) => ({ ...item, fill: item.color }))}
              dataKey="amount"
              nameKey="name"
              innerRadius="52%"
              outerRadius="84%"
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="rows">
        {expenses.map((item) => (
          <li key={item.id}>
            <span>
              <span style={{ color: item.color }}>●</span> {item.name}
            </span>
            <strong>{money(item.amount)}</strong>
          </li>
        ))}
      </ul>
    </>
  );
}

function Progress({ item }: { item: Limit }) {
  return (
    <div className={`limit ${item.status}`}>
      <strong>{item.category.name}</strong>
      <span>
        {money(item.spentKopecks)} из {money(item.limitKopecks)}
      </span>
      {item.percent !== null && (
        <progress
          aria-label={`Использование лимита «${item.category.name}»`}
          value={Math.min(100, item.percent)}
          max={100}
        />
      )}
      <small>
        {item.percent === null
          ? "Процент не рассчитывается"
          : `${item.percent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}% · ${statuses[item.status]}`}{" "}
        · Остаток {money(item.remainingKopecks)}
      </small>
    </div>
  );
}

export function Dashboard() {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [summary, setSummary] = useState<Summary>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<Summary>(`/dashboard?month=${month}`)
      .then((value) => {
        if (active) setSummary(value);
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [month]);
  return (
    <>
      <div className="actions heading">
        <h1>Главная</h1>
        <a className="primary button" href="/transactions?new">
          Добавить операцию
        </a>
      </div>
      <label className="period">
        Месяц
        <input
          aria-label="Месяц"
          type="month"
          value={month}
          onChange={(event) => {
            if (event.target.value) {
              setSummary(undefined);
              setError("");
              setMonth(event.target.value);
            }
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {!summary && !error && <p role="status">Загрузка…</p>}
      {summary && (
        <>
          <div className="metrics">
            {[
              ["Общий баланс", summary.balance],
              ["Доходы за месяц", summary.income],
              ["Расходы за месяц", summary.expense],
              ["Денежный поток", summary.net],
            ].map(([label, value]) => (
              <div key={label} className="card metric">
                <span>{label}</span>
                <strong>{money(Number(value))}</strong>
              </div>
            ))}
          </div>
          <div className="report-grid">
            <section className="card">
              <h2>Доходы и расходы за 6 месяцев</h2>
              <FlowChart flow={summary.flow} />
            </section>
            <section className="card">
              <h2>Структура расходов</h2>
              <ExpenseChart expenses={summary.expenses} />
            </section>
            <section className="card">
              <h2>Последние операции</h2>
              {!summary.recent.length && <p>Операций пока нет.</p>}
              <ul className="rows">
                {summary.recent.map((item) => (
                  <li key={item.id}>
                    <a href={`/transactions?edit=${item.id}`}>
                      {item.category?.name ?? entryNames[item.type]} ·{" "}
                      {item.date}
                    </a>
                    <strong>{money(item.amountKopecks)}</strong>
                  </li>
                ))}
              </ul>
            </section>
            <section className="card">
              <h2>Лимиты месяца</h2>
              {!summary.budgets.length && <p>Лимиты пока не заданы.</p>}
              {summary.budgets.map((item) => (
                <Progress key={item.id} item={item} />
              ))}
              <a href={`/budgets?month=${month}`}>Управление бюджетами</a>
            </section>
          </div>
        </>
      )}
    </>
  );
}

export function Budgets() {
  const initial = new URLSearchParams(location.search).get("month") ?? "";
  const [month, setMonth] = useState(
    /^\d{4}-(0[1-9]|1[0-2])$/.test(initial) ? initial : today().slice(0, 7),
  );
  const [categories, setCategories] = useState<Category[]>([]);
  const [limits, setLimits] = useState<Limit[]>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([
      api<Category[]>("/categories"),
      api<Limit[]>(`/budgets/${month}`),
    ])
      .then(([options, values]) => {
        if (active) {
          setCategories(options);
          setLimits(values);
        }
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [month]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = [...form]
        .filter(([, raw]) => String(raw).trim())
        .map(([categoryId, raw]) => ({
          categoryId,
          limitKopecks: cents(String(raw)),
        }));
      setLimits(await api<Limit[]>(`/budgets/${month}`, "PUT", body));
      setNotice("Лимиты сохранены.");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const options = categories.filter(
    (item) =>
      item.type === "EXPENSE" &&
      (!item.isArchived ||
        limits?.some((limit) => limit.categoryId === item.id)),
  );
  return (
    <>
      <h1>Бюджеты</h1>
      <label className="period">
        Месяц
        <input
          aria-label="Месяц"
          type="month"
          value={month}
          disabled={busy}
          onChange={(event) => {
            if (event.target.value) {
              setLimits(undefined);
              setError("");
              setNotice("");
              setMonth(event.target.value);
            }
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!limits && !error && <p role="status">Загрузка…</p>}
      {limits && (
        <div className="report-grid">
          <form key={month} className="card form" onSubmit={save}>
            <h2>Лимиты по категориям</h2>
            <p>Пустое поле удаляет лимит. Ноль задаёт нулевой лимит.</p>
            {options.map((category) => {
              const value = limits.find(
                (limit) => limit.categoryId === category.id,
              );
              return (
                <label key={category.id}>
                  {category.name}, ₽
                  <input
                    name={category.id}
                    inputMode="decimal"
                    defaultValue={value ? inputMoney(value.limitKopecks) : ""}
                  />
                </label>
              );
            })}
            {options.length ? (
              <button className="primary" disabled={busy}>
                Сохранить лимиты
              </button>
            ) : (
              <a href="/categories">Создать категорию расходов</a>
            )}
          </form>
          <section className="card">
            <h2>Использование лимитов</h2>
            {!limits.length && <p>Лимиты пока не заданы.</p>}
            {limits.map((item) => (
              <Progress key={item.id} item={item} />
            ))}
          </section>
        </div>
      )}
    </>
  );
}
