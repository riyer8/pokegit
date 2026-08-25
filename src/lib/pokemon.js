/**
 * Deterministic Pokémon assignment. Same repo signals → same Pokémon.
 */

export const POKEDEX = {
  Pikachu: {
    name: "Pikachu",
    emoji: "⚡",
    blurb: "Small · Focused · Useful",
    signal: "Small, focused, useful project. Ships a clear slice of value.",
  },
  Dragonite: {
    name: "Dragonite",
    emoji: "🐉",
    blurb: "Large · Mature · Powerful",
    signal: "Large, mature, powerful codebase. Serious long-lived work.",
  },
  Alakazam: {
    name: "Alakazam",
    emoji: "🧙",
    blurb: "Complex · Technical",
    signal: "Complex / technical work. Heavy ideas, ML, or deep systems.",
  },
  Blastoise: {
    name: "Blastoise",
    emoji: "🛡️",
    blurb: "Robust · Defensive",
    signal: "Robust / defensive. Reliability, hardening, careful engineering.",
  },
  Blissey: {
    name: "Blissey",
    emoji: "🌸",
    blurb: "Exceptional testing",
    signal: "Exceptional testing and CI habits. Careful, support-oriented.",
  },
  Golem: {
    name: "Golem",
    emoji: "🪨",
    blurb: "Infrastructure",
    signal: "Infrastructure / ops. Platform, devops, systems-facing work.",
  },
  Umbreon: {
    name: "Umbreon",
    emoji: "🌙",
    blurb: "Security",
    signal: "Security-flavored. Auth, crypto, hardening, guarded domains.",
  },
  Sylveon: {
    name: "Sylveon",
    emoji: "🧚",
    blurb: "Frontend · Design",
    signal: "Frontend / design. Interface craft and visual product work.",
  },
  Ditto: {
    name: "Ditto",
    emoji: "🌀",
    blurb: "Experimental",
    signal: "Experimental. Prototypes, playgrounds, shape-shifting ideas.",
  },
  Snorlax: {
    name: "Snorlax",
    emoji: "😴",
    blurb: "Dormant · Inactive",
    signal: "Dormant or inactive. Little recent activity, or archived.",
  },
  Eevee: {
    name: "Eevee",
    emoji: "🦊",
    blurb: "Early-stage · Potential",
    signal: "Early-stage or versatile. Still taking shape.",
  },
};

function haystack(repo, signals) {
  return `${repo.name} ${(repo.topics || []).join(" ")} ${repo.description || ""} ${
    repo.language || ""
  } ${(signals.rootFiles || []).join(" ")}`.toLowerCase();
}

export function assignPokemon(repo, scores, signals = {}) {
  const hay = haystack(repo, signals);
  const days = (Date.now() - new Date(repo.pushedAt).getTime()) / (1000 * 60 * 60 * 24);
  const stars = repo.stargazers || 0;
  const size = repo.size || 0;
  const tags = [];

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
    /machine-learning|ml-|deep-learning|llm|neural|pytorch|tensorflow|jupyter|data-sci|nlp/.test(hay) ||
    (repo.language === "Python" && /model|train|dataset|ml/.test(hay))
  ) {
    tags.push("ML");
    return { ...POKEDEX.Alakazam, tags };
  }

  if (
    /frontend|react|vue|svelte|css|design-system|ui-|ux|figma|tailwind|next\.?js|component/.test(hay) ||
    ["HTML", "CSS", "Vue"].includes(repo.language)
  ) {
    tags.push("Frontend");
    return { ...POKEDEX.Sylveon, tags };
  }

  if (scores.testing >= 8.2 && signals.hasTests && signals.hasCi) {
    tags.push("Testing");
    return { ...POKEDEX.Blissey, tags };
  }

  if (
    (scores.testing >= 7 && signals.hasCi && signals.hasTests) ||
    /reliability|resilience|hardening|observability|robust/.test(hay)
  ) {
    if (scores.maintenance >= 7 || scores.architecture >= 7) {
      tags.push("Robust");
      return { ...POKEDEX.Blastoise, tags };
    }
  }

  if (/experiment|prototype|playground|sandbox|hack|demo|wip/.test(hay)) {
    tags.push("Experimental");
    return { ...POKEDEX.Ditto, tags };
  }

  const mature = stars >= 80 || size >= 2000 || (days < 180 && size >= 500 && stars >= 20);
  const smallFocused = size < 400 && stars < 200 && days < 365;

  if (mature && (scores.maintenance >= 7 || stars >= 200) && size >= 800) {
    tags.push("Mature", repo.language || "Backend");
    return {
      ...POKEDEX.Dragonite,
      blurb: `Mature · ${repo.language || "Polyglot"} · Powerful`,
      tags,
    };
  }

  if (scores.complexity >= 8 && size >= 500) {
    tags.push("Complex");
    return { ...POKEDEX.Alakazam, tags };
  }

  if (smallFocused || (size < 250 && days < 120)) {
    tags.push("Focused");
    return { ...POKEDEX.Pikachu, tags };
  }

  if (stars < 5 && days < 90 && size < 800) {
    tags.push("Early");
    return { ...POKEDEX.Eevee, tags };
  }

  if (size >= 1000 || stars >= 50) {
    tags.push(repo.language || "General");
    return { ...POKEDEX.Dragonite, tags };
  }

  if (scores.testing >= 7) {
    return { ...POKEDEX.Blissey, tags: ["Testing"] };
  }

  tags.push(repo.language || "General");
  return { ...POKEDEX.Eevee, tags };
}
