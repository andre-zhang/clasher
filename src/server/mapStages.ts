import {
  buildWalkMatrixFromStageOrder,
  orderScheduleStagesByMap,
} from "@/lib/walkMatrixDefaults";

export { buildWalkMatrixFromStageOrder, orderScheduleStagesByMap };

export function parseStageLabelsFromVision(
  json: Record<string, unknown>
): string[] {
  const keys = ["stageLabels", "labels", "stages", "stage_names"] as const;
  for (const k of keys) {
    const v = json[k];
    if (Array.isArray(v)) {
      const out = v
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter(Boolean);
      if (out.length) return out;
    }
  }
  return [];
}

export function parseMatchesFromVision(
  json: Record<string, unknown>
): Record<string, string> {
  const raw = json.matches ?? json.mapping;
  if (!Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const ml =
      (typeof o.mapLabel === "string" && o.mapLabel) ||
      (typeof o.label === "string" && o.label) ||
      (typeof o.from === "string" && o.from) ||
      "";
    const ss =
      (typeof o.scheduleStage === "string" && o.scheduleStage) ||
      (typeof o.stage === "string" && o.stage) ||
      (typeof o.to === "string" && o.to) ||
      "";
    if (ml.trim() && ss.trim()) out[ml.trim()] = ss.trim();
  }
  return out;
}
