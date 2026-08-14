import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/auth";

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const ADMIN_EMAIL = `test-gateway-admin-${suffix}@example.com`;
const STAFF_EMAIL = `test-gateway-staff-${suffix}@example.com`;
const PASSWORD = "initial-password-123";

const createdUserIds: string[] = [];
const createdGatewayIds: string[] = [];
const createdMerchantIds: string[] = [];
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
    data: { name: "Test Gateway Admin", email: ADMIN_EMAIL, passwordHash, role: "ADMIN" },
  });
  const staff = await prisma.user.create({
    data: { name: "Test Gateway Staff", email: STAFF_EMAIL, passwordHash, role: "STAFF" },
  });
  createdUserIds.push(admin.id, staff.id);

  const adminLogin = await request(app).post("/api/auth/login").send({ email: ADMIN_EMAIL, password: PASSWORD });
  adminCookie = extractCookie(adminLogin);
  const staffLogin = await request(app).post("/api/auth/login").send({ email: STAFF_EMAIL, password: PASSWORD });
  staffCookie = extractCookie(staffLogin);
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { changedById: { in: createdUserIds } },
        { entityId: { in: [...createdGatewayIds, ...createdMerchantIds] } },
      ],
    },
  });
  await prisma.merchantGatewayRate.deleteMany({ where: { gatewayId: { in: createdGatewayIds } } });
  await prisma.gateway.deleteMany({ where: { id: { in: createdGatewayIds } } });
  await prisma.merchant.deleteMany({ where: { id: { in: createdMerchantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("POST /api/gateways", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/gateways").send({ name: "Nope" });
    expect(res.status).toBe(401);
  });

  it("rejects staff (read-only role)", async () => {
    const res = await request(app)
      .post("/api/gateways")
      .set("Cookie", staffCookie)
      .send({ name: `Staff Attempt ${suffix}` });
    expect(res.status).toBe(403);
  });

  it("creates a gateway", async () => {
    const res = await request(app)
      .post("/api/gateways")
      .set("Cookie", adminCookie)
      .send({ name: `Gateway A ${suffix}` });
    expect(res.status).toBe(201);
    expect(res.body.active).toBe(true);
    createdGatewayIds.push(res.body.id);
  });

  it("rejects a duplicate name (case-insensitive)", async () => {
    const res = await request(app)
      .post("/api/gateways")
      .set("Cookie", adminCookie)
      .send({ name: `gateway a ${suffix}`.toUpperCase() });
    expect(res.status).toBe(409);
  });
});

describe("GET /api/gateways", () => {
  it("allows staff to list and filters by search/active", async () => {
    const res = await request(app)
      .get(`/api/gateways?search=${encodeURIComponent(`Gateway A ${suffix}`)}`)
      .set("Cookie", staffCookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);

    const inactiveRes = await request(app)
      .get(`/api/gateways?search=${encodeURIComponent(`Gateway A ${suffix}`)}&active=false`)
      .set("Cookie", staffCookie);
    expect(inactiveRes.body.length).toBe(0);
  });
});

describe("PATCH /api/gateways/:id", () => {
  it("rejects staff", async () => {
    const res = await request(app)
      .patch(`/api/gateways/${createdGatewayIds[0]}`)
      .set("Cookie", staffCookie)
      .send({ active: false });
    expect(res.status).toBe(403);
  });

  it("disables a gateway and records an audit entry", async () => {
    const res = await request(app)
      .patch(`/api/gateways/${createdGatewayIds[0]}`)
      .set("Cookie", adminCookie)
      .send({ active: false });
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);

    const auditEntries = await prisma.auditLog.findMany({
      where: { entityType: "gateway", entityId: createdGatewayIds[0], fieldChanged: "active" },
    });
    expect(auditEntries.length).toBe(1);
    expect(auditEntries[0].oldValue).toBe("true");
    expect(auditEntries[0].newValue).toBe("false");
  });

  it("re-enables the gateway", async () => {
    const res = await request(app)
      .patch(`/api/gateways/${createdGatewayIds[0]}`)
      .set("Cookie", adminCookie)
      .send({ active: true });
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(true);
  });
});

describe("DELETE /api/gateways/:id", () => {
  it("deletes a gateway with no payments", async () => {
    const gateway = await prisma.gateway.create({
      data: { name: `Deletable Gateway ${suffix}`, createdById: createdUserIds[0] },
    });
    createdGatewayIds.push(gateway.id);

    const res = await request(app).delete(`/api/gateways/${gateway.id}`).set("Cookie", adminCookie);
    expect(res.status).toBe(204);

    const found = await prisma.gateway.findUnique({ where: { id: gateway.id } });
    expect(found).toBeNull();
    createdGatewayIds.splice(createdGatewayIds.indexOf(gateway.id), 1);
  });

  it("blocks deletion of a gateway with existing payments", async () => {
    const merchant = await prisma.merchant.create({
      data: {
        name: `Payment Merchant ${suffix}`,
        merchantCode: `TESTMER-${suffix}`,
        createdById: createdUserIds[0],
      },
    });
    createdMerchantIds.push(merchant.id);

    const payment = await prisma.payment.create({
      data: {
        merchantId: merchant.id,
        gatewayId: createdGatewayIds[0],
        grossAmount: 100,
        rateSnapshot: 20,
        status: "PENDING",
        createdById: createdUserIds[0],
      },
    });
    createdPaymentIds.push(payment.id);

    const res = await request(app).delete(`/api/gateways/${createdGatewayIds[0]}`).set("Cookie", adminCookie);
    expect(res.status).toBe(409);

    const stillExists = await prisma.gateway.findUnique({ where: { id: createdGatewayIds[0] } });
    expect(stillExists).not.toBeNull();
  });

  it("rejects staff", async () => {
    const res = await request(app).delete(`/api/gateways/${createdGatewayIds[0]}`).set("Cookie", staffCookie);
    expect(res.status).toBe(403);
  });
});
