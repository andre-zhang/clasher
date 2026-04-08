"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function JoinEntryPage() {
  const router = useRouter();
  const [token, setToken] = useState("");

  function go() {
    const t = token.trim().toLowerCase();
    if (!t) return;
    router.push(`/join/${encodeURIComponent(t)}`);
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <Link href="/" className="text-sm text-zinc-600 underline">
        ← Back
      </Link>
      <h1 className="mt-6 text-2xl font-bold text-zinc-900">Join</h1>
      <div className="mt-8 flex flex-col gap-3">
        <input
          className="w-full border-2 border-zinc-900 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Code"
          onKeyDown={(e) => e.key === "Enter" && go()}
        />
        <button
          type="button"
          onClick={go}
          className="border-2 border-zinc-900 bg-indigo-600 py-3 text-sm font-semibold text-white shadow-[3px_3px_0_0_#18181b]"
        >
          Continue
        </button>
      </div>
    </main>
  );
}
