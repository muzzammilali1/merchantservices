import "dotenv/config";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth";

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "mmuzzammilali1@gmail.com";
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? "Admin";

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (existing) {
    console.log(`Admin user already exists for ${ADMIN_EMAIL}, skipping seed.`);
    return;
  }

  const tempPassword = process.env.SEED_ADMIN_PASSWORD ?? crypto.randomBytes(9).toString("base64url");
  const passwordHash = await hashPassword(tempPassword);

  const user = await prisma.user.create({
    data: {
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      passwordHash,
      role: "ADMIN",
      mustChangePassword: true,
    },
  });

  console.log("Initial admin user created:");
  console.log(`  email:    ${user.email}`);
  console.log(`  password: ${tempPassword}`);
  console.log("  (mustChangePassword is set — this password must be changed on first login)");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
