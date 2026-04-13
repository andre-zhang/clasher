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
