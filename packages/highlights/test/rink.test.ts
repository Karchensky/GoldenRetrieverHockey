import { test } from "node:test";
import assert from "node:assert/strict";
import { clipsCredit, gameDetails, type Session } from "../src/rink.ts";

/**
 * The platform's token expires part way through a long run — on 2026-10-18,
 * half an hour in, every recap after the second was refused. A session signs
 * in again once and asks again; anything else the platform says is passed on.
 */

const realFetch = globalThis.fetch;
function platform(answer: (token: string) => { status: number; body: unknown }) {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const token = String(new Headers(init?.headers).get("authorization") ?? "").split(" ")[1] ?? "";
    const { status, body } = answer(token);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

test("an expired token is renewed once and the call made again", async (t) => {
  t.after(() => { globalThis.fetch = realFetch; });
  platform((token) => (token === "fresh" ? { status: 200, body: { data: { ClipsCredit: 17 } } } : { status: 401, body: { message: "Token expired" } }));
  let renewed = 0;
  const s: Session = { token: "stale", renew: async () => { renewed++; s.token = "fresh"; } };
  assert.equal(await clipsCredit(s), 17);
  assert.equal(renewed, 1);
  assert.equal(s.token, "fresh");
});

test("a refusal that is not about the token is not retried, and a session that cannot renew says so", async (t) => {
  t.after(() => { globalThis.fetch = realFetch; });
  let renewed = 0;
  platform(() => ({ status: 500, body: { message: "Server error" } }));
  const s: Session = { token: "fresh", renew: async () => { renewed++; } };
  await assert.rejects(gameDetails(s, 1), /game 1: 500 — Server error/);
  assert.equal(renewed, 0);
  platform(() => ({ status: 401, body: { message: "Token expired" } }));
  await assert.rejects(clipsCredit({ token: "stale" }), /401 — Token expired/);
  // Renewed and still refused: reported, not asked a third time.
  await assert.rejects(clipsCredit({ token: "stale", renew: async () => { renewed++; } }), /401/);
  assert.equal(renewed, 1);
});
