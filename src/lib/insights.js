/**
 * Day-2 observations, evidence, and at-a-glance copy for PokéGit.
 * Observations > raw score dumps.
 */

function daysSince(iso) {
  if (!iso) return 9999;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

function ageYears(iso) {
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}

function clampLabel(score) {
  if (score == null) return "unknown";
  if (score >= 8.5) return "clear strength";
  if (score >= 7) return "solid";
  if (score >= 5) return "mixed";
  return "thinner";
}

/**
 * Build checklist evidence from the analyzed set.
 */
export function buildEvidence(analyzedRepos, profileScores) {
  const n = analyzedRepos.length || 1;
  const withTests = analyzedRepos.filter((a) => a.signals?.hasTests).length;
  const withCi = analyzedRepos.filter((a) => a.signals?.hasCi).length;
  const withReadme = analyzedRepos.filter((a) => a.signals?.hasReadme).length;
  const active90 = analyzedRepos.filter((a) => daysSince(a.repo.pushedAt) < 90).length;
  const active365 = analyzedRepos.filter((a) => daysSince(a.repo.pushedAt) < 365).length;
  const mature = analyzedRepos.filter((a) => ageYears(a.repo.createdAt) >= 2).length;

  const items = [
    { ok: n >= 1, text: `${n} owned non-fork repositories analyzed` },
    { ok: withTests > 0, text: `Automated tests visible in ${withTests}/${n}` },
    { ok: withCi > 0, text: `CI configured in ${withCi}/${n}` },
    { ok: withReadme > 0, text: `README present in ${withReadme}/${n}` },
    { ok: active90 > 0, text: `${active90}/${n} pushed within the last 90 days` },
    { ok: active365 >= Math.ceil(n / 2), text: `${active365}/${n} touched in the last year` },
    { ok: mature > 0, text: `${mature} project(s) are 2+ years old` },
    {
      ok: (profileScores.testing || 0) >= 7,
      text: `Testing score ${profileScores.testing ?? "—"}/10`,
    },
    {
      ok: (profileScores.maintenance || 0) >= 7,
      text: `Maintenance score ${profileScores.maintenance ?? "—"}/10`,
    },
  ];

  return items;
}

/**
 * Narrative observations with kind + evidence bullets.
 * kind: observed | inferred | uncertain
 */
export function buildObservations(analyzedRepos, profileScores, languageSummary = []) {
  const n = analyzedRepos.length || 1;
  const withTests = analyzedRepos.filter((a) => a.signals?.hasTests);
  const withCi = analyzedRepos.filter((a) => a.signals?.hasCi);
  const active90 = analyzedRepos.filter((a) => daysSince(a.repo.pushedAt) < 90);
  const oldButAlive = analyzedRepos.filter(
    (a) => ageYears(a.repo.createdAt) >= 2 && daysSince(a.repo.pushedAt) < 180
  );
  const noTests = analyzedRepos.filter((a) => !a.signals?.hasTests);
  const langs = (languageSummary || []).map((l) => l.name);
  const observations = [];

  // Testing
  if (withTests.length / n >= 0.6) {
    observations.push({
      id: "testing-strong",
      icon: "🧪",
      title: "Testing is a clear strength",
      kind: "observed",
      body: `${withTests.length} of the ${n} analyzed repositories contain automated tests${
        withCi.length ? `, and ${withCi.length} wire up CI` : ""
      }. Larger projects in the set appear to prioritize regression protection.`,
      evidence: [
        `Tests in ${withTests.map((a) => a.repo.name).slice(0, 3).join(", ")}`,
        withCi.length ? `CI in ${withCi.length}/${n}` : null,
        `Testing score ${profileScores.testing}/10`,
      ].filter(Boolean),
      dim: "testing",
      score: profileScores.testing,
    });
  } else if (noTests.length / n >= 0.6) {
    observations.push({
      id: "testing-thin",
      icon: "🧪",
      title: "Limited testing infrastructure is visible",
      kind: "observed",
      body: `${noTests.length}/${n} analyzed repos show no obvious test footprint. That doesn't mean "bad engineer." It means public automation is sparse.`,
      evidence: noTests.slice(0, 3).map((a) => `No test signals in ${a.repo.name}`),
      dim: "testing",
      score: profileScores.testing,
    });
  }

  // Maintenance
  if (active90.length >= 2 || (oldButAlive.length >= 1 && active90.length >= 1)) {
    observations.push({
      id: "maintenance-strong",
      icon: "🔄",
      title: "This developer likes to maintain things",
      kind: "inferred",
      body:
        oldButAlive.length > 0
          ? `${active90.length} repositories received meaningful pushes in the last 90 days, including older work that is still getting care.`
          : `${active90.length} repositories received meaningful pushes in the last 90 days.`,
      evidence: active90.slice(0, 3).map((a) => {
        const d = Math.round(daysSince(a.repo.pushedAt));
        return `${a.repo.name} pushed ~${d}d ago`;
      }),
      dim: "maintenance",
      score: profileScores.maintenance,
    });
  } else if ((profileScores.maintenance || 0) <= 4.5) {
    observations.push({
      id: "maintenance-quiet",
      icon: "🔄",
      title: "Public maintenance looks quiet lately",
      kind: "observed",
      body: "Most of the sample hasn't moved recently. Older projects may simply be finished rather than abandoned in disgrace.",
      evidence: analyzedRepos
        .slice(0, 3)
        .map((a) => `${a.repo.name}: ~${Math.round(daysSince(a.repo.pushedAt))}d since push`),
      dim: "maintenance",
      score: profileScores.maintenance,
    });
  }

  // Language / stack pattern
  if (langs.length >= 2) {
    const top = langs.slice(0, 3).join(" + ");
    observations.push({
      id: "stack-pattern",
      icon: "🧩",
      title: "Interesting stack pattern",
      kind: "inferred",
      body: `Their public work repeatedly surfaces ${top}, suggesting a real preference rather than random language hopping.`,
      evidence: (languageSummary || []).slice(0, 3).map((l) => `${l.name} ~${l.percent}% of sample weight`),
      dim: "architecture",
      score: profileScores.architecture,
    });
  } else if (langs[0]) {
    observations.push({
      id: "lang-focus",
      icon: "🧩",
      title: `${langs[0]} shows up as a home base`,
      kind: "observed",
      body: `Most of the analyzed weight sits in ${langs[0]}. That usually means depth over résumé padding.`,
      evidence: [`Primary language signal: ${langs[0]}`],
      dim: "architecture",
      score: profileScores.architecture,
    });
  }

  // Docs
  if ((profileScores.documentation || 0) >= 7.5) {
    observations.push({
      id: "docs-strong",
      icon: "📚",
      title: "Documentation is taken seriously",
      kind: "observed",
      body: "READMEs and docs signals show up often enough that outsiders can actually orient themselves.",
      evidence: [
        `Documentation score ${profileScores.documentation}/10`,
        `${analyzedRepos.filter((a) => a.signals?.hasReadme).length}/${n} with README`,
      ],
      dim: "documentation",
      score: profileScores.documentation,
    });
  } else if ((profileScores.documentation || 0) <= 5) {
    observations.push({
      id: "docs-thin",
      icon: "📚",
      title: "Docs look thinner than the code signals",
      kind: "observed",
      body: "Public documentation lags the rest of the profile. Fine for private hacks. Rough if strangers are meant to use the work.",
      evidence: [`Documentation score ${profileScores.documentation}/10`],
      dim: "documentation",
      score: profileScores.documentation,
    });
  }

  // Uncertain catch-all if thin
  if (observations.length < 2) {
    observations.push({
      id: "uncertain-thin",
      icon: "❔",
      title: "Public sample is a bit thin to overclaim",
      kind: "uncertain",
      body: "There's enough to sketch a silhouette, not enough to write a biography. Treat the stronger signals as more trustworthy than the soft ones.",
      evidence: [`Only ${n} repos in the analysis set`],
      dim: null,
      score: null,
    });
  }

  return observations.slice(0, 5);
}

/**
 * At-a-glance headline + strongest dims + one-liner.
 * Answers: "What kind of engineer is this?"
 */
export function buildGlance(user, profileScores, observations, summary, languageSummary = []) {
  const ranked = [
    ["testing", "Testing", "🧪"],
    ["architecture", "Architecture", "🏗"],
    ["maintenance", "Maintenance", "🔄"],
    ["documentation", "Docs", "📚"],
    ["complexity", "Complexity", "🛠"],
    ["activity", "Activity", "🚀"],
  ]
    .map(([key, label, icon]) => ({ key, label, icon, score: profileScores[key] }))
    .filter((d) => d.score != null)
    .sort((a, b) => b.score - a.score);

  // Match the Day-2 mock: show top strengths (prefer the four classic dims when close)
  const classic = ranked.filter((d) =>
    ["testing", "architecture", "maintenance", "documentation"].includes(d.key)
  );
  const strongest = (classic.length >= 3 ? classic : ranked).slice(0, 4);

  const headline =
    summary?.glanceHeadline ||
    deriveHeadline(user, profileScores, observations, languageSummary);

  const oneLiner =
    summary?.oneLiner ||
    deriveOneLiner(profileScores, observations) ||
    "Public GitHub signals sketch a partial engineering silhouette.";

  return {
    headline,
    oneLiner,
    strongest,
    allScores: ranked,
  };
}

function deriveHeadline(user, scores, observations, languageSummary = []) {
  const langs = (languageSummary || []).map((l) => l.name).filter(Boolean);
  const bits = [];

  if ((scores.testing || 0) >= 8) bits.push("test-oriented");
  if ((scores.maintenance || 0) >= 8) bits.push("maintenance-minded");
  if ((scores.architecture || 0) >= 8) bits.push("structure-conscious");
  if ((scores.complexity || 0) >= 8) bits.push("systems-depth");
  if ((scores.documentation || 0) >= 8) bits.push("docs-aware");

  let stack = "";
  if (langs.length >= 2) stack = `${langs[0]} / ${langs[1]}`;
  else if (langs[0]) stack = langs[0];

  if (bits.length && stack) {
    return `${capitalize(bits[0])} ${stack} engineer`;
  }
  if (bits.length >= 2) {
    return `${capitalize(bits[0])}, ${bits[1]} engineer`;
  }
  if (bits.length === 1) {
    return `${capitalize(bits[0])} engineer`;
  }
  if (stack) return `${stack}-focused engineer`;
  if (observations[0]?.title) {
    return observations[0].title.replace(/^[^\w]+ /, "").replace(/\.$/, "") || "Public-work engineer";
  }
  return user?.bio?.split(/[.\n]/)[0]?.trim() || "Public GitHub engineer";
}

function deriveOneLiner(scores, observations) {
  const traits = [];
  if ((scores.testing || 0) >= 7.5) traits.push("test-oriented");
  if ((scores.maintenance || 0) >= 7.5) traits.push("highly iterative");
  if ((scores.architecture || 0) >= 7.5) traits.push("structure-conscious");
  if (traits.length >= 2) return `Consistent, ${traits[0]} and ${traits[1]}.`;
  if (traits.length === 1) return `Consistent and ${traits[0]}.`;
  if (observations[0]?.title) return observations[0].title;
  return "";
}

function capitalize(s) {
  return String(s || "").replace(/^\w/, (c) => c.toUpperCase());
}

/** Per-repo drill-down payload. */
export function buildRepoDrilldown(item) {
  const { repo, scores, signals, pokemon } = item;
  const years = ageYears(repo.createdAt);
  const days = Math.round(daysSince(repo.pushedAt));

  const checks = [
    { ok: Boolean(signals.hasCi), text: "CI configured" },
    { ok: Boolean(signals.hasTests), text: "Automated tests" },
    { ok: days < 180, text: "Active development" },
    { ok: Boolean(signals.hasReadme || signals.hasDocs), text: "Documentation" },
    { ok: Boolean(signals.hasLicenseFile || repo.license), text: "License present" },
    {
      ok: (signals.rootFiles || []).some((f) =>
        /package-lock|yarn.lock|pnpm-lock|go.sum|Cargo.lock|Gemfile.lock|poetry.lock/i.test(f)
      ),
      text: "Lockfile / dependency pin",
    },
  ];

  const interesting = [
    years >= 1 ? `${years.toFixed(1)} years old` : "Younger than a year",
    days < 90 ? "Still actively maintained" : days < 365 ? "Touched within a year" : "Quiet lately",
    repo.language ? `${repo.language}-heavy` : null,
    (repo.stargazers || 0) >= 20 ? `${repo.stargazers} stars` : null,
    (repo.topics || []).length ? `Topics: ${repo.topics.slice(0, 4).join(", ")}` : null,
  ].filter(Boolean);

  const roleGuess = pokemon.tags?.includes("Frontend")
    ? "Frontend"
    : pokemon.tags?.includes("Infra")
      ? "Infrastructure"
      : pokemon.tags?.includes("Security")
        ? "Security"
        : pokemon.tags?.includes("ML")
          ? "ML / research"
          : repo.language
            ? `${repo.language} · project`
            : "General project";

  return {
    roleGuess,
    checks,
    interesting,
    whyTitle: `Why ${pokemon.name}?`,
    whyBody: pokemon.why || pokemon.signal,
    personality: pokemon.personality || pokemon.blurb,
  };
}

export { clampLabel, daysSince, ageYears };
