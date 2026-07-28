type Rule = { allow: boolean; path: string };

/**
 * Minimal robots.txt matcher: the Allow/Disallow prefix rules for one
 * user-agent group, resolved by longest-match (the de-facto standard).
 */
export function parseRobots(
  txt: string,
  ua: string,
): { isAllowed(path: string): boolean } {
  const rules: Rule[] = [];

  // Group handling (RFC 9309 §2.2): a run of consecutive `User-agent:`
  // lines forms ONE group, naming possibly several agents. The first
  // Allow/Disallow line after that run closes the group and decides
  // whether its rules apply — by the union of names in the run, not just
  // the last one seen. A later `User-agent:` line (after rules were
  // already read) starts a brand-new group, so repeated non-adjacent
  // groups accumulate independently instead of overwriting each other.
  let groupAgents: string[] = [];
  let groupOpen = false; // still inside a run of consecutive User-agent lines
  let groupMatches = false; // does any agent named in the CURRENT group match us?

  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (!groupOpen) {
        // First User-agent line of a new group (either the very first
        // group in the file, or a fresh one following a prior group's
        // directives).
        groupAgents = [];
        groupOpen = true;
      }
      groupAgents.push(value);
    } else if (field === "allow" || field === "disallow") {
      // Directives before any User-agent line are ignored (no open group).
      if (groupOpen) {
        groupMatches = groupAgents.some(
          (a) => a === "*" || a.toLowerCase() === ua.toLowerCase(),
        );
        groupOpen = false; // the run is closed by its first directive
      }
      if (!groupMatches) continue;
      // "Disallow:" with an empty value means allow-all; it creates no rule.
      if (field === "disallow" && value === "") continue;
      rules.push({ allow: field === "allow", path: value });
    }
  }

  return {
    isAllowed(path: string): boolean {
      let best: Rule | null = null;
      for (const r of rules) {
        if (!path.startsWith(r.path)) continue;
        if (!best || r.path.length > best.path.length) best = r;
      }
      return best ? best.allow : true;
    },
  };
}

/**
 * Classifies a resolved robots.txt HTTP response per RFC 9309 §2.3.1 and
 * returns the resulting rule set (or null to signal fail-closed).
 *
 *   - 2xx              "available": parse the body normally.
 *   - 4xx, except 429  "unavailable": the crawler could not find a
 *                      robots.txt, so there are no restrictions to apply.
 *                      Allow all. (This is what makes 404 correctly mean
 *                      "no restrictions" — do not "simplify" this to
 *                      cover all non-2xx statuses, see the 5xx case below.)
 *   - 5xx, and 429     "unreachable": the server exists but could not
 *                      give a real answer (429 is an overload / rate-limit
 *                      signal, not "there is no robots.txt here"). RFC
 *                      9309 requires the crawler assume complete disallow
 *                      until it can fetch a real answer, so this fails
 *                      closed (null) exactly like a thrown network error.
 *
 * Any other/unexpected status also fails closed, on the same "cannot
 * confirm permission" reasoning.
 */
async function robotsRulesFromResponse(
  res: Response,
  ua: string,
): Promise<{ isAllowed(path: string): boolean } | null> {
  if (res.status >= 200 && res.status < 300) {
    return parseRobots(await res.text(), ua);
  }
  if (res.status >= 400 && res.status < 500 && res.status !== 429) {
    return parseRobots("", ua);
  }
  return null;
}

/** Fetches and caches robots.txt per host. Fails closed on error. */
export class RobotsCache {
  private readonly cache = new Map<
    string,
    { isAllowed(path: string): boolean } | null
  >();
  // Explicit fields, NOT parameter properties — Node's type stripping only
  // erases types and cannot emit the runtime assignments they require.
  private readonly fetchFn: typeof fetch;
  private readonly ua: string;

  constructor(fetchFn: typeof fetch, ua = "*") {
    this.fetchFn = fetchFn;
    this.ua = ua;
  }

  async isAllowed(url: string): Promise<boolean> {
    const u = new URL(url);
    let rules = this.cache.get(u.host);

    if (rules === undefined) {
      let fetched: { isAllowed(path: string): boolean } | null;
      try {
        const res = await this.fetchFn(`${u.protocol}//${u.host}/robots.txt`);
        fetched = await robotsRulesFromResponse(res, this.ua);
      } catch {
        // Thrown/network error: cannot confirm permission for THIS call,
        // so fail closed — but deliberately do NOT cache.set() here.
        // Caching a transient blip as a permanent "null" would silently
        // disallow the entire host (losing that host's archive data) for
        // the rest of the crawl run after one flaky request. Leaving the
        // cache entry unset means the next isAllowed() call for this host
        // simply retries the fetch, so a transient failure self-heals. A
        // persistent failure still fails closed on every call (nothing
        // here weakens that), and retry volume is naturally bounded: the
        // caller rate-limits per host, and failing closed means no page
        // fetches happen anyway while the host is unreachable.
        return false;
      }
      // A resolved HTTP response (2xx, 4xx, or 5xx/429) is a definitive,
      // reproducible outcome for this host — cache it once, including the
      // fail-closed 5xx/429 case (`fetched === null`), so a struggling
      // host isn't refetched on every single request.
      this.cache.set(u.host, fetched);
      rules = fetched;
    }

    if (rules === null) return false;
    return rules.isAllowed(u.pathname);
  }
}
