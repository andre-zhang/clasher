#!/usr/bin/env node
/**
 * Build: prisma generate → (optional) DB schema sync → next build.
 *
 * - Local: if DATABASE_URL is unset, skips migrate/db push. If it is set but the DB
 *   is unreachable (e.g. Postgres off), skips after warning so `npm run build` still works.
 * - Vercel: DATABASE_URL must be set (Build + Production); tries migrate deploy,
 *   then falls back to db push; build fails if both cannot reach the DB.
 * - Override: SKIP_DB_SYNC=1 skips migrate and db push even when DATABASE_URL is set.
 */
import { execSync } from "node:child_process";

function run(cmd) {
  console.log(`\n> ${cmd}\n`);
  execSync(cmd, { stdio: "inherit", env: process.env });
}

run("npx prisma generate");

if (process.env.SKIP_DB_SYNC === "1") {
  console.warn(
    "\n[clasher] SKIP_DB_SYNC=1 — skipping prisma migrate / db push.\n"
  );
} else if (process.env.DATABASE_URL) {
  const isVercel = process.env.VERCEL === "1";
  try {
    run("npx prisma migrate deploy");
  } catch {
    console.warn(
      "\n[clasher] prisma migrate deploy failed — applying schema with prisma db push.\n"
    );
    try {
      run("npx prisma db push --skip-generate");
    } catch {
      if (isVercel) {
        console.error(
          "\n[clasher] Could not reach the database on Vercel. Check DATABASE_URL (Build + Runtime) and that the DB accepts connections.\n"
        );
        process.exit(1);
      }
      console.warn(
        "\n[clasher] Database unreachable (e.g. Postgres not running locally). Skipping schema sync; `next build` continues. Start the DB and run `npx prisma migrate deploy`, or set SKIP_DB_SYNC=1.\n"
      );
    }
  }
} else if (process.env.VERCEL === "1") {
  console.error(
    "\n[clasher] DATABASE_URL is missing on Vercel. Add it for Environment: Production, Preview, and Development, and enable it for Build (not only Runtime).\n"
  );
  process.exit(1);
} else {
  console.warn(
    "\n[clasher] DATABASE_URL unset — skipping prisma migrate / db push (local build).\n"
  );
}

run("npx next build");
