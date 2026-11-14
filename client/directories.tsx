import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  api,
  accountNames,
  entryNames,
  cents,
  inputMoney,
  money,
} from "./api.js";
import type { Account, Category } from "./api.js";

type Mode = "accounts" | "categories";
type Item = Account | Category;

export function Directories({ mode }: { mode: Mode }) {
  const [items, setItems] = useState<Item[]>();
  const [selected, setSelected] = useState<Item>();
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const accounts = mode === "accounts";
  const account = selected && "isActive" in selected ? selected : undefined;
  const category = selected && "isArchived" in selected ? selected : undefined;

  useEffect(() => {
    let active = true;
    api<Item[]>(`/${mode}`)
      .then((data) => {
        if (active) setItems(data);
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [mode, revision]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const body = accounts
        ? {
            name: form.get("name"),
            type: form.get("type"),
            openingBalanceKopecks: cents(String(form.get("amount"))),
            isActive: form.has("active"),
          }
        : {
            name: form.get("name"),
            ...(category ? {} : { type: form.get("type") }),
            color: form.get("color"),
            icon: form.get("icon"),
            isArchived: !form.has("active"),
          };
      await api(
        `/${mode}${selected ? `/${selected.id}` : ""}`,
        selected ? "PATCH" : "POST",
        body,
      );
      setSelected(undefined);
      setRevision((value) => value + 1);
      setNotice("Изменения сохранены.");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h1>{accounts ? "Счета" : "Категории"}</h1>
      <section className="card">
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {!items && !error && <p>Загрузка…</p>}
        {items?.length === 0 && <p>Записей пока нет.</p>}
        {items && (
          <ul className="rows">
            {items.map((item) => (
              <li key={item.id}>
                <span>
                  {"icon" in item && (
                    <span style={{ color: item.color }}>{item.icon} </span>
                  )}
                  <strong>{item.name}</strong>
                  {" · "}
                  {"isActive" in item
                    ? `${accountNames[item.type]} · ${money(item.balanceKopecks ?? item.openingBalanceKopecks)}${item.isActive ? "" : " · В архиве"}`
                    : `${entryNames[item.type]}${item.isArchived ? " · В архиве" : ""}`}
                </span>
                <button type="button" onClick={() => setSelected(item)}>
                  Изменить
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <form
        className="card form"
        key={selected?.id ?? revision}
        onSubmit={save}
      >
        <h2>
          {selected
            ? `Редактирование: ${selected.name}`
            : accounts
              ? "Новый счёт"
              : "Новая категория"}
        </h2>
        <label>
          Название
          <input
            name="name"
            maxLength={100}
            defaultValue={selected?.name}
            required
          />
        </label>
        <label>
          Тип
          <select
            name="type"
            defaultValue={selected?.type}
            disabled={!!category}
          >
            {Object.entries(
              accounts ? accountNames : { INCOME: "Доход", EXPENSE: "Расход" },
            ).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {accounts ? (
          <label>
            Начальный баланс, ₽
            <input
              name="amount"
              inputMode="decimal"
              defaultValue={inputMoney(account?.openingBalanceKopecks ?? 0)}
              required
            />
          </label>
        ) : (
          <>
            <label>
              Цвет
              <input
                name="color"
                type="color"
                defaultValue={category?.color ?? "#2563eb"}
              />
            </label>
            <label>
              Иконка
              <input
                name="icon"
                maxLength={32}
                defaultValue={category?.icon ?? "●"}
                required
              />
            </label>
          </>
        )}
        <label className="check">
          <input
            name="active"
            type="checkbox"
            defaultChecked={account?.isActive ?? !category?.isArchived}
          />{" "}
          Активная запись
        </label>
        <div className="actions">
          <button className="primary" disabled={saving}>
            Сохранить
          </button>
          {selected && (
            <button type="button" onClick={() => setSelected(undefined)}>
              Отмена
            </button>
          )}
        </div>
      </form>
    </>
  );
}
