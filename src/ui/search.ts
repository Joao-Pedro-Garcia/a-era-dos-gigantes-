/**
 * Item and recipe search: case- and accent-insensitive, every word of the
 * query must appear in the name, the description or the category.
 */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function matches(query: string, ...fields: string[]): boolean {
  const q = normalize(query);
  if (!q) return true;
  const hay = normalize(fields.join(' '));
  return q.split(/\s+/).every((w) => hay.includes(w));
}
