/**
 * CS focus-area signals: what kind of builder someone is from public repos.
 */

import { preciseBlurb } from "./text.js";

export const FOCUS_AREAS = [
  { key: "ai", label: "AI / ML", icon: "🤖" },
  { key: "llm", label: "LLM / Transformers", icon: "🧠" },
  { key: "infra", label: "Infrastructure", icon: "🪨" },
  { key: "research", label: "Research", icon: "🔬" },
  { key: "graphics", label: "Graphics", icon: "🎨" },
  { key: "frontend", label: "Frontend", icon: "✨" },
  { key: "systems", label: "Systems", icon: "⚙️" },
  { key: "security", label: "Security", icon: "🔒" },
  { key: "data", label: "Data", icon: "📊" },
  { key: "mobile", label: "Mobile", icon: "📱" },
];

const FOCUS_KEYS = FOCUS_AREAS.map((a) => a.key);

function clamp(n, min = 0, max = 10) {
  return Math.round(Math.min(max, Math.max(min, n)) * 10) / 10;
}

function haystack(repo, signals = {}) {
  return `${repo.name} ${(repo.topics || []).join(" ")} ${repo.description || ""} ${
    repo.language || ""
  } ${(signals.rootFiles || []).join(" ")}`.toLowerCase();
}

/**
 * Per-repo focus scores (0–10). Multiple areas can be strong on one repo.
 */
export function scoreRepoFocus(repo, signals = {}) {
  const hay = haystack(repo, signals);
  const lang = repo.language || "";
  const topics = (repo.topics || []).length;

  let ai = 1.5;
  if (/machine-learning|deep-learning|neural|pytorch|tensorflow|keras|jax|scikit|mlops|computer-vision|cv\b|nlp\b|data-science/.test(hay)) {
    ai += 5;
  }
  if (/model|train|inference|dataset|embedding|classification|regression/.test(hay)) ai += 2;
  if (lang === "Python" && /ml|model|train/.test(hay)) ai += 1.5;
  if (topics >= 2 && /ml|ai/.test(hay)) ai += 0.8;

  let llm = 1;
  if (/llm|transformer|gpt|bert|diffusion|generative-ai|langchain|rag\b|fine-tun|huggingface|openai|anthropic|prompt/.test(hay)) {
    llm += 6;
  }
  if (/tokeniz|attention|lora|peft|vllm|ollama/.test(hay)) llm += 2.5;
  if (ai >= 7 && /nlp|language-model/.test(hay)) llm += 1.5;

  let infra = 1.5;
  if (/infra|devops|kubernetes|k8s|terraform|ansible|docker|helm|sre|platform|pulumi|cloudformation|nomad|istio/.test(hay)) {
    infra += 5.5;
  }
  if (/ci\/cd|observability|prometheus|grafana|argocd|gitops/.test(hay)) infra += 2;
  if (lang === "HCL" || lang === "Go" && /k8s|kube|container/.test(hay)) infra += 1.5;

  let research = 1;
  if (/research|paper|arxiv|benchmark|experiment|reproducib|thesis|academic|lab\b|dataset|ablation/.test(hay)) {
    research += 5;
  }
  if (/jupyter|notebook|\.ipynb|colab/.test(hay)) research += 2;
  if (repo.name.match(/bench|eval|ablation|study/i)) research += 1.5;

  let graphics = 1;
  if (/graphics|render|shader|opengl|vulkan|webgl|three\.js|game-engine|unity|unreal|blender|raytrac|gpu|wgpu|metal/.test(hay)) {
    graphics += 5.5;
  }
  if (/canvas|pixi|babylon|godot|2d|3d|animation|visualization/.test(hay)) graphics += 2;
  if (["GLSL", "HLSL"].includes(lang)) graphics += 3;

  let frontend = 1.5;
  if (/frontend|react|vue|svelte|next\.?js|nuxt|remix|angular|design-system|ui-|ux|tailwind|component|css-in-js/.test(hay)) {
    frontend += 5;
  }
  if (["HTML", "CSS", "Vue", "Svelte"].includes(lang)) frontend += 2.5;
  if (/electron|tauri|desktop-app/.test(hay)) frontend += 1;

  let systems = 2;
  if (/compiler|distributed|database|protocol|consensus|raft|grpc|microservice|kernel|runtime|wasm|systems|performance|latency/.test(hay)) {
    systems += 4.5;
  }
  if (["Rust", "C", "C++", "Go", "Zig"].includes(lang)) systems += 1.5;
  if ((repo.size || 0) >= 800 && systems >= 5) systems += 1;

  let security = 1;
  if (/security|crypto|auth|oauth|cve|vuln|pentest|encryption|zero-trust|hardening|audit/.test(hay)) {
    security += 5.5;
  }

  let data = 1.5;
  if (/data-engineer|etl|spark|airflow|dbt|warehouse|analytics|pipeline|kafka|flink|clickhouse|snowflake|bigquery/.test(hay)) {
    data += 5;
  }
  if (/pandas|polars|duckdb|parquet|sql\b|postgres|clickhouse/.test(hay)) data += 2;

  let mobile = 1;
  if (/android|ios|swiftui|kotlin|react-native|flutter|mobile-app|expo/.test(hay)) mobile += 5;
  if (["Swift", "Kotlin", "Dart", "Objective-C"].includes(lang)) mobile += 2.5;

  // Cross-signal boosts from Pokémon tags when present
  const tags = signals.focusTags || [];
  if (tags.includes("ML")) {
    ai = Math.max(ai, 7);
    llm = Math.max(llm, ai >= 7 ? 5 : llm);
  }
  if (tags.includes("Infra")) infra = Math.max(infra, 7);
  if (tags.includes("Frontend")) frontend = Math.max(frontend, 7);
  if (tags.includes("Security")) security = Math.max(security, 7);

  const raw = { ai, llm, infra, research, graphics, frontend, systems, security, data, mobile };
  const out = {};
  for (const k of FOCUS_KEYS) out[k] = clamp(raw[k]);
  return out;
}

