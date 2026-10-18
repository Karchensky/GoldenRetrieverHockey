/**
 * The rink's video platform (LECOM Harborcenter, run by HTPTV), as the daily
 * job uses it: sign in, find our recorded games, ask for a clip of a goal,
 * fetch it when it is ready. The same calls the rink's own web app makes, with
 * the account owner's subscription; nothing here is available that the site's
 * own Download button does not offer.
 *
 * **The job's logs are public** — the repository is — so nothing here ever
 * prints a token, the stream's address or a clip's download link. Errors carry
 * a status and the platform's message, never a URL.
 *
 * **`requestDownload` is the only call that spends anything**: one of the
 * account's monthly download credits. It is called from one place, `daily.ts`,
 * after the goal is located and confirmed and the account shows no download
 * for that clip already.
 */

const MAIN = "https://harborcenter-api.htptv.net";
const PUBLIC = "https://api.htptv.net";
const MOMENTS = "https://al-api.htptv.net";
/** The platform's id for the HarborCenter tenant, as its own web app sends it. */
const CUSTOMER = 10;

/**
 * A signed-in session. Its token expires — on 2026-10-18 half an hour into a
 * run that made recaps, every call after that was refused "401 — Token
 * expired" — so a session from `signIn` can `renew` itself, and every call
 * made with one signs in again once when the platform says the token is no
 * good. A refused call did nothing, so asking again is safe, even a download.
 */
export type Session = { token: string; renew?: () => Promise<void> };

/** A platform that stops answering costs a minute, not the job's hour. */
const TIMEOUT = 60_000;

async function call<T>(label: string, url: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), ...init });
  if (!r.ok) {
    let message = "";
    try { const j = await r.json() as { message?: string; error?: string }; message = j.message ?? j.error ?? ""; } catch {}
    throw Object.assign(new Error(`${label}: ${r.status}${message ? ` — ${message}` : ""}`), { status: r.status });
  }
  return r.status === 204 ? (undefined as T) : (await r.json() as T);
}

export async function signIn(email: string, password: string): Promise<Session> {
  const login = async () => {
    // The rink's app sends the caller's public address with the sign-in, so this does too.
    const ip = await publicAddress();
    const j = await call<{ data?: { AccessToken?: string } }>("sign in", `${MAIN}/login`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email, password, ip_address: ip }),
    });
    const token = j.data?.AccessToken;
    if (!token) throw new Error("sign in: no token in the reply");
    return token;
  };
  const s: Session = { token: await login() };
  s.renew = async () => { s.token = await login(); };
  return s;
}

/** A call made with the session's token: refused as unauthorised, the session signs in again and it is made once more. */
export async function authed<T>(s: Session, go: () => Promise<T>): Promise<T> {
  try {
    return await go();
  } catch (e) {
    if ((e as { status?: number }).status !== 401 || !s.renew) throw e;
    await s.renew();
    return go();
  }
}

/** The caller's public address, from whichever of two lookups answers. */
async function publicAddress(): Promise<string> {
  for (const url of ["https://api.ipify.org", "https://icanhazip.com"]) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const ip = (await r.text()).trim();
      if (r.ok && /^[\d.:a-f]+$/i.test(ip)) return ip;
    } catch {}
  }
  throw new Error("sign in: could not look up this machine's public address");
}

const main = (s: Session) => ({ Authorization: `bearer ${s.token}` });
const moments = (s: Session) => ({ Authorization: `Bearer ${s.token}`, "x-htp-device": "web", "content-type": "application/json" });

/** Download credits left this billing month. */
export async function clipsCredit(s: Session): Promise<number> {
  const j = await authed(s, () => call<{ data?: { ClipsCredit?: number } }>("download credit", `${MAIN}/getUserDownloadCredit`, { headers: main(s) }));
  if (typeof j.data?.ClipsCredit !== "number") throw new Error("download credit: no ClipsCredit in the reply");
  return j.data.ClipsCredit;
}

export type RinkTeam = { id: number; name: string; mascot: string };

/**
 * Every team on the platform that is us. The club has been entered more than
 * once — "Golden" Retrievers and "The Golden" Retrievers are separate ids with
 * games under each — and "Golden" alone is also the Golden Seals, a different
 * club. So it is the name and the mascot together, with or without "The".
 */
export const isUs = (t: { name: string; mascot: string }) =>
  /^(the\s+)?golden\s+retrievers?$/i.test(`${t.name} ${t.mascot}`.trim().replace(/\s+/g, " "));

export async function ourTeams(): Promise<RinkTeam[]> {
  const j = await call<{ data?: unknown }>("teams", `${PUBLIC}/teams/${CUSTOMER}`);
  const rows = (Array.isArray(j.data) ? j.data : (j.data as { rows?: unknown[] })?.rows ?? []) as
    { team_id: number; team_name: string; team_mascot: string }[];
  return rows.map((t) => ({ id: t.team_id, name: t.team_name ?? "", mascot: t.team_mascot ?? "" })).filter(isUs);
}

