import { Prisma } from "@prisma/client";

type ErrorStatus = 500 | 503;

/**
 * Map Prisma / config failures to JSON API responses (avoid opaque 500 HTML).
 */
export function dbErrorHttpResponse(err: unknown): {
  status: ErrorStatus;
  body: { error: string; message: string; code?: string };
} {
  if (!process.env.DATABASE_URL?.trim()) {
    return {
      status: 503,
      body: {
        error: "database_not_configured",
        message:
          "DATABASE_URL is not set on the server. In Vercel: Project → Settings → Environment Variables → add DATABASE_URL for Production, then Redeploy.",
      },
    };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2021") {
      return {
        status: 503,
        body: {
          error: "database_schema_missing",
          code: err.code,
          message:
            "Postgres has no Clasher tables yet. On your PC: set DATABASE_URL to the same value as Vercel, then run `npx prisma db push` (or `prisma migrate deploy`).",
        },
      };
    }
    if (err.code === "P1001") {
      return {
        status: 503,
        body: {
          error: "database_unreachable",
          code: err.code,
          message:
            "Cannot reach the database host. Check DATABASE_URL (correct host, port, SSL). For Neon, use the connection string that includes sslmode=require.",
        },
      };
    }
    if (err.code === "P1003") {
      return {
        status: 503,
        body: {
          error: "database_not_found",
          code: err.code,
          message:
            "The database name in DATABASE_URL does not exist. Create the database in your provider or fix the URL.",
        },
      };
    }
    if (err.code === "P1000") {
      return {
        status: 503,
        body: {
          error: "database_auth_failed",
          code: err.code,
          message:
            "Database authentication failed. Check the user/password in DATABASE_URL.",
        },
      };
    }
    return {
      status: 503,
      body: {
        error: "database_request_failed",
        code: err.code,
        message: err.message,
      },
    };
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    return {
      status: 503,
      body: {
        error: "database_init_failed",
        message: err.message,
      },
    };
  }

  if (err instanceof Prisma.PrismaClientRustPanicError) {
    return {
      status: 500,
      body: {
        error: "database_engine_error",
        message: err.message,
      },
    };
  }

  const msg = err instanceof Error ? err.message : String(err);
  return {
    status: 500,
    body: {
      error: "internal_error",
      message: msg,
    },
  };
}
