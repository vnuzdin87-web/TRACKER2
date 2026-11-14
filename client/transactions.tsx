import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, cents, entryNames, inputMoney, money } from "./api.js";
import type { Account, Category } from "./api.js";

export type Entry = {
  id: string;
  type: keyof typeof entryNames;
  amountKopecks: number;
  date: string;
  accountId: string;
  account: Account;
  categoryId: string | null;
  category: Category | null;
  destinationAccountId: string | null;
  destinationAccount: Account | null;
  note: string;
};

export function today() {
  return new Intl.DateTimeFormat("sv-SE").format(new Date());
}

type Result = { items: Entry[]; total: number; page: number; pageSize: number };

export function Transactions() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [result, setResult] = useState<Result>();
  const [selected, setSelected] = useState<Entry>();
  const [formOpen, setFormOpen] = useState(
    new URLSearchParams(location.search).has("new"),
  );
  const [type, setType] = useState<Entry["type"]>("EXPENSE");
  const [filters, setFilters] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const id = new URLSearchParams(location.search).get("edit");
    Promise.all([
      api<Account[]>("/accounts"),
      api<Category[]>("/categories"),
      id ? api<Entry>(`/transactions/${id}`) : undefined,
    ])
      .then(([a, c, entry]) => {
        if (!active) return;
        setAccounts(a);
        setCategories(c);
        if (entry) {
          setSelected(entry);
          setType(entry.type);
          setFormOpen(true);
        }
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    api<Result>(`/transactions?page=${page}${filters ? `&${filters}` : ""}`)
      .then((data) => {
        if (active) setResult(data);
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [page, filters, revision]);

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const query = new URLSearchParams();
      for (const [key, raw] of new FormData(event.currentTarget)) {
        const value = String(raw).trim();
        if (value)
          query.set(
            key,
            key === "min" || key === "max" ? String(cents(value)) : value,
          );
      }
      setError("");
      setFilters(query.toString());
      setPage(1);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  function close() {
    setSelected(undefined);
    setFormOpen(false);
    if (location.search) history.replaceState(null, "", location.pathname);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(
        `/transactions${selected ? `/${selected.id}` : ""}`,
        selected ? "PATCH" : "POST",
        {
          type,
          amountKopecks: cents(String(form.get("amount"))),
          date: form.get("date"),
          accountId: form.get("accountId"),
          categoryId: form.get("categoryId"),
          destinationAccountId: form.get("destinationAccountId"),
          note: form.get("note"),
        },
      );
      close();
      setRevision((value) => value + 1);
      setNotice("Операция сохранена.");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: Entry) {
    if (!confirm("Удалить операцию? Остатки и отчёты будут пересчитаны."))
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`/transactions/${entry.id}`, "DELETE");
      if (selected?.id === entry.id) close();
      if (result?.items.length === 1 && page > 1) setPage(page - 1);
      setRevision((value) => value + 1);
      setNotice("Операция удалена.");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function accountOptions(keep?: string | null) {
    return accounts
      .filter((account) => account.isActive || account.id === keep)
      .map((account) => (
        <option key={account.id} value={account.id}>
          {account.name}
          {account.isActive ? "" : " (архив)"}
        </option>
      ));
  }

  return (
    <>
      <div className="actions heading">
        <h1>Операции</h1>
        <button
          className="primary"
          onClick={() => {
            setSelected(undefined);
            setType("EXPENSE");
            setFormOpen(true);
          }}
        >
          Добавить операцию
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {formOpen && (
        <form className="card form" key={selected?.id ?? "new"} onSubmit={save}>
          <h2>{selected ? "Редактирование операции" : "Новая операция"}</h2>
          <label>
            Тип
            <select
              value={type}
              onChange={(event) => setType(event.target.value as Entry["type"])}
            >
              {Object.entries(entryNames).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Сумма, ₽
            <input
              name="amount"
              inputMode="decimal"
              defaultValue={selected ? inputMoney(selected.amountKopecks) : ""}
              required
            />
          </label>
          <label>
            Дата
            <input
              name="date"
              type="date"
              defaultValue={selected?.date ?? today()}
              required
            />
          </label>
          <label>
            Счёт
            <select
              name="accountId"
              defaultValue={selected?.accountId ?? ""}
              required
            >
              <option value="">Выберите счёт</option>
              {accountOptions(selected?.accountId)}
            </select>
          </label>
          {accounts.every((account) => !account.isActive) && (
            <a href="/accounts">Создать счёт</a>
          )}
          {type === "TRANSFER" ? (
            <label>
              Счёт получателя
              <select
                name="destinationAccountId"
                defaultValue={selected?.destinationAccountId ?? ""}
                required
              >
                <option value="">Выберите счёт</option>
                {accountOptions(selected?.destinationAccountId)}
              </select>
            </label>
          ) : (
            <label>
              Категория
              <select
                key={type}
                name="categoryId"
                defaultValue={selected?.categoryId ?? ""}
                required
              >
                <option value="">Выберите категорию</option>
                {categories
                  .filter(
                    (item) =>
                      item.type === type &&
                      (!item.isArchived || item.id === selected?.categoryId),
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label>
            Комментарий
            <textarea
              name="note"
              maxLength={500}
              defaultValue={selected?.note}
            />
          </label>
          <div className="actions">
            <button className="primary" disabled={busy}>
              Сохранить
            </button>
            <button type="button" onClick={close}>
              Отмена
            </button>
          </div>
        </form>
      )}
      <form
        className="card filters"
        onSubmit={apply}
        onReset={() => {
          setFilters("");
          setPage(1);
          setError("");
        }}
      >
        <label>
          С даты
          <input type="date" name="from" />
        </label>
        <label>
          По дату
          <input type="date" name="to" />
        </label>
        <label>
          Тип
          <select name="type">
            <option value="">Все</option>
            {Object.entries(entryNames).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Категория
          <select name="categoryId">
            <option value="">Все</option>
            {categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {entryNames[item.type]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Счёт
          <select name="accountId">
            <option value="">Все</option>
            {accounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Сумма от, ₽<input name="min" inputMode="decimal" />
        </label>
        <label>
          Сумма до, ₽<input name="max" inputMode="decimal" />
        </label>
        <label>
          Комментарий
          <input name="search" type="search" maxLength={500} />
        </label>
        <label>
          Сортировка
          <select name="sort">
            <option value="date">По дате</option>
            <option value="amountKopecks">По сумме</option>
          </select>
        </label>
        <label>
          Порядок
          <select name="order">
            <option value="desc">По убыванию</option>
            <option value="asc">По возрастанию</option>
          </select>
        </label>
        <div className="actions">
          <button>Применить</button>
          <button type="reset">Сбросить</button>
        </div>
      </form>
      <section className="card">
        {!result && !error && <p>Загрузка…</p>}
        {result?.items.length === 0 && <p>Операций не найдено.</p>}
        {result && (
          <ul className="rows">
            {result.items.map((entry) => (
              <li key={entry.id}>
                <div>
                  <strong>
                    {entry.category?.name ?? entryNames[entry.type]} ·{" "}
                    {money(entry.amountKopecks)}
                  </strong>
                  <div>
                    {entry.date} · {entry.account.name}
                    {entry.destinationAccount &&
                      ` → ${entry.destinationAccount.name}`}
                  </div>
                  {entry.note && <div>{entry.note}</div>}
                </div>
                <div className="actions">
                  <button
                    onClick={() => {
                      setSelected(entry);
                      setType(entry.type);
                      setFormOpen(true);
                      window.scrollTo(0, 0);
                    }}
                  >
                    Изменить
                  </button>
                  <button disabled={busy} onClick={() => void remove(entry)}>
                    Удалить
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {result && result.total > result.pageSize && (
          <div className="actions">
            <button
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Назад
            </button>
            <span>
              Страница {page} из {Math.ceil(result.total / result.pageSize)}
            </span>
            <button
              disabled={page * result.pageSize >= result.total}
              onClick={() => setPage((value) => value + 1)}
            >
              Далее
            </button>
          </div>
        )}
      </section>
    </>
  );
}