export type RinkGame = {
  id: number;
  /** "2026-10-15" */
  date: string;
  /** "20:30", the 24-hour form the site's games use. */
  time: string;
  /** "Rink 2" */
  rink: string;
  home: string;
  away: string;
};

/** "08:30 PM" -> "20:30". */
export function to24h(t: string): string {
  const m = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(t.trim());
  if (!m) throw new Error(`Not a 12-hour time: "${t}"`);
  const h = Number(m[1]) % 12 + (m[3]!.toUpperCase() === "PM" ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/** Our recorded games on or after `since` (YYYY-MM-DD), newest first, across every id that is us. */
export async function recordedGames(teams: RinkTeam[], since: string): Promise<RinkGame[]> {
  const seen = new Map<number, RinkGame>();
  for (const team of teams) {
    for (let page = 1; page <= 20; page++) {
      const q = new URLSearchParams({ customer: String(CUSTOMER), status: "vod", limit: "36", start: "", end: "", page: String(page), team: String(team.id) });
      const j = await call<{ data?: { game_id: number; game_date: string; game_time: string; pad_name: string; home_team: string; home_team_mascot: string; away_team: string; away_team_mascot: string }[] }>("recorded games", `${PUBLIC}/schedule?${q}`);
      const rows = j.data ?? [];
      for (const g of rows) {
        if (g.game_date < since) continue;
        seen.set(g.game_id, {
          id: g.game_id, date: g.game_date, time: to24h(g.game_time), rink: g.pad_name,
          home: `${g.home_team} ${g.home_team_mascot ?? ""}`.trim(), away: `${g.away_team} ${g.away_team_mascot ?? ""}`.trim(),
        });
      }
      // Newest first: once a page reaches back past `since`, nothing further is wanted.
      if (rows.length < 36 || rows.some((g) => g.game_date < since)) break;
    }
  }
  return [...seen.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export type GameDetails = { live: boolean; rink: string; dateTime: string; streamUrl: string | null };

/** The game's player details. `streamUrl` is the recording — never log it. */
export async function gameDetails(s: Session, id: number): Promise<GameDetails> {
  const j = await authed(s, () => call<{ data?: { is_live: number; pad_name: string; game_date_time: string; vod_url: string | null }[] }>(
    `game ${id}`, `${PUBLIC}/player/${id}`, { headers: main(s) }));
  const g = j.data?.[0];
  if (!g) throw new Error(`game ${id}: no details`);
  return { live: g.is_live === 1, rink: g.pad_name, dateTime: g.game_date_time, streamUrl: g.vod_url || null };
}

export type Moment = {
  id: string;
  type: string;
  startSec: number;
  durationSec: number;
  /** null until a download is asked for. `url` only once COMPLETE — never log it. */
  download: { status: string; url: string | null } | null;
};

type RawMoment = { id: string; type: string; start_ms: number; duration_ms: number; download: { status: string; url: string | null } | null };
const moment = (m: RawMoment): Moment => ({ id: m.id, type: m.type, startSec: m.start_ms / 1000, durationSec: m.duration_ms / 1000, download: m.download });

/** The account's own clips of a game. */
export async function myMoments(s: Session, game: number): Promise<Moment[]> {
  const j = await authed(s, () => call<{ moments?: RawMoment[] }>(`moments of ${game}`, `${MOMENTS}/games/${game}/moments?tab=mine&sort=oldest`, { headers: moments(s) }));
  return (j.moments ?? []).map(moment);
}

/** The rink cuts clips of 20 to 60 seconds and refuses anything else. */
export const CLIP_MIN = 20, CLIP_MAX = 60;

/** Mark a clip. Free: a clip is a start and a length saved to the account. */
export async function createMoment(s: Session, game: number, startSec: number, durationSec: number): Promise<Moment> {
  if (durationSec < CLIP_MIN || durationSec > CLIP_MAX) throw new Error(`A ${durationSec}s clip — the rink cuts ${CLIP_MIN} to ${CLIP_MAX}`);
  const j = await authed(s, () => call<{ moment: RawMoment }>(`new clip of ${game}`, `${MOMENTS}/games/${game}/moments`, {
    method: "POST",
    headers: moments(s),
    body: JSON.stringify({ type: "goal", startMs: Math.round(startSec * 1000), durationMs: Math.round(durationSec * 1000), feed: "home" }),
  }));
  return moment(j.moment);
}

/** SPENDS ONE DOWNLOAD CREDIT. The rink renders the clip; `myMoments` shows it COMPLETE, with a link, a few minutes later. */
export async function requestDownload(s: Session, momentId: string): Promise<void> {
  await authed(s, () => call<void>(`download of clip ${momentId}`, `${MOMENTS}/moments/${momentId}/download`, { method: "POST", headers: moments(s) }));
}
