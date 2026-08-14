import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/auth";

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const ADMIN_EMAIL = `test-recalc-admin-${suffix}@example.com`;
const PASSWORD = "initial-password-123";

const createdUserIds: string[] = [];
const createdMerchantIds: string[] = [];
const createdGatewayIds: string[] = [];
const createdPaymentIds: string[] = [];
let adminCookie: string;
let merchantId: string;
let gatewayId: string;

function extractCookie(response: request.Response): string {
  const setCookie = response.headers["set-cookie"];
  if (!setCookie) throw new Error("Expected a Set-Cookie header");
  return Array.isArray(setCookie) ? setCookie[0] : setCookie;
}

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const admin = await prisma.user.create({
    data: { name: "Test Recalc Admin", email: ADMIN_EMAIL, passwordHash, role: "ADMIN" },
  });
  createdUserIds.push(admin.id);

  const login = await request(app).post("/api/auth/login").send({ email: ADMIN_EMAIL, password: PASSWORD });
  adminCookie = extractCookie(login);

  const merchant = await prisma.merchant.create({
    data: { name: `Recalc Merchant ${suffix}`, merchantCode: `RCM-${suffix}`, createdById: admin.id },
  });
  merchantId = merchant.id;
  createdMerchantIds.push(merchant.id);

  const gateway = await prisma.gateway.create({ data: { name: `Recalc Gateway ${suffix}`, createdById: admin.id } });
  gatewayId = gateway.id;
  createdGatewayIds.push(gateway.id);
});

afterAll(async () => {
  await prisma.rateRecalculation.deleteMany({
    where: { merchantGatewayRate: { merchantId: { in: createdMerchantIds } } },
  });
  await prisma.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { changedById: { in: createdUserIds } },
        { entityId: { in: [...createdMerchantIds, ...createdGatewayIds] } },
      ],
    },
  });
  await prisma.merchantGatewayRate.deleteMany({ where: { merchantId: { in: createdMerchantIds } } });
  await prisma.merchant.deleteMany({ where: { id: { in: createdMerchantIds } } });
  await prisma.gateway.deleteMany({ where: { id: { in: createdGatewayIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("forward-only rate changes (default)", () => {
  it("leaves existing payments' snapshot and deduction untouched", async () => {
    await request(app)
      .post(`/api/merchants/${merchantId}/gateway-rates`)
      .set("Cookie", adminCookie)
      .send({ gatewayId, percentage: 20 });

    const p = await request(app)
      .post("/api/payments")
      .set("Cookie", adminCookie)
      .send({ merchantId, gatewayId, grossAmount: 1000, status: "RECEIVED" });
    createdPaymentIds.push(p.body.id);
    expect(p.body.rateSnapshot).toBe("20");
    expect(p.body.deductionAmount).toBe("200");

    const changeRes = await request(app)
      .post(`/api/merchants/${merchantId}/gateway-rates`)
      .set("Cookie", adminCookie)
      .send({ gatewayId, percentage: 30 });
    expect(changeRes.body.paymentsAffectedCount).toBe(0);

    const check = await request(app).get(`/api/payments?merchantId=${merchantId}`).set("Cookie", adminCookie);
    const payment = check.body.find((row: { id: string }) => row.id === p.body.id);
    expect(payment.rateSnapshot).toBe("20");
    expect(payment.deductionAmount).toBe("200");
  });
});

describe("retroactive rate recalculation", () => {
  it("rewrites rateSnapshot and deduction/net on existing payments, and records a RateRecalculation row", async () => {
    const before = await request(app).get(`/api/payments?merchantId=${merchantId}`).set("Cookie", adminCookie);
    expect(before.body[0].rateSnapshot).toBe("20");

    const recalcRes = await request(app)
      .post(`/api/merchants/${merchantId}/gateway-rates`)
      .set("Cookie", adminCookie)
      .send({ gatewayId, percentage: 50, applyRetroactively: true });
    expect(recalcRes.status).toBe(201);
    expect(recalcRes.body.paymentsAffectedCount).toBe(1);

    const after = await request(app).get(`/api/payments?merchantId=${merchantId}`).set("Cookie", adminCookie);
    expect(after.body[0].rateSnapshot).toBe("50");
    expect(after.body[0].deductionAmount).toBe("500");
    expect(after.body[0].netAmount).toBe("500");

    const summary = await request(app).get(`/api/merchants/${merchantId}/summary`).set("Cookie", adminCookie);
    expect(summary.body.totals.totalDeduction).toBe("500");

    const recalcRows = await prisma.rateRecalculation.findMany({
      where: { merchantGatewayRate: { merchantId, gatewayId } },
    });
    expect(recalcRows.length).toBe(1);
    expect(recalcRows[0].oldPercentage.toString()).toBe("30");
    expect(recalcRows[0].newPercentage.toString()).toBe("50");
    expect(recalcRows[0].appliedRetroactively).toBe(true);
    expect(recalcRows[0].paymentsAffectedCount).toBe(1);
  });

  it("does not affect payments for a different gateway even on the same merchant", async () => {
    const otherGateway = await prisma.gateway.create({
      data: { name: `Recalc Other Gateway ${suffix}`, createdById: createdUserIds[0] },
    });
    createdGatewayIds.push(otherGateway.id);

    await request(app)
      .post(`/api/merchants/${merchantId}/gateway-rates`)
      .set("Cookie", adminCookie)
      .send({ gatewayId: otherGateway.id, percentage: 5 });

    const p = await request(app)
      .post("/api/payments")
      .set("Cookie", adminCookie)
      .send({ merchantId, gatewayId: otherGateway.id, grossAmount: 1000, status: "RECEIVED" });
    createdPaymentIds.push(p.body.id);

    await request(app)
      .post(`/api/merchants/${merchantId}/gateway-rates`)
      .set("Cookie", adminCookie)
      .send({ gatewayId, percentage: 60, applyRetroactively: true });

    const check = await request(app).get(`/api/payments?merchantId=${merchantId}`).set("Cookie", adminCookie);
    const otherPayment = check.body.find((row: { id: string }) => row.id === p.body.id);
    expect(otherPayment.rateSnapshot).toBe("5");
  });
});
