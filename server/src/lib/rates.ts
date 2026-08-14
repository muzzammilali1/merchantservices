import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { calculateAmounts, PaymentStatus } from "../services/paymentCalculations";

/**
 * Closes out whatever rate is currently open (effectiveTo: null) for this
 * merchant+gateway pair and opens a new one, preserving history.
 *
 * By default this is forward-only — it never touches rateSnapshot on
 * existing payments. Passing applyRetroactively rewrites rateSnapshot (and
 * recomputes deduction/net for RECEIVED payments) on every existing payment
 * for this merchant+gateway pair, and records a RateRecalculation row so the
 * bulk change is traceable as a single event.
 */
export async function setMerchantGatewayRate(params: {
  merchantId: string;
  gatewayId: string;
  percentage: Prisma.Decimal.Value;
  changedById: string;
  applyRetroactively?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const current = await tx.merchantGatewayRate.findFirst({
      where: { merchantId: params.merchantId, gatewayId: params.gatewayId, effectiveTo: null },
    });

    if (current) {
      await tx.merchantGatewayRate.update({ where: { id: current.id }, data: { effectiveTo: now } });
    }

    const created = await tx.merchantGatewayRate.create({
      data: {
        merchantId: params.merchantId,
        gatewayId: params.gatewayId,
        percentage: params.percentage,
        effectiveFrom: now,
        createdById: params.changedById,
      },
    });

    let paymentsAffectedCount = 0;

    if (params.applyRetroactively && current) {
      const affectedPayments = await tx.payment.findMany({
        where: { merchantId: params.merchantId, gatewayId: params.gatewayId },
      });

      for (const payment of affectedPayments) {
        const { deductionAmount, netAmount } = calculateAmounts(
          payment.grossAmount,
          created.percentage,
          payment.status as PaymentStatus
        );
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            rateSnapshot: created.percentage,
            deductionAmount: deductionAmount ?? null,
            netAmount: netAmount ?? null,
          },
        });
      }
      paymentsAffectedCount = affectedPayments.length;

      await tx.rateRecalculation.create({
        data: {
          merchantGatewayRateId: created.id,
          oldPercentage: current.percentage,
          newPercentage: created.percentage,
          appliedRetroactively: true,
          paymentsAffectedCount,
          changedById: params.changedById,
        },
      });
    }

    return { previous: current, created, paymentsAffectedCount };
  });
}

export function getCurrentRate(merchantId: string, gatewayId: string) {
  return prisma.merchantGatewayRate.findFirst({
    where: { merchantId, gatewayId, effectiveTo: null },
  });
}
