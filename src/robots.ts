/**
 * Minimal robots.txt support. The watcher only fetches a page when the site's
 * robots.txt allows our user agent (or *) to read that path.
 */

interface Group {
  agents: string[];
  rules: { allow: boolean; path: string }[];
}

export function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const field = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (current && (field === 'allow' || field === 'disallow')) {
      if (value || field === 'allow') current.rules.push({ allow: field === 'allow', path: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function patternToRegex(p: string): RegExp {
  const anchored = p.endsWith('$');
  const body = (anchored ? p.slice(0, -1) : p).replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

/** Longest matching rule wins; ties go to allow. No matching rule = allowed. */
export function isAllowed(groups: Group[], userAgent: string, pathAndQuery: string): boolean {
  const ua = userAgent.toLowerCase();
  const token = ua.split(/[/\s]/)[0];
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && (token.includes(a) || a.includes(token))));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of chosen) {
    for (const r of g.rules) {
      if (r.path === '' ) continue;
      if (patternToRegex(r.path).test(pathAndQuery)) {
        const len = r.path.length;
        if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
      }
    }
  }
  return best ? best.allow : true;
}

const cache = new Map<string, { groups: Group[]; at: number }>();

export async function robotsAllows(url: string, userAgent: string): Promise<boolean> {
  const u = new URL(url);
  const key = u.origin;
  let entry = cache.get(key);
  if (!entry || Date.now() - entry.at > 6 * 3600_000) {
    let groups: Group[] = [];
    let res: Response;
    try {
      res = await fetch(`${u.origin}/robots.txt`, { headers: { 'user-agent': userAgent }, signal: AbortSignal.timeout(10000) });
    } catch (err) {
      // Can't read robots.txt: don't fetch the page this round.
      throw new Error(`robots.txt unreachable: ${err instanceof Error ? err.message : String(err)}`);
    }
    // 4xx = no robots file = everything allowed; 5xx = treat as temporarily disallowed.
    if (res.status >= 500) throw new Error(`robots.txt returned HTTP ${res.status}`);
    if (res.ok) groups = parseRobots(await res.text());
    entry = { groups, at: Date.now() };
    cache.set(key, entry);
  }
  return isAllowed(entry.groups, userAgent, u.pathname + u.search);
}
