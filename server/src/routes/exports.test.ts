import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/auth";

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const ADMIN_EMAIL = `test-export-admin-${suffix}@example.com`;
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
    data: { name: "Test Export Admin", email: ADMIN_EMAIL, passwordHash, role: "ADMIN" },
  });
  createdUserIds.push(admin.id);

  const login = await request(app).post("/api/auth/login").send({ email: ADMIN_EMAIL, password: PASSWORD });
  adminCookie = extractCookie(login);

  const merchant = await prisma.merchant.create({
    data: { name: `Export Merchant ${suffix}`, merchantCode: `EXP-${suffix}`, createdById: admin.id },
  });
  merchantId = merchant.id;
  createdMerchantIds.push(merchant.id);

  const gateway = await prisma.gateway.create({ data: { name: `Export Gateway ${suffix}`, createdById: admin.id } });
  gatewayId = gateway.id;
  createdGatewayIds.push(gateway.id);

  await request(app)
    .post(`/api/merchants/${merchant.id}/gateway-rates`)
    .set("Cookie", adminCookie)
    .send({ gatewayId: gateway.id, percentage: 20 });

  const p = await request(app)
    .post("/api/payments")
    .set("Cookie", adminCookie)
    .send({ merchantId: merchant.id, gatewayId: gateway.id, grossAmount: 3000, status: "RECEIVED" });
  createdPaymentIds.push(p.body.id);
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

describe("CSV exports", () => {
  it("GET /api/payments?format=csv returns a CSV with the payment row", async () => {
    const res = await request(app)
      .get(`/api/payments?merchantId=${merchantId}&format=csv`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.text).toContain("Date,Time,Merchant,Gateway,Gross,Status");
    expect(res.text).toContain(`Export Merchant ${suffix}`);
    expect(res.text).toContain("3000");
  });

  it("GET /api/reports/merchants?format=csv returns a CSV with the merchant row", async () => {
    const res = await request(app)
      .get(`/api/reports/merchants?merchantId=${merchantId}&format=csv`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text).toContain(`Export Merchant ${suffix}`);
    expect(res.text).toContain("600");
  });

  it("GET /api/reports/gateways?format=csv returns a CSV with the gateway row", async () => {
    const res = await request(app)
      .get(`/api/reports/gateways?gatewayId=${gatewayId}&format=csv`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text).toContain(`Export Gateway ${suffix}`);
  });
});

describe("PDF exports", () => {
  it("GET /api/merchants/:id/summary?format=pdf returns a valid PDF document", async () => {
    const res = await request(app)
      .get(`/api/merchants/${merchantId}/summary?format=pdf`)
      .set("Cookie", adminCookie)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    const buffer = res.body as Buffer;
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(500);
  });

  it("GET /api/reports/merchants?format=pdf returns a valid PDF document", async () => {
    const res = await request(app)
      .get(`/api/reports/merchants?format=pdf`)
      .set("Cookie", adminCookie)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    const buffer = res.body as Buffer;
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("GET /api/reports/gateways?format=pdf returns a valid PDF document", async () => {
    const res = await request(app)
      .get(`/api/reports/gateways?format=pdf`)
      .set("Cookie", adminCookie)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    const buffer = res.body as Buffer;
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
