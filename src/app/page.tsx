import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-8 px-6 py-16">
      <div>
        <p className="text-sm font-medium uppercase tracking-widest text-violet-400">
          Clasher
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Festival Squad
        </h1>
        <p className="mt-3 text-zinc-400">
          Plan a lineup together, build a timetable, and resolve clashes. Your
          squad lives on the server; this browser keeps your member secret and a
          cached snapshot for spotty signal.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <Link
          href="/create"
          className="rounded-xl bg-violet-600 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-violet-500"
        >
          Create a squad
        </Link>
        <p className="text-center text-sm text-zinc-500">
          Have an invite link? Open it directly{" "}
          <span className="text-zinc-400">(e.g. /join/…)</span> or enter the
          code on join.
        </p>
        <Link
          href="/join"
          className="rounded-xl border border-zinc-700 px-4 py-3 text-center text-sm font-semibold text-zinc-200 transition hover:border-zinc-500"
        >
          Join with a code
        </Link>
      </div>
    </main>
  );
}
