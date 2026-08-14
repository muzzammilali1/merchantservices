import { Decimal } from "@prisma/client/runtime/library";

export type PaymentStatus = "RECEIVED" | "NOT_RECEIVED" | "PENDING";

export interface CalculatedAmounts {
  deductionAmount: Decimal | null;
  netAmount: Decimal | null;
}

/**
 * Deduction/net are only meaningful once a payment has actually settled.
 * Not Received / Pending payments display as "—" until their status flips.
 */
export function calculateAmounts(
  grossAmount: Decimal | number | string,
  ratePercentage: Decimal | number | string,
  status: PaymentStatus
): CalculatedAmounts {
  if (status !== "RECEIVED") {
    return { deductionAmount: null, netAmount: null };
  }

  const gross = new Decimal(grossAmount);
  const rate = new Decimal(ratePercentage);
  const deductionAmount = gross.mul(rate).div(100).toDecimalPlaces(2);
  const netAmount = gross.sub(deductionAmount).toDecimalPlaces(2);

  return { deductionAmount, netAmount };
}

export interface ActiveRateLookup {
  merchantId: string;
  gatewayId: string;
  percentage: Decimal;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

/**
 * Picks the rate that was in effect at `asOf` for a given merchant+gateway
 * pair out of its full rate history. Used to snapshot a payment's rate at
 * submission time, or to answer "what rate applied on date X" for reports.
 */
export function resolveActiveRate(
  history: ActiveRateLookup[],
  asOf: Date = new Date()
): ActiveRateLookup | null {
  return (
    history.find(
      (rate) =>
        rate.effectiveFrom <= asOf &&
        (rate.effectiveTo === null || rate.effectiveTo > asOf)
    ) ?? null
  );
}

export interface MerchantGatewayTotals {
  gatewayId: string;
  gatewayName: string;
  received: Decimal;
  notReceived: Decimal;
  pending: Decimal;
  deduction: Decimal;
  net: Decimal;
}

export interface PaymentLike {
  gatewayId: string;
  gatewayName: string;
  grossAmount: Decimal | number | string;
  status: PaymentStatus;
  deductionAmount: Decimal | number | string | null;
  netAmount: Decimal | number | string | null;
}

/**
 * Aggregates a merchant's payments into per-gateway totals. Always computed
 * from the underlying payment rows rather than stored running totals, so a
 * status change or edit is reflected the next time this runs.
 */
export function summarizeByGateway(
  payments: PaymentLike[]
): MerchantGatewayTotals[] {
  const byGateway = new Map<string, MerchantGatewayTotals>();

  for (const payment of payments) {
    let totals = byGateway.get(payment.gatewayId);
    if (!totals) {
      totals = {
        gatewayId: payment.gatewayId,
        gatewayName: payment.gatewayName,
        received: new Decimal(0),
        notReceived: new Decimal(0),
        pending: new Decimal(0),
        deduction: new Decimal(0),
        net: new Decimal(0),
      };
      byGateway.set(payment.gatewayId, totals);
    }

    const gross = new Decimal(payment.grossAmount);
    if (payment.status === "RECEIVED") {
      totals.received = totals.received.add(gross);
      totals.deduction = totals.deduction.add(
        new Decimal(payment.deductionAmount ?? 0)
      );
      totals.net = totals.net.add(new Decimal(payment.netAmount ?? 0));
    } else if (payment.status === "NOT_RECEIVED") {
      totals.notReceived = totals.notReceived.add(gross);
    } else {
      totals.pending = totals.pending.add(gross);
    }
  }

  return Array.from(byGateway.values());
}

export interface Totals {
  gross: Decimal;
  received: Decimal;
  notReceived: Decimal;
  pending: Decimal;
  deduction: Decimal;
  net: Decimal;
  count: number;
}

export interface BasicPaymentLike {
  grossAmount: Decimal | number | string;
  status: PaymentStatus;
  deductionAmount: Decimal | number | string | null;
  netAmount: Decimal | number | string | null;
}

/**
 * Generic aggregator with no grouping key — used for the dashboard's
 * overall totals, and reused for per-merchant / per-gateway report rows by
 * pre-filtering the payment array before calling this.
 */
export function summarizeTotals(payments: BasicPaymentLike[]): Totals {
  const totals: Totals = {
    gross: new Decimal(0),
    received: new Decimal(0),
    notReceived: new Decimal(0),
    pending: new Decimal(0),
    deduction: new Decimal(0),
    net: new Decimal(0),
    count: payments.length,
  };

  for (const payment of payments) {
    const gross = new Decimal(payment.grossAmount);
    totals.gross = totals.gross.add(gross);
    if (payment.status === "RECEIVED") {
      totals.received = totals.received.add(gross);
      totals.deduction = totals.deduction.add(new Decimal(payment.deductionAmount ?? 0));
      totals.net = totals.net.add(new Decimal(payment.netAmount ?? 0));
    } else if (payment.status === "NOT_RECEIVED") {
      totals.notReceived = totals.notReceived.add(gross);
    } else {
      totals.pending = totals.pending.add(gross);
    }
  }

  return totals;
}
