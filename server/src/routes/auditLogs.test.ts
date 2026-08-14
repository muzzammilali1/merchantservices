import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/auth";

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const ADMIN_EMAIL = `test-auditlog-admin-${suffix}@example.com`;
const PASSWORD = "initial-password-123";

const createdUserIds: string[] = [];
const createdMerchantIds: string[] = [];
let adminCookie: string;
let merchantId: string;

function extractCookie(response: request.Response): string {
  const setCookie = response.headers["set-cookie"];
  if (!setCookie) throw new Error("Expected a Set-Cookie header");
  return Array.isArray(setCookie) ? setCookie[0] : setCookie;
}

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const admin = await prisma.user.create({
    data: { name: "Test Auditlog Admin", email: ADMIN_EMAIL, passwordHash, role: "ADMIN" },
  });
  createdUserIds.push(admin.id);

  const login = await request(app).post("/api/auth/login").send({ email: ADMIN_EMAIL, password: PASSWORD });
  adminCookie = extractCookie(login);

  const merchant = await prisma.merchant.create({
    data: { name: `Audit Merchant ${suffix}`, merchantCode: `AUD-${suffix}`, createdById: admin.id },
  });
  merchantId = merchant.id;
  createdMerchantIds.push(merchant.id);
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { OR: [{ changedById: { in: createdUserIds } }, { entityId: { in: createdMerchantIds } }] },
  });
  await prisma.merchant.deleteMany({ where: { id: { in: createdMerchantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("GET /api/audit-logs", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/audit-logs");
    expect(res.status).toBe(401);
  });

  it("records and returns an edit with old/new values and who made it", async () => {
    const newName = `Audit Merchant Renamed ${suffix}`;
    await request(app)
      .patch(`/api/merchants/${merchantId}`)
      .set("Cookie", adminCookie)
      .send({ name: newName });

    const res = await request(app)
      .get(`/api/audit-logs?entityType=merchant&entityId=${merchantId}`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].fieldChanged).toBe("name");
    expect(res.body[0].oldValue).toBe(`Audit Merchant ${suffix}`);
    expect(res.body[0].newValue).toBe(newName);
    expect(res.body[0].changedBy.name).toBe("Test Auditlog Admin");
  });

  it("filters by date range", async () => {
    const res = await request(app)
      .get(`/api/audit-logs?entityType=merchant&entityId=${merchantId}&to=2020-01-01`)
      .set("Cookie", adminCookie);
    expect(res.body.length).toBe(0);
  });
});
