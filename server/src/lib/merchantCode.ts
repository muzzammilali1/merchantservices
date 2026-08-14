import { prisma } from "./prisma";

/**
 * Merchant codes are generated from a dedicated Postgres sequence
 * (merchant_code_seq) rather than counting rows, so concurrent creates
 * never collide.
 */
export async function nextMerchantCode(): Promise<string> {
  const rows = await prisma.$queryRaw<{ nextval: bigint | string }[]>`
    SELECT nextval('merchant_code_seq')
  `;
  const n = String(rows[0].nextval);
  return `MER-${n.padStart(4, "0")}`;
}
