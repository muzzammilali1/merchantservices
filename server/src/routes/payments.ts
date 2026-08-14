import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { nextMerchantCode } from "../lib/merchantCode";
import { getCurrentRate } from "../lib/rates";
import { calculateAmounts, PaymentStatus } from "../services/paymentCalculations";
import { recordAuditChange } from "../lib/audit";
import { toCsv } from "../lib/csv";

const router = Router();
router.use(requireAuth);

const VALID_STATUSES: PaymentStatus[] = ["RECEIVED", "NOT_RECEIVED", "PENDING"];

function serializePayment(payment: {
  id: string;
  merchantId: string;
  gatewayId: string;
  grossAmount: Prisma.Decimal;
  status: string;
  rateSnapshot: Prisma.Decimal;
  deductionAmount: Prisma.Decimal | null;
  netAmount: Prisma.Decimal | null;
  notes: string | null;
  submittedAt: Date;
}) {
  return {
    id: payment.id,
    merchantId: payment.merchantId,
    gatewayId: payment.gatewayId,
    grossAmount: payment.grossAmount.toString(),
    status: payment.status,
    rateSnapshot: payment.rateSnapshot.toString(),
    deductionAmount: payment.deductionAmount?.toString() ?? null,
    netAmount: payment.netAmount?.toString() ?? null,
    notes: payment.notes,
    submittedAt: payment.submittedAt,
  };
}

router.post("/", async (req, res) => {
  const { merchantId, merchantName, gatewayId, grossAmount, status, notes } = req.body ?? {};

  if (typeof gatewayId !== "string" || gatewayId.trim().length === 0) {
    res.status(400).json({ error: "gatewayId is required" });
    return;
  }
  const grossAmountNum = typeof grossAmount === "number" ? grossAmount : Number(grossAmount);
  if (!Number.isFinite(grossAmountNum) || grossAmountNum <= 0) {
    res.status(400).json({ error: "grossAmount must be a positive number" });
    return;
  }
  const resolvedStatus: PaymentStatus = status ?? "PENDING";
  if (!VALID_STATUSES.includes(resolvedStatus)) {
    res.status(400).json({ error: `status must be one of ${VALID_STATUSES.join(", ")}` });
    return;
  }
  if (notes !== undefined && typeof notes !== "string") {
    res.status(400).json({ error: "notes must be a string" });
    return;
  }

  const gateway = await prisma.gateway.findUnique({ where: { id: gatewayId } });
  if (!gateway || !gateway.active) {
    res.status(400).json({ error: "Selected gateway is not available" });
    return;
  }

  let merchant;
  if (typeof merchantId === "string" && merchantId.trim().length > 0) {
    merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) {
      res.status(404).json({ error: "Merchant not found" });
      return;
    }
  } else if (typeof merchantName === "string" && merchantName.trim().length > 0) {
    const trimmedName = merchantName.trim();
    merchant = await prisma.merchant.findFirst({
      where: { name: { equals: trimmedName, mode: "insensitive" } },
    });
    if (!merchant) {
      const merchantCode = await nextMerchantCode();
      merchant = await prisma.merchant.create({
        data: { name: trimmedName, merchantCode, createdById: req.user!.id },
      });
    }
  } else {
    res.status(400).json({ error: "Either merchantId or merchantName is required" });
    return;
  }

  if (!merchant.active) {
    res.status(400).json({ error: "This merchant is inactive and cannot receive new payments" });
    return;
  }

  const currentRate = await getCurrentRate(merchant.id, gateway.id);
  if (!currentRate) {
    res.status(400).json({
      error: `No rate has been configured for ${merchant.name} on ${gateway.name} yet. An admin must set one before payments can be recorded.`,
    });
    return;
  }

  const { deductionAmount, netAmount } = calculateAmounts(
    grossAmountNum,
    currentRate.percentage,
    resolvedStatus
  );

  const payment = await prisma.payment.create({
    data: {
      merchantId: merchant.id,
      gatewayId: gateway.id,
      grossAmount: grossAmountNum,
      status: resolvedStatus,
      rateSnapshot: currentRate.percentage,
      deductionAmount: deductionAmount ?? undefined,
      netAmount: netAmount ?? undefined,
      notes: notes ?? null,
      createdById: req.user!.id,
    },
  });

  res.status(201).json({
    ...serializePayment(payment),
    merchant: { id: merchant.id, name: merchant.name, merchantCode: merchant.merchantCode },
    gateway: { id: gateway.id, name: gateway.name },
  });
});

