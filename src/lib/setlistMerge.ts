import type { SetlistPreviewResult } from "@/lib/setlistPreviewTypes";

/** Merge chunked preview API responses into one dashboard payload. */
export function mergeSetlistPreviewResults(parts: SetlistPreviewResult[]): SetlistPreviewResult {
  if (!parts.length) {
    return {
      setlistfmConfigured: false,
      spotifyClientConfigured: false,
      artists: [],
      combined: [],
    };
  }
  const artists = parts.flatMap((p) => p.artists);
  const combinedFlat = parts.flatMap((p) => p.combined);
  const combined = [...combinedFlat].sort(
    (a, b) =>
      b.count - a.count ||
      a.artistName.localeCompare(b.artistName, undefined, { sensitivity: "base" }) ||
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
  );
  const warn = [...new Set(parts.flatMap((p) => p.selectionWarnings ?? []))];

  return {
    setlistfmConfigured: parts.every((p) => p.setlistfmConfigured),
    spotifyClientConfigured: parts.some((p) => p.spotifyClientConfigured),
    artists,
    combined,
    selectionWarnings: warn.length ? warn : undefined,
  };
}
