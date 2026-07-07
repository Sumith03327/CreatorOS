/**
 * Parses a Mesh JSON response defensively. Even in json_object mode, models
 * occasionally wrap output in ```json fences or add stray prose. This strips the
 * common wrappers and, as a last resort, extracts the first {...} block before
 * throwing a clear error the caller can surface for a retry.
 *
 * Kept in a plain (non-"use server") module so it can be a synchronous helper
 * shared by the server-action flows.
 */
export function parseMeshJson<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        // fall through to the shared error below
      }
    }
    throw new Error('AI returned an unreadable response. Please try again.');
  }
}
