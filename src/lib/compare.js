/**
 * Descriptive comparison of two PokéGit profiles.
 * Focus: uniqueness of ideas, activity (public vs likely-private, recent moves),
 * and whimsy. Never ranks who is better.
 */

const PLAYFUL_RE =
  /\b(fun|funny|toy|game|games|playful|whimsy|whimsical|cute|art|generative|pokemon|pokémon|doodle|sketch|playground|hackathon|silly|meme|party|rainbow|sparkle|magic|weird|experimental)\b/i;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const EMOJI_ALL_RE = /\p{Extended_Pictographic}/gu;
const UNCOMMON_LANGS = new Set([
  "Rust",
  "Zig",
  "Elixir",
  "Haskell",
  "OCaml",
  "Nim",
  "Crystal",
  "Julia",
  "Lua",
  "Assembly",
  "WebAssembly",
  "Solidity",
  "Nix",
  "D",
  "F#",
  "Clojure",
  "Erlang",
  "Elm",
  "PureScript",
  "Reason",
  "R",
  "Fortran",
]);

function joinList(items) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

function haystack(payload) {
  const user = payload?.user || {};
  const repos = payload?.analyzedRepos || [];
  return [
    user.bio,
    user.company,
    user.blog,
    ...repos.map(
      (a) => `${a.repo?.name || ""} ${a.repo?.description || ""} ${(a.repo?.topics || []).join(" ")}`
    ),
  ]
    .filter(Boolean)
    .join(" ");
}

export function profileFlavor(payload) {
  const user = payload?.user || {};
  const repos = payload?.analyzedRepos || [];
  const activity = payload?.activity || {};
  const pulse = payload?.contributionPulse || null;
  const langs = (payload?.languageSummary || []).map((l) => l.name).filter(Boolean);
  const bio = user.bio || "";
  const text = haystack(payload);
  const emojiHits = (text.match(EMOJI_ALL_RE) || []).length;
  const playfulRepos = repos.filter((a) =>
    PLAYFUL_RE.test(`${a.repo?.name || ""} ${a.repo?.description || ""} ${(a.repo?.topics || []).join(" ")}`)
  );
  const pokeNames = repos.map((a) => a.pokemon?.name).filter(Boolean);
  const pokeKinds = [...new Set(pokeNames)];
  const ditto = pokeNames.filter((n) => n === "Ditto").length;
  const sylveon = pokeNames.filter((n) => n === "Sylveon").length;
  const eevee = pokeNames.filter((n) => n === "Eevee").length;
  const alakazam = pokeNames.filter((n) => n === "Alakazam").length;
  const topics = new Set(repos.flatMap((a) => a.repo?.topics || []));
  const unusualLangs = langs.filter((l) => UNCOMMON_LANGS.has(l));
  const publicQuiet =
    activity.label === "quiet" ||
    activity.label === "dormant" ||
    ((activity.commitApprox || 0) === 0 && (activity.newestPushDays == null || activity.newestPushDays > 90));
  const publicHeavy =
    (activity.commitApprox || 0) >= 12 || activity.label === "hot" || activity.label === "active";
  const yearCount = pulse?.yearCount ?? null;
  const possiblyPrivate =
    Boolean(pulse?.includesPrivate) ||
    (yearCount != null && yearCount >= 80 && publicQuiet);

  return {
    uniqueness: {
      unusualLangs,
      topicCount: topics.size,
      pokeKinds,
      experimental: ditto,
      complex: alakazam,
      langCount: langs.length,
      langs: langs.slice(0, 4),
      surprises: (payload.surprises || []).map((s) => s.title).filter(Boolean),
    },
    whimsy: {
      emojiHits,
      playfulRepos: playfulRepos.map((a) => a.repo.name),
      bioPlayful: PLAYFUL_RE.test(bio) || EMOJI_RE.test(bio),
      hasProfileReadme: Boolean(payload.hasProfileReadme),
      ditto,
      sylveon,
      eevee,
    },
    activity: {
      label: activity.label || "steady",
      commitApprox: activity.commitApprox || 0,
      sampleNote: activity.sampleNote || null,
      newestPushDays: activity.newestPushDays ?? null,
      newestRepoName: activity.newestRepoName || null,
      reposTouched: (activity.reposTouched || []).slice(0, 3),
      yearCount,
      includesPrivate: Boolean(pulse?.includesPrivate),
      recentActiveDays: pulse?.recentActiveDays ?? null,
      possiblyPrivate,
      publicHeavy,
      publicQuiet,
    },
  };
}

