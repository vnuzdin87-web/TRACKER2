import { Router } from "express";
import { z } from "zod";
import { db } from "./db.js";
import { color, endpoint, kopecks, name, uuid } from "./http.js";

import { balances } from "./transactions.js";

export const directories = Router();
export const accountTypes = ["CASH", "DEBIT", "SAVINGS", "OTHER"] as const;
export const categoryTypes = ["INCOME", "EXPENSE"] as const;

export const accountBody = z.strictObject({
  name,
  type: z.enum(accountTypes),
  openingBalanceKopecks: kopecks,
  isActive: z.boolean().optional(),
});

export const categoryBody = z.strictObject({
  name,
  type: z.enum(categoryTypes),
  color,
  icon: z.string().trim().min(1).max(32),
  isArchived: z.boolean().optional(),
});

directories.get(
  "/accounts",
  endpoint(() => db.$transaction((tx) => balances(tx))),
);
directories.post(
  "/accounts",
  endpoint(
    (request) => db.account.create({ data: accountBody.parse(request.body) }),
    201,
  ),
);
directories.patch(
  "/accounts/:id",
  endpoint((request) =>
    db.account.update({
      where: { id: uuid.parse(request.params.id) },
      data: accountBody.partial().parse(request.body),
    }),
  ),
);

directories.get(
  "/categories",
  endpoint(() =>
    db.category.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] }),
  ),
);
directories.post(
  "/categories",
  endpoint(
    (request) => db.category.create({ data: categoryBody.parse(request.body) }),
    201,
  ),
);
directories.patch(
  "/categories/:id",
  endpoint((request) =>
    db.category.update({
      where: { id: uuid.parse(request.params.id) },
      data: categoryBody.omit({ type: true }).partial().parse(request.body),
    }),
  ),
);
