/**
 * Deep public analysis for a single GitHub repository page.
 */

import { request } from "./github-request.js";
import { inspectRepoSignals } from "./inspect.js";
import { scoreRepo } from "./score.js";
import { assignPokemon } from "./pokemon.js";
import { detectAiAssistance } from "./summarize.js";
import { openaiChatJson } from "./openai-request.js";
import { buildRepoDrilldown } from "./insights.js";
import { preciseBlurb, stripMarkdown } from "./text.js";
import { buildReadmeCenter, maybePolishReadmeCenter, parsePackageHints } from "./readme-center.js";
import { gatherRepoChatPack } from "./repo-chat.js";

function cleanLine(s) {
  return String(s || "")
    .replace(/\u2014/g, ".")
    .replace(/\u2013/g, ",")
    .replace(/\s*—\s*/g, ". ")
    .replace(/\s*–\s*/g, ", ")
    .replace(/\.\s*\./g, ".")
    .trim();
}

function decodeBase64(content) {
  try {
    const normalized = String(content || "").replace(/\n/g, "");
    // GitHub content API uses base64
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}

async function fetchRepoMeta(owner, repo) {
  const { data, rateLimitRemaining } = await request(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  );
  return {
    rateLimitRemaining,
    repo: {
      id: data.id,
      name: data.name,
      fullName: data.full_name,
      description: data.description,
      htmlUrl: data.html_url,
      language: data.language,
      stargazers: data.stargazers_count,
      forks: data.forks_count,
      watchers: data.watchers_count,
      openIssues: data.open_issues_count,
      size: data.size,
      topics: data.topics || [],
      license: data.license?.spdx_id || null,
      archived: data.archived,
      disabled: data.disabled,
      isFork: Boolean(data.fork),
      defaultBranch: data.default_branch,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      pushedAt: data.pushed_at,
      homepage: data.homepage || null,
      owner: {
        login: data.owner?.login,
        avatarUrl: data.owner?.avatar_url,
        type: data.owner?.type,
      },
    },
  };
}

async function fetchReadme(owner, repo) {
  try {
    const { data } = await request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`
    );
    const text = decodeBase64(data.content);
    return {
      name: data.name,
      path: data.path,
      text,
      excerpt: excerptReadme(text),
    };
  } catch {
    return null;
  }
}

function excerptReadme(text) {
  if (!text) return "";
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("![") && !l.startsWith("<img") && !/^\[!\[/.test(l));

  const useful = [];
  let sawTitle = false;
  for (const line of lines) {
    if (/^#+\s/.test(line)) {
      if (!sawTitle) {
        sawTitle = true;
        continue; // skip the H1; we want the blurb under it
      }
      if (useful.length) break;
      continue;
    }
    if (/^```/.test(line)) break;
    if (/^[-*_|]{3,}$/.test(line)) continue;
    if (/^\|/.test(line)) continue;
    if (/^(badges?|toc|table of contents|contents)\b/i.test(line.replace(/^#+\s*/, ""))) continue;
    if (/^(install|installation|getting started|usage|license|contributing|development)\b/i.test(line.replace(/^#+\s*/, ""))) {
      if (useful.length) break;
      continue;
    }

    const cleaned = stripMarkdown(
      line.replace(/^>\s*/, "").replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "")
    );
    if (!cleaned || cleaned.length < 12) continue;
    if (/^(npm |yarn |pnpm |pip install|cargo |go get)/i.test(cleaned)) continue;

    useful.push(cleaned);
    if (useful.join(" ").length > 280) break;
  }

  return preciseBlurb(useful.join(" "), { maxChars: 240, maxSentences: 2 });
}

async function fetchLanguages(owner, repo) {
  try {
    const { data } = await request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/languages`
    );
    const entries = Object.entries(data || {});
    const total = entries.reduce((s, [, n]) => s + n, 0) || 1;
    return entries
      .map(([name, bytes]) => ({ name, percent: Math.round((bytes / total) * 1000) / 10 }))
      .sort((a, b) => b.percent - a.percent)
      .slice(0, 8);
  } catch {
    return [];
  }
}

async function fetchFileText(owner, repo, path) {
  try {
    const { data } = await request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`
    );
    if (data?.content && data.encoding === "base64") return decodeBase64(data.content);
  } catch {
    /* missing */
  }
  return null;
}

async function fetchWorkflowNames(owner, repo) {
  try {
    const { data } = await request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/.github/workflows`
    );
    if (!Array.isArray(data)) return [];
    return data.map((f) => f.name).filter(Boolean);
  } catch {
    return [];
  }
}

function parseTestCommands(manifestText, kind) {
  const commands = [];
  if (!manifestText) return commands;
  if (kind === "package.json") {
    try {
      const pkg = JSON.parse(manifestText);
      const scripts = pkg.scripts || {};
      for (const key of ["test", "test:unit", "test:ci", "coverage", "vitest", "jest"]) {
        if (scripts[key]) commands.push({ cmd: `npm run ${key}`, via: `package.json scripts.${key}` });
      }
      if (!commands.length && scripts.lint) {
        commands.push({ cmd: "npm run lint", via: "package.json scripts.lint (no test script found)" });
      }
    } catch {
      /* ignore */
    }
  }
  if (kind === "pyproject" || kind === "pytest") {
    if (/pytest/i.test(manifestText)) commands.push({ cmd: "pytest", via: "pytest config / dependency" });
    if (/unittest/i.test(manifestText)) commands.push({ cmd: "python -m unittest", via: "unittest mention" });
  }
  if (kind === "makefile") {
    if (/^test\s*:/m.test(manifestText)) commands.push({ cmd: "make test", via: "Makefile target" });
  }
  if (kind === "cargo") {
    commands.push({ cmd: "cargo test", via: "Cargo.toml present" });
  }
  if (kind === "go") {
    commands.push({ cmd: "go test ./...", via: "go.mod present" });
  }
  return commands;
}

function extractReadmeTestHints(readmeText) {
  if (!readmeText) return [];
  const hints = [];
  const lower = readmeText.toLowerCase();
  const blocks = readmeText.match(/```[\s\S]*?```/g) || [];
  for (const block of blocks) {
    const body = block.replace(/```\w*\n?/, "").replace(/```$/, "");
    if (/\b(npm test|pnpm test|yarn test|pytest|cargo test|go test|make test|vitest|jest)\b/i.test(body)) {
      const line = body
        .split(/\n/)
        .map((l) => l.replace(/^\$\s*/, "").trim())
        .find((l) => /\b(test|pytest|vitest|jest)\b/i.test(l));
      if (line) hints.push({ cmd: line.slice(0, 120), via: "README code block" });
    }
  }
  if (!hints.length && /\b(npm test|pytest|cargo test|go test)\b/.test(lower)) {
    const m = readmeText.match(/\b(npm test|pnpm test|yarn test|pytest|cargo test|go test \.\/\.\.\.)\b/i);
    if (m) hints.push({ cmd: m[1], via: "README mention" });
  }
  return hints.slice(0, 4);
}

function buildAbout({ repo, readme, languages }) {
  const ghDesc = preciseBlurb(repo.description || "", { maxChars: 180, maxSentences: 2 });
  const readmeBlurb = preciseBlurb(readme?.excerpt || "", { maxChars: 220, maxSentences: 2 });

  let summary = ghDesc;
  let fromReadme = false;

  if (!summary && readmeBlurb) {
    summary = readmeBlurb;
    fromReadme = true;
  } else if (
    summary &&
    readmeBlurb &&
    !readmeBlurb.toLowerCase().includes(summary.toLowerCase().slice(0, 40)) &&
    summary.length < 90 &&
    readmeBlurb.length > 40
  ) {
    // Short GitHub description + one clarifying README sentence
    const extra = preciseBlurb(readmeBlurb, { maxChars: 120, maxSentences: 1 });
    if (extra && !summary.toLowerCase().includes(extra.toLowerCase().slice(0, 24))) {
      summary = preciseBlurb(`${summary} ${extra}`, { maxChars: 240, maxSentences: 3 });
      fromReadme = true;
    }
  }

  if (!summary) {
    summary = `${repo.name} is a public ${repo.language || "polyglot"} repository with little descriptive text on GitHub.`;
  }

  summary = cleanLine(summary);

  const bullets = [];
  if (repo.language) bullets.push(`Primary language: ${repo.language}`);
  if (languages[0] && languages[0].name !== repo.language) {
    bullets.push(`Also heavy on ${languages[0].name} (~${languages[0].percent}%)`);
  } else if (languages[0]) {
    bullets.push(`Language mix led by ${languages[0].name} (~${languages[0].percent}%)`);
  }
  if (repo.topics?.length) bullets.push(`Topics: ${repo.topics.slice(0, 5).join(", ")}`);
  if (repo.license) bullets.push(`License: ${repo.license}`);
  if (repo.isFork) bullets.push("Marked as a fork");
  if (repo.archived) bullets.push("Archived");
  if (repo.homepage) bullets.push(`Homepage: ${repo.homepage}`);

  return {
    summary,
    blurb: preciseBlurb(summary, { maxChars: 160, maxSentences: 2 }),
    fromReadme: fromReadme || Boolean(readme?.excerpt && !ghDesc),
    readmeName: readme?.name || null,
    bullets,
  };
}

function buildHowToTest({ signals, commands, readmeHints, workflows }) {
  const merged = [];
  const seen = new Set();
  for (const c of [...commands, ...readmeHints]) {
    const key = c.cmd.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(c);
  }

  let verdict;
  let kind = "observed";
  if (merged.length && signals.hasTests) {
    verdict = "Automated tests look present, and there are concrete commands to try.";
  } else if (signals.hasTests && !merged.length) {
    verdict = "Test files or folders show up, but a clear one-line test command was not found.";
    kind = "inferred";
  } else if (merged.length && !signals.hasTests) {
    verdict = "Commands mention testing, but the root layout does not clearly show a test suite.";
    kind = "inferred";
  } else if (signals.hasCi) {
    verdict = "CI is configured, so tests may run in Actions even if local commands are undocumented.";
    kind = "inferred";
  } else {
    verdict = "No clear public test suite or test command was found. Testing approach is uncertain from public signals alone.";
    kind = "uncertain";
  }

  return {
    verdict,
    kind,
    commands: merged.slice(0, 5),
    hasTests: Boolean(signals.hasTests),
    hasCi: Boolean(signals.hasCi),
    workflows,
    tips: [
      signals.hasTests ? "Look under test/, tests/, __tests__, or *.spec.* for examples." : "Adding a small test folder would make this easier for strangers.",
      signals.hasCi ? "Check the Actions tab for what CI actually runs." : "A GitHub Actions workflow is a strong public trust signal.",
    ],
  };
}

function buildStructure({ repo, signals, scores, languages }) {
  const roots = signals.rootFiles || [];
  const notes = [];
  let points = 4;

  const hasSrc = roots.some((n) => /^(src|lib|app|pkg|internal|cmd|packages)$/i.test(n));
  const hasConfig = roots.some((n) =>
    /package\.json|pyproject\.toml|cargo\.toml|go\.mod|composer\.json|Gemfile/i.test(n)
  );
  const hasDocs = signals.hasReadme || signals.hasDocs;
  const hasLock = roots.some((n) =>
    /package-lock|yarn\.lock|pnpm-lock|Cargo\.lock|go\.sum|poetry\.lock/i.test(n)
  );

  if (hasSrc) {
    points += 1.5;
    notes.push({ ok: true, text: "Source layout folders are visible at the root (src/lib/app-style)." });
  } else {
    notes.push({ ok: false, text: "No obvious src/lib/app layout at the root." });
  }
  if (hasConfig) {
    points += 1.2;
    notes.push({ ok: true, text: "Project manifest found (package manager / language config)." });
  }
  if (hasDocs) {
    points += 1;
    notes.push({ ok: true, text: "Documentation entry point is present (README/docs)." });
  } else {
    notes.push({ ok: false, text: "README/docs signal is weak or missing." });
  }
  if (signals.hasTests) {
    points += 1;
    notes.push({ ok: true, text: "Automated test footprint is visible." });
  }
  if (signals.hasCi) {
    points += 0.8;
    notes.push({ ok: true, text: "CI / automation config is visible." });
  }
  if (hasLock) {
    points += 0.5;
    notes.push({ ok: true, text: "Dependency lockfile suggests reproducible installs." });
  }
  if (repo.size < 30 && (repo.stargazers || 0) < 5) {
    points -= 0.8;
    notes.push({ ok: false, text: "Repository footprint is very small; may still be a stub." });
  }
  if (languages.length >= 4) {
    notes.push({
      ok: true,
      text: `Polyglot root: ${languages
        .slice(0, 3)
        .map((l) => l.name)
        .join(", ")}.`,
    });
  }

  const score = Math.max(0, Math.min(10, Math.round(points * 10) / 10));
  let label = "mixed";
  if (score >= 8) label = "well structured";
  else if (score >= 6) label = "reasonably structured";
  else if (score <= 3.5) label = "early / thin structure";

  return {
    score,
    label,
    architectureScore: scores.architecture,
    rootFiles: roots.slice(0, 24),
    notes,
  };
}

async function maybePolishAbout(about, repo) {
  try {
    const result = await openaiChatJson({
      temperature: 0.4,
      maxTokens: 120,
      system:
        'You write PokéGit repo blurbs. Return JSON {"summary":"1-2 precise sentences, under 40 words"}. Plain text only. No markdown. No em dashes. Use only provided facts. Do not invent features.',
      user: `Repo: ${repo.fullName}\nLanguage: ${repo.language}\nDescription: ${repo.description || "(none)"}\nTopics: ${(repo.topics || []).join(", ")}\nREADME excerpt: ${about.summary}`,
    });
    if (!result.ok || !result.content) return about;
    const parsed = JSON.parse(result.content);
    if (parsed?.summary) {
      about.summary = preciseBlurb(cleanLine(parsed.summary), { maxChars: 220, maxSentences: 2 });
      about.blurb = preciseBlurb(about.summary, { maxChars: 160, maxSentences: 2 });
    }
  } catch {
    /* keep heuristic */
  }
  return about;
}

/**
 * Full single-repo page analysis.
 */
export async function analyzeRepoPage(owner, repoName) {
  const { repo, rateLimitRemaining: rem1 } = await fetchRepoMeta(owner, repoName);
  const [signals, readme, languages, workflows] = await Promise.all([
    inspectRepoSignals(owner, repoName),
    fetchReadme(owner, repoName),
    fetchLanguages(owner, repoName),
    fetchWorkflowNames(owner, repoName),
  ]);

  const rootsOriginal = signals.rootFiles || [];
  const root = rootsOriginal.map((n) => n.toLowerCase());
  const findRoot = (name) => rootsOriginal.find((n) => n.toLowerCase() === name.toLowerCase()) || name;
  const commands = [];
  const jobs = [];
  let packageHints = null;

  if (root.includes("package.json")) {
    jobs.push(
      fetchFileText(owner, repoName, findRoot("package.json")).then((t) => {
        packageHints = parsePackageHints(t);
        commands.push(...parseTestCommands(t, "package.json"));
      })
    );
  }
  if (root.includes("pyproject.toml") || root.includes("pytest.ini") || root.includes("setup.cfg")) {
    const path = root.includes("pyproject.toml")
      ? findRoot("pyproject.toml")
      : root.includes("pytest.ini")
        ? findRoot("pytest.ini")
        : findRoot("setup.cfg");
    jobs.push(
      fetchFileText(owner, repoName, path).then((t) => commands.push(...parseTestCommands(t, "pyproject")))
    );
  }
  if (root.includes("makefile")) {
    jobs.push(
      fetchFileText(owner, repoName, findRoot("Makefile")).then((t) =>
        commands.push(...parseTestCommands(t, "makefile"))
      )
    );
  }
  if (root.includes("cargo.toml")) {
    commands.push(...parseTestCommands("cargo", "cargo"));
  }
  if (root.includes("go.mod")) {
    commands.push(...parseTestCommands("go", "go"));
  }
  await Promise.all(jobs);

  const readmeHints = extractReadmeTestHints(readme?.text || "");
  const scores = scoreRepo(repo, signals);
  const pokemon = assignPokemon(repo, scores, signals);
  const item = { repo, signals, scores, pokemon };
  item.drilldown = buildRepoDrilldown(item);

  let about = buildAbout({ repo, readme, languages });
  about = await maybePolishAbout(about, repo);

  let readmeCenter = buildReadmeCenter({
    repo,
    readme,
    languages,
    signals,
    packageHints,
  });
  readmeCenter = await maybePolishReadmeCenter(readmeCenter, { repo, readme });

  const chatPack = await gatherRepoChatPack({
    owner,
    repoName,
    repo,
    readme,
    about,
    readmeCenter,
    languages,
    signals,
  });

  const howToTest = buildHowToTest({
    signals,
    commands,
    readmeHints,
    workflows,
  });
  const structure = buildStructure({ repo, signals, scores, languages });

  const aiAssistance = detectAiAssistance([
    {
      repo: {
        ...repo,
        description: `${repo.description || ""} ${readme?.excerpt || ""}`,
        topics: [...(repo.topics || []), ...(signals.rootFiles || [])],
      },
      signals,
    },
  ]);

  // Nudge AI evidence with README tooling mentions
  if (readme?.text) {
    const extra = [];
    if (/\.cursorrules|cursor\b/i.test(readme.text)) extra.push("README mentions Cursor-related tooling");
    if (/copilot/i.test(readme.text)) extra.push("README mentions Copilot");
    if (/chatgpt|openai|claude|anthropic|llm/i.test(readme.text)) extra.push("README mentions LLM / AI tools");
    if (extra.length) {
      aiAssistance.evidence = [...new Set([...(aiAssistance.evidence || []), ...extra])].slice(0, 5);
      if (aiAssistance.level === "none") {
        aiAssistance.level = "low";
        aiAssistance.label = "Low";
        aiAssistance.confidence = "low";
        aiAssistance.summary =
          "Repository text mentions AI-related tooling. Public GitHub data is not sufficient to estimate what percentage of code was AI-generated.";
      }
    }
  }

  const analyzedAt = new Date().toISOString();
  return {
    mode: "repo",
    owner,
    repoName,
    repo,
    signals,
    scores,
    pokemon,
    drilldown: item.drilldown,
    languages,
    about,
    readmeCenter,
    chatPack,
    howToTest,
    structure,
    aiAssistance,
    rateLimitRemaining: rem1,
    analyzedAt,
    fetchedAt: analyzedAt,
  };
}
