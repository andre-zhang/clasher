/**
 * When a clash choice names one slot id, set wants true for that slot and false for the other in the pair.
 */
export function wantsDeltaFromChoice(
  slotAId: string,
  slotBId: string,
  choice: string
): Record<string, boolean> {
  if (choice === slotAId) return { [slotAId]: true, [slotBId]: false };
  if (choice === slotBId) return { [slotAId]: false, [slotBId]: true };
  return {};
}
