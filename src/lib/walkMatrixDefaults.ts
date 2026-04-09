export function buildWalkMatrixFromStageOrder(
  orderedStages: string[]
): Record<string, Record<string, number>> {
  const uniq = [...new Set(orderedStages.map((s) => s.trim()).filter(Boolean))];
  const n = uniq.length;
  const half = Math.max(1, Math.floor(n / 2));
  const out: Record<string, Record<string, number>> = {};
  for (let i = 0; i < n; i++) {
    const si = uniq[i]!;
    out[si] = {};
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const sj = uniq[j]!;
      const d = Math.abs(i - j);
      let mins = 15;
      if (d === 1) mins = 5;
      else if (d <= half) mins = 10;
      out[si]![sj] = mins;
    }
  }
  return out;
}

export function orderScheduleStagesByMap(
  scheduleStages: string[],
  mapLabels: string[],
  alias: Record<string, string>
): string[] {
  const uniq = [...new Set(scheduleStages.map((s) => s.trim()).filter(Boolean))];
  const indexForStage = (stage: string): number => {
    let best = 1e9;
    for (const [mapLabel, schedStage] of Object.entries(alias)) {
      if (schedStage.trim() !== stage) continue;
      const idx = mapLabels.findIndex(
        (l) => l.trim().toLowerCase() === mapLabel.trim().toLowerCase()
      );
      if (idx >= 0) best = Math.min(best, idx);
    }
    return best;
  };
  return uniq.sort((a, b) => {
    const ia = indexForStage(a);
    const ib = indexForStage(b);
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });
}
