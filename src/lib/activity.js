/**
 * Recent public activity from GitHub events (PushEvent commit counts).
 * Public events cover roughly the last 90 days.
 */

function daysSince(iso) {
  if (!iso) return 9999;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * @param {Array} events - GitHub public events payload
 * @param {{ analyzedRepos?: Array, profileActivityScore?: number }} [opts]
 */
export function summarizePublicActivity(events = [], opts = {}) {
  const analyzed = opts.analyzedRepos || [];
  const pushes = [];

  for (const ev of events || []) {
    if (ev?.type !== "PushEvent") continue;
    const fullName = ev.repo?.name || "";
    const short = fullName.includes("/") ? fullName.split("/").pop() : fullName;
    const commits = Number(ev.payload?.size) || ev.payload?.commits?.length || 0;
    pushes.push({
      at: ev.created_at,
      repo: short,
      fullName,
      commits: Math.max(0, commits),
    });
  }

  const byRepo = {};
  let commitApprox = 0;
  for (const p of pushes) {
    commitApprox += p.commits;
    if (!p.repo) continue;
    byRepo[p.repo] = (byRepo[p.repo] || 0) + p.commits;
  }

  const reposTouched = Object.entries(byRepo)
    .sort((a, b) => b[1] - a[1])
    .map(([name, commits]) => ({ name, commits }));

  const lastAt = pushes[0]?.at || null;
  const daysSinceLast = lastAt != null ? daysSince(lastAt) : null;

  // Fall back to repo push dates when events are empty / unavailable
  const byPush = [...analyzed].sort(
    (a, b) => new Date(b.repo.pushedAt) - new Date(a.repo.pushedAt)
  );
  const active30 = analyzed.filter((a) => daysSince(a.repo.pushedAt) < 30).length;
  const active90 = analyzed.filter((a) => daysSince(a.repo.pushedAt) < 90).length;
  const newestRepo = byPush[0]?.repo;
  const newestPushDays = newestRepo ? Math.round(daysSince(newestRepo.pushedAt)) : null;

  const score = opts.profileActivityScore;
  let label = "steady";
  if (commitApprox >= 40 || (active30 >= 2 && commitApprox >= 10) || (score != null && score >= 8.5)) {
    label = "hot";
  } else if (commitApprox >= 12 || active30 >= 1 || (score != null && score >= 7)) {
    label = "active";
  } else if (
    (daysSinceLast != null && daysSinceLast > 120) ||
    (newestPushDays != null && newestPushDays > 270) ||
    (score != null && score <= 4)
  ) {
    label = "quiet";
  } else if (
    (newestPushDays != null && newestPushDays > 540) ||
    (analyzed.length > 0 && active90 === 0 && commitApprox === 0)
  ) {
    label = "dormant";
  }

  const topRepos = reposTouched.slice(0, 3);
  let sampleNote = null;
  if (commitApprox > 0 && topRepos.length) {
    const repoBit = topRepos
      .map((r) => `${r.name}${r.commits ? ` (~${r.commits})` : ""}`)
      .join(", ");
    sampleNote = `≈${commitApprox} public commit${commitApprox === 1 ? "" : "s"} across ${
      reposTouched.length
    } repo${reposTouched.length === 1 ? "" : "s"} recently (${repoBit}).`;
  } else if (newestRepo && newestPushDays != null) {
    sampleNote =
      newestPushDays < 14
        ? `${newestRepo.name} was pushed within the last two weeks.`
        : newestPushDays < 90
          ? `${newestRepo.name} last moved ~${newestPushDays}d ago.`
          : `Newest sample push is ~${newestPushDays}d old (${newestRepo.name}).`;
  }

  return {
    pushEvents: pushes.length,
    commitApprox,
    reposTouched,
    commitsByRepo: byRepo,
    daysSinceLastPushEvent: daysSinceLast != null ? Math.round(daysSinceLast) : null,
    active30,
    active90,
    newestRepoName: newestRepo?.name || null,
    newestPushDays,
    label,
    sampleNote,
  };
}

/** Short adjective for headlines / one-liners. */
export function activityAdjective(activity) {
  switch (activity?.label) {
    case "hot":
      return "Highly active";
    case "active":
      return "Active";
    case "quiet":
      return "Quietly shipping";
    case "dormant":
      return "Mostly quiet";
    default:
      return "Steady";
  }
}

/** Lowercase vibe fragment for sentence midpoints. */
export function activityVibe(activity) {
  switch (activity?.label) {
    case "hot":
      return "shipping often";
    case "active":
      return "recently active";
    case "quiet":
      return "quieter lately";
    case "dormant":
      return "dormant on public pushes";
    default:
      return "keeping a steady pace";
  }
}
