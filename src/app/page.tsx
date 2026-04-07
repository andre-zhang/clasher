import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-8 px-6 py-16">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-zinc-600">
          Clasher
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900">
          Lineup, timetable, clash picks
        </h1>
      </div>
      <div className="flex flex-col gap-3">
        <Link
          href="/create"
          className="border-2 border-zinc-900 bg-indigo-600 px-4 py-3 text-center text-sm font-semibold text-white shadow-[4px_4px_0_0_#18181b]"
        >
          Create a group
        </Link>
        <Link
          href="/join"
          className="border-2 border-zinc-900 bg-white px-4 py-3 text-center text-sm font-semibold text-zinc-900 shadow-[4px_4px_0_0_#18181b]"
        >
          Join with a code
        </Link>
      </div>
    </main>
  );
}
