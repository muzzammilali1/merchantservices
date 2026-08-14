import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/auth";

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const ADMIN_EMAIL = `test-payment-admin-${suffix}@example.com`;
const STAFF_EMAIL = `test-payment-staff-${suffix}@example.com`;
const PASSWORD = "initial-password-123";

const createdUserIds: string[] = [];
const createdMerchantIds: string[] = [];
const createdGatewayIds: string[] = [];
const createdPaymentIds: string[] = [];
let adminCookie: string;
let staffCookie: string;

function extractCookie(response: request.Response): string {
  const setCookie = response.headers["set-cookie"];
  if (!setCookie) throw new Error("Expected a Set-Cookie header");
  return Array.isArray(setCookie) ? setCookie[0] : setCookie;
}

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const admin = await prisma.user.create({
    data: { name: "Test Payment Admin", email: ADMIN_EMAIL, passwordHash, role: "ADMIN" },
  });
  const staff = await prisma.user.create({
    data: { name: "Test Payment Staff", email: STAFF_EMAIL, passwordHash, role: "STAFF" },
  });
  createdUserIds.push(admin.id, staff.id);

  const adminLogin = await request(app).post("/api/auth/login").send({ email: ADMIN_EMAIL, password: PASSWORD });
  adminCookie = extractCookie(adminLogin);
  const staffLogin = await request(app).post("/api/auth/login").send({ email: STAFF_EMAIL, password: PASSWORD });
  staffCookie = extractCookie(staffLogin);

  const gateway = await prisma.gateway.create({
    data: { name: `Payment Test Gateway ${suffix}`, createdById: admin.id },
  });
  createdGatewayIds.push(gateway.id);

  const merchant = await prisma.merchant.create({
    data: {
      name: `Payment Test Merchant ${suffix}`,
      merchantCode: `PTM-${suffix}`,
      createdById: admin.id,
    },
  });
  createdMerchantIds.push(merchant.id);
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { changedById: { in: createdUserIds } },
        { entityId: { in: [...createdMerchantIds, ...createdGatewayIds] } },
      ],
    },
  });
  await prisma.merchantGatewayRate.deleteMany({
    where: { OR: [{ merchantId: { in: createdMerchantIds } }, { gatewayId: { in: createdGatewayIds } }] },
  });
  await prisma.merchant.deleteMany({ where: { id: { in: createdMerchantIds } } });
  await prisma.gateway.deleteMany({ where: { id: { in: createdGatewayIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("rate must exist before a payment can be recorded", () => {
  it("rejects payment creation when no rate is configured", async () => {
    const res = await request(app)
      .post("/api/payments")
      .set("Cookie", adminCookie)
      .send({ merchantId: createdMerchantIds[0], gatewayId: createdGatewayIds[0], grossAmount: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no rate/i);
  });
});

describe("POST /api/merchants/:id/gateway-rates", () => {
  it("rejects staff", async () => {
    const res = await request(app)
      .post(`/api/merchants/${createdMerchantIds[0]}/gateway-rates`)
      .set("Cookie", staffCookie)
      .send({ gatewayId: createdGatewayIds[0], percentage: 20 });
    expect(res.status).toBe(403);
  });

  it("sets an initial rate for a merchant+gateway pair", async () => {
    const res = await request(app)
      .post(`/api/merchants/${createdMerchantIds[0]}/gateway-rates`)
      .set("Cookie", adminCookie)
      .send({ gatewayId: createdGatewayIds[0], percentage: 20 });
    expect(res.status).toBe(201);
    expect(res.body.percentage).toBe("20");
    expect(res.body.effectiveTo).toBeNull();
  });

  it("changing the rate closes the old row and opens a new one", async () => {
    const before = await request(app)
      .get(`/api/merchants/${createdMerchantIds[0]}/gateway-rates`)
      .set("Cookie", adminCookie);
    expect(before.body.length).toBe(1);

    const res = await request(app)
      .post(`/api/merchants/${createdMerchantIds[0]}/gateway-rates`)
      .set("Cookie", adminCookie)
      .send({ gatewayId: createdGatewayIds[0], percentage: 15 });
    expect(res.status).toBe(201);
    expect(res.body.percentage).toBe("15");

    const after = await request(app)
      .get(`/api/merchants/${createdMerchantIds[0]}/gateway-rates`)
      .set("Cookie", adminCookie);
    expect(after.body.length).toBe(2);
    const current = after.body.find((r: { isCurrent: boolean }) => r.isCurrent);
    const past = after.body.find((r: { isCurrent: boolean }) => !r.isCurrent);
    expect(current.percentage).toBe("15");
    expect(past.percentage).toBe("20");
    expect(past.effectiveTo).not.toBeNull();
  });
});

describe("POST /api/payments", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app)
      .post("/api/payments")
      .send({ merchantId: createdMerchantIds[0], gatewayId: createdGatewayIds[0], grossAmount: 100 });
    expect(res.status).toBe(401);
  });

  it("creates a RECEIVED payment with computed deduction/net using the current rate (15%)", async () => {
    const res = await request(app)
      .post("/api/payments")
      .set("Cookie", staffCookie)
      .send({
        merchantId: createdMerchantIds[0],
        gatewayId: createdGatewayIds[0],
        grossAmount: 5000,
        status: "RECEIVED",
      });
    expect(res.status).toBe(201);
    expect(res.body.rateSnapshot).toBe("15");
    expect(res.body.deductionAmount).toBe("750");
    expect(res.body.netAmount).toBe("4250");
    expect(res.body.submittedAt).toBeDefined();
    createdPaymentIds.push(res.body.id);
  });

  it("defaults to PENDING status with null deduction/net when status is omitted", async () => {
    const res = await request(app)
      .post("/api/payments")
      .set("Cookie", adminCookie)
      .send({ merchantId: createdMerchantIds[0], gatewayId: createdGatewayIds[0], grossAmount: 1000 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
    expect(res.body.deductionAmount).toBeNull();
    expect(res.body.netAmount).toBeNull();
    createdPaymentIds.push(res.body.id);
  });

  it("auto-creates a merchant by name when no matching merchant exists, and reuses it on a second submission", async () => {
    const newMerchantName = `Brand New Merchant ${suffix}`;
    const res1 = await request(app)
      .post("/api/payments")
      .set("Cookie", adminCookie)
      .send({ merchantName: newMerchantName, gatewayId: createdGatewayIds[0], grossAmount: 500 });
    expect(res1.status).toBe(400);
    expect(res1.body.error).toMatch(/no rate/i);

    const newMerchant = await prisma.merchant.findFirst({ where: { name: newMerchantName } });
    expect(newMerchant).not.toBeNull();
    createdMerchantIds.push(newMerchant!.id);

    await request(app)
      .post(`/api/merchants/${newMerchant!.id}/gateway-rates`)
      .set("Cookie", adminCookie)
      .send({ gatewayId: createdGatewayIds[0], percentage: 10 });

    const res2 = await request(app)
      .post("/api/payments")
      .set("Cookie", adminCookie)
      .send({ merchantName: newMerchantName.toUpperCase(), gatewayId: createdGatewayIds[0], grossAmount: 200, status: "RECEIVED" });
    expect(res2.status).toBe(201);
    expect(res2.body.merchant.id).toBe(newMerchant!.id);
    expect(res2.body.deductionAmount).toBe("20");
    createdPaymentIds.push(res2.body.id);

    const merchantCount = await prisma.merchant.count({ where: { name: newMerchantName } });
    expect(merchantCount).toBe(1);
  });

  it("rejects a gross amount that is not a positive number", async () => {
    const res = await request(app)
      .post("/api/payments")
      .set("Cookie", adminCookie)
      .send({ merchantId: createdMerchantIds[0], gatewayId: createdGatewayIds[0], grossAmount: -5 });
    expect(res.status).toBe(400);
  });

  it("rejects an inactive gateway", async () => {
    await request(app)
      .patch(`/api/gateways/${createdGatewayIds[0]}`)
      .set("Cookie", adminCookie)
      .send({ active: false });

    const res = await request(app)
      .post("/api/payments")
      .set("Cookie", adminCookie)
      .send({ merchantId: createdMerchantIds[0], gatewayId: createdGatewayIds[0], grossAmount: 100 });
    expect(res.status).toBe(400);

    await request(app)
      .patch(`/api/gateways/${createdGatewayIds[0]}`)
      .set("Cookie", adminCookie)
      .send({ active: true });
  });
});
