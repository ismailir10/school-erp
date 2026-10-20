// Adapter parity: seed.ts uses the same PrismaPg adapter — keep in sync.
// Last verified: 2026-10-20-payment-link-expiry-display — the seed now adds
// payment-link expiry fixtures (INV-YYYY-0080..0089 + one expired webhook event);
// both sides still construct PrismaPg from DATABASE_URL, adapter unchanged.
import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured. Set it in .env");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