router.get("/", async (req, res) => {
  const { merchantId, gatewayId, status, from, to } = req.query;

  const where: Prisma.PaymentWhereInput = {};
  if (typeof merchantId === "string") where.merchantId = merchantId;
  if (typeof gatewayId === "string") where.gatewayId = gatewayId;
  if (typeof status === "string" && VALID_STATUSES.includes(status as PaymentStatus)) {
    where.status = status as PaymentStatus;
  }
  if (typeof from === "string" || typeof to === "string") {
    where.submittedAt = {};
    if (typeof from === "string" && !Number.isNaN(Date.parse(from))) {
      where.submittedAt.gte = new Date(from);
    }
    if (typeof to === "string" && !Number.isNaN(Date.parse(to))) {
      where.submittedAt.lte = new Date(to);
    }
  }

  const limit = Math.min(Number(req.query.limit) || 200, 500);

  const payments = await prisma.payment.findMany({
    where,
    orderBy: { submittedAt: "desc" },
    take: limit,
    include: {
      gateway: { select: { id: true, name: true } },
      merchant: { select: { id: true, name: true, merchantCode: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });

  if (req.query.format === "csv") {
    const csv = toCsv(
      ["Date", "Time", "Merchant", "Gateway", "Gross", "Status", "Rate %", "Deduction", "Net", "Notes", "Created By"],
      payments.map((p) => [
        p.submittedAt.toISOString().slice(0, 10),
        p.submittedAt.toISOString().slice(11, 16),
        p.merchant.name,
        p.gateway.name,
        p.grossAmount.toString(),
        p.status,
        p.rateSnapshot.toString(),
        p.deductionAmount?.toString() ?? "",
        p.netAmount?.toString() ?? "",
        p.notes ?? "",
        p.createdBy.name,
      ])
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="payments.csv"`);
    res.send(csv);
    return;
  }

  res.json(
    payments.map((payment) => ({
      ...serializePayment(payment),
      gateway: payment.gateway,
      merchant: payment.merchant,
      createdBy: payment.createdBy,
    }))
  );
});

router.patch("/:id", requireRole("ADMIN"), async (req, res) => {
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!payment) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  const { status, grossAmount, notes } = req.body ?? {};
  const data: Prisma.PaymentUpdateInput = {};
  const auditEntries: Promise<unknown>[] = [];

  let nextStatus: PaymentStatus = payment.status as PaymentStatus;
  let nextGrossAmount: Prisma.Decimal | number = payment.grossAmount;

  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: `status must be one of ${VALID_STATUSES.join(", ")}` });
      return;
    }
    if (status !== payment.status) {
      nextStatus = status;
      data.status = status;
      auditEntries.push(
        recordAuditChange({
          entityType: "payment",
          entityId: payment.id,
          fieldChanged: "status",
          oldValue: payment.status,
          newValue: status,
          changedById: req.user!.id,
        })
      );
    }
  }

  if (grossAmount !== undefined) {
    const grossAmountNum = typeof grossAmount === "number" ? grossAmount : Number(grossAmount);
    if (!Number.isFinite(grossAmountNum) || grossAmountNum <= 0) {
      res.status(400).json({ error: "grossAmount must be a positive number" });
      return;
    }
    if (grossAmountNum !== payment.grossAmount.toNumber()) {
      nextGrossAmount = grossAmountNum;
      data.grossAmount = grossAmountNum;
      auditEntries.push(
        recordAuditChange({
          entityType: "payment",
          entityId: payment.id,
          fieldChanged: "grossAmount",
          oldValue: payment.grossAmount.toString(),
          newValue: String(grossAmountNum),
          changedById: req.user!.id,
        })
      );
    }
  }

  if (notes !== undefined) {
    if (typeof notes !== "string") {
      res.status(400).json({ error: "notes must be a string" });
      return;
    }
    if (notes !== (payment.notes ?? "")) {
      data.notes = notes;
      auditEntries.push(
        recordAuditChange({
          entityType: "payment",
          entityId: payment.id,
          fieldChanged: "notes",
          oldValue: payment.notes,
          newValue: notes,
          changedById: req.user!.id,
        })
      );
    }
  }

  // Deduction/net always derive from the payment's own rateSnapshot — never
  // the merchant's current rate — so editing status/amount here can never
  // silently apply a rate the payment wasn't actually submitted under.
  if (data.status !== undefined || data.grossAmount !== undefined) {
    const { deductionAmount, netAmount } = calculateAmounts(
      nextGrossAmount,
      payment.rateSnapshot,
      nextStatus
    );
    data.deductionAmount = deductionAmount ?? null;
    data.netAmount = netAmount ?? null;
  }

  if (Object.keys(data).length === 0) {
    res.json(serializePayment(payment));
    return;
  }

  data.updatedBy = { connect: { id: req.user!.id } };
  const updated = await prisma.payment.update({ where: { id: payment.id }, data });
  await Promise.all(auditEntries);
  res.json(serializePayment(updated));
});

export default router;
