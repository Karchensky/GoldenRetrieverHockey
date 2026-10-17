import { execFileSync } from "node:child_process";
import { waitForDeployment } from "../packages/build/src/deployment.ts";

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN;
if (!repository || !token) throw new Error("GITHUB_REPOSITORY and GH_TOKEN are required.");

// GITHUB_SHA is the checkout's original revision, before the refresh commit.
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
console.log(`Waiting for Cloudflare to deploy ${sha}...`);
try {
  const url = await waitForDeployment({ repository, sha, token });
  console.log(`Cloudflare deployment succeeded: ${url}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
