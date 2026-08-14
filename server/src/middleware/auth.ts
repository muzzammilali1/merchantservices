import { NextFunction, Request, Response } from "express";
import { AUTH_COOKIE_NAME, verifyToken } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { User, UserRole } from "@prisma/client";

export type AuthenticatedUser = Pick<
  User,
  "id" | "name" | "email" | "role" | "active" | "mustChangePassword"
>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Reloads the user from the DB on every request (rather than trusting the
 * JWT payload alone) so a deactivated account is locked out immediately
 * instead of waiting for its token to expire.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });

    if (!user || !user.active) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
      mustChangePassword: user.mustChangePassword,
    };
    next();
  } catch {
    res.status(401).json({ error: "Not authenticated" });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}
