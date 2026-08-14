import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/auth";

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const ADMIN_EMAIL = `test-summary-admin-${suffix}@example.com`;
const STAFF_EMAIL = `test-summary-staff-${suffix}@example.com`;
const PASSWORD = "initial-password-123";

const createdUserIds: string[] = [];
const createdMerchantIds: string[] = [];
const createdGatewayIds: string[] = [];
const createdPaymentIds: string[] = [];
let adminCookie: string;
let staffCookie: string;
let merchantId: string;
let gatewayAId: string;
let gatewayBId: string;

function extractCookie(response: request.Response): string {
  const setCookie = response.headers["set-cookie"];
  if (!setCookie) throw new Error("Expected a Set-Cookie header");
  return Array.isArray(setCookie) ? setCookie[0] : setCookie;
}

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const admin = await prisma.user.create({
    data: { name: "Test Summary Admin", email: ADMIN_EMAIL, passwordHash, role: "ADMIN" },
  });
  const staff = await prisma.user.create({
    data: { name: "Test Summary Staff", email: STAFF_EMAIL, passwordHash, role: "STAFF" },
  });
  createdUserIds.push(admin.id, staff.id);

  const adminLogin = await request(app).post("/api/auth/login").send({ email: ADMIN_EMAIL, password: PASSWORD });
  adminCookie = extractCookie(adminLogin);
  const staffLogin = await request(app).post("/api/auth/login").send({ email: STAFF_EMAIL, password: PASSWORD });
  staffCookie = extractCookie(staffLogin);

  const merchant = await prisma.merchant.create({
    data: { name: `Summary Merchant ${suffix}`, merchantCode: `SUM-${suffix}`, createdById: admin.id },
  });
  merchantId = merchant.id;
  createdMerchantIds.push(merchant.id);

  const gatewayA = await prisma.gateway.create({ data: { name: `Summary Gateway A ${suffix}`, createdById: admin.id } });
  const gatewayB = await prisma.gateway.create({ data: { name: `Summary Gateway B ${suffix}`, createdById: admin.id } });
  gatewayAId = gatewayA.id;
  gatewayBId = gatewayB.id;
  createdGatewayIds.push(gatewayA.id, gatewayB.id);

  await request(app)
    .post(`/api/merchants/${merchant.id}/gateway-rates`)
    .set("Cookie", adminCookie)
    .send({ gatewayId: gatewayA.id, percentage: 20 });
  await request(app)
    .post(`/api/merchants/${merchant.id}/gateway-rates`)
    .set("Cookie", adminCookie)
    .send({ gatewayId: gatewayB.id, percentage: 10 });

  const p1 = await request(app)
    .post("/api/payments")
    .set("Cookie", adminCookie)
    .send({ merchantId: merchant.id, gatewayId: gatewayA.id, grossAmount: 20000, status: "RECEIVED" });
  const p2 = await request(app)
    .post("/api/payments")
    .set("Cookie", adminCookie)
    .send({ merchantId: merchant.id, gatewayId: gatewayB.id, grossAmount: 15000, status: "RECEIVED" });
  const p3 = await request(app)
    .post("/api/payments")
    .set("Cookie", adminCookie)
    .send({ merchantId: merchant.id, gatewayId: gatewayA.id, grossAmount: 2000, status: "NOT_RECEIVED" });
  const p4 = await request(app)
    .post("/api/payments")
    .set("Cookie", adminCookie)
    .send({ merchantId: merchant.id, gatewayId: gatewayB.id, grossAmount: 1000, status: "PENDING" });
  createdPaymentIds.push(p1.body.id, p2.body.id, p3.body.id, p4.body.id);
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { changedById: { in: createdUserIds } },
        { entityId: { in: [...createdMerchantIds, ...createdGatewayIds, ...createdPaymentIds] } },
      ],
    },
  });
  await prisma.merchantGatewayRate.deleteMany({ where: { merchantId: { in: createdMerchantIds } } });
  await prisma.merchant.deleteMany({ where: { id: { in: createdMerchantIds } } });
  await prisma.gateway.deleteMany({ where: { id: { in: createdGatewayIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("GET /api/merchants/:id/summary", () => {
  it("returns correct totals and per-gateway breakdown (matches the spec example: 20000@20% + 15000@10%)", async () => {
    const res = await request(app).get(`/api/merchants/${merchantId}/summary`).set("Cookie", staffCookie);
    expect(res.status).toBe(200);
    expect(res.body.totals.totalReceived).toBe("35000");
    expect(res.body.totals.totalNotReceived).toBe("2000");
    expect(res.body.totals.totalPending).toBe("1000");
    expect(res.body.totals.totalGross).toBe("38000");
    expect(res.body.totals.totalDeduction).toBe("5500");
    expect(res.body.totals.totalNet).toBe("29500");

    const gwA = res.body.gatewayBreakdown.find((g: { gatewayId: string }) => g.gatewayId === gatewayAId);
    const gwB = res.body.gatewayBreakdown.find((g: { gatewayId: string }) => g.gatewayId === gatewayBId);
    expect(gwA.received).toBe("20000");
    expect(gwA.deduction).toBe("4000");
    expect(gwB.received).toBe("15000");
    expect(gwB.deduction).toBe("1500");

    expect(res.body.currentRates.length).toBe(2);
  });

  it("returns 404 for an unknown merchant", async () => {
    const res = await request(app).get("/api/merchants/does-not-exist/summary").set("Cookie", adminCookie);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/payments filters", () => {
  it("filters by merchantId and status", async () => {
    const res = await request(app)
      .get(`/api/payments?merchantId=${merchantId}&status=RECEIVED`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body.every((p: { status: string }) => p.status === "RECEIVED")).toBe(true);
  });

  it("filters by gatewayId", async () => {
    const res = await request(app)
      .get(`/api/payments?merchantId=${merchantId}&gatewayId=${gatewayAId}`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it("includes gateway name and createdBy on each row", async () => {
    const res = await request(app)
      .get(`/api/payments?merchantId=${merchantId}&limit=1`)
      .set("Cookie", adminCookie);
    expect(res.body[0].gateway.name).toBeDefined();
    expect(res.body[0].createdBy.name).toBeDefined();
  });
});

describe("PATCH /api/payments/:id — status change updates totals", () => {
  it("rejects staff", async () => {
    const res = await request(app)
      .patch(`/api/payments/${createdPaymentIds[3]}`)
      .set("Cookie", staffCookie)
      .send({ status: "RECEIVED" });
    expect(res.status).toBe(403);
  });

  it("flips the PENDING payment to RECEIVED, computes deduction from its own rateSnapshot, and the merchant summary reflects it", async () => {
    const patchRes = await request(app)
      .patch(`/api/payments/${createdPaymentIds[3]}`)
      .set("Cookie", adminCookie)
      .send({ status: "RECEIVED" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.status).toBe("RECEIVED");
    expect(patchRes.body.rateSnapshot).toBe("10");
    expect(patchRes.body.deductionAmount).toBe("100");
    expect(patchRes.body.netAmount).toBe("900");

    const summary = await request(app).get(`/api/merchants/${merchantId}/summary`).set("Cookie", adminCookie);
    expect(summary.body.totals.totalPending).toBe("0");
    expect(summary.body.totals.totalReceived).toBe("36000");
    expect(summary.body.totals.totalDeduction).toBe("5600");

    const auditEntries = await prisma.auditLog.findMany({
      where: { entityType: "payment", entityId: createdPaymentIds[3], fieldChanged: "status" },
    });
    expect(auditEntries.length).toBe(1);
    expect(auditEntries[0].oldValue).toBe("PENDING");
    expect(auditEntries[0].newValue).toBe("RECEIVED");
  });

  it("does not change the deduction rate even if the merchant's current rate is later changed (snapshot is preserved)", async () => {
    await request(app)
      .post(`/api/merchants/${merchantId}/gateway-rates`)
      .set("Cookie", adminCookie)
      .send({ gatewayId: gatewayBId, percentage: 50 });

    const res = await request(app).get(`/api/payments?merchantId=${merchantId}`).set("Cookie", adminCookie);
    const flipped = res.body.find((p: { id: string }) => p.id === createdPaymentIds[3]);
    expect(flipped.rateSnapshot).toBe("10");
    expect(flipped.deductionAmount).toBe("100");
  });
});
