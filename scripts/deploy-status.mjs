// Prints Vercel's deploy result for the latest commits on main, read from
// GitHub commit statuses (Vercel posts one per deploy). Exits 1 if the
// newest commit's deploy failed, so a check can't miss a broken release.
//   node scripts/deploy-status.mjs [count]
const repo = "khatridheeraj/SourcingoOS";
const count = Number(process.argv[2] ?? 3);
const api = (path) =>
  fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: { Accept: "application/vnd.github+json" },
  }).then((r) => {
    if (!r.ok) throw new Error(`GitHub ${r.status} for ${path}`);
    return r.json();
  });

const commits = await api(`commits?sha=main&per_page=${count}`);
let newestFailed = false;
for (const [i, c] of commits.entries()) {
  const { statuses } = await api(`commits/${c.sha}/status`);
  const vercel = statuses.find((s) => s.context === "Vercel");
  const state = vercel?.state ?? "not reported";
  if (i === 0 && state === "failure") newestFailed = true;
  const title = c.commit.message.split("\n")[0];
  console.log(`${c.sha.slice(0, 7)}  ${state.padEnd(12)}  ${title}`);
  if (vercel && state !== "success") console.log(`         ${vercel.description}`);
}
process.exit(newestFailed ? 1 : 0);
