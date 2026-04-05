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
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
        ← Back
      </Link>
      <h1 className="mt-6 text-2xl font-bold">Join with a code</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Paste the invite token from your friend’s link (the path after{" "}
        <code className="text-zinc-300">/join/</code>).
      </p>
      <div className="mt-8 flex flex-col gap-3">
        <input
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-violet-500"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="invite token"
          onKeyDown={(e) => e.key === "Enter" && go()}
        />
        <button
          type="button"
          onClick={go}
          className="rounded-xl bg-violet-600 py-3 text-sm font-semibold text-white hover:bg-violet-500"
        >
          Continue
        </button>
      </div>
    </main>
  );
}
