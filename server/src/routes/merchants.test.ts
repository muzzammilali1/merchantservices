import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/auth";

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const ADMIN_EMAIL = `test-merchant-admin-${suffix}@example.com`;
const STAFF_EMAIL = `test-merchant-staff-${suffix}@example.com`;
const PASSWORD = "initial-password-123";

const createdUserIds: string[] = [];
const createdMerchantIds: string[] = [];
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
    data: { name: "Test Merchant Admin", email: ADMIN_EMAIL, passwordHash, role: "ADMIN" },
  });
  const staff = await prisma.user.create({
    data: { name: "Test Merchant Staff", email: STAFF_EMAIL, passwordHash, role: "STAFF" },
  });
  createdUserIds.push(admin.id, staff.id);

  const adminLogin = await request(app).post("/api/auth/login").send({ email: ADMIN_EMAIL, password: PASSWORD });
  adminCookie = extractCookie(adminLogin);
  const staffLogin = await request(app).post("/api/auth/login").send({ email: STAFF_EMAIL, password: PASSWORD });
  staffCookie = extractCookie(staffLogin);
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { changedById: { in: createdUserIds } },
        { entityId: { in: createdMerchantIds } },
      ],
    },
  });
  await prisma.merchant.deleteMany({ where: { id: { in: createdMerchantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("POST /api/merchants", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/merchants").send({ name: "Nope" });
    expect(res.status).toBe(401);
  });

  it("rejects staff (read-only role)", async () => {
    const res = await request(app)
      .post("/api/merchants")
      .set("Cookie", staffCookie)
      .send({ name: `Staff Attempt ${suffix}` });
    expect(res.status).toBe(403);
  });

  it("creates a merchant with a generated sequential code", async () => {
    const res1 = await request(app)
      .post("/api/merchants")
      .set("Cookie", adminCookie)
      .send({ name: `ABC Restaurant ${suffix}` });
    expect(res1.status).toBe(201);
    expect(res1.body.merchantCode).toMatch(/^MER-\d{4,}$/);
    expect(res1.body.active).toBe(true);
    createdMerchantIds.push(res1.body.id);

    const res2 = await request(app)
      .post("/api/merchants")
      .set("Cookie", adminCookie)
      .send({ name: `XYZ Diner ${suffix}` });
    expect(res2.status).toBe(201);
    createdMerchantIds.push(res2.body.id);

    const codeNum1 = parseInt(res1.body.merchantCode.split("-")[1], 10);
    const codeNum2 = parseInt(res2.body.merchantCode.split("-")[1], 10);
    expect(codeNum2).toBe(codeNum1 + 1);
  });

  it("rejects a duplicate name (case-insensitive)", async () => {
    const name = `ABC Restaurant ${suffix}`;
    const res = await request(app)
      .post("/api/merchants")
      .set("Cookie", adminCookie)
      .send({ name: name.toUpperCase() });
    expect(res.status).toBe(409);
  });

  it("rejects an empty name", async () => {
    const res = await request(app).post("/api/merchants").set("Cookie", adminCookie).send({ name: "   " });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/merchants", () => {
  it("allows staff to list merchants", async () => {
    const res = await request(app).get("/api/merchants").set("Cookie", staffCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("filters by search text", async () => {
    const res = await request(app)
      .get(`/api/merchants?search=${encodeURIComponent(`XYZ Diner ${suffix}`)}`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].name).toBe(`XYZ Diner ${suffix}`);
  });

  it("filters by active status", async () => {
    const res = await request(app)
      .get(`/api/merchants?search=${encodeURIComponent(String(suffix))}&active=false`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });
});

describe("GET /api/merchants/:id", () => {
  it("returns 404 for an unknown id", async () => {
    const res = await request(app).get("/api/merchants/does-not-exist").set("Cookie", adminCookie);
    expect(res.status).toBe(404);
  });

  it("returns the merchant for a valid id", async () => {
    const res = await request(app)
      .get(`/api/merchants/${createdMerchantIds[0]}`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createdMerchantIds[0]);
  });
});

describe("PATCH /api/merchants/:id", () => {
  it("rejects staff", async () => {
    const res = await request(app)
      .patch(`/api/merchants/${createdMerchantIds[0]}`)
      .set("Cookie", staffCookie)
      .send({ active: false });
    expect(res.status).toBe(403);
  });

  it("updates name and active, and records audit log entries", async () => {
    const newName = `ABC Restaurant Renamed ${suffix}`;
    const res = await request(app)
      .patch(`/api/merchants/${createdMerchantIds[0]}`)
      .set("Cookie", adminCookie)
      .send({ name: newName, active: false });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(newName);
    expect(res.body.active).toBe(false);

    const auditEntries = await prisma.auditLog.findMany({
      where: { entityType: "merchant", entityId: createdMerchantIds[0] },
    });
    const fields = auditEntries.map((e) => e.fieldChanged).sort();
    expect(fields).toEqual(["active", "name"]);

    const nameChange = auditEntries.find((e) => e.fieldChanged === "name")!;
    expect(nameChange.oldValue).toBe(`ABC Restaurant ${suffix}`);
    expect(nameChange.newValue).toBe(newName);
  });

  it("rejects renaming to a name that already exists", async () => {
    const res = await request(app)
      .patch(`/api/merchants/${createdMerchantIds[0]}`)
      .set("Cookie", adminCookie)
      .send({ name: `XYZ Diner ${suffix}` });
    expect(res.status).toBe(409);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request(app)
      .patch("/api/merchants/does-not-exist")
      .set("Cookie", adminCookie)
      .send({ active: true });
    expect(res.status).toBe(404);
  });
});
