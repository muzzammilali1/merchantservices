import { describe, expect, it } from "vitest";
import { hashPassword, signToken, verifyPassword, verifyToken } from "./auth";

describe("password hashing", () => {
  it("hashes a password and can verify it back", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(hash).not.toBe("correct-horse-battery-staple");
    await expect(verifyPassword("correct-horse-battery-staple", hash)).resolves.toBe(true);
  });

  it("rejects an incorrect password against a hash", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });
});

describe("jwt tokens", () => {
  it("signs and verifies a round trip", () => {
    const token = signToken({ sub: "user_123", role: "ADMIN" });
    const payload = verifyToken(token);
    expect(payload.sub).toBe("user_123");
    expect(payload.role).toBe("ADMIN");
  });

  it("throws when verifying a tampered token", () => {
    const token = signToken({ sub: "user_123", role: "STAFF" });
    const tampered = token.slice(0, -2) + "xx";
    expect(() => verifyToken(tampered)).toThrow();
  });
});
