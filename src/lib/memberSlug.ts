/**
 * Stable slug from a member display name (for URLs and weak "log back in" matching).
 */
export function memberDisplaySlug(displayName: string): string {
  return displayName
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Whether joining with `incoming` would duplicate an existing member’s identity. */
export function displayNameTakenInSquad(
  existingNames: string[],
  incoming: string
): boolean {
  return existingNames.some((existing) => {
    const a = memberDisplaySlug(existing);
    const b = memberDisplaySlug(incoming);
    if (a.length > 0 && b.length > 0) return a === b;
    return existing.trim().toLowerCase() === incoming.trim().toLowerCase();
  });
}
