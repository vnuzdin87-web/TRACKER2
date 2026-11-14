import express from "express";
import type { ErrorRequestHandler } from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { directories } from "./directories.js";
import { HttpError } from "./http.js";

import { transactions } from "./transactions.js";

import { reports } from "./reports.js";

import { goals } from "./goals.js";
import { analytics } from "./analytics.js";

import { backup } from "./backup.js";
import { exchange } from "./exchange.js";

export const app = express();
app.disable("x-powered-by");
app.get("/health", (_request, response) => {
  response.json({ data: { status: "ok" } });
});
app.use("/api/v1", express.json({ limit: "24mb" }));

app.use(
  "/api/v1",
  directories,
  transactions,
  reports,
  goals,
  analytics,
  backup,
  exchange,
);

app.use("/api", (_request, response) => {
  response
    .status(404)
    .json({ error: { code: "NOT_FOUND", message: "Маршрут не найден." } });
});

const client = resolve(import.meta.dirname, "../client");
const index = resolve(client, "index.html");
if (existsSync(index)) {
  app.use(express.static(client));
  app.get("/{*path}", (_request, response) => response.sendFile(index));
}

const handleError: ErrorRequestHandler = (error, _request, response, _next) => {
  if (response.headersSent) return _next(error);
  if (
    error instanceof SyntaxError &&
    "status" in error &&
    error.status === 400
  ) {
    response
      .status(400)
      .json({
        error: { code: "INVALID_JSON", message: "Проверьте формат JSON." },
      });
    return;
  }
  if (error instanceof ZodError) {
    response
      .status(400)
      .json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Проверьте введённые данные.",
          fields: error.issues.map((issue) => issue.path.join(".")),
        },
      });
    return;
  }
  if (error instanceof HttpError) {
    response
      .status(error.status)
      .json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") {
      response
        .status(404)
        .json({ error: { code: "NOT_FOUND", message: "Запись не найдена." } });
      return;
    }
    if (["P2002", "P2003"].includes(error.code)) {
      response
        .status(409)
        .json({
          error: {
            code: "CONFLICT",
            message: "Запись уже существует или используется.",
          },
        });
      return;
    }
  }
  console.error(error);
  response
    .status(500)
    .json({ error: { code: "INTERNAL_ERROR", message: "Ошибка сервера." } });
};
app.use(handleError);
