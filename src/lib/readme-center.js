/**
 * README Pokémon Center: diagnose project DNA and README UX from public text.
 * Heuristic first. Never invent private-install reality.
 */

import { openaiChatJson } from "./openai-request.js";
import { preciseBlurb, stripMarkdown } from "./text.js";

export const PROJECT_DNA = [
  { id: "experimental", emoji: "🧪", label: "Experimental" },
  { id: "infrastructure", emoji: "🏗", label: "Infrastructure" },
  { id: "library", emoji: "📦", label: "Library" },
  { id: "creative", emoji: "🎨", label: "Creative Tool" },
];

const DNA_BY_ID = Object.fromEntries(PROJECT_DNA.map((d) => [d.id, d]));

function cleanLine(s) {
  return String(s || "")
    .replace(/\u2014/g, ".")
    .replace(/\u2013/g, ",")
    .replace(/\s*—\s*/g, ". ")
    .replace(/\s*–\s*/g, ", ")
    .replace(/\.\s*\./g, ".")
    .trim();
}

function hay(parts) {
  return parts.filter(Boolean).join("\n").toLowerCase();
}

function countHits(text, patterns) {
  let n = 0;
  for (const p of patterns) {
    if (p.test(text)) n += 1;
    p.lastIndex = 0;
  }
  return n;
}

export function parsePackageHints(packageJsonText) {
  if (!packageJsonText) return null;
  try {
    const pkg = JSON.parse(packageJsonText);
    return {
      name: pkg.name || null,
      description: pkg.description || null,
      hasBin: Boolean(pkg.bin),
      hasMain: Boolean(pkg.main || pkg.module || pkg.exports || pkg.types || pkg.typings),
      isPrivate: Boolean(pkg.private),
      version: typeof pkg.version === "string" ? pkg.version : null,
    };
  } catch {
    return null;
  }
}

/**
 * Cheap README structure for UX timing.
 */
