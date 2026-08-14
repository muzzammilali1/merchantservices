import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("authRateLimiter", () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("is skipped entirely under NODE_ENV=test (so the test suite's many logins don't trip it)", async () => {
    process.env.NODE_ENV = "test";
    const { authRateLimiter } = await import("./rateLimiters");
    const app = express();
    app.get("/probe", authRateLimiter, (_req, res) => res.status(200).json({ ok: true }));

    for (let i = 0; i < 25; i++) {
      const res = await request(app).get("/probe");
      expect(res.status).toBe(200);
    }
  });

  it("blocks with 429 after the configured threshold outside of test mode", async () => {
    process.env.NODE_ENV = "production";
    const { authRateLimiter } = await import("./rateLimiters");
    const app = express();
    app.get("/probe", authRateLimiter, (_req, res) => res.status(200).json({ ok: true }));

    let lastStatus = 200;
    for (let i = 0; i < 21; i++) {
      const res = await request(app).get("/probe");
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
