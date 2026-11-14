import { PrismaClient } from "@prisma/client";

import { resolve } from "node:path";

process.env.DATABASE_URL ??= `file:${resolve("prisma/budget.db").replaceAll("\\", "/")}`;
export const db = new PrismaClient();
