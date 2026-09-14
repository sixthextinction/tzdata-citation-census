// Fetch a URL from the Internet Archive's Wayback Machine
export async function wayback(url) {
  try {
    const api =
      "https://archive.org/wayback/available?url=" + encodeURIComponent(url); // API endpoint valid as of 12 Sept 2026
    const resp = await fetch(api, { signal: AbortSignal.timeout(20_000) });
    if (!resp.ok) {
      return { tried: true, hit: false, error: `HTTP ${resp.status}` };
    }
    const json = await resp.json();
    const snap = json?.archived_snapshots?.closest;
    if (snap?.available) {
      return { tried: true, hit: true, url: snap.url, timestamp: snap.timestamp };
    }
    return { tried: true, hit: false };
  } catch (err) {
    return { tried: true, hit: false, error: err.name };
  }
}

// Leave this here for convenience
// Quickly checks and returns if we need to retry with Wayback
export function needsWayback(row) {
  if (row.direct !== 404 && row.direct !== 410) return false; // not 404 or 410, so no need to try Wayback
  if (row.wayback?.tried) return false; // already tried Wayback, so no need to try again
  if (row.archived?.url) return false; // already archived, so no need to try again
  return true;
}
