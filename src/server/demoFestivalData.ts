/** Seeded into new squads so the lineup is not empty. */
export const DEMO_SEED_ARTIST_NAMES = [
  "Aurora Keys",
  "Neon Tide",
  "Midnight Relay",
  "Velvet Static",
  "Solar Bloom",
];

/** Full demo lineup after POST .../demo-lineup */
export const DEMO_ARTIST_NAMES = [
  "Aurora Keys",
  "Neon Tide",
  "Midnight Relay",
  "Velvet Static",
  "Solar Bloom",
  "Echo Harbor",
];

export const DEMO_SLOT_ROWS: {
  dayLabel: string;
  stageName: string;
  start: string;
  end: string;
  artistIndex: number;
}[] = [
  { dayLabel: "Fri", stageName: "North", start: "18:00", end: "19:15", artistIndex: 0 },
  { dayLabel: "Fri", stageName: "South", start: "18:30", end: "19:30", artistIndex: 1 },
  { dayLabel: "Fri", stageName: "North", start: "20:00", end: "21:30", artistIndex: 2 },
  { dayLabel: "Fri", stageName: "South", start: "20:15", end: "21:15", artistIndex: 3 },
  { dayLabel: "Sat", stageName: "North", start: "17:00", end: "18:00", artistIndex: 4 },
  { dayLabel: "Sat", stageName: "South", start: "17:30", end: "18:45", artistIndex: 5 },
  { dayLabel: "Sat", stageName: "North", start: "19:00", end: "20:30", artistIndex: 0 },
  { dayLabel: "Sat", stageName: "South", start: "19:15", end: "20:15", artistIndex: 1 },
];
