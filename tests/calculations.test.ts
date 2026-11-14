import { describe, expect, test } from "vitest";
import { cents } from "../client/api.js";
import { budgetUsage, shiftMonth } from "../server/reports.js";

describe("суммы и периоды", () => {
  test("переводит ввод в целые копейки", () => {
    expect(cents("10000,01")).toBe(1000001);
    expect(cents("-0.05")).toBe(-5);
    expect(() => cents("0.001")).toThrow();
    expect(() => cents("21474836.48")).toThrow();
  });
  test("обрабатывает границы лимита и смену года", () => {
    expect(budgetUsage(100, 79).status).toBe("normal");
    expect(budgetUsage(100, 80).status).toBe("warning");
    expect(budgetUsage(100, 100).status).toBe("reached");
    expect(budgetUsage(0, 1).percent).toBeNull();
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});
