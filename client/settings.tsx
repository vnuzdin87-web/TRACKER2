import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, entryNames, money } from "./api.js";

type SettingsData = { theme: "light" | "dark"; weekStartsOn: number };
type Preview = {
  token: string;
  exportedAt: string;
  counts: Record<string, number>;
};
type ImportReport = {
  imported: number;
  skipped: number;
  errors: { row: number; message: string }[];
};
type CsvPreview = {
  token: string;
  errors: ImportReport["errors"];
  rows: {
    row: number;
    duplicate: boolean;
    account: string;
    category?: string;
    destination?: string;
    date: string;
    type: keyof typeof entryNames;
    amountKopecks: number;
    note: string;
  }[];
};
const names: Record<string, string> = {
  accounts: "Счета",
  categories: "Категории",
  transactions: "Операции",
  budgets: "Бюджеты",
  goals: "Цели",
  contributions: "Взносы",
  settings: "Настройки",
};
const weekdays = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье",
];

export function applyTheme(theme: SettingsData["theme"]) {
  document.documentElement.dataset.theme = theme;
}

export function Settings() {
  const [settings, setSettings] = useState<SettingsData>();
  const [restore, setRestore] = useState<{
    preview: Preview;
    backup: unknown;
  }>();
  const [csvPreview, setCsvPreview] = useState<{
    csv: string;
    result: CsvPreview;
  }>();
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [report, setReport] = useState<ImportReport>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api<SettingsData>("/settings")
      .then((data) => {
        if (active) setSettings(data);
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
    setNotice("");
    setError("");
    try {
      await action();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void perform(async () => {
      const result = await api<SettingsData>("/settings", "PATCH", {
        theme: form.get("theme"),
        weekStartsOn: Number(form.get("weekStartsOn")),
      });
      setSettings(result);
      applyTheme(result.theme);
      setNotice("Настройки сохранены.");
    });
  }

  function fileFrom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    return new FormData(event.currentTarget).get("file") as File;
  }

  function inspect(event: FormEvent<HTMLFormElement>) {
    const file = fileFrom(event);
    setRestore(undefined);
    void perform(async () => {
      if (file.size > 20_000_000)
        throw new Error("Размер резервной копии превышает 20 МБ.");
      let backup: unknown;
      try {
        backup = JSON.parse(await file.text());
      } catch {
        throw new Error("Не удалось прочитать JSON-файл.");
      }
      const preview = await api<Preview>("/restore/preview", "POST", backup);
      setRestore({ preview, backup });
    });
  }

  function inspectCsv(event: FormEvent<HTMLFormElement>) {
    const file = fileFrom(event);
    setCsvPreview(undefined);
    setReport(undefined);
    setIncludeDuplicates(false);
    void perform(async () => {
      if (file.size > 8_000_000) throw new Error("Размер CSV превышает 8 МБ.");
      const csv = await file.text();
      setCsvPreview({
        csv,
        result: await api<CsvPreview>("/import/csv/preview", "POST", { csv }),
      });
    });
  }

  function confirmCsv() {
    if (!csvPreview) return;
    void perform(async () => {
      const { csv, result } = csvPreview;
      setCsvPreview(undefined);
      setReport(
        await api<ImportReport>("/import/csv", "POST", {
          csv,
          token: result.token,
          includeDuplicates,
        }),
      );
    });
  }

  const duplicates =
    csvPreview?.result.rows.filter((row) => row.duplicate).length ?? 0;
  return (
    <>
      <h1>Настройки</h1>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!settings && !error && <p role="status">Загрузка…</p>}
      {settings && (
        <form
          className="card form"
          key={settings.theme + settings.weekStartsOn}
          onSubmit={save}
        >
          <h2>Интерфейс</h2>
          <label>
            Тема
            <select name="theme" defaultValue={settings.theme}>
              <option value="light">Светлая</option>
              <option value="dark">Тёмная</option>
            </select>
          </label>
          <label>
            Первый день недели
            <select name="weekStartsOn" defaultValue={settings.weekStartsOn}>
              {weekdays.map((value, index) => (
                <option key={value} value={index + 1}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <p>Валюта — российский рубль. Язык — русский.</p>
          <button className="primary" disabled={busy}>
            Сохранить настройки
          </button>
        </form>
      )}
      <div className="report-grid">
        <section className="card">
          <h2>Экспорт</h2>
          <div className="actions mt-3">
            <a className="button" href="/api/v1/export?format=csv">
              Операции CSV
            </a>
            <a className="button" href="/api/v1/export?format=xlsx">
              Отчёт XLSX
            </a>
            <a className="button" href="/api/v1/backup">
              Резервная копия JSON
            </a>
          </div>
        </section>
        <form className="card form" onSubmit={inspectCsv}>
          <h2>Импорт операций</h2>
          <p>
            Используйте CSV с заголовками из экспорта. Импорт добавляет операции
            в существующие счета.
          </p>
          <label>
            Файл CSV
            <input
              name="file"
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={() => {
                setCsvPreview(undefined);
                setReport(undefined);
              }}
              required
            />
          </label>
          <button disabled={busy}>Проверить CSV</button>
          {csvPreview && (
            <div>
              <h3 className="font-semibold">Предпросмотр импорта</h3>
              <p role="status">
                К добавлению:{" "}
                {csvPreview.result.rows.length -
                  (includeDuplicates ? 0 : duplicates)}
                . Возможных дубликатов: {duplicates}. Ошибок:{" "}
                {csvPreview.result.errors.length}.
              </p>
              {duplicates > 0 && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={includeDuplicates}
                    onChange={(event) =>
                      setIncludeDuplicates(event.target.checked)
                    }
                  />{" "}
                  Добавить возможные дубликаты
                </label>
              )}
              <ul className="rows">
                {csvPreview.result.rows.map((item) => (
                  <li key={item.row}>
                    <span>
                      Строка {item.row} · {item.date} · {entryNames[item.type]}{" "}
                      · {money(item.amountKopecks)} · {item.account}
                      {item.destination && " → " + item.destination}
                      {item.category && " · " + item.category}
                      {item.note && " · " + item.note}
                      {item.duplicate &&
                        (includeDuplicates
                          ? " · Возможный дубликат"
                          : " · Дубликат, будет пропущен")}
                    </span>
                  </li>
                ))}
                {csvPreview.result.errors.map((item) => (
                  <li key={item.row}>
                    Строка {item.row} · {item.message}
                  </li>
                ))}
              </ul>
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  onClick={confirmCsv}
                  disabled={
                    busy ||
                    csvPreview.result.rows.length ===
                      (includeDuplicates ? 0 : duplicates)
                  }
                >
                  Подтвердить импорт
                </button>
                <button type="button" onClick={() => setCsvPreview(undefined)}>
                  Отмена
                </button>
              </div>
            </div>
          )}
          {report && (
            <div role="status">
              <p>
                Импортировано: {report.imported}. Пропущено: {report.skipped}.
                Ошибок: {report.errors.length}.
              </p>
              <ul className="rows">
                {report.errors.map((item) => (
                  <li key={item.row}>
                    Строка {item.row} · {item.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </form>
        <section className="card">
          <form className="form" onSubmit={inspect}>
            <h2>Восстановление из копии</h2>
            <label>
              Файл JSON
              <input
                name="file"
                type="file"
                accept=".json,application/json"
                onChange={() => setRestore(undefined)}
                required
              />
            </label>
            <button disabled={busy}>Проверить копию</button>
          </form>
          {restore && (
            <div className="mt-4">
              <h3 className="font-semibold">Содержимое копии</h3>
              <p>
                {new Date(restore.preview.exportedAt).toLocaleString("ru-RU")}
              </p>
              <ul className="rows">
                {Object.entries(restore.preview.counts).map(([key, value]) => (
                  <li key={key}>
                    <span>{names[key]}</span>
                    <strong>{value}</strong>
                  </li>
                ))}
              </ul>
              <p>Восстановление заменит все текущие данные.</p>
              <div className="actions mt-2">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        "Заменить текущие данные содержимым резервной копии?",
                      )
                    )
                      void perform(async () => {
                        await api("/restore/confirm", "POST", {
                          token: restore.preview.token,
                          backup: restore.backup,
                        });
                        const result = await api<SettingsData>("/settings");
                        setSettings(result);
                        applyTheme(result.theme);
                        setRestore(undefined);
                        setNotice("Данные восстановлены.");
                      });
                  }}
                >
                  Подтвердить восстановление
                </button>
                <button disabled={busy} onClick={() => setRestore(undefined)}>
                  Отмена
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