function uniquenessBlurb(login, u) {
  const bits = [];
  if (u.unusualLangs.length) bits.push(`${joinList(u.unusualLangs)} in the mix`);
  if (u.experimental) bits.push(`${u.experimental} experimental Ditto-shaped repo${u.experimental === 1 ? "" : "s"}`);
  if (u.complex) bits.push("Alakazam-level technical projects");
  if (u.topicCount >= 5) bits.push(`a wide topic spread (${u.topicCount} topics in the sample)`);
  if (u.pokeKinds.length >= 4) bits.push(`several repository personalities (${joinList(u.pokeKinds.slice(0, 4))})`);
  if (u.surprises[0]) bits.push(u.surprises[0].toLowerCase());
  if (!bits.length && u.langs.length) bits.push(`a ${joinList(u.langs.slice(0, 2))} footprint`);
  if (!bits.length) return `@${login}'s public ideas are hard to read from this sample.`;
  return `@${login}: ${bits.slice(0, 3).join("; ")}.`;
}

function activityBlurb(login, a) {
  const recent =
    a.reposTouched.length > 0
      ? a.reposTouched
          .map((r) => (r.commits ? `${r.name} (~${r.commits})` : r.name))
          .slice(0, 2)
          .join(", ")
      : a.newestRepoName
        ? a.newestPushDays != null
          ? `${a.newestRepoName} ~${a.newestPushDays}d ago`
          : a.newestRepoName
        : null;

  if (a.publicHeavy) {
    const commits =
      a.commitApprox > 0 ? `≈${a.commitApprox} public commit${a.commitApprox === 1 ? "" : "s"} recently` : "recent public pushes";
    const where = recent ? ` in ${recent}` : "";
    const priv = a.includesPrivate || a.possiblyPrivate ? " The year graph may also count private days." : "";
    return `@${login} is shipping in public (${commits}${where}).${priv}`;
  }

  if (a.possiblyPrivate) {
    const year = a.yearCount != null ? ` ~${a.yearCount} contributions in the last year` : "";
    const days =
      a.recentActiveDays != null && a.recentActiveDays > 0
        ? ` ${a.recentActiveDays} active day${a.recentActiveDays === 1 ? "" : "s"} on the calendar in the last two weeks.`
        : "";
    return `@${login}'s public repos look quiet${recent ? ` (last public move: ${recent})` : ""}, while the contribution graph still looks busy${year}.${days} That often means private work GitHub does not list.`;
  }

  if (a.recentActiveDays != null && a.recentActiveDays > 0 && a.publicQuiet) {
    return `@${login} has ${a.recentActiveDays} active calendar day${a.recentActiveDays === 1 ? "" : "s"} in the last two weeks, with little showing up as public repo pushes. Could be private work, or activity GitHub does not expose as events.`;
  }

  if (a.publicQuiet) {
    return `@${login} has been quiet on public pushes${recent ? ` (last sample: ${recent})` : ""}. Private repos stay invisible here.`;
  }

  return `@${login} is keeping a steady public pace${recent ? ` (${recent})` : ""}.`;
}

function whimsyBlurb(login, w) {
  const bits = [];
  if (w.bioPlayful) bits.push("a playful profile bio");
  if (w.emojiHits >= 3) bits.push(`emoji showing up across the public surface (${w.emojiHits} hits in the sample)`);
  else if (w.emojiHits >= 1) bits.push("a little emoji in names or copy");
  if (w.playfulRepos.length) bits.push(`toy/game energy in ${joinList(w.playfulRepos.slice(0, 2))}`);
  if (w.ditto) bits.push("experimental Ditto repos");
  if (w.sylveon) bits.push("design-forward Sylveon work");
  if (w.hasProfileReadme) bits.push("a profile README, which is a chance to be weird on purpose");
  if (!bits.length) return `@${login}'s public GitHub reads fairly straight. Not much toy, emoji, or experimental sparkle in the sample.`;
  return `@${login}: ${bits.slice(0, 3).join("; ")}.`;
}

