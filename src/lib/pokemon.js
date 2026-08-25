/**
 * Deterministic Pokémon assignment from repo characteristics.
 * Same inputs → same Pokémon. Visual language only — not a game.
 */

const POKEDEX = {
  Dragonite: {
    name: "Dragonite",
    emoji: "🐉",
    blurb: "Mature · Complex · Backend-leaning",
    signal: "Large, mature, complex project. Often a serious backend or long-lived codebase.",
  },
  Pikachu: {
    name: "Pikachu",
    emoji: "⚡",
    blurb: "Small · Focused · Fast-moving",
    signal: "Small, focused, fast-moving tool or library. Ships useful slices quickly.",
  },
  Alakazam: {
    name: "Alakazam",
    emoji: "🧙",
    blurb: "Complex · Experimental · Analytical",
    signal: "Analytical / ML-leaning work. Math-heavy, experimental, or research-flavored.",
  },
  Blissey: {
    name: "Blissey",
    emoji: "🩷",
    blurb: "Strong testing · Careful · Supportive",
    signal: "Strong testing and CI signals. Careful, support-oriented engineering habits.",
  },
  Golem: {
    name: "Golem",
    emoji: "🪨",
    blurb: "Infrastructure · Solid · Ops-minded",
    signal: "Infrastructure / ops. Solid platform, devops, or systems-facing work.",
  },
  Umbreon: {
    name: "Umbreon",
    emoji: "🌙",
    blurb: "Security · Guarded · Precise",
    signal: "Security-flavored. Auth, crypto, hardening, or similarly guarded domains.",
  },
  Ditto: {
    name: "Ditto",
    emoji: "🟣",
    blurb: "Creative · Experimental · Adaptive",
    signal: "Experimental / adaptive. Prototypes, playgrounds, or shape-shifting ideas.",
  },
  Sylveon: {
    name: "Sylveon",
    emoji: "🎀",
    blurb: "Frontend · Design · Interface-focused",
    signal: "Frontend / design. Interface craft, UI systems, or visual product work.",
  },
  Snorlax: {
    name: "Snorlax",
    emoji: "😴",
    blurb: "Quiet · Low recent activity",
    signal: "Quiet or dormant. Little recent activity, or an archived project.",
  },
  Eevee: {
    name: "Eevee",
    emoji: "🦊",
    blurb: "Versatile · Early-stage · Potential",
    signal: "Early-stage or versatile. Still taking shape, with room to evolve.",
  },
};

function haystack(repo, signals) {
  return `${repo.name} ${(repo.topics || []).join(" ")} ${repo.description || ""} ${
    repo.language || ""
  } ${(signals.rootFiles || []).join(" ")}`.toLowerCase();
}

/**
 * @returns {{ name: string, emoji: string, blurb: string, tags: string[] }}
 */
export function assignPokemon(repo, scores, signals = {}) {
  const hay = haystack(repo, signals);
  const days =
    (Date.now() - new Date(repo.pushedAt).getTime()) / (1000 * 60 * 60 * 24);
  const stars = repo.stargazers || 0;
  const size = repo.size || 0;
  const tags = [];

  // Priority rules (order matters) — first match wins for specialty types
  if (repo.archived || days > 540) {
    tags.push("Dormant");
    return { ...POKEDEX.Snorlax, tags };
  }

  if (/security|crypto|auth|oauth|cve|vuln|pentest/.test(hay)) {
    tags.push("Security");
    return { ...POKEDEX.Umbreon, tags };
  }

  if (/infra|devops|kubernetes|k8s|terraform|ansible|docker|helm|sre|platform/.test(hay)) {
    tags.push("Infra");
    return { ...POKEDEX.Golem, tags };
  }

  if (
    /machine-learning|ml-|deep-learning|llm|neural|pytorch|tensorflow|jupyter|data-sci|nlp/.test(
      hay
    ) ||
    (repo.language === "Python" && /model|train|dataset|ml/.test(hay))
  ) {
    tags.push("ML");
    return { ...POKEDEX.Alakazam, tags };
  }

  if (
    /frontend|react|vue|svelte|css|design-system|ui-|ux|figma|tailwind|next\.?js|component/.test(
      hay
    ) ||
    ["HTML", "CSS", "Vue"].includes(repo.language)
  ) {
    tags.push("Frontend");
    return { ...POKEDEX.Sylveon, tags };
  }

  if (scores.testing >= 8.2 && signals.hasTests && signals.hasCi) {
    tags.push("Testing");
    return { ...POKEDEX.Blissey, tags };
  }

  if (/experiment|prototype|playground|sandbox|hack|demo|wip/.test(hay) || /ditto/.test(hay)) {
    tags.push("Experimental");
    return { ...POKEDEX.Ditto, tags };
  }

  // Size / maturity heuristics
  const mature =
    stars >= 80 ||
    size >= 2000 ||
    (days < 180 && size >= 500 && stars >= 20);

  const smallFocused = size < 400 && stars < 200 && days < 365;

  if (mature && (scores.maintenance >= 7 || stars >= 200) && size >= 800) {
    tags.push("Mature", repo.language || "Backend");
    return {
      ...POKEDEX.Dragonite,
      blurb: `Mature · ${repo.language || "Polyglot"} · Well maintained`,
      tags,
    };
  }

  if (smallFocused || (size < 250 && days < 120)) {
    tags.push("Focused");
    return {
      ...POKEDEX.Pikachu,
      blurb: "Small · Focused · Fast-moving",
      tags,
    };
  }

  if (stars < 5 && days < 90 && size < 800) {
    tags.push("Early");
    return { ...POKEDEX.Eevee, tags };
  }

  // Default: Dragonite for substantial, Pikachu for light, Eevee otherwise
  if (size >= 1000 || stars >= 50) {
    tags.push(repo.language || "General");
    return {
      ...POKEDEX.Dragonite,
      blurb: `Substantial · ${repo.language || "Mixed"} · Active`,
      tags,
    };
  }

  if (scores.testing >= 7) {
    return { ...POKEDEX.Blissey, tags: ["Testing"] };
  }

  tags.push(repo.language || "General");
  return { ...POKEDEX.Eevee, tags };
}

export { POKEDEX };
