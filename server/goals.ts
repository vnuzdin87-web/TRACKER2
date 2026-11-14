import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "./db.js";
import {
  color,
  date,
  endpoint,
  invalid,
  missing,
  name,
  positive,
  uuid,
} from "./http.js";

export const goals = Router();
const goalInclude = {
  account: true,
  contributions: { orderBy: [{ date: "desc" }, { id: "desc" }] },
} satisfies Prisma.GoalInclude;
type Goal = Prisma.GoalGetPayload<{ include: typeof goalInclude }>;
const fields = z.strictObject({
  name,
  color,
  deadline: date,
  targetKopecks: positive,
  description: z.string().max(1000),
  accountId: uuid.nullable(),
  isArchived: z.boolean(),
});
const contribution = z.strictObject({ date, amountKopecks: positive });

function details(goal: Goal) {
  const savedKopecks = goal.contributions.reduce(
    (sum, item) => sum + item.amountKopecks,
    0,
  );
  return {
    ...goal,
    savedKopecks,
    percent: (savedKopecks * 100) / goal.targetKopecks,
  };
}

async function validateAccount(
  tx: Prisma.TransactionClient,
  id: string | null | undefined,
  current?: string | null,
) {
  if (id === undefined || id === null || id === current) return;
  const account = await tx.account.findUnique({ where: { id } });
  if (account?.type !== "SAVINGS" || !account.isActive)
    invalid("Выберите активный накопительный счёт.");
}

async function refresh(
  tx: Prisma.TransactionClient,
  id: string,
  archived?: boolean,
) {
  const goal =
    (await tx.goal.findUnique({ where: { id }, include: goalInclude })) ??
    missing();
  const data = details(goal);
  const isArchived = archived ?? goal.status === "ARCHIVED";
  const status = isArchived
    ? "ARCHIVED"
    : data.savedKopecks >= goal.targetKopecks
      ? "ACHIEVED"
      : "ACTIVE";
  if (goal.status !== status)
    await tx.goal.update({ where: { id }, data: { status } });
  return { ...data, status };
}

goals.get(
  "/goals",
  endpoint(async () =>
    (
      await db.goal.findMany({ include: goalInclude, orderBy: { name: "asc" } })
    ).map(details),
  ),
);
goals.post(
  "/goals",
  endpoint(
    (request) =>
      db.$transaction(async (tx) => {
        const { isArchived, ...data } = fields
          .extend({
            description: fields.shape.description.default(""),
            accountId: fields.shape.accountId.default(null),
            isArchived: fields.shape.isArchived.default(false),
          })
          .parse(request.body);
        await validateAccount(tx, data.accountId);
        return details(
          await tx.goal.create({
            data: { ...data, status: isArchived ? "ARCHIVED" : "ACTIVE" },
            include: goalInclude,
          }),
        );
      }),
    201,
  ),
);
goals.patch(
  "/goals/:id",
  endpoint((request) =>
    db.$transaction(async (tx) => {
      const id = uuid.parse(request.params.id);
      const { isArchived, ...data } = fields.partial().parse(request.body);
      const goal = (await tx.goal.findUnique({ where: { id } })) ?? missing();
      await validateAccount(tx, data.accountId, goal.accountId);
      await tx.goal.update({ where: { id }, data });
      return refresh(tx, id, isArchived);
    }),
  ),
);

goals.post(
  "/goals/:id/contributions",
  endpoint(
    (request) =>
      db.$transaction(async (tx) => {
        const goalId = uuid.parse(request.params.id);
        const goal =
          (await tx.goal.findUnique({ where: { id: goalId } })) ?? missing();
        if (goal.status === "ARCHIVED")
          invalid("Восстановите цель из архива перед добавлением взноса.");
        await tx.goalContribution.create({
          data: { ...contribution.parse(request.body), goalId },
        });
        return refresh(tx, goalId);
      }),
    201,
  ),
);

goals.patch(
  "/goals/:id/contributions/:contributionId",
  endpoint((request) =>
    db.$transaction(async (tx) => {
      const goalId = uuid.parse(request.params.id);
      const id = uuid.parse(request.params.contributionId);
      await tx.goalContribution.update({
        where: { id, goalId },
        data: contribution.partial().parse(request.body),
      });
      return refresh(tx, goalId);
    }),
  ),
);

goals.delete(
  "/goals/:id/contributions/:contributionId",
  endpoint(
    (request) =>
      db.$transaction(async (tx) => {
        const goalId = uuid.parse(request.params.id);
        const id = uuid.parse(request.params.contributionId);
        await tx.goalContribution.delete({ where: { id, goalId } });
        await refresh(tx, goalId);
      }),
    204,
  ),
);