export function parseReadmeVitals(text) {
  const raw = String(text || "");
  const lines = raw.split(/\r?\n/);
  const vitals = {
    chars: raw.trim().length,
    headings: [],
    firstProse: "",
    firstProseIndex: -1,
    badgeHeavy: false,
    hasInstall: false,
    installIndex: -1,
    installCommands: [],
    hasPrereq: false,
    hasEnv: false,
    hasWhatEarly: false,
    fenceCount: (raw.match(/```/g) || []).length / 2,
  };

  if (!raw.trim()) return vitals;

  const badgeRe = /!\[|shields\.io|badge|img\.shields|camo\.githubusercontent/i;
  let badgeRun = 0;
  let sawTitle = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^#+\s+/.test(trimmed)) {
      const title = trimmed.replace(/^#+\s+/, "").replace(/<[^>]+>/g, "").trim();
      vitals.headings.push(title);
      if (/install|getting started|quick start|setup|usage/i.test(title) && vitals.installIndex < 0) {
        vitals.hasInstall = true;
        vitals.installIndex = i;
      }
      if (!sawTitle) sawTitle = true;
      continue;
    }

    if (badgeRe.test(trimmed) || /^<p\s.*img/i.test(trimmed) || /^<img/i.test(trimmed)) {
      if (i < 18) badgeRun += 1;
      continue;
    }

    if (vitals.firstProseIndex < 0 && !/^[-*_|]{3,}$/.test(trimmed) && !/^\|/.test(trimmed) && !/^```/.test(trimmed)) {
      const prose = preciseBlurb(stripMarkdown(trimmed), { maxChars: 220, maxSentences: 2 });
      if (prose.length >= 12 && !/^(npm |yarn |pnpm |pip |cargo |brew )/i.test(prose)) {
        vitals.firstProse = prose;
        vitals.firstProseIndex = i;
      }
    }
  }

  vitals.badgeHeavy = badgeRun >= 4;

  const cmdBlocks = raw.match(/```[\s\S]*?```/g) || [];
  const cmdRe =
    /\b(npm i(?:nstall)?|pnpm add|yarn add|pip install|poetry add|cargo add|go get|brew install|docker(?:\s+compose)?|helm |terraform |make install)\b/i;
  for (const block of cmdBlocks) {
    const body = block.replace(/```\w*\n?/, "").replace(/```$/, "");
    for (const line of body.split("\n")) {
      const cmd = line.replace(/^\$\s*/, "").trim();
      if (cmdRe.test(cmd) && vitals.installCommands.length < 8) {
        vitals.installCommands.push(cmd.slice(0, 140));
      }
    }
  }
  if (!vitals.installCommands.length && cmdRe.test(raw)) {
    const m = raw.match(
      /\b((?:npm i(?:nstall)?|pnpm add|yarn add|pip install|cargo add|docker(?:-compose)?(?:\s+\w+){0,4})[^\n`]{0,80})/i
    );
    if (m) vitals.installCommands.push(m[1].trim().slice(0, 140));
  }
  if (vitals.installCommands.length) vitals.hasInstall = true;

  const lower = raw.toLowerCase();
  vitals.hasPrereq = /\b(node(?:\.js)? \d|python \d|go \d|jdk|requires? (?:node|python|docker)|pre-?requisite)/i.test(
    raw
  );
  vitals.hasEnv = /\b(\.env|api[_-]?key|secret[_-]?key|export [A-Z_]{3,}=|environment variable)/i.test(raw);

  const first = vitals.firstProse.toLowerCase();
  vitals.hasWhatEarly =
    Boolean(first) &&
    vitals.firstProseIndex >= 0 &&
    vitals.firstProseIndex < 24 &&
    !/^(install|clone|getting started)/i.test(first) &&
    (/\b(is a|lets you|helps you|library|tool|sdk|framework|cli|editor|server|platform)\b/.test(first) ||
      first.length >= 40);

  return vitals;
}

function scoreDna({ repo, readmeText, languages, signals, packageHints }) {
  const text = hay([
    repo?.name,
    repo?.description,
    repo?.fullName,
    (repo?.topics || []).join(" "),
    readmeText?.slice(0, 8000),
    (signals?.rootFiles || []).join(" "),
    languages?.map((l) => l.name).join(" "),
    packageHints?.description,
  ]);
  const roots = (signals?.rootFiles || []).map((n) => n.toLowerCase());
  const scores = {
    experimental: 1,
    infrastructure: 0,
    library: 0,
    creative: 0,
  };

  scores.library += countHits(text, [
    /\blibrary\b/,
    /\bsdk\b/,
    /\bnpm package\b/,
    /\bpypi\b/,
    /\bcrates\.io\b/,
    /\bimport\b/,
    /\bapi reference\b/,
    /\btypescript types\b/,
    /\bcargo add\b/,
    /\bpip install\b/,
    /\bnpm i(?:nstall)?\b/,
  ]);
  if (packageHints?.hasMain && !packageHints?.hasBin) scores.library += 3;
  if (packageHints?.hasMain && packageHints?.hasBin) scores.library += 1;
  if (/\b(lib|pkg)\b/.test(repo?.name || "")) scores.library += 1;

  scores.infrastructure += countHits(text, [
    /\binfrastructure\b/,
    /\bself-?hosted\b/,
    /\bkubernetes\b|\bk8s\b/,
    /\bterraform\b/,
    /\bdocker(?:-compose)?\b/,
    /\bhelm chart\b/,
    /\bobservability\b/,
    /\bdeploy(ment)?\b/,
    /\bci\/cd\b/,
    /\breverse proxy\b/,
    /\bload balancer\b/,
  ]);
  if (roots.some((n) => /dockerfile|compose|terraform|\.tf$|helm|k8s|kubernetes|ansible/.test(n))) {
    scores.infrastructure += 3;
  }
  if (packageHints?.hasBin && !packageHints?.hasMain) scores.infrastructure += 1;

  scores.creative += countHits(text, [
    /\b(editor|canvas|design tool|generative|shader|animation)\b/,
    /\b(sketch|draw|paint|illustrat|typography)\b/,
    /\b(game engine|pixel art|music|synth|midi)\b/,
    /\b(p5\.js|three\.js|processing|blender|figma)\b/,
    /\bcreative (?:coding|tool|studio)\b/,
    /\bplayground\b/,
  ]);
  if ((repo?.topics || []).some((t) => /game|design|art|music|graphics|creative/i.test(t))) {
    scores.creative += 2;
  }

  scores.experimental += countHits(text, [
    /\b(wip|work in progress|prototype|experiment|poc|proof of concept)\b/,
    /\bhackathon\b/,
    /\bdo not use in production\b/,
    /\bresearch\b/,
    /\bjupyter\b|\bnotebook\b/,
    /\bscratch\b/,
  ]);
  const readmeChars = String(readmeText || "").trim().length;
  if (readmeChars < 280) scores.experimental += 3;
  if (readmeChars < 80) scores.experimental += 2;
  if (!signals?.hasReadme && readmeChars < 40) scores.experimental += 3;
  if ((repo?.stargazers || 0) < 8 && (repo?.size || 0) < 80) scores.experimental += 1;
  if (packageHints?.version && /^0\./.test(packageHints.version)) scores.experimental += 1;
  if (repo?.archived) scores.experimental += 1;

  let id = "experimental";
  let best = -1;
  for (const key of ["library", "infrastructure", "creative", "experimental"]) {
    if (scores[key] > best) {
      best = scores[key];
      id = key;
    }
  }
  return { id, scores };
}

function minuteWord(n) {
  return n === 1 ? "1 minute" : `${n} minutes`;
}

function secondWord(n) {
  return n === 1 ? "1 second" : `${n} seconds`;
}

export function estimateReadmeUx(vitals) {
  let understandSeconds = 28;
  let installMinutes = 5;
  let understandKind = "inferred";
  let installKind = "inferred";

  if (!vitals.chars) {
    return {
      understandSeconds: 90,
      installMinutes: 12,
      understandKind: "uncertain",
      installKind: "uncertain",
    };
  }

  if (vitals.hasWhatEarly && vitals.firstProseIndex <= 8) {
    understandSeconds = vitals.badgeHeavy ? 18 : 12;
    understandKind = "observed";
  } else if (vitals.hasWhatEarly) {
    understandSeconds = vitals.badgeHeavy ? 28 : 20;
    understandKind = "observed";
  } else if (vitals.firstProse) {
    understandSeconds = 40;
  } else {
    understandSeconds = 55;
    understandKind = "uncertain";
  }
  if (vitals.chars > 12000) understandSeconds += 8;

  const cmds = vitals.installCommands.length;
  if (!vitals.hasInstall && !cmds) {
    installMinutes = 8;
    installKind = "uncertain";
  } else if (cmds <= 1 && !vitals.hasEnv && !vitals.hasPrereq && !/docker/i.test(vitals.installCommands[0] || "")) {
    installMinutes = 1;
    installKind = "observed";
  } else if (cmds <= 2 && !vitals.hasEnv) {
    installMinutes = 2;
    installKind = "observed";
  } else if (/docker|compose|k8s|terraform|helm/i.test(vitals.installCommands.join(" ")) || vitals.hasEnv) {
    installMinutes = vitals.hasEnv && vitals.hasPrereq ? 8 : 4;
    installKind = "observed";
  } else if (cmds >= 4 || vitals.hasPrereq) {
    installMinutes = 6;
  } else {
    installMinutes = 3;
  }

  understandSeconds = Math.max(8, Math.min(90, Math.round(understandSeconds)));
  installMinutes = Math.max(1, Math.min(20, Math.round(installMinutes)));
  return { understandSeconds, installMinutes, understandKind, installKind };
}

function defaultQuote(ux, dna, vitals) {
  if (!vitals.chars) {
    return "The README is missing, so a stranger has to guess from the file tree.";
  }
  const u = secondWord(ux.understandSeconds);
  const m = minuteWord(ux.installMinutes);
  if (ux.understandSeconds <= 15 && ux.installMinutes <= 2) {
    return `A stranger can grok this in ${u} and be running in about ${m}.`;
  }
  if (ux.understandSeconds >= 40 && ux.installMinutes <= 2) {
    return `Installation is quick (~${m}), but it takes ${u} to learn what you just installed.`;
  }
  return `A developer can understand what this does in ${u}, but installation takes ${m}.`;
}

function dnaWhy(id, repo) {
  const name = repo?.name || "this repo";
  if (id === "library") {
    return `${name} reads as something other programs import, not an app you live in.`;
  }
  if (id === "infrastructure") {
    return `${name} reads as plumbing you deploy or run, not a library you import.`;
  }
  if (id === "creative") {
    return `${name} reads as a studio or toy for making things, not a backend service.`;
  }
  return `${name} still feels like a lab bench: early, thin docs, or openly unfinished.`;
}

function labNotes(vitals, ux, dnaId) {
  const notes = [];
  if (!vitals.chars) {
    notes.push({
      kind: "observed",
      text: "No public README was returned. The Center is working from repo metadata only.",
    });
    return notes;
  }
  if (vitals.hasWhatEarly) {
    notes.push({
      kind: "observed",
      text: "The opening prose actually says what this is before the install ritual.",
    });
  } else {
    notes.push({
      kind: vitals.firstProse ? "inferred" : "uncertain",
      text: vitals.badgeHeavy
        ? "The top of the README is badge-heavy, so the 'what' arrives late."
        : "A stranger may hunt for a one-sentence 'what this does'.",
    });
  }
  if (vitals.installCommands.length === 1 && ux.installMinutes <= 2) {
    notes.push({
      kind: "observed",
      text: `Install looks copy-pasteable (${vitals.installCommands[0].slice(0, 72)}).`,
    });
  } else if (vitals.hasEnv) {
    notes.push({
      kind: "observed",
      text: "Setup mentions env vars or secrets, so first run is more than one command.",
    });
  } else if (!vitals.hasInstall) {
    notes.push({
      kind: "uncertain",
      text: "No clear Install / Getting Started heading showed up.",
    });
  }
  if (dnaId === "experimental" && vitals.chars < 280) {
    notes.push({
      kind: "observed",
      text: "The README is short enough that the project still feels like an experiment.",
    });
  }
  return notes.slice(0, 3);
}

export function buildReadmeCenter({
  repo,
  readme,
  languages = [],
  signals = {},
  packageHints = null,
} = {}) {
  const text = readme?.text || "";
  const vitals = parseReadmeVitals(text);
  const { id, scores } = scoreDna({
    repo,
    readmeText: text,
    languages,
    signals,
    packageHints,
  });
  const dna = DNA_BY_ID[id] || DNA_BY_ID.experimental;
  const ux = estimateReadmeUx(vitals);
  const quote = defaultQuote(ux, dna, vitals);
  const types = PROJECT_DNA.map((d) => ({
    ...d,
    active: d.id === dna.id,
    score: scores[d.id] || 0,
  }));

  return {
    dna: {
      id: dna.id,
      emoji: dna.emoji,
      label: dna.label,
      why: cleanLine(dnaWhy(dna.id, repo)),
    },
    types,
    vitals: {
      ...ux,
      quote: cleanLine(quote),
    },
    notes: labNotes(vitals, ux, dna.id),
    source: "heuristic",
    missingReadme: vitals.chars < 40,
  };
}

export async function maybePolishReadmeCenter(center, { repo, readme } = {}) {
  if (!center || center.missingReadme) return center;
  try {
    const result = await openaiChatJson({
      temperature: 0.45,
      maxTokens: 220,
      system: `You are Nurse Joy at the PokéGit README Pokémon Center.
Diagnose open-source README UX. Use only provided facts. No em dashes.
Return JSON:
{
  "dnaId": "experimental|infrastructure|library|creative",
  "why": "one sentence on why that DNA",
  "quote": "one playful UX sentence like: A developer can understand what this does in 12 seconds, but installation takes 4 minutes.",
  "understandSeconds": 12,
  "installMinutes": 4
}
Keep times close to the heuristic times. Product name is PokéGit.`,
      user: [
        `Repo: ${repo?.fullName || repo?.name}`,
        `Heuristic DNA: ${center.dna.id} (${center.dna.label})`,
        `Heuristic quote: ${center.vitals.quote}`,
        `Understand ~${center.vitals.understandSeconds}s, install ~${center.vitals.installMinutes}m`,
        `Description: ${repo?.description || "(none)"}`,
        `Topics: ${(repo?.topics || []).join(", ") || "(none)"}`,
        `README excerpt:\n${String(readme?.text || "").slice(0, 1800)}`,
      ].join("\n"),
    });
    if (!result.ok || !result.content) return center;
    const parsed = JSON.parse(result.content);
    const dna = DNA_BY_ID[parsed.dnaId];
    if (dna) {
      center.dna = {
        id: dna.id,
        emoji: dna.emoji,
        label: dna.label,
        why: cleanLine(parsed.why || center.dna.why),
      };
      center.types = (center.types || PROJECT_DNA).map((d) => ({
        ...d,
        active: d.id === dna.id,
      }));
    }
    if (parsed.quote) center.vitals.quote = cleanLine(parsed.quote);
    const u = Number(parsed.understandSeconds);
    const m = Number(parsed.installMinutes);
    if (Number.isFinite(u)) center.vitals.understandSeconds = Math.max(8, Math.min(90, Math.round(u)));
    if (Number.isFinite(m)) center.vitals.installMinutes = Math.max(1, Math.min(20, Math.round(m)));
    center.source = "openai";
  } catch {
    /* keep heuristic */
  }
  return center;
}
