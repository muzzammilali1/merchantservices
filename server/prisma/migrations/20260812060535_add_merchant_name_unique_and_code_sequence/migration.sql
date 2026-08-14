-- Drop the old non-unique index on Merchant.name (superseded by the unique constraint below)
DROP INDEX IF EXISTS "Merchant_name_idx";

-- Enforce unique merchant names
ALTER TABLE "Merchant" ADD CONSTRAINT "Merchant_name_key" UNIQUE ("name");

-- Sequence used to generate sequential merchant codes (MER-0001, MER-0002, ...)
CREATE SEQUENCE IF NOT EXISTS "merchant_code_seq";
