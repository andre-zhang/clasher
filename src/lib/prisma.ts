import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { clasherPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.clasherPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.clasherPrisma = prisma;
}
