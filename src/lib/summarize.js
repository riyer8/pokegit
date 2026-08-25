/**
 * Greens / reds for a profile — pointed, specific, a little ruthless.
 */

import { getOpenAIKey } from "./secrets.js";

function daysSince(iso) {
  if (!iso) return 9999;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

function buildContext(analysis) {
  const { user, profileScores, analyzedRepos, insufficient } = analysis;
  if (insufficient) return null;

  const lines = [
    `Developer: ${user.login}`,
    user.name ? `Name: ${user.name}` : null,
    user.bio ? `Bio: ${user.bio}` : null,
    user.company ? `Company: ${user.company}` : null,
    `Followers: ${user.followers ?? "?"}`,
    "",
    "Scores 0–10 (derived, imperfect):",
    `Code quality: ${profileScores.codeQuality}`,
    `Testing: ${profileScores.testing}`,
    `Maintenance: ${profileScores.maintenance}`,
    `Documentation: ${profileScores.documentation}`,
    "",
    "Repos (name these in flags when relevant):",
  ].filter((x) => x !== null);

  for (const item of analyzedRepos) {
    const { repo, scores, signals, pokemon } = item;
    lines.push(
      [
        `- ${repo.name} [${pokemon.name}]`,
        `  language: ${repo.language || "unknown"}`,
        `  stars: ${repo.stargazers}, forks: ${repo.forks}, sizeKB: ${repo.size}`,
        `  lastPush: ${repo.pushedAt?.slice(0, 10)}, daysSincePush: ${Math.round(daysSince(repo.pushedAt))}, archived: ${Boolean(repo.archived)}`,
        `  tests: ${signals.hasTests}, ci: ${signals.hasCi}, readme: ${signals.hasReadme}, docs: ${signals.hasDocs}, contributing: ${signals.hasContributing}`,
        `  scores: Q${scores.codeQuality} T${scores.testing} M${scores.maintenance} D${scores.documentation}`,
        repo.description ? `  description: ${repo.description.slice(0, 160)}` : "  description: (none)",
        repo.topics?.length ? `  topics: ${repo.topics.slice(0, 8).join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return lines.join("\n");
}

function pack(greens, reds, source, extra = {}) {
  const clean = (s) =>
    String(s)
      .replace(/\u2014/g, ".") // em dash
      .replace(/\u2013/g, ",") // en dash
      .replace(/\s*—\s*/g, ". ")
      .replace(/\s*–\s*/g, ", ")
      .replace(/\.\s*\./g, ".")
      .trim();
  const g = (greens || []).filter(Boolean).map(clean).slice(0, 5);
  const r = (reds || []).filter(Boolean).map(clean).slice(0, 5);
  const text = [...g.map((x) => `+ ${x}`), ...r.map((x) => `- ${x}`)].join("\n");
  return { text, greens: g, reds: r, source, ...extra };
}

export function heuristicSummary(analysis) {
  const { profileScores, analyzedRepos, insufficient, insufficientReason, user } = analysis;
  if (insufficient) {
    return pack([], [insufficientReason || "Almost nothing public to judge."], "heuristic");
  }

  const greens = [];
  const reds = [];
  const n = analyzedRepos.length || 1;
  const byMaint = [...analyzedRepos].sort((a, b) => b.scores.maintenance - a.scores.maintenance);
  const byStars = [...analyzedRepos].sort((a, b) => b.repo.stargazers - a.repo.stargazers);
  const top = byStars[0];
  const freshest = [...analyzedRepos].sort(
    (a, b) => daysSince(a.repo.pushedAt) - daysSince(b.repo.pushedAt)
  )[0];
  const stalest = [...analyzedRepos].sort(
    (a, b) => daysSince(b.repo.pushedAt) - daysSince(a.repo.pushedAt)
  )[0];

  const withTests = analyzedRepos.filter((a) => a.signals?.hasTests);
  const withCi = analyzedRepos.filter((a) => a.signals?.hasCi);
  const noReadme = analyzedRepos.filter((a) => !a.signals?.hasReadme);
  const noTests = analyzedRepos.filter((a) => !a.signals?.hasTests);
  const dormant = analyzedRepos.filter((a) => a.pokemon.name === "Snorlax" || daysSince(a.repo.pushedAt) > 540);
  const dragons = analyzedRepos.filter((a) => a.pokemon.name === "Dragonite");
  const langs = [...new Set(analyzedRepos.map((a) => a.repo.language).filter(Boolean))];

  // --- greens: name real repos ---
  if (top && top.repo.stargazers >= 50) {
    greens.push(
      `${top.repo.name} actually has gravity (${top.repo.stargazers}★). Not just a parking lot of empty repos.`
    );
  } else if (dragons[0]) {
    greens.push(`${dragons[0].repo.name} looks like a real, heavy codebase. Not a weekend toy.`);
  }

  if (withTests.length / n >= 0.6) {
    const sample = withTests
      .slice(0, 2)
      .map((a) => a.repo.name)
      .join(", ");
    greens.push(`Tests show up where it counts (${sample}${withTests.length > 2 ? ", and a couple more" : ""}).`);
  } else if (withTests.length === 1) {
    greens.push(`At least ${withTests[0].repo.name} isn't shipping completely untested.`);
  }

  if (withCi.length / n >= 0.5) {
    greens.push(`CI isn't theater. ${withCi.length}/${n} of the sample has automation wired in.`);
  }

  if (profileScores.maintenance >= 7.5 && freshest) {
    const d = Math.round(daysSince(freshest.repo.pushedAt));
    greens.push(
      d < 30
        ? `Still touching code recently. ${freshest.repo.name} got a push about ${d}d ago.`
        : `Maintenance isn't abandoned. ${byMaint[0].repo.name} still gets love.`
    );
  }

  if (langs.length === 1) {
    greens.push(`Doesn't thrash languages. Mostly ${langs[0]}, which usually means depth over resume-padding.`);
  } else if (langs.length === 2) {
    greens.push(`Tight stack: ${langs.join(" + ")}. Focused, not a zoo.`);
  }

  // --- reds: be blunt, name names ---
  if (profileScores.testing <= 4.5 || noTests.length / n >= 0.6) {
    const sample = noTests
      .slice(0, 2)
      .map((a) => a.repo.name)
      .join(", ");
    reds.push(
      sample
        ? `Testing looks optional. ${sample}${noTests.length > 2 ? " and friends" : ""} show no test footprint.`
        : "Testing signals are basically missing."
    );
  }

  if (noReadme.length) {
    reds.push(
      noReadme.length === 1
        ? `${noReadme[0].repo.name} ships without even a README. That's a tell.`
        : `${noReadme.length} repos without a README, including ${noReadme[0].repo.name}.`
    );
  }

  if (profileScores.documentation <= 5) {
    reds.push("Docs are an afterthought. Fine for private hacks, rough for anything others should use.");
  }

  if (dormant.length >= Math.ceil(n / 2)) {
    reds.push(
      `Half the party is asleep. ${dormant
        .slice(0, 2)
        .map((a) => a.repo.name)
        .join(", ")}${dormant.length > 2 ? ", and more" : ""} look abandoned.`
    );
  } else if (stalest && daysSince(stalest.repo.pushedAt) > 365) {
    reds.push(
      `${stalest.repo.name} hasn't moved in about ${Math.round(daysSince(stalest.repo.pushedAt) / 30)} months. Dead weight in the top set.`
    );
  }

  const tinyPopular = analyzedRepos.filter((a) => a.repo.stargazers >= 20 && (a.repo.size || 0) < 80);
  if (tinyPopular[0] && !tinyPopular[0].signals.hasTests) {
    reds.push(`${tinyPopular[0].repo.name} has attention but almost no substance footprint.`);
  }

  const starTotal = analyzedRepos.reduce((s, a) => s + (a.repo.stargazers || 0), 0);
  if (starTotal < 5 && (user?.followers || 0) < 20 && n >= 3) {
    reds.push("Public work hasn't found an audience yet. Hard to tell signal from noise.");
  }

  if (profileScores.maintenance <= 4.5) {
    reds.push("Maintenance score is ugly. This profile reads like a graveyard with a couple of survivors.");
  }

  // ensure both sides have bite
  if (!greens.length) {
    greens.push(
      freshest
        ? `Something is still alive (${freshest.repo.name}). Thin praise, but it's not zero.`
        : "Public repos exist. That's the nicest thing available from this sample."
    );
  }
  if (!reds.length) {
    const weakest = [...analyzedRepos].sort((a, b) => a.scores.testing - b.scores.testing)[0];
    reds.push(
      weakest
        ? `${weakest.repo.name} is the soft underbelly. Weakest testing/structure in the set.`
        : "Profile is oddly smooth. Either elite or the public sample is too thin to puncture."
    );
  }

  return pack(greens.slice(0, 4), reds.slice(0, 4), "heuristic");
}

function parseModelJson(raw) {
  if (!raw) return null;
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();
  try {
    const data = JSON.parse(text);
    if (!Array.isArray(data.greens) && !Array.isArray(data.reds)) return null;
    return pack(data.greens || [], data.reds || [], "openai");
  } catch {
    return null;
  }
}

export async function generateSummary(analysis) {
  const fallback = heuristicSummary(analysis);
  if (analysis.insufficient) return fallback;

  const openaiApiKey = await getOpenAIKey();
  if (!openaiApiKey) return fallback;

  const context = buildContext(analysis);
  const system = `You write green/red flags for PokéGit like a blunt senior engineer texting a friend after stalking someone's GitHub.

Return ONLY JSON: {"greens":[...],"reds":[...]}

How to sound:
- Human cadence. Short sentences. Fragments are fine. Contractions when natural.
- Never use em dashes (—) or en dashes (–). Use periods, commas, or parentheses instead.
- Avoid AI tells: "delve", "landscape", "robust", "leverage", "showcase", "it is worth noting", "stands out as", "demonstrates a commitment".
- Harsh and specific. Name real repos. Roast soft spots. Praise only what earns it.
- Not cruel about the person. Savage about the public work patterns.
- 3-4 greens, 3-4 reds. One short line each.
- Only claim what the data supports. No mush, no disclaimers.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.75,
        max_tokens: 380,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: `Write greens and reds for this profile. Sound like a person, not a model. No em dashes.\n\n${context}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      console.warn("PokéGit OpenAI error", res.status);
      return { ...fallback, llmError: true };
    }

    const data = await res.json();
    const parsed = parseModelJson(data.choices?.[0]?.message?.content);
    if (!parsed || (!parsed.greens.length && !parsed.reds.length)) {
      return { ...fallback, llmError: true };
    }
    return parsed;
  } catch (err) {
    console.warn("PokéGit OpenAI failed", err);
    return { ...fallback, llmError: true };
  }
}
