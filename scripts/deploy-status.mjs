// Prints Vercel's production deploy result for the latest commits on main,
// read from GitHub deployments (Vercel records one per deploy). Exits 1 if the
// newest commit's production deploy failed, or if Vercel still hasn't started
// it 10 minutes after the commit, so a check can't miss a release that never
// went live. Preview deploys of the same commit (from a branch pointing at it)
// are ignored: only production decides what the live app runs.
//   node scripts/deploy-status.mjs [count]
const repo = "khatridheeraj/SourcingoOS";
const count = Number(process.argv[2] ?? 3);
const api = (path) =>
  fetch(path.startsWith("https://") ? path : `https://api.github.com/repos/${repo}/${path}`, {
    headers: { Accept: "application/vnd.github+json" },
  }).then((r) => {
    if (!r.ok) throw new Error(`GitHub ${r.status} for ${path}`);
    return r.json();
  });

const commits = await api(`commits?sha=main&per_page=${count}`);
let newestFailed = false;
for (const [i, c] of commits.entries()) {
  const [deploy] = await api(`deployments?sha=${c.sha}&environment=Production&per_page=1`);
  const [latest] = deploy ? await api(deploy.statuses_url) : [];
  const state = latest?.state ?? "not reported";
  const stale = !deploy && Date.now() - Date.parse(c.commit.committer.date) > 10 * 60_000;
  if (i === 0 && (state === "failure" || state === "error" || stale)) newestFailed = true;
  const title = c.commit.message.split("\n")[0];
  console.log(`${c.sha.slice(0, 7)}  ${state.padEnd(12)}  ${title}`);
  if (latest && state !== "success") console.log(`         ${latest.description}`);
  if (stale) console.log("         Vercel has not started a production deploy for this commit.");
}
process.exit(newestFailed ? 1 : 0);
