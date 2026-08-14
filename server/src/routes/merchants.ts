import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { nextMerchantCode } from "../lib/merchantCode";
import { recordAuditChange } from "../lib/audit";
import { setMerchantGatewayRate } from "../lib/rates";
import { summarizeByGateway } from "../services/paymentCalculations";
import { Decimal } from "@prisma/client/runtime/library";
import { streamMerchantStatementPdf } from "../lib/pdf";

const router = Router();
router.use(requireAuth);

function serializeMerchant(merchant: {
  id: string;
  merchantCode: string;
  name: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: merchant.id,
    merchantCode: merchant.merchantCode,
    name: merchant.name,
    active: merchant.active,
    createdAt: merchant.createdAt,
    updatedAt: merchant.updatedAt,
  };
}

router.post("/", requireRole("ADMIN"), async (req, res) => {
  const { name } = req.body ?? {};
  if (typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "Merchant name is required" });
    return;
  }
  const trimmedName = name.trim();

  const duplicate = await prisma.merchant.findFirst({
    where: { name: { equals: trimmedName, mode: "insensitive" } },
  });
  if (duplicate) {
    res.status(409).json({ error: "A merchant with this name already exists" });
    return;
  }

  const merchantCode = await nextMerchantCode();

  try {
    const merchant = await prisma.merchant.create({
      data: { name: trimmedName, merchantCode, createdById: req.user!.id },
    });
    res.status(201).json(serializeMerchant(merchant));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      res.status(409).json({ error: "A merchant with this name already exists" });
      return;
    }
    throw error;
  }
});

router.get("/", async (req, res) => {
  const { search, active } = req.query;

  const where: Prisma.MerchantWhereInput = {};
  if (typeof search === "string" && search.trim().length > 0) {
    where.name = { contains: search.trim(), mode: "insensitive" };
  }
  if (active === "true") where.active = true;
  if (active === "false") where.active = false;

  const merchants = await prisma.merchant.findMany({
    where,
    orderBy: { name: "asc" },
  });
  res.json(merchants.map(serializeMerchant));
});

router.get("/:id", async (req, res) => {
  const merchant = await prisma.merchant.findUnique({ where: { id: req.params.id } });
  if (!merchant) {
    res.status(404).json({ error: "Merchant not found" });
    return;
  }
  res.json(serializeMerchant(merchant));
});

