import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { PaymentStatus, summarizeByGateway, summarizeTotals } from "../services/paymentCalculations";
import { toCsv } from "../lib/csv";
import { streamTableReportPdf } from "../lib/pdf";

const router = Router();
router.use(requireAuth);

const VALID_STATUSES: PaymentStatus[] = ["RECEIVED", "NOT_RECEIVED", "PENDING"];

function buildPaymentWhere(query: Record<string, unknown>): Prisma.PaymentWhereInput {
  const { merchantId, gatewayId, status, from, to } = query;
  const where: Prisma.PaymentWhereInput = {};
  if (typeof merchantId === "string") where.merchantId = merchantId;
  if (typeof gatewayId === "string") where.gatewayId = gatewayId;
  if (typeof status === "string" && VALID_STATUSES.includes(status as PaymentStatus)) {
    where.status = status as PaymentStatus;
  }
  if (typeof from === "string" || typeof to === "string") {
    where.submittedAt = {};
    if (typeof from === "string" && !Number.isNaN(Date.parse(from))) {
      where.submittedAt.gte = new Date(from as string);
    }
    if (typeof to === "string" && !Number.isNaN(Date.parse(to))) {
      where.submittedAt.lte = new Date(to as string);
    }
  }
  return where;
}

function serializeTotals(totals: ReturnType<typeof summarizeTotals>) {
  return {
    count: totals.count,
    gross: totals.gross.toString(),
    received: totals.received.toString(),
    notReceived: totals.notReceived.toString(),
    pending: totals.pending.toString(),
    deduction: totals.deduction.toString(),
    net: totals.net.toString(),
  };
}

router.get("/dashboard", async (req, res) => {
  const where = buildPaymentWhere(req.query as Record<string, unknown>);

  const [payments, totalMerchants] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: { gateway: { select: { id: true, name: true } } },
    }),
    typeof req.query.merchantId === "string" ? Promise.resolve(1) : prisma.merchant.count(),
  ]);

  const totals = summarizeTotals(payments);
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

  const distinctGatewayCount =
    typeof req.query.gatewayId === "string" ? 1 : new Set(payments.map((p) => p.gatewayId)).size;

  res.json({
    totalMerchants,
    totalGatewayCount: distinctGatewayCount,
    totals: serializeTotals(totals),
    gatewayBreakdown: gatewayBreakdown.map((g) => ({
      gatewayId: g.gatewayId,
      gatewayName: g.gatewayName,
      received: g.received.toString(),
      notReceived: g.notReceived.toString(),
      pending: g.pending.toString(),
      volume: g.received.add(g.notReceived).add(g.pending).toString(),
      deduction: g.deduction.toString(),
      net: g.net.toString(),
    })),
  });
});

router.get("/merchants", async (req, res) => {
  const where = buildPaymentWhere(req.query as Record<string, unknown>);

  const [merchants, payments] = await Promise.all([
    prisma.merchant.findMany({ orderBy: { name: "asc" } }),
    prisma.payment.findMany({ where }),
  ]);

  const byMerchant = new Map<string, typeof payments>();
  for (const payment of payments) {
    const list = byMerchant.get(payment.merchantId) ?? [];
    list.push(payment);
    byMerchant.set(payment.merchantId, list);
  }

  const rows = merchants.map((merchant) => {
    const totals = summarizeTotals(byMerchant.get(merchant.id) ?? []);
    return {
      merchantId: merchant.id,
      merchantCode: merchant.merchantCode,
      name: merchant.name,
      active: merchant.active,
      totals: serializeTotals(totals),
    };
  });

  if (req.query.format === "csv") {
    const csv = toCsv(
      ["Merchant Code", "Merchant", "Status", "Gross", "Received", "Not Received", "Pending", "Deduction", "Net"],
      rows.map((r) => [
        r.merchantCode,
        r.name,
        r.active ? "Active" : "Inactive",
        r.totals.gross,
        r.totals.received,
        r.totals.notReceived,
        r.totals.pending,
        r.totals.deduction,
        r.totals.net,
      ])
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="merchant-report.csv"`);
    res.send(csv);
    return;
  }

  if (req.query.format === "pdf") {
    streamTableReportPdf(
      res,
      "merchant-report.pdf",
      "Merchant Report",
      [
        { label: "Merchant Code", width: 90 },
        { label: "Merchant", width: 150 },
        { label: "Status", width: 60 },
        { label: "Gross", width: 80 },
        { label: "Received", width: 80 },
        { label: "Not Received", width: 90 },
        { label: "Pending", width: 80 },
        { label: "Deduction", width: 80 },
        { label: "Net", width: 80 },
      ],
      rows.map((r) => [
        r.merchantCode,
        r.name,
        r.active ? "Active" : "Inactive",
        r.totals.gross,
        r.totals.received,
        r.totals.notReceived,
        r.totals.pending,
        r.totals.deduction,
        r.totals.net,
      ])
    );
    return;
  }

  res.json(rows);
});

router.get("/gateways", async (req, res) => {
  const where = buildPaymentWhere(req.query as Record<string, unknown>);

  const [gateways, payments] = await Promise.all([
    prisma.gateway.findMany({ orderBy: { name: "asc" } }),
    prisma.payment.findMany({ where }),
  ]);

  const byGateway = new Map<string, typeof payments>();
  for (const payment of payments) {
    const list = byGateway.get(payment.gatewayId) ?? [];
    list.push(payment);
    byGateway.set(payment.gatewayId, list);
  }

  const rows = gateways.map((gateway) => {
    const totals = summarizeTotals(byGateway.get(gateway.id) ?? []);
    return {
      gatewayId: gateway.id,
      name: gateway.name,
      active: gateway.active,
      totals: serializeTotals(totals),
    };
  });

  if (req.query.format === "csv") {
    const csv = toCsv(
      ["Gateway", "Status", "Transactions", "Received", "Not Received", "Pending", "Total Volume"],
      rows.map((r) => [
        r.name,
        r.active ? "Active" : "Inactive",
        r.totals.count,
        r.totals.received,
        r.totals.notReceived,
        r.totals.pending,
        r.totals.gross,
      ])
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="gateway-report.csv"`);
    res.send(csv);
    return;
  }

  if (req.query.format === "pdf") {
    streamTableReportPdf(
      res,
      "gateway-report.pdf",
      "Gateway Report",
      [
        { label: "Gateway", width: 150 },
        { label: "Status", width: 80 },
        { label: "Transactions", width: 100 },
        { label: "Received", width: 100 },
        { label: "Not Received", width: 110 },
        { label: "Pending", width: 100 },
        { label: "Total Volume", width: 110 },
      ],
      rows.map((r) => [
        r.name,
        r.active ? "Active" : "Inactive",
        String(r.totals.count),
        r.totals.received,
        r.totals.notReceived,
        r.totals.pending,
        r.totals.gross,
      ])
    );
    return;
  }

  res.json(rows);
});

export default router;
