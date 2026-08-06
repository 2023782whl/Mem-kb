/**
 * Minimal YAML parser for .supabase markers and .redirect breadcrumbs.
 * Handles flat key: value maps only. No arrays, no nesting.
 */
export function parse(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    result[key] = value;
  }
  return result;
}

export function stringify(obj: Record<string, string | number>): string {
  return Object.entries(obj)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n') + '\n';
}
