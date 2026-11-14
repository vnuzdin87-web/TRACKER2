import type { Request, Response, RequestHandler } from "express";
import { z } from "zod";

export const uuid = z.uuid();
export const name = z.string().trim().min(1).max(100);
export const color = z.string().regex(/^#[0-9a-f]{6}$/i);
export const kopecks = z.number().int().min(-2147483648).max(2147483647);
export const positive = kopecks.min(1);
export const date = z.iso.date();
export const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function missing(): never {
  throw new HttpError(404, "NOT_FOUND", "Запись не найдена.");
}

export function invalid(message: string): never {
  throw new HttpError(400, "INVALID_DATA", message);
}

export function endpoint(
  handler: (request: Request, response: Response) => Promise<unknown>,
  status = 200,
): RequestHandler {
  return async (request, response) => {
    const data = await handler(request, response);
    if (response.headersSent) return;
    if (status === 204) response.sendStatus(204);
    else response.status(status).json({ data });
  };
}