export function aggregateProfileFocus(analyzedRepos) {
  if (!analyzedRepos.length) {
    return { areas: {}, top: [], primary: null, secondary: null, enoughData: false };
  }

  const totals = Object.fromEntries(FOCUS_KEYS.map((k) => [k, { w: 0, s: 0 }]));

  for (const item of analyzedRepos) {
    const focus = item.focusScores || scoreRepoFocus(item.repo, item.signals);
    const stars = item.repo.stargazers || 0;
    const weight =
      Math.log10(stars + 10) *
      (item.repo.archived ? 0.35 : 1) *
      (daysSince(item.repo.pushedAt) < 365 ? 1.15 : 0.8);
    for (const k of FOCUS_KEYS) {
      totals[k].s += (focus[k] || 0) * weight;
      totals[k].w += weight;
    }
  }

  const areas = {};
  for (const k of FOCUS_KEYS) {
    areas[k] = totals[k].w ? clamp(totals[k].s / totals[k].w) : 0;
  }

  const top = FOCUS_AREAS.map((meta) => ({
    ...meta,
    score: areas[meta.key],
  }))
    .filter((a) => a.score >= 3.5)
    .sort((a, b) => b.score - a.score);

  const primary = top[0] || null;
  const secondary = top[1] && top[1].score >= primary.score - 1.5 ? top[1] : null;

  return {
    areas,
    top: top.slice(0, 5),
    primary: primary?.key || null,
    secondary: secondary?.key || null,
    enoughData: true,
  };
}

