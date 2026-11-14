import type { Server } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, expect, test } from "vitest";
import { app } from "../server/app.js";

let server: Server;
let url: string;

beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Сервер не запустился");
  url = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("отвечает на проверку доступности", async () => {
  const response = await fetch(`${url}/health`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { status: "ok" } });
});

test("возвращает ошибку JSON для неизвестного API-маршрута", async () => {
  const response = await fetch(`${url}/api/v1/unknown`);
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
});
