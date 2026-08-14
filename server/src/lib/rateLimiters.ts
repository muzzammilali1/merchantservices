import rateLimit from "express-rate-limit";

const isTest = process.env.NODE_ENV === "test";

/**
 * Slows down credential-guessing against /api/auth/login and
 * /api/auth/change-password. Disabled under NODE_ENV=test since the test
 * suite legitimately logs in dozens of times per run from the same client.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: { error: "Too many attempts. Please try again later." },
});
