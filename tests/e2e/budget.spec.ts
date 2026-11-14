import { expect, test } from "@playwright/test";

test("учёт расхода, лимит, тёмная тема и адаптивность", async ({
  page,
  request,
}) => {
  await page.goto("/accounts");
  await expect(page.getByText("Записей пока нет.")).toBeVisible();
  await page.getByLabel("Название").fill("Карта");
  await page.getByLabel("Тип").selectOption("DEBIT");
  await page.getByLabel("Начальный баланс, ₽").fill("10000");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("status")).toContainText("Изменения сохранены");
  const category = await request.post("/api/v1/categories", {
    data: { name: "Продукты", type: "EXPENSE", color: "#2563eb", icon: "●" },
  });
  expect(category.status()).toBe(201);
  await page.goto("/transactions?new");
  await page.getByLabel("Сумма, ₽", { exact: true }).fill("2500");
  await page.getByLabel("Дата", { exact: true }).fill("2026-11-13");
  const form = page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "Новая операция" }) });
  await form
    .getByRole("combobox", { name: "Счёт", exact: true })
    .selectOption({ label: "Карта" });
  await form
    .getByRole("combobox", { name: "Категория", exact: true })
    .selectOption({ label: "Продукты" });
  await form.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("status")).toContainText("Операция сохранена");
  await page.goto("/budgets?month=2026-11");
  await page.getByLabel("Продукты, ₽").fill("2000");
  await page.getByRole("button", { name: "Сохранить лимиты" }).click();
  await expect(page.getByText(/125% · Лимит достигнут/)).toBeVisible();
  await page.goto("/dashboard");
  await page.getByLabel("Месяц").fill("2026-11");
  await expect(page.getByText(/7\s500,00/)).toBeVisible();
  await page.getByRole("link", { name: "Продукты · 2026-11-13" }).click();
  await expect(
    page.getByRole("heading", { name: "Редактирование операции" }),
  ).toBeVisible();
  await page.goto("/settings");
  await page
    .getByRole("combobox", { name: "Тема", exact: true })
    .selectOption("dark");
  await page.getByRole("button", { name: "Сохранить настройки" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      "dashboard",
      "transactions",
      "accounts",
      "categories",
      "budgets",
      "goals",
      "analytics",
      "settings",
    ]) {
      await page.goto("/" + route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
    }
  }
});

test("предпросмотр CSV и восстановление скачанной копии", async ({
  page,
  request,
}) => {
  const accountResponse = await request.post("/api/v1/accounts", {
    data: {
      name: "Счёт для копии",
      type: "CASH",
      openingBalanceKopecks: 100000,
    },
  });
  expect(accountResponse.ok()).toBeTruthy();
  const account = (await accountResponse.json()).data;
  const categoryResponse = await request.post("/api/v1/categories", {
    data: {
      name: "Категория копии",
      type: "EXPENSE",
      color: "#112233",
      icon: "●",
    },
  });
  expect(categoryResponse.ok()).toBeTruthy();
  const category = (await categoryResponse.json()).data;
  const entry = await request.post("/api/v1/transactions", {
    data: {
      type: "EXPENSE",
      date: "2026-11-17",
      amountKopecks: 15000,
      accountId: account.id,
      categoryId: category.id,
      note: "Проверка копии",
    },
  });
  expect(entry.ok()).toBeTruthy();

  await page.goto("/settings");
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Операции CSV" }).click();
  const csv = await (await csvDownload).path();
  await page.getByLabel("Файл CSV").setInputFiles(csv);
  await page.getByRole("button", { name: "Проверить CSV" }).click();
  await expect(
    page.getByText(/Дубликат, будет пропущен/).first(),
  ).toBeVisible();
  const confirmImport = page.getByRole("button", {
    name: "Подтвердить импорт",
  });
  await expect(confirmImport).toBeDisabled();
  const transactions = async () => {
    const result = await request.get("/api/v1/transactions");
    expect(result.ok()).toBeTruthy();
    return (await result.json()).data;
  };
  const before = await transactions();
  await page
    .getByRole("checkbox", { name: "Добавить возможные дубликаты" })
    .check();
  await confirmImport.click();
  await expect(
    page.getByText("Импортировано: " + before.total, { exact: false }),
  ).toBeVisible();
  expect((await transactions()).total).toBe(before.total * 2);

  const backupDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Резервная копия JSON" }).click();
  const backup = await (await backupDownload).path();

  await page.goto("/accounts");
  const accountRow = page
    .getByRole("listitem")
    .filter({ hasText: account.name });
  await accountRow.getByRole("button", { name: "Изменить" }).click();
  await page.getByLabel("Название").fill("Изменённый счёт");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("status")).toContainText("Изменения сохранены");

  await page.goto("/settings");
  await page.getByLabel("Файл JSON").setInputFiles(backup);
  await page.getByRole("button", { name: "Проверить копию" }).click();
  await expect(
    page.getByRole("heading", { name: "Содержимое копии" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Подтвердить восстановление" })
    .click();
  await expect(page.getByText("Данные восстановлены.")).toBeVisible();
  await page.goto("/accounts");
  await expect(accountRow).toContainText(/700,00/);
  await expect(page.getByText("Изменённый счёт")).toHaveCount(0);
  const restored = (await transactions()).items.filter(
    (item: { accountId: string }) => item.accountId === account.id,
  );
  expect(restored).toHaveLength(2);
  for (const item of restored) {
    expect(item.account.name).toBe(account.name);
    expect(item.category.id).toBe(category.id);
  }
});
