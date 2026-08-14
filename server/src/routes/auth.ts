import { Router } from "express";
import { prisma } from "../lib/prisma";
import { AUTH_COOKIE_NAME, hashPassword, signToken, verifyPassword } from "../lib/auth";
import { requireAuth } from "../middleware/auth";

const router = Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 12 * 60 * 60 * 1000,
};

router.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const validPassword = await verifyPassword(password, user.passwordHash);
  if (!validPassword) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const token = signToken({ sub: user.id, role: user.role });
  res.cookie(AUTH_COOKIE_NAME, token, COOKIE_OPTIONS);
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  });
});

router.post("/logout", (_req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME, COOKIE_OPTIONS);
  res.status(204).send();
});

router.get("/me", requireAuth, (req, res) => {
  res.json(req.user);
});

router.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    res.status(400).json({ error: "Current and new password are required" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  const validPassword = await verifyPassword(currentPassword, user.passwordHash);
  if (!validPassword) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  });

  await prisma.auditLog.create({
    data: {
      entityType: "user",
      entityId: user.id,
      fieldChanged: "password",
      note: "Password changed by user",
      changedById: user.id,
    },
  });

  res.status(204).send();
});

export default router;
