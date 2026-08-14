import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { recordAuditChange } from "../lib/audit";

const router = Router();
router.use(requireAuth);

function serializeGateway(gateway: {
  id: string;
  name: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: gateway.id,
    name: gateway.name,
    active: gateway.active,
    createdAt: gateway.createdAt,
    updatedAt: gateway.updatedAt,
  };
}

router.post("/", requireRole("ADMIN"), async (req, res) => {
  const { name } = req.body ?? {};
  if (typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "Gateway name is required" });
    return;
  }
  const trimmedName = name.trim();

  const duplicate = await prisma.gateway.findFirst({
    where: { name: { equals: trimmedName, mode: "insensitive" } },
  });
  if (duplicate) {
    res.status(409).json({ error: "A gateway with this name already exists" });
    return;
  }

  try {
    const gateway = await prisma.gateway.create({
      data: { name: trimmedName, createdById: req.user!.id },
    });
    res.status(201).json(serializeGateway(gateway));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      res.status(409).json({ error: "A gateway with this name already exists" });
      return;
    }
    throw error;
  }
});

router.get("/", async (req, res) => {
  const { search, active } = req.query;

  const where: Prisma.GatewayWhereInput = {};
  if (typeof search === "string" && search.trim().length > 0) {
    where.name = { contains: search.trim(), mode: "insensitive" };
  }
  if (active === "true") where.active = true;
  if (active === "false") where.active = false;

  const gateways = await prisma.gateway.findMany({
    where,
    orderBy: { name: "asc" },
  });
  res.json(gateways.map(serializeGateway));
});

router.get("/:id", async (req, res) => {
  const gateway = await prisma.gateway.findUnique({ where: { id: req.params.id } });
  if (!gateway) {
    res.status(404).json({ error: "Gateway not found" });
    return;
  }
  res.json(serializeGateway(gateway));
});

router.patch("/:id", requireRole("ADMIN"), async (req, res) => {
  const gateway = await prisma.gateway.findUnique({ where: { id: req.params.id } });
  if (!gateway) {
    res.status(404).json({ error: "Gateway not found" });
    return;
  }

  const { name, active } = req.body ?? {};
  const data: Prisma.GatewayUpdateInput = {};
  const auditEntries: Promise<unknown>[] = [];

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "Gateway name cannot be empty" });
      return;
    }
    const trimmedName = name.trim();
    if (trimmedName !== gateway.name) {
      const duplicate = await prisma.gateway.findFirst({
        where: {
          id: { not: gateway.id },
          name: { equals: trimmedName, mode: "insensitive" },
        },
      });
      if (duplicate) {
        res.status(409).json({ error: "A gateway with this name already exists" });
        return;
      }
      data.name = trimmedName;
      auditEntries.push(
        recordAuditChange({
          entityType: "gateway",
          entityId: gateway.id,
          fieldChanged: "name",
          oldValue: gateway.name,
          newValue: trimmedName,
          changedById: req.user!.id,
        })
      );
    }
  }

  if (active !== undefined) {
    if (typeof active !== "boolean") {
      res.status(400).json({ error: "active must be a boolean" });
      return;
    }
    if (active !== gateway.active) {
      data.active = active;
      auditEntries.push(
        recordAuditChange({
          entityType: "gateway",
          entityId: gateway.id,
          fieldChanged: "active",
          oldValue: String(gateway.active),
          newValue: String(active),
          changedById: req.user!.id,
        })
      );
    }
  }

  if (Object.keys(data).length === 0) {
    res.json(serializeGateway(gateway));
    return;
  }

  const updated = await prisma.gateway.update({ where: { id: gateway.id }, data });
  await Promise.all(auditEntries);
  res.json(serializeGateway(updated));
});

router.delete("/:id", requireRole("ADMIN"), async (req, res) => {
  const gateway = await prisma.gateway.findUnique({ where: { id: req.params.id } });
  if (!gateway) {
    res.status(404).json({ error: "Gateway not found" });
    return;
  }

  const paymentCount = await prisma.payment.count({ where: { gatewayId: gateway.id } });
  if (paymentCount > 0) {
    res.status(409).json({
      error: "This gateway has existing payments and cannot be deleted. Disable it instead.",
    });
    return;
  }

  await prisma.merchantGatewayRate.deleteMany({ where: { gatewayId: gateway.id } });
  await prisma.gateway.delete({ where: { id: gateway.id } });

  await recordAuditChange({
    entityType: "gateway",
    entityId: gateway.id,
    fieldChanged: "deleted",
    oldValue: gateway.name,
    newValue: null,
    changedById: req.user!.id,
  });

  res.status(204).send();
});

export default router;
