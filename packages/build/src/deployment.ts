import { setTimeout as sleep } from "node:timers/promises";

type CheckRun = {
  id: number;
  name: string;
  head_sha: string;
  app: { slug: string };
  status: string;
  conclusion: string | null;
  details_url: string | null;
};

/** A successful local build does not prove Cloudflare published the pushed data. */
export async function waitForDeployment({
  repository, sha, token, fetchFn = fetch, wait = sleep, now = Date.now,
  timeoutMs = 10 * 60_000, pollMs = 15_000,
}: {
  repository: string;
  sha: string;
  token: string;
  fetchFn?: typeof fetch;
  wait?: (ms: number) => Promise<unknown>;
  now?: () => number;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<string> {
  const checkName = "Workers Builds: goldenretrieverhockey";
  const url = new URL(`https://api.github.com/repos/${repository}/commits/${sha}/check-runs`);
  url.searchParams.set("check_name", checkName);
  url.searchParams.set("filter", "latest");
  url.searchParams.set("per_page", "100");
  const deadline = now() + timeoutMs;
  let state = "Cloudflare has not reported a build";

  while (now() < deadline) {
    const response = await fetchFn(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, deadline - now()))),
    });
    if (!response.ok) {
      throw new Error(`Cannot verify Cloudflare deployment: GitHub returned HTTP ${response.status}.`);
    }
    const body = await response.json() as { check_runs: CheckRun[] };
    // A rerun supersedes the failed attempt. Only trust this Worker's check
    // from Cloudflare on the exact commit the refresh pushed.
    const check = body.check_runs
      .filter((c) => c.name === checkName && c.head_sha === sha &&
        c.app?.slug === "cloudflare-workers-and-pages")
      .sort((a, b) => b.id - a.id)[0];
    if (check?.status === "completed") {
      if (check.conclusion === "success") {
        return check.details_url ?? `https://github.com/${repository}/commit/${sha}/checks`;
      }
      throw new Error(
        `Cloudflare deployment ${check.conclusion ?? "has no conclusion"} for ${sha}. ` +
        `Captured data is saved in GitHub, but publication was not successful. ${check.details_url ?? ""}`,
      );
    }
    if (check) state = `Cloudflare build is ${check.status}`;
    await wait(Math.max(0, Math.min(pollMs, deadline - now())));
  }
  throw new Error(`Timed out verifying deployment of ${sha}: ${state}. The live site may still have older data.`);
}