function daysSince(iso) {
  if (!iso) return 9999;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

export function focusAreaLabel(key) {
  return FOCUS_AREAS.find((a) => a.key === key)?.label || key;
}

/** @returns {{ key: string, label: string, icon: string } | null} */
export function focusAreaMeta(key) {
  const area = FOCUS_AREAS.find((a) => a.key === key);
  return area ? { key: area.key, label: area.label, icon: area.icon } : null;
}

/** Map focus keys to pillar objects, preserving order and dropping unknown keys. */
export function focusPillars(keys = []) {
  const out = [];
  const seen = new Set();
  for (const key of keys) {
    const meta = focusAreaMeta(key);
    if (!meta || seen.has(meta.key)) continue;
    seen.add(meta.key);
    out.push(meta);
  }
  return out;
}

/**
 * Actionable builder-type headline from focus + languages + activity.
 */
export function deriveBuilderHeadline(user, focusProfile, languageSummary = [], activity = null, pulse = null) {
  const langs = (languageSummary || []).map((l) => l.name).filter(Boolean);
  const top = focusProfile?.top || [];
  const primary = top[0];
  const secondary = top[1];

  const stack =
    langs.length >= 2 ? `${langs[0]}/${langs[1]}` : langs[0] ? langs[0] : null;

  const possiblyPrivate =
    Boolean(pulse?.includesPrivate) ||
    (pulse?.yearCount >= 80 && (activity?.label === "quiet" || activity?.label === "dormant"));

  if (primary && primary.score >= 6.5) {
    const focusBit =
      secondary && secondary.score >= 5.5
        ? `${primary.label} + ${secondary.label}`
        : primary.label;
    if (possiblyPrivate && (activity?.commitApprox || 0) < 8) {
      return `${focusBit} builder. Active on the graph, quiet in public repos`;
    }
    if (activity?.label === "hot" || activity?.commitApprox >= 25) {
      const where = (activity.reposTouched || [])
        .slice(0, 2)
        .map((r) => r.name)
        .join(" & ");
      return where
        ? `${focusBit} builder shipping in ${where}`
        : `${focusBit} builder shipping often`;
    }
    if (stack) return `${focusBit} engineer (${stack})`;
    return `${focusBit} engineer`;
  }

  if (stack && possiblyPrivate) {
    return `${stack} engineer. Likely cooking in private`;
  }
  if (stack && activity?.commitApprox >= 12) {
    const repos = (activity.reposTouched || []).slice(0, 2).map((r) => r.name).join(", ");
    return repos
      ? `${stack} builder active in ${repos}`
      : `${stack} builder with steady public commits`;
  }
  if (stack) return `${stack}-focused engineer`;

  const who = user?.name?.trim() || (user?.login ? `@${user.login}` : null);
  if (who) return `${who}. Mixed public signals`;
  return "Mixed public engineering signals";
}

export function deriveBuilderOneLiner(focusProfile, activity, pulse) {
  const top = focusProfile?.top?.[0];
  const commits = activity?.commitApprox || 0;
  const pushes = activity?.pushCount ?? activity?.pushEvents ?? 0;
  const year = pulse?.yearCount;
  const privateHint = pulse?.includesPrivate || pulse?.possiblyPrivate;

  if (pushes >= 8 && top) {
    const repos = (activity.reposPushed || activity.reposTouched || [])
      .slice(0, 2)
      .map((r) => `${r.name}${r.pushes ? ` (${r.pushes} pushes)` : r.commits ? ` (~${r.commits})` : ""}`)
      .join(", ");
    return repos
      ? `${pushes} recent public pushes in ${repos}. Strong ${top.label.toLowerCase()} lean.`
      : `${pushes} recent public pushes. Strong ${top.label.toLowerCase()} lean.`;
  }

  if (commits >= 12 && top) {
    const repos = (activity.reposTouched || [])
      .slice(0, 2)
      .map((r) => `${r.name}${r.commits ? ` (~${r.commits})` : ""}`)
      .join(", ");
    return repos
      ? `≈${commits} recent public commits in ${repos}. Strong ${top.label.toLowerCase()} lean.`
      : `≈${commits} recent public commits. Strong ${top.label.toLowerCase()} lean.`;
  }

  if (privateHint && year && pushes < 5 && commits < 8) {
    return `~${year} contributions on the year graph${pulse.includesPrivate ? " (includes private)" : ""}, but few public repo pushes. May be building privately.`;
  }

  if (top && top.score >= 5) {
    return `Public repos skew toward ${top.label.toLowerCase()}${focusProfile.top[1] ? ` and ${focusProfile.top[1].label.toLowerCase()}` : ""}.`;
  }

  if (activity?.sampleNote) return activity.sampleNote;
  return "A partial read from public repos only.";
}

/**
 * One sentence explaining what a repo is about (not the Pokémon assignment).
 */
export function repoOneLiner(repo, pokemon, signals = {}) {
  const fromDesc = preciseBlurb(repo.description, { maxChars: 140, maxSentences: 1 });
  if (fromDesc) return fromDesc;

  const hay = haystack(repo, signals);
  const lang = repo.language || "code";

  if (/llm|transformer|gpt|huggingface|langchain/.test(hay)) {
    return `Works with language models or transformer tooling in ${lang}.`;
  }
  if (/machine-learning|pytorch|tensorflow|neural/.test(hay)) {
    return `Machine learning project in ${lang}.`;
  }
  if (/kubernetes|terraform|docker|infra|devops/.test(hay)) {
    return `Infrastructure or platform tooling around ${lang}.`;
  }
  if (/react|vue|svelte|frontend|ui|design-system/.test(hay)) {
    return `User-facing ${lang} interface or component work.`;
  }
  if (/graphics|shader|render|webgl|game/.test(hay)) {
    return `Graphics or visual computing in ${lang}.`;
  }
  if (/security|crypto|auth/.test(hay)) {
    return `Security or auth-related ${lang} project.`;
  }
  if (/compiler|distributed|database|protocol/.test(hay)) {
    return `Systems-level ${lang} engineering.`;
  }
  if (pokemon?.tags?.includes("Experimental")) {
    return `Experimental ${lang} prototype or playground.`;
  }
  if (repo.archived) {
    return `Archived ${lang} project. May be finished or superseded.`;
  }
  if (lang) return `${lang} project without a public description.`;
  return "No public description. Infer from code and topics.";
}

export function repoImpressiveness(item) {
  const repo = item.repo;
  const stars = repo.stargazers || 0;
  const days = daysSince(repo.pushedAt);
  const recency = Math.max(0, 1 - days / 400);
  const focusTop = Math.max(...Object.values(item.focusScores || {}), 0);
  const commits = item.signals?.recentCommitApprox || 0;
  const pokeTier = {
    Dragonite: 2.8,
    Alakazam: 2.5,
    Golem: 2.2,
    Umbreon: 2,
    Sylveon: 1.8,
    Blastoise: 1.6,
    Pikachu: 1.4,
    Ditto: 1.2,
    Eevee: 1,
    Snorlax: 0.4,
    Blissey: 1.3,
  };
  const tier = pokeTier[item.pokemon?.name] || 1.2;
  return (
    Math.log10(stars + 1) * 2.8 +
    recency * 3.5 +
    focusTop * 0.35 +
    Math.min(commits, 40) * 0.06 +
    tier
  );
}
