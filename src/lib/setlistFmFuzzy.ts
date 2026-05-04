import type { SetlistfmArtistHit, SetlistIdRow } from "@/lib/setlistfm";
import { listSetlistPage, searchArtistsByName, sleepMs } from "@/lib/setlistfm";

/** Accent-fold + lowercase + strip noise punctuation for overlap scores. */
export function normalizeForFuzzy(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function diceBigrams(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const bag = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bag.set(bg, (bag.get(bg) ?? 0) + 1);
  }
  let match = 0;
  let total = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const c = bag.get(bg) ?? 0;
    total += 1;
    if (c > 0) {
      match += 1;
      bag.set(bg, c - 1);
    }
  }
  return total === 0 ? 0 : (2 * match) / (a.length - 1 + (b.length - 1));
}

function tokenJaccard(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** How well `candidate` matches festival lineup spelling (0–1). Super permissive. */
export function fuzzyArtistMatchScore(lineupName: string, hit: SetlistfmArtistHit): number {
  const raw = lineupName.trim();
  const variants = [
    fuzzyPairScore(raw, hit.name),
    hit.sortName ? fuzzyPairScore(raw, hit.sortName) : 0,
  ];
  return Math.max(...variants, 0);
}

function fuzzyPairScore(lineup: string, candidate: string): number {
  const a = normalizeForFuzzy(lineup);
  const b = normalizeForFuzzy(candidate);
  if (!a.length || !b.length) return 0;
  if (a === b) return 1;

  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if (short.length >= 4 && long.includes(short)) return 0.9 + 0.09 * (short.length / long.length);

  const dice = diceBigrams(` ${a} `, ` ${b} `);
  const jac = tokenJaccard(a, b);

  const ta = new Set(a.split(" ").filter((w) => w.length >= 2));
  const tb = new Set(b.split(" ").filter((w) => w.length >= 2));
  let tokenCover = 0;
  for (const w of ta) {
    if (tb.has(w)) tokenCover += 1;
    else {
      for (const u of tb) {
        if (w.includes(u) || u.includes(w)) {
          tokenCover += 0.85;
          break;
        }
      }
    }
  }
  const coverRatio = ta.size === 0 ? 0 : Math.min(1, tokenCover / ta.size);

  return Math.max(dice, jac, coverRatio * 0.95, 0.55 * dice + 0.45 * jac);
}

const COLLAB_SPLIT =
  /\s*(?:,|\||\b(?:x|×|\/|\+|feat\.?|featuring|ft\.?|vs\.?|versus|with)\b)\s*/i;

function pushDistinct(out: string[], s: string) {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length >= 2 && !out.includes(t)) out.push(t);
}

/** Many spelling/shape variants so setlist.fm search has a fighting chance. */
export function lineupSearchQueryVariants(primary: string): string[] {
  const raw = primary.trim();
  if (!raw) return [];

  const out: string[] = [];
  pushDistinct(out, raw);
  pushDistinct(out, raw.replace(/\.\s*$/, ""));
  pushDistinct(out, raw.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim());

  pushDistinct(out, raw.replace(/^the\s+/i, ""));
  pushDistinct(out, raw.replace(/^dj\s+/i, ""));
  pushDistinct(out, raw.replace(/^mc\s+/i, ""));

  if (raw.includes("&")) pushDistinct(out, raw.replace(/\s*&\s*/g, " and "));
  if (/\band\b/i.test(raw)) pushDistinct(out, raw.replace(/\s+and\s+/gi, " & "));

  const depunct = raw.replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
  pushDistinct(out, depunct);
  pushDistinct(out, depunct.replace(/^the\s+/i, ""));
  pushDistinct(out, depunct.replace(/\.\s*$/, ""));

  if (COLLAB_SPLIT.test(raw)) {
    for (const part of raw.split(COLLAB_SPLIT).map((p) => p.trim()).filter(Boolean)) {
      pushDistinct(out, part);
      pushDistinct(out, part.replace(/\.\s*$/, ""));
    }
  }

  const words = raw.split(/\s+/).filter((w) => normalizeForFuzzy(w).length >= 6);
  const uniqWords = [...new Set(words.map((w) => normalizeForFuzzy(w)))];
  for (const w of uniqWords.slice(0, 4)) {
    if (w.length >= 8) pushDistinct(out, w);
  }

  return out.slice(0, 14);
}

export type ResolveArtistResult =
  | { ok: true; hit: SetlistfmArtistHit; firstPageSetlists: SetlistIdRow[] }
  | { ok: false; reason: "no_search_hits" | "no_setlists" };

/**
 * Broad search + fuzzy ranking + try MBIDs until one has listed concerts.
 */
export async function resolveArtistWithSetlists(
  lineupDisplayName: string,
  reqGapMs: number,
  opts?: {
    /** Extra searches widen recall but cost API quota / wall time. */
    maxSearchVariants?: number;
    /** Max list lookups after merging candidates (sorted best-first). */
    maxMbidProbePages?: number;
    hitsPerSearch?: number;
  }
): Promise<ResolveArtistResult> {
  const maxVariants = Math.min(14, Math.max(4, opts?.maxSearchVariants ?? 12));
  const maxProbe = Math.min(35, Math.max(8, opts?.maxMbidProbePages ?? 22));
  const hitsPerSearch = Math.min(20, Math.max(8, opts?.hitsPerSearch ?? 18));

  const queries = lineupSearchQueryVariants(lineupDisplayName).slice(0, maxVariants);
  const byMbid = new Map<string, { hit: SetlistfmArtistHit; score: number }>();

  for (const q of queries) {
    const hits = await searchArtistsByName(q, { maxResults: hitsPerSearch });
    await sleepMs(reqGapMs);
    for (const h of hits) {
      const score = fuzzyArtistMatchScore(lineupDisplayName, h);
      const prev = byMbid.get(h.mbid);
      if (!prev || score > prev.score) byMbid.set(h.mbid, { hit: h, score });
    }
  }

  if (!byMbid.size) return { ok: false, reason: "no_search_hits" };

  const ranked = [...byMbid.values()].sort((x, y) => y.score - x.score);

  for (let i = 0; i < ranked.length && i < maxProbe; i++) {
    const { hit } = ranked[i]!;
    const { setlists } = await listSetlistPage(hit.mbid, 1);
    await sleepMs(reqGapMs);
    if (setlists.length > 0) return { ok: true, hit, firstPageSetlists: setlists };
  }

  return { ok: false, reason: "no_setlists" };
}
