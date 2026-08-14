import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const { entityType, entityId, from, to } = req.query;

  const where: Prisma.AuditLogWhereInput = {};
  if (typeof entityType === "string") where.entityType = entityType;
  if (typeof entityId === "string") where.entityId = entityId;
  if (typeof from === "string" || typeof to === "string") {
    where.changedAt = {};
    if (typeof from === "string" && !Number.isNaN(Date.parse(from))) {
      where.changedAt.gte = new Date(from);
    }
    if (typeof to === "string" && !Number.isNaN(Date.parse(to))) {
      where.changedAt.lte = new Date(to);
    }
  }

  const limit = Math.min(Number(req.query.limit) || 200, 500);

  const entries = await prisma.auditLog.findMany({
    where,
    orderBy: { changedAt: "desc" },
    take: limit,
    include: { changedBy: { select: { id: true, name: true } } },
  });

  res.json(
    entries.map((entry) => ({
      id: entry.id,
      entityType: entry.entityType,
      entityId: entry.entityId,
      fieldChanged: entry.fieldChanged,
      oldValue: entry.oldValue,
      newValue: entry.newValue,
      note: entry.note,
      changedBy: entry.changedBy,
      changedAt: entry.changedAt,
    }))
  );
});

export default router;
