import { describe, expect, it } from "vitest";
import { Decimal } from "@prisma/client/runtime/library";
import {
  calculateAmounts,
  resolveActiveRate,
  summarizeByGateway,
  summarizeTotals,
} from "./paymentCalculations";

describe("calculateAmounts", () => {
  it("computes deduction and net for a received payment", () => {
    const result = calculateAmounts(5000, 20, "RECEIVED");
    expect(result.deductionAmount?.toString()).toBe("1000");
    expect(result.netAmount?.toString()).toBe("4000");
  });

  it("returns null deduction/net for a not-received payment", () => {
    const result = calculateAmounts(2000, 20, "NOT_RECEIVED");
    expect(result.deductionAmount).toBeNull();
    expect(result.netAmount).toBeNull();
  });

  it("returns null deduction/net for a pending payment", () => {
    const result = calculateAmounts(2000, 20, "PENDING");
    expect(result.deductionAmount).toBeNull();
    expect(result.netAmount).toBeNull();
  });

  it("rounds to 2 decimal places", () => {
    const result = calculateAmounts(99.99, 33.33, "RECEIVED");
    expect(result.deductionAmount?.toFixed(2)).toBe("33.33");
    expect(result.netAmount?.toFixed(2)).toBe("66.66");
  });
});

describe("resolveActiveRate", () => {
  const history = [
    {
      merchantId: "m1",
      gatewayId: "g1",
      percentage: new Decimal(20),
      effectiveFrom: new Date("2026-01-01"),
      effectiveTo: new Date("2026-06-01"),
    },
    {
      merchantId: "m1",
      gatewayId: "g1",
      percentage: new Decimal(15),
      effectiveFrom: new Date("2026-06-01"),
      effectiveTo: null,
    },
  ];

  it("picks the rate active on a historical date", () => {
    const rate = resolveActiveRate(history, new Date("2026-03-01"));
    expect(rate?.percentage.toString()).toBe("20");
  });

  it("picks the current open-ended rate", () => {
    const rate = resolveActiveRate(history, new Date("2026-08-01"));
    expect(rate?.percentage.toString()).toBe("15");
  });

  it("returns null when no rate covers the date", () => {
    const rate = resolveActiveRate(history, new Date("2025-01-01"));
    expect(rate).toBeNull();
  });
});

describe("summarizeByGateway", () => {
  it("aggregates received, not-received, pending, deduction, and net per gateway", () => {
    const totals = summarizeByGateway([
      {
        gatewayId: "g1",
        gatewayName: "Gateway A",
        grossAmount: 5000,
        status: "RECEIVED",
        deductionAmount: 1000,
        netAmount: 4000,
      },
      {
        gatewayId: "g1",
        gatewayName: "Gateway A",
        grossAmount: 2000,
        status: "NOT_RECEIVED",
        deductionAmount: null,
        netAmount: null,
      },
      {
        gatewayId: "g2",
        gatewayName: "Gateway B",
        grossAmount: 3000,
        status: "RECEIVED",
        deductionAmount: 600,
        netAmount: 2400,
      },
    ]);

    const gatewayA = totals.find((t) => t.gatewayId === "g1");
    const gatewayB = totals.find((t) => t.gatewayId === "g2");

    expect(gatewayA?.received.toString()).toBe("5000");
    expect(gatewayA?.notReceived.toString()).toBe("2000");
    expect(gatewayA?.deduction.toString()).toBe("1000");
    expect(gatewayB?.received.toString()).toBe("3000");
    expect(gatewayB?.net.toString()).toBe("2400");
  });

  it("reflects a status flip from not-received to received when re-run", () => {
    const before = summarizeByGateway([
      {
        gatewayId: "g1",
        gatewayName: "Gateway A",
        grossAmount: 1000,
        status: "NOT_RECEIVED",
        deductionAmount: null,
        netAmount: null,
      },
    ]);
    expect(before[0].received.toString()).toBe("0");
    expect(before[0].notReceived.toString()).toBe("1000");

    const { deductionAmount, netAmount } = calculateAmounts(1000, 20, "RECEIVED");
    const after = summarizeByGateway([
      {
        gatewayId: "g1",
        gatewayName: "Gateway A",
        grossAmount: 1000,
        status: "RECEIVED",
        deductionAmount,
        netAmount,
      },
    ]);
    expect(after[0].received.toString()).toBe("1000");
    expect(after[0].notReceived.toString()).toBe("0");
    expect(after[0].deduction.toString()).toBe("200");
  });
});

describe("summarizeTotals", () => {
  it("aggregates gross/received/notReceived/pending/deduction/net/count with no grouping", () => {
    const totals = summarizeTotals([
      { grossAmount: 5000, status: "RECEIVED", deductionAmount: 1000, netAmount: 4000 },
      { grossAmount: 2000, status: "NOT_RECEIVED", deductionAmount: null, netAmount: null },
      { grossAmount: 1000, status: "PENDING", deductionAmount: null, netAmount: null },
      { grossAmount: 3000, status: "RECEIVED", deductionAmount: 600, netAmount: 2400 },
    ]);

    expect(totals.count).toBe(4);
    expect(totals.gross.toString()).toBe("11000");
    expect(totals.received.toString()).toBe("8000");
    expect(totals.notReceived.toString()).toBe("2000");
    expect(totals.pending.toString()).toBe("1000");
    expect(totals.deduction.toString()).toBe("1600");
    expect(totals.net.toString()).toBe("6400");
  });

  it("returns all zeros for an empty payment list", () => {
    const totals = summarizeTotals([]);
    expect(totals.count).toBe(0);
    expect(totals.gross.toString()).toBe("0");
  });
});
