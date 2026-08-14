import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

const app = createApp();

describe("unmatched routes", () => {
  it("returns a JSON 404 instead of Express's default HTML page", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body.error).toBe("Not found");
  });
});

describe("unhandled errors in async route handlers", () => {
  it("are caught and returned as a generic 500 instead of hanging the request", async () => {
    // Rather than coax a real route into throwing, mount a throwing route on
    // a fresh app built the same way createApp() builds its middleware
    // stack, to verify express-async-errors + the error handler actually
    // catch a rejected async handler.
    // createApp() (imported above) already installed express-async-errors
    // process-wide, so a fresh express() instance here inherits the patch.
    const express = (await import("express")).default;
    const { errorHandler, notFoundHandler } = await import("./lib/errorHandler");

    const testApp = express();
    testApp.get("/boom", async () => {
      throw new Error("simulated failure");
    });
    testApp.use(notFoundHandler);
    testApp.use(errorHandler);

    const res = await request(testApp).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Internal server error");
    expect(res.body.error).not.toContain("simulated failure");
  });
});
