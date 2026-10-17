import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForDeployment } from "../src/deployment.ts";

const sha = "a".repeat(40);
const url = "https://dash.cloudflare.com/example/build";
const success = {
  id: 1, name: "Workers Builds: goldenretrieverhockey", head_sha: sha,
  app: { slug: "cloudflare-workers-and-pages" }, status: "completed",
  conclusion: "success", details_url: url,
};

function harness(responses: unknown[], status = 200) {
  let clock = 0;
  const requests: string[] = [];
  const options = {
    repository: "example/hockey", sha, token: "test-token",
    timeoutMs: 30, pollMs: 10,
    now: () => clock,
    wait: async (ms: number) => { clock += ms; },
    fetchFn: (async (input) => {
      requests.push(String(input));
      const body = responses.length > 1 ? responses.shift() : responses[0];
      return Response.json(body, { status });
    }) as typeof fetch,
  };
  return { options, requests };
}

test("waits for registration and completion on the newly pushed commit", async () => {
  const { options, requests } = harness([
    { check_runs: [] },
    { check_runs: [{ ...success, status: "in_progress", conclusion: null }] },
    { check_runs: [success] },
  ]);
  assert.equal(await waitForDeployment(options), url);
  assert.equal(requests.length, 3);
  const endpoint = new URL(requests[0]!);
  assert.equal(endpoint.pathname, `/repos/example/hockey/commits/${sha}/check-runs`);
  assert.equal(endpoint.searchParams.get("check_name"), success.name);
});

test("hosting failure turns the refresh red even after a successful local build", async () => {
  const { options, requests } = harness([{ check_runs: [{ ...success, conclusion: "failure" }] }]);
  await assert.rejects(waitForDeployment(options), (error: Error) => {
    assert.match(error.message, /Cloudflare deployment failure/);
    assert.ok(error.message.includes(url));
    assert.match(error.message, /Captured data is saved/);
    return true;
  });
  assert.equal(requests.length, 1);
});

test("cancelled, skipped, and inconclusive deployments do not count as published", async (t) => {
  for (const conclusion of ["cancelled", "skipped", "neutral", "timed_out", null]) {
    await t.test(String(conclusion), async () => {
      const { options } = harness([{ check_runs: [{ ...success, conclusion }] }]);
      await assert.rejects(waitForDeployment(options), /publication was not successful/);
    });
  }
});

test("a newer successful retry supersedes an earlier failed attempt", async () => {
  const { options } = harness([{ check_runs: [
    { ...success, conclusion: "failure" }, { ...success, id: 2 },
  ] }]);
  assert.equal(await waitForDeployment(options), url);
});

test("an old success cannot hide a newer running or failed deployment", async () => {
  const { options, requests } = harness([
    { check_runs: [success, { ...success, id: 2, status: "in_progress", conclusion: null }] },
    { check_runs: [success, { ...success, id: 2, conclusion: "failure" }] },
  ]);
  await assert.rejects(waitForDeployment(options), /Cloudflare deployment failure/);
  assert.equal(requests.length, 2);
});

test("unrelated successes cannot satisfy the deployment check", async () => {
  const { options, requests } = harness([{ check_runs: [
    { ...success, head_sha: "b".repeat(40) },
    { ...success, name: "Workers Builds: another-site" },
    { ...success, app: { slug: "github-actions" } },
  ] }]);
  await assert.rejects(waitForDeployment(options), /Timed out.*has not reported a build/);
  assert.equal(requests.length, 3);
});

test("a build that never finishes times out instead of staying green", async () => {
  const { options } = harness([{ check_runs: [{ ...success, status: "in_progress", conclusion: null }] }]);
  await assert.rejects(waitForDeployment(options), /Timed out.*in_progress/);
});

test("GitHub permission failures are reported without disclosing the token", async () => {
  const { options } = harness([{}], 403);
  await assert.rejects(waitForDeployment(options), /GitHub returned HTTP 403/);
});
