import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Directories } from "./directories.js";
import { Transactions } from "./transactions.js";
import { Budgets, Dashboard } from "./reports.js";
import { Goals } from "./goals.js";
import { Analytics } from "./analytics.js";
import { Settings, applyTheme } from "./settings.js";
import { api } from "./api.js";
import "./style.css";

const links = {
  "/dashboard": "Главная",
  "/transactions": "Операции",
  "/accounts": "Счета",
  "/categories": "Категории",
  "/budgets": "Бюджеты",
  "/goals": "Цели",
  "/analytics": "Аналитика",
  "/settings": "Настройки",
};

function App() {
  const route = location.pathname === "/" ? "/dashboard" : location.pathname;
  return (
    <div className="layout">
      <aside className="sidebar">
        <a className="brand" href="/dashboard">
          Мой бюджет
        </a>
        <nav aria-label="Основное меню">
          {Object.entries(links).map(([path, label]) => (
            <a
              key={path}
              href={path}
              aria-current={route === path ? "page" : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
      </aside>
      <main className="content">
        {route === "/accounts" ? (
          <Directories mode="accounts" />
        ) : route === "/categories" ? (
          <Directories mode="categories" />
        ) : route === "/transactions" ? (
          <Transactions />
        ) : route === "/budgets" ? (
          <Budgets />
        ) : route === "/goals" ? (
          <Goals />
        ) : route === "/analytics" ? (
          <Analytics />
        ) : route === "/settings" ? (
          <Settings />
        ) : (
          <Dashboard />
        )}
      </main>
    </div>
  );
}

void api<{ theme: "light" | "dark" }>("/settings")
  .then((value) => applyTheme(value.theme))
  .catch(() => undefined);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