router.patch("/:id", requireRole("ADMIN"), async (req, res) => {
  const merchant = await prisma.merchant.findUnique({ where: { id: req.params.id } });
  if (!merchant) {
    res.status(404).json({ error: "Merchant not found" });
    return;
  }

  const { name, active } = req.body ?? {};
  const data: Prisma.MerchantUpdateInput = {};
  const auditEntries: Promise<unknown>[] = [];

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "Merchant name cannot be empty" });
      return;
    }
    const trimmedName = name.trim();
    if (trimmedName !== merchant.name) {
      const duplicate = await prisma.merchant.findFirst({
        where: {
          id: { not: merchant.id },
          name: { equals: trimmedName, mode: "insensitive" },
        },
      });
      if (duplicate) {
        res.status(409).json({ error: "A merchant with this name already exists" });
        return;
      }
      data.name = trimmedName;
      auditEntries.push(
        recordAuditChange({
          entityType: "merchant",
          entityId: merchant.id,
          fieldChanged: "name",
          oldValue: merchant.name,
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
    if (active !== merchant.active) {
      data.active = active;
      auditEntries.push(
        recordAuditChange({
          entityType: "merchant",
          entityId: merchant.id,
          fieldChanged: "active",
          oldValue: String(merchant.active),
          newValue: String(active),
          changedById: req.user!.id,
        })
      );
    }
  }

  if (Object.keys(data).length === 0) {
    res.json(serializeMerchant(merchant));
    return;
  }

  const updated = await prisma.merchant.update({ where: { id: merchant.id }, data });
  await Promise.all(auditEntries);
  res.json(serializeMerchant(updated));
});

router.get("/:merchantId/gateway-rates", async (req, res) => {
  const merchant = await prisma.merchant.findUnique({ where: { id: req.params.merchantId } });
  if (!merchant) {
    res.status(404).json({ error: "Merchant not found" });
    return;
  }

  const rates = await prisma.merchantGatewayRate.findMany({
    where: { merchantId: merchant.id },
    include: { gateway: { select: { id: true, name: true } } },
    orderBy: [{ gatewayId: "asc" }, { effectiveFrom: "desc" }],
  });

  res.json(
    rates.map((rate) => ({
      id: rate.id,
      gatewayId: rate.gatewayId,
      gatewayName: rate.gateway.name,
      percentage: rate.percentage.toString(),
      effectiveFrom: rate.effectiveFrom,
      effectiveTo: rate.effectiveTo,
      isCurrent: rate.effectiveTo === null,
    }))
  );
});

router.post("/:merchantId/gateway-rates", requireRole("ADMIN"), async (req, res) => {
  const merchant = await prisma.merchant.findUnique({ where: { id: req.params.merchantId } });
  if (!merchant) {
    res.status(404).json({ error: "Merchant not found" });
    return;
  }

  const { gatewayId, percentage, applyRetroactively } = req.body ?? {};
  if (typeof gatewayId !== "string" || gatewayId.trim().length === 0) {
    res.status(400).json({ error: "gatewayId is required" });
    return;
  }
  const percentageNum = typeof percentage === "number" ? percentage : Number(percentage);
  if (!Number.isFinite(percentageNum) || percentageNum < 0 || percentageNum > 100) {
    res.status(400).json({ error: "percentage must be a number between 0 and 100" });
    return;
  }
  if (applyRetroactively !== undefined && typeof applyRetroactively !== "boolean") {
    res.status(400).json({ error: "applyRetroactively must be a boolean" });
    return;
  }

  const gateway = await prisma.gateway.findUnique({ where: { id: gatewayId } });
  if (!gateway) {
    res.status(404).json({ error: "Gateway not found" });
    return;
  }

  const { previous, created, paymentsAffectedCount } = await setMerchantGatewayRate({
    merchantId: merchant.id,
    gatewayId: gateway.id,
    percentage: percentageNum,
    changedById: req.user!.id,
    applyRetroactively: Boolean(applyRetroactively),
  });

  await recordAuditChange({
    entityType: "merchant_gateway_rate",
    entityId: `${merchant.id}:${gateway.id}`,
    fieldChanged: "percentage",
    oldValue: previous ? previous.percentage.toString() : null,
    newValue: created.percentage.toString(),
    changedById: req.user!.id,
    note:
      previous && applyRetroactively
        ? `Rate changed retroactively; ${paymentsAffectedCount} existing payment(s) recalculated`
        : previous
          ? "Rate changed (forward-only; existing payments keep their snapshot)"
          : "Initial rate set",
  });

  res.status(201).json({
    id: created.id,
    gatewayId: created.gatewayId,
    percentage: created.percentage.toString(),
    effectiveFrom: created.effectiveFrom,
    effectiveTo: created.effectiveTo,
    paymentsAffectedCount,
  });
});

router.get("/:id/summary", async (req, res) => {
  const merchant = await prisma.merchant.findUnique({
    where: { id: req.params.id },
    include: { createdBy: { select: { id: true, name: true } } },
  });
  if (!merchant) {
    res.status(404).json({ error: "Merchant not found" });
    return;
  }

  const [payments, currentRates] = await Promise.all([
    prisma.payment.findMany({
      where: { merchantId: merchant.id },
      include: { gateway: { select: { id: true, name: true } } },
    }),
    prisma.merchantGatewayRate.findMany({
      where: { merchantId: merchant.id, effectiveTo: null },
      include: { gateway: { select: { id: true, name: true } } },
    }),
  ]);

  const gatewayBreakdown = summarizeByGateway(
    payments.map((p) => ({
      gatewayId: p.gatewayId,
      gatewayName: p.gateway.name,
      grossAmount: p.grossAmount,
      status: p.status,
      deductionAmount: p.deductionAmount,
      netAmount: p.netAmount,
    }))
  );

  const totals = gatewayBreakdown.reduce(
    (acc, g) => ({
      received: acc.received.add(g.received),
      notReceived: acc.notReceived.add(g.notReceived),
      pending: acc.pending.add(g.pending),
      deduction: acc.deduction.add(g.deduction),
      net: acc.net.add(g.net),
    }),
    {
      received: new Decimal(0),
      notReceived: new Decimal(0),
      pending: new Decimal(0),
      deduction: new Decimal(0),
      net: new Decimal(0),
    }
  );

  const totalsPayload = {
    totalReceived: totals.received.toString(),
    totalNotReceived: totals.notReceived.toString(),
    totalPending: totals.pending.toString(),
    totalGross: totals.received.add(totals.notReceived).add(totals.pending).toString(),
    totalDeduction: totals.deduction.toString(),
    totalNet: totals.net.toString(),
  };
  const gatewayBreakdownPayload = gatewayBreakdown.map((g) => ({
    gatewayId: g.gatewayId,
    gatewayName: g.gatewayName,
    received: g.received.toString(),
    notReceived: g.notReceived.toString(),
    pending: g.pending.toString(),
    deduction: g.deduction.toString(),
    net: g.net.toString(),
  }));

  if (req.query.format === "pdf") {
    streamMerchantStatementPdf(res, {
      merchant: {
        name: merchant.name,
        merchantCode: merchant.merchantCode,
        active: merchant.active,
        createdAt: merchant.createdAt.toISOString(),
      },
      totals: totalsPayload,
      gatewayBreakdown: gatewayBreakdownPayload,
      payments: payments
        .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())
        .map((p) => ({
          submittedAt: p.submittedAt.toISOString(),
          gatewayName: p.gateway.name,
          grossAmount: p.grossAmount.toString(),
          status: p.status,
          rateSnapshot: p.rateSnapshot.toString(),
          deductionAmount: p.deductionAmount?.toString() ?? null,
          netAmount: p.netAmount?.toString() ?? null,
        })),
    });
    return;
  }

  res.json({
    merchant: {
      ...serializeMerchant(merchant),
      createdBy: merchant.createdBy,
    },
    currentRates: currentRates.map((r) => ({
      gatewayId: r.gatewayId,
      gatewayName: r.gateway.name,
      percentage: r.percentage.toString(),
    })),
    totals: totalsPayload,
    gatewayBreakdown: gatewayBreakdownPayload,
  });
});

export default router;
