import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, cents, inputMoney, money } from "./api.js";
import type { Account } from "./api.js";
import { today } from "./transactions.js";

type Contribution = { id: string; date: string; amountKopecks: number };
type Goal = {
  id: string;
  name: string;
  deadline: string;
  targetKopecks: number;
  savedKopecks: number;
  percent: number;
  description: string;
  color: string;
  status: "ACTIVE" | "ARCHIVED" | "ACHIEVED";
  accountId: string | null;
  account: Account | null;
  contributions: Contribution[];
};
const statuses = {
  ACTIVE: "В процессе",
  ARCHIVED: "В архиве",
  ACHIEVED: "Достигнута",
};

export function Goals() {
  const [goals, setGoals] = useState<Goal[]>();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editing, setEditing] = useState<Goal>();
  const [open, setOpen] = useState(false);
  const [contribution, setContribution] = useState<{
    goal: Goal;
    entry?: Contribution;
  }>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([api<Goal[]>("/goals"), api<Account[]>("/accounts")])
      .then(([data, options]) => {
        if (active) {
          setGoals(data);
          setAccounts(options);
        }
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, []);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setGoals(await api<Goal[]>("/goals"));
      setNotice("Изменения сохранены.");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function saveGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void perform(async () => {
      await api(
        `/goals${editing ? `/${editing.id}` : ""}`,
        editing ? "PATCH" : "POST",
        {
          name: form.get("name"),
          color: form.get("color"),
          deadline: form.get("deadline"),
          targetKopecks: cents(String(form.get("amount"))),
          description: form.get("description"),
          accountId: form.get("accountId") || null,
          isArchived: form.has("archived"),
        },
      );
      setOpen(false);
    });
  }

  function saveContribution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!contribution) return;
    const { goal, entry } = contribution;
    void perform(async () => {
      await api(
        `/goals/${goal.id}/contributions${entry ? `/${entry.id}` : ""}`,
        entry ? "PATCH" : "POST",
        {
          date: form.get("date"),
          amountKopecks: cents(String(form.get("amount"))),
        },
      );
      setContribution(undefined);
    });
  }

  return (
    <>
      <div className="heading actions">
        <h1>Цели</h1>
        <button
          className="primary"
          onClick={() => {
            setEditing(undefined);
            setOpen(true);
          }}
        >
          Добавить цель
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!goals && !error && <p role="status">Загрузка…</p>}
      {open && (
        <form
          className="card form"
          key={editing?.id ?? "new"}
          onSubmit={saveGoal}
        >
          <h2>{editing ? "Редактирование цели" : "Новая цель"}</h2>
          <label>
            Название
            <input
              name="name"
              defaultValue={editing?.name}
              maxLength={100}
              required
            />
          </label>
          <label>
            Целевая сумма, ₽
            <input
              name="amount"
              inputMode="decimal"
              defaultValue={editing && inputMoney(editing.targetKopecks)}
              required
            />
          </label>
          <label>
            Срок
            <input
              type="date"
              name="deadline"
              defaultValue={editing?.deadline ?? today()}
              required
            />
          </label>
          <label>
            Описание
            <textarea
              name="description"
              defaultValue={editing?.description}
              maxLength={1000}
            />
          </label>
          <label>
            Цвет
            <input
              type="color"
              name="color"
              defaultValue={editing?.color ?? "#2563eb"}
            />
          </label>
          <label>
            Накопительный счёт
            <select name="accountId" defaultValue={editing?.accountId ?? ""}>
              <option value="">Без привязки</option>
              {accounts
                .filter(
                  (item) =>
                    (item.isActive && item.type === "SAVINGS") ||
                    item.id === editing?.accountId,
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          {editing && (
            <label className="check">
              <input
                type="checkbox"
                name="archived"
                defaultChecked={editing.status === "ARCHIVED"}
              />{" "}
              В архиве
            </label>
          )}
          <div className="actions">
            <button className="primary" disabled={busy}>
              Сохранить цель
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              Отмена
            </button>
          </div>
        </form>
      )}
      {contribution && (
        <form
          className="card form"
          onSubmit={saveContribution}
          key={contribution.entry?.id ?? contribution.goal.id}
        >
          <h2>
            {contribution.entry ? "Редактирование взноса" : "Новый взнос"} ·{" "}
            {contribution.goal.name}
          </h2>
          <label>
            Дата
            <input
              type="date"
              name="date"
              defaultValue={contribution.entry?.date ?? today()}
              required
            />
          </label>
          <label>
            Сумма взноса, ₽
            <input
              name="amount"
              inputMode="decimal"
              defaultValue={
                contribution.entry &&
                inputMoney(contribution.entry.amountKopecks)
              }
              required
            />
          </label>
          <div className="actions">
            <button className="primary" disabled={busy}>
              Сохранить взнос
            </button>
            <button type="button" onClick={() => setContribution(undefined)}>
              Отмена
            </button>
          </div>
        </form>
      )}
      {goals?.length === 0 && <div className="card">Целей пока нет.</div>}
      <div className="report-grid">
        {goals?.map((goal) => (
          <section key={goal.id} className="card">
            <h2>
              <span style={{ color: goal.color }}>●</span> {goal.name}
            </h2>
            <p>
              {statuses[goal.status]} · до {goal.deadline}
            </p>
            {goal.description && <p>{goal.description}</p>}
            {goal.account && <p>{goal.account.name}</p>}
            <div className="limit">
              <strong>
                {money(goal.savedKopecks)} из {money(goal.targetKopecks)}
              </strong>
              <progress
                aria-label={`Прогресс цели «${goal.name}»`}
                value={Math.min(100, goal.percent)}
                max={100}
                style={{ accentColor: goal.color }}
              />
              <span>
                {goal.percent.toLocaleString("ru-RU", {
                  maximumFractionDigits: 1,
                })}
                %
              </span>
            </div>
            <div className="actions">
              <button
                onClick={() => {
                  setEditing(goal);
                  setOpen(true);
                  window.scrollTo(0, 0);
                }}
              >
                Изменить цель
              </button>
              {goal.status !== "ARCHIVED" && (
                <button
                  onClick={() => {
                    setContribution({ goal });
                    window.scrollTo(0, 0);
                  }}
                >
                  Добавить взнос
                </button>
              )}
            </div>
            <h3 className="mt-4 font-semibold">История взносов</h3>
            {!goal.contributions.length && <p>Взносов пока нет.</p>}
            <ul className="rows">
              {goal.contributions.map((entry) => (
                <li key={entry.id}>
                  <span>
                    {entry.date} · {money(entry.amountKopecks)}
                  </span>
                  <div className="actions">
                    <button
                      onClick={() => {
                        setContribution({ goal, entry });
                        window.scrollTo(0, 0);
                      }}
                    >
                      Изменить
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (confirm("Отменить взнос?"))
                          void perform(async () => {
                            await api(
                              `/goals/${goal.id}/contributions/${entry.id}`,
                              "DELETE",
                            );
                            setContribution(undefined);
                          });
                      }}
                    >
                      Отменить взнос
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
