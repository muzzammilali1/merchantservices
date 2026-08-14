import "express-async-errors";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import authRouter from "./routes/auth";
import merchantsRouter from "./routes/merchants";
import gatewaysRouter from "./routes/gateways";
import paymentsRouter from "./routes/payments";
import reportsRouter from "./routes/reports";
import auditLogsRouter from "./routes/auditLogs";
import { authRateLimiter } from "./lib/rateLimiters";
import { errorHandler, notFoundHandler } from "./lib/errorHandler";

const DEFAULT_ORIGINS = ["http://localhost:5173", "http://localhost:5174"];

export function createApp() {
  const app = express();
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()) ?? DEFAULT_ORIGINS;

  // This API is consumed cross-origin by the portal/admin SPAs (different
  // ports even in local dev), including direct-navigation file downloads
  // (CSV/PDF export links) — the default same-origin resource policy would
  // block those, so it's relaxed here.
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(compression());
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.use("/api/auth", authRateLimiter, authRouter);
  app.use("/api/merchants", merchantsRouter);
  app.use("/api/gateways", gatewaysRouter);
  app.use("/api/payments", paymentsRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/audit-logs", auditLogsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
