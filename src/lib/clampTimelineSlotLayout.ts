/**
 * Keep absolutely positioned slot cards inside the timeline body so they do not
 * sit under the sticky stage header or extend past the day grid.
 */
export function clampTimelineSlotLayout(
  topPx: number,
  heightPx: number,
  bodyPx: number,
  minHeight = 14
): { topPx: number; heightPx: number } {
  if (!Number.isFinite(bodyPx) || bodyPx <= 0) {
    return { topPx: 0, heightPx: Math.max(4, minHeight) };
  }
  const minH = Math.min(Math.max(4, minHeight), bodyPx);
  let t = Math.max(0, topPx);
  let h = Math.max(minH, heightPx);
  if (t > bodyPx - minH) t = Math.max(0, bodyPx - minH);
  if (t + h > bodyPx) h = Math.max(minH, bodyPx - t);
  return { topPx: t, heightPx: h };
}
