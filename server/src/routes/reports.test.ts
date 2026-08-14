import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/auth";

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const ADMIN_EMAIL = `test-reports-admin-${suffix}@example.com`;
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
    data: { name: "Test Reports Admin", email: ADMIN_EMAIL, passwordHash, role: "ADMIN" },
  });
  createdUserIds.push(admin.id);

  const login = await request(app).post("/api/auth/login").send({ email: ADMIN_EMAIL, password: PASSWORD });
  adminCookie = extractCookie(login);

  const merchant = await prisma.merchant.create({
    data: { name: `Report Merchant ${suffix}`, merchantCode: `RPT-${suffix}`, createdById: admin.id },
  });
  merchantId = merchant.id;
  createdMerchantIds.push(merchant.id);

  const gateway = await prisma.gateway.create({ data: { name: `Report Gateway ${suffix}`, createdById: admin.id } });
  gatewayId = gateway.id;
  createdGatewayIds.push(gateway.id);

  await request(app)
    .post(`/api/merchants/${merchant.id}/gateway-rates`)
    .set("Cookie", adminCookie)
    .send({ gatewayId: gateway.id, percentage: 25 });

  const p1 = await request(app)
    .post("/api/payments")
    .set("Cookie", adminCookie)
    .send({ merchantId: merchant.id, gatewayId: gateway.id, grossAmount: 4000, status: "RECEIVED" });
  const p2 = await request(app)
    .post("/api/payments")
    .set("Cookie", adminCookie)
    .send({ merchantId: merchant.id, gatewayId: gateway.id, grossAmount: 1000, status: "NOT_RECEIVED" });
  const p3 = await request(app)
    .post("/api/payments")
    .set("Cookie", adminCookie)
    .send({ merchantId: merchant.id, gatewayId: gateway.id, grossAmount: 500, status: "PENDING" });
  createdPaymentIds.push(p1.body.id, p2.body.id, p3.body.id);
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
  await prisma.merchantGatewayRate.deleteMany({ where: { merchantId: { in: createdMerchantIds } } });
  await prisma.merchant.deleteMany({ where: { id: { in: createdMerchantIds } } });
  await prisma.gateway.deleteMany({ where: { id: { in: createdGatewayIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("GET /api/reports/dashboard", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/reports/dashboard");
    expect(res.status).toBe(401);
  });

  it("computes totals scoped to a single merchant+gateway via filters", async () => {
    const res = await request(app)
      .get(`/api/reports/dashboard?merchantId=${merchantId}&gatewayId=${gatewayId}`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.totalMerchants).toBe(1);
    expect(res.body.totalGatewayCount).toBe(1);
    expect(res.body.totals.gross).toBe("5500");
    expect(res.body.totals.received).toBe("4000");
    expect(res.body.totals.notReceived).toBe("1000");
    expect(res.body.totals.pending).toBe("500");
    expect(res.body.totals.deduction).toBe("1000");
    expect(res.body.totals.net).toBe("3000");
    expect(res.body.totals.count).toBe(3);

    const gw = res.body.gatewayBreakdown.find((g: { gatewayId: string }) => g.gatewayId === gatewayId);
    expect(gw.volume).toBe("5500");
  });

  it("filters by status", async () => {
    const res = await request(app)
      .get(`/api/reports/dashboard?merchantId=${merchantId}&status=RECEIVED`)
      .set("Cookie", adminCookie);
    expect(res.body.totals.count).toBe(1);
    expect(res.body.totals.received).toBe("4000");
    expect(res.body.totals.notReceived).toBe("0");
  });

  it("filters by date range excluding everything when the range is in the past", async () => {
    const res = await request(app)
      .get(`/api/reports/dashboard?merchantId=${merchantId}&to=2020-01-01`)
      .set("Cookie", adminCookie);
    expect(res.body.totals.count).toBe(0);
  });
});

describe("GET /api/reports/merchants", () => {
  it("includes the test merchant with correct totals", async () => {
    const res = await request(app)
      .get(`/api/reports/merchants?gatewayId=${gatewayId}`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const row = res.body.find((r: { merchantId: string }) => r.merchantId === merchantId);
    expect(row).toBeDefined();
    expect(row.totals.gross).toBe("5500");
    expect(row.totals.deduction).toBe("1000");
  });

  it("includes merchants with zero activity in the filtered range", async () => {
    const otherMerchant = await prisma.merchant.create({
      data: { name: `Zero Activity Merchant ${suffix}`, merchantCode: `ZAM-${suffix}`, createdById: createdUserIds[0] },
    });
    createdMerchantIds.push(otherMerchant.id);

    const res = await request(app)
      .get(`/api/reports/merchants?gatewayId=${gatewayId}`)
      .set("Cookie", adminCookie);
    const row = res.body.find((r: { merchantId: string }) => r.merchantId === otherMerchant.id);
    expect(row).toBeDefined();
    expect(row.totals.gross).toBe("0");
    expect(row.totals.count).toBe(0);
  });
});

describe("GET /api/reports/gateways", () => {
  it("includes the test gateway with correct totals", async () => {
    const res = await request(app)
      .get(`/api/reports/gateways?merchantId=${merchantId}`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const row = res.body.find((r: { gatewayId: string }) => r.gatewayId === gatewayId);
    expect(row).toBeDefined();
    expect(row.totals.gross).toBe("5500");
    expect(row.totals.count).toBe(3);
  });
});
