import { test } from "node:test";
import assert from "node:assert/strict";
import {
  guestTicket,
  authHeader,
  partialUrl,
  endpoints,
  playerIdsIn,
  teamIdsIn,
  HARBORCENTER_CLIENT_SERVICE_ID,
  HAHL_LEAGUE_ID,
  teamIdentity,
  isRetrievers,
} from "../src/sources/digitalshift.ts";

test("guestTicket posts the client_service_id and returns the hash", async () => {
  let seenUrl = "";
  let seenBody = "";
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    seenUrl = String(input);
    seenBody = String(init?.body ?? "");
    assert.equal(init?.method, "POST");
    return new Response(JSON.stringify({ ticket: { hash: "ABC123" }, version: 1 }), {
      status: 200,
    });
  }) as unknown as typeof fetch;

  const t = await guestTicket(fake);
  assert.equal(t, "ABC123");
  assert.equal(seenUrl, "https://web.api.digitalshift.ca/login");
  assert.ok(
    seenBody.includes(HARBORCENTER_CLIENT_SERVICE_ID),
    "must send the client_service_id",
  );
});

test("guestTicket throws on a non-2xx login", async () => {
  const fake = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
  await assert.rejects(() => guestTicket(fake), /status 503/);
});

test("guestTicket throws when the response carries no ticket hash", async () => {
  // Must fail loud: a missing ticket would otherwise degrade into
  // unauthenticated requests that all 401 and look like "no data exists".
  const fake = (async () =>
    new Response(JSON.stringify({ version: 1 }), { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(() => guestTicket(fake), /no ticket hash/);
});

test("authHeader wraps the ticket in the exact format the API requires", () => {
  // From the bundle: headers.Authorization = 'ticket="' + ticket + '"'
  assert.equal(authHeader("ABC"), 'ticket="ABC"');
});

test("partialUrl targets the WEB api, not the advertised stats api", () => {
  // stats.api.digitalshift.ca is advertised in window.config but the SPA never
  // calls it; it rejects the site's own ticket with invalid_ticket_service.
  const u = partialUrl("team", { team_id: 681628 });
  assert.ok(u.startsWith("https://web.api.digitalshift.ca/partials/stats/"), u);
  assert.ok(!u.includes("stats.api.digitalshift.ca"), "must not use the red-herring host");
  assert.ok(u.includes("team_id=681628"));
});

test("endpoints nest stats under team/, not as a sibling", () => {
  // The flat shape (partials/stats/stats?team_id=) 404s.
  assert.ok(endpoints.teamStats(681628).includes("/partials/stats/team/stats?"));
  assert.ok(endpoints.team(681628).includes("/partials/stats/team?"));
  assert.ok(endpoints.player(2350393).includes("/partials/stats/player?player_id=2350393"));
});

test("HAHL_LEAGUE_ID is Seneca HAHL", () => {
  assert.equal(HAHL_LEAGUE_ID, 1367);
});

test("playerIdsIn extracts and dedupes player ids from a partial", () => {
  const c = `<a href="stats#/player/2350393">Bryan Karchensky</a>
             <a href="stats#/player/2374630">Adam Kaplewicz</a>
             <a href="stats#/player/2350393">Bryan Karchensky</a>`;
  assert.deepEqual(playerIdsIn(c), [2350393, 2374630]);
});

test("playerIdsIn returns empty for markup with no players", () => {
  assert.deepEqual(playerIdsIn("<div>nothing here</div>"), []);
});

test("teamIdsIn extracts and dedupes team ids from a partial", () => {
  const c = `<a href="/stats#/1367/team/681628/stats">Stats</a>
             <a href="/stats#/1367/team/681628/roster">Roster</a>
             <a href="/stats#/1367/team/121839/stats">Other</a>`;
  assert.deepEqual(teamIdsIn(c), [121839, 681628]);
});

// --- team identity: must test the team's OWN name, not the whole document ---

const grPartial = (name: string, siblings = "") =>
  `<h1 class="sr-only"> ${name}, Summer 2026, Silver </h1>
   <div ng-init="ctrl.teams_by_division = [${siblings}]"></div>`;

test("teamIdentity parses the team's own name, session and division", () => {
  const id = teamIdentity(grPartial("The Golden Retrievers"));
  assert.deepEqual(id, { name: "The Golden Retrievers", session: "Summer 2026", division: "Silver" });
});

test("teamIdentity returns null when there is no header", () => {
  assert.equal(teamIdentity("<div>nope</div>"), null);
});

test("isRetrievers accepts BOTH live name variants", () => {
  // Both are in live, alternating use across consecutive sessions.
  assert.equal(isRetrievers(grPartial("Golden Retrievers")), true);
  assert.equal(isRetrievers(grPartial("The Golden Retrievers")), true);
});

test("isRetrievers rejects a team that merely SHARES A DIVISION with the Retrievers", () => {
  // The regression that matters: a team partial embeds teams_by_division
  // listing every sibling. Searching raw content matched Classic Cue's
  // Billiards, Burners, 716 Realty Group and Wurlitzer Blues as "Retrievers"
  // purely because the Retrievers appeared in their division list.
  const siblings = `{"name":"The Golden Retrievers"},{"name":"Burners"}`;
  const notUs = grPartial("Classic Cue's Billiards", siblings);
  assert.ok(/golden retrievers/i.test(notUs), "sanity: the name IS present in the document");
  assert.equal(isRetrievers(notUs), false, "but this team is NOT the Retrievers");
});

test("isRetrievers rejects the owner's other teams by name", () => {
  for (const n of ["Burners", "716 Realty Group", "Classic Cue's Billiards", "Whalers"]) {
    assert.equal(isRetrievers(grPartial(n)), false, `${n} is not the Retrievers`);
  }
});

test("isRetrievers rejects a partial with no header", () => {
  assert.equal(isRetrievers("<div>golden retrievers mentioned here</div>"), false);
});