function uniquenessLens(left, right, fl, fr) {
  const body = [uniquenessBlurb(left.user.login, fl.uniqueness), uniquenessBlurb(right.user.login, fr.uniqueness)].join(
    " "
  );
  const evidence = [
    `@${left.user.login}: ${fl.uniqueness.langs.join(", ") || "mixed langs"}, ${fl.uniqueness.topicCount} topics, ${fl.uniqueness.pokeKinds.length} Pokémon kinds`,
    `@${right.user.login}: ${fr.uniqueness.langs.join(", ") || "mixed langs"}, ${fr.uniqueness.topicCount} topics, ${fr.uniqueness.pokeKinds.length} Pokémon kinds`,
  ];
  return {
    id: "uniqueness",
    title: "Uniqueness of ideas",
    icon: "✦",
    kind: "inferred",
    body,
    evidence,
    sides: {
      left: uniquenessBlurb(left.user.login, fl.uniqueness),
      right: uniquenessBlurb(right.user.login, fr.uniqueness),
    },
  };
}

function activityLens(left, right, fl, fr) {
  const body = [activityBlurb(left.user.login, fl.activity), activityBlurb(right.user.login, fr.activity)].join(" ");
  const evidence = [];
  for (const [login, a] of [
    [left.user.login, fl.activity],
    [right.user.login, fr.activity],
  ]) {
    const bits = [`public ${a.label}`];
    if (a.commitApprox) bits.push(`≈${a.commitApprox} public commits`);
    if (a.yearCount != null) bits.push(`${a.yearCount} contributions / year`);
    if (a.possiblyPrivate) bits.push("likely some private work");
    if (a.newestRepoName && a.newestPushDays != null) bits.push(`${a.newestRepoName} ~${a.newestPushDays}d`);
    evidence.push(`@${login}: ${bits.join(", ")}`);
  }
  return {
    id: "activity",
    title: "Activity",
    icon: "🚀",
    kind: fl.activity.possiblyPrivate || fr.activity.possiblyPrivate ? "uncertain" : "observed",
    body,
    evidence,
    sides: {
      left: activityBlurb(left.user.login, fl.activity),
      right: activityBlurb(right.user.login, fr.activity),
    },
  };
}

function whimsyLens(left, right, fl, fr) {
  const body = [whimsyBlurb(left.user.login, fl.whimsy), whimsyBlurb(right.user.login, fr.whimsy)].join(" ");
  const evidence = [];
  for (const [login, w] of [
    [left.user.login, fl.whimsy],
    [right.user.login, fr.whimsy],
  ]) {
    const bits = [];
    if (w.emojiHits) bits.push(`${w.emojiHits} emoji`);
    if (w.playfulRepos.length) bits.push(`playful: ${w.playfulRepos.slice(0, 2).join(", ")}`);
    if (w.hasProfileReadme) bits.push("profile README");
    if (w.ditto) bits.push("Ditto");
    evidence.push(`@${login}: ${bits.join(", ") || "straight public face"}`);
  }
  return {
    id: "whimsy",
    title: "Whimsy",
    icon: "✨",
    kind: "inferred",
    body,
    evidence,
    sides: {
      left: whimsyBlurb(left.user.login, fl.whimsy),
      right: whimsyBlurb(right.user.login, fr.whimsy),
    },
  };
}

/**
 * @returns {{ left, right, lenses: Array, differences: Array, similarities: Array, disclaimer: string }}
 */
export function compareProfiles(left, right) {
  const disclaimer =
    "Descriptive contrast of public GitHub signals only. Not a ranking of who is the better engineer. Private repos stay invisible unless someone opted to count them on their contribution graph.";

  if (!left?.user || !right?.user) {
    return { left, right, lenses: [], differences: [], similarities: [], disclaimer };
  }

  const fl = profileFlavor(left);
  const fr = profileFlavor(right);
  const lenses = [
    uniquenessLens(left, right, fl, fr),
    activityLens(left, right, fl, fr),
    whimsyLens(left, right, fl, fr),
  ];

  return {
    left,
    right,
    lenses,
    differences: lenses,
    similarities: [],
    disclaimer,
  };
}
