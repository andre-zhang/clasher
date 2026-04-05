import { PrismaClient } from "@prisma/client";

/**
 * Reuse one client per serverless isolate (Vercel) to avoid exhausting DB connections.
 * See https://www.prisma.io/docs/guides/database/troubleshooting-orm/help-articles/nextjs-prisma-client-dev-practices
 */
const globalForPrisma = globalThis as unknown as { clasherPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.clasherPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

globalForPrisma.clasherPrisma = prisma;
