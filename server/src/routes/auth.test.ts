import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/auth";
import { requireAuth, requireRole } from "../middleware/auth";
import cookieParser from "cookie-parser";

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const ADMIN_EMAIL = `test-admin-${suffix}@example.com`;
const STAFF_EMAIL = `test-staff-${suffix}@example.com`;
const INACTIVE_EMAIL = `test-inactive-${suffix}@example.com`;
const PASSWORD = "initial-password-123";

const createdUserIds: string[] = [];

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);

  const admin = await prisma.user.create({
    data: { name: "Test Admin", email: ADMIN_EMAIL, passwordHash, role: "ADMIN" },
  });
  const staff = await prisma.user.create({
    data: { name: "Test Staff", email: STAFF_EMAIL, passwordHash, role: "STAFF" },
  });
  const inactive = await prisma.user.create({
    data: { name: "Test Inactive", email: INACTIVE_EMAIL, passwordHash, role: "ADMIN", active: false },
  });

  createdUserIds.push(admin.id, staff.id, inactive.id);
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { changedById: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

function extractCookie(response: request.Response): string {
  const setCookie = response.headers["set-cookie"];
  if (!setCookie) throw new Error("Expected a Set-Cookie header");
  return Array.isArray(setCookie) ? setCookie[0] : setCookie;
}

describe("POST /api/auth/login", () => {
  it("rejects an unknown email", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "whatever" });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: ADMIN_EMAIL, password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("rejects a deactivated user even with the correct password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: INACTIVE_EMAIL, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it("logs in with correct credentials and sets a session cookie", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: ADMIN_EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(ADMIN_EMAIL);
    expect(res.body.mustChangePassword).toBe(true);
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.headers["set-cookie"]).toBeDefined();
  });
});

describe("GET /api/auth/me", () => {
  it("rejects a request with no session cookie", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns the current user for a valid session", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: ADMIN_EMAIL, password: PASSWORD });
    const cookie = extractCookie(login);

    const res = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(ADMIN_EMAIL);
  });
});

describe("POST /api/auth/change-password", () => {
  it("rejects the wrong current password", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: ADMIN_EMAIL, password: PASSWORD });
    const cookie = extractCookie(login);

    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", cookie)
      .send({ currentPassword: "not-the-password", newPassword: "new-password-456" });
    expect(res.status).toBe(401);
  });

  it("changes the password, clears mustChangePassword, and allows login with the new password", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: ADMIN_EMAIL, password: PASSWORD });
    const cookie = extractCookie(login);

    const changeRes = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", cookie)
      .send({ currentPassword: PASSWORD, newPassword: "new-password-456" });
    expect(changeRes.status).toBe(204);

    const oldLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: ADMIN_EMAIL, password: PASSWORD });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: ADMIN_EMAIL, password: "new-password-456" });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.mustChangePassword).toBe(false);
  });
});

describe("requireRole", () => {
  it("allows an admin and blocks staff from an admin-only route", async () => {
    const testApp = express();
    testApp.use(express.json());
    testApp.use(cookieParser());
    testApp.use("/api/auth", (await import("../routes/auth")).default);
    testApp.get("/api/admin-only", requireAuth, requireRole("ADMIN"), (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const adminLogin = await request(testApp)
      .post("/api/auth/login")
      .send({ email: ADMIN_EMAIL, password: "new-password-456" });
    const adminCookie = extractCookie(adminLogin);

    const staffLogin = await request(testApp)
      .post("/api/auth/login")
      .send({ email: STAFF_EMAIL, password: PASSWORD });
    const staffCookie = extractCookie(staffLogin);

    const adminRes = await request(testApp).get("/api/admin-only").set("Cookie", adminCookie);
    expect(adminRes.status).toBe(200);

    const staffRes = await request(testApp).get("/api/admin-only").set("Cookie", staffCookie);
    expect(staffRes.status).toBe(403);
  });
});
