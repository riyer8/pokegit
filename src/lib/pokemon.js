/**
 * Deterministic Pokémon assignment with personality + why-this-one copy.
 * Always PokéGit — never invent other product names.
 */

export const POKEDEX = {
  Pikachu: {
    name: "Pikachu",
    emoji: "⚡",
    blurb: "Small · Focused · Useful",
    personality: "Small but energetic",
    signal: "Small, focused, useful project. Ships a clear slice of value.",
  },
  Dragonite: {
    name: "Dragonite",
    emoji: "🐉",
    blurb: "Large · Mature · Powerful",
    personality: "Mature powerhouse",
    signal: "Large, mature, powerful codebase. Serious long-lived work.",
  },
  Alakazam: {
    name: "Alakazam",
    emoji: "🧙",
    blurb: "Complex · Technical",
    personality: "Complex thinker",
    signal: "Complex / technical work. Heavy ideas, ML, or deep systems.",
  },
  Blastoise: {
    name: "Blastoise",
    emoji: "🛡️",
    blurb: "Robust · Defensive",
    personality: "Built to hold the line",
    signal: "Robust / defensive. Reliability, hardening, careful engineering.",
  },
  Blissey: {
    name: "Blissey",
    emoji: "🌸",
    blurb: "Exceptional testing",
    personality: "Protects everything with tests",
    signal: "Exceptional testing and CI habits. Careful, support-oriented.",
  },
  Golem: {
    name: "Golem",
    emoji: "🪨",
    blurb: "Infrastructure",
    personality: "Infrastructure bedrock",
    signal: "Infrastructure / ops. Platform, devops, systems-facing work.",
  },
  Umbreon: {
    name: "Umbreon",
    emoji: "🌙",
    blurb: "Security",
    personality: "Security-minded",
    signal: "Security-flavored. Auth, crypto, hardening, guarded domains.",
  },
  Sylveon: {
    name: "Sylveon",
    emoji: "🧚",
    blurb: "Frontend · Design",
    personality: "Interface-first",
    signal: "Frontend / design. Interface craft and visual product work.",
  },
  Ditto: {
    name: "Ditto",
    emoji: "🌀",
    blurb: "Experimental",
    personality: "Shapeshifting experiment",
    signal: "Experimental. Prototypes, playgrounds, shape-shifting ideas.",
  },
  Snorlax: {
    name: "Snorlax",
    emoji: "😴",
    blurb: "Dormant · Inactive",
    personality: "Quiet for now",
    signal: "Dormant or inactive. Little recent activity, or archived.",
  },
  Eevee: {
    name: "Eevee",
    emoji: "🦊",
    blurb: "Early-stage · Potential",
    personality: "Still evolving",
    signal: "Early-stage or versatile. Still taking shape.",
  },
};

function haystack(repo, signals) {
  return `${repo.name} ${(repo.topics || []).join(" ")} ${repo.description || ""} ${
    repo.language || ""
  } ${(signals.rootFiles || []).join(" ")}`.toLowerCase();
}

function daysSince(iso) {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

function ageYears(iso) {
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}

/** Human reason for why this Pokémon was chosen. */
export function explainPokemon(name, repo, scores, signals = {}) {
  const days = Math.round(daysSince(repo.pushedAt));
  const years = ageYears(repo.createdAt).toFixed(1);
  const lang = repo.language || "mixed languages";
  const size = repo.size || 0;

  switch (name) {
    case "Snorlax":
      return repo.archived
        ? `${repo.name} is archived, so it reads as dormant rather than actively evolving.`
        : `${repo.name} hasn't seen meaningful activity in a long while (~${days}d since last push). That may mean finished, not failed.`;
    case "Umbreon":
      return `${repo.name} carries security / auth / crypto-flavored signals in its topics or description.`;
    case "Golem":
      return `${repo.name} looks infrastructure-shaped (ops, platform, containers, or similar).`;
    case "Alakazam":
      return scores.complexity >= 8
        ? `${repo.name} shows high technical complexity (${scores.complexity}/10) for a ${lang} project.`
        : `${repo.name} reads research / ML / deeply technical from its public signals.`;
    case "Sylveon":
      return `${repo.name} leans frontend / design (${lang}). Interface work is the clearest signal.`;
    case "Blissey":
      return `${repo.name} has automated tests${signals.hasCi ? " and CI" : ""}. Testing score ${scores.testing}/10.`;
    case "Blastoise":
      return `${repo.name} combines solid structure with defensive habits (tests/CI or reliability cues).`;
    case "Ditto":
      return `${repo.name} looks experimental. Prototype / playground energy more than a long-lived product.`;
    case "Dragonite":
      return `Large, mature ${lang} project (~${years}y old, ${size}KB footprint${
        (repo.stargazers || 0) >= 20 ? `, ${repo.stargazers}★` : ""
      }) with enough activity and weight to feel like a powerhouse.`;
    case "Pikachu":
      return `Small, focused ${lang} project with a narrow purpose and room to move fast.`;
    case "Eevee":
    default:
      return `${repo.name} is still taking shape. Early-stage or mixed signals, so Eevee fits until it evolves into something clearer.`;
  }
}

export function assignPokemon(repo, scores, signals = {}) {
  const hay = haystack(repo, signals);
  const days = daysSince(repo.pushedAt);
  const stars = repo.stargazers || 0;
  const size = repo.size || 0;
  const tags = [];
  let base;

  if (repo.archived || days > 540) {
    tags.push("Dormant");
    base = POKEDEX.Snorlax;
  } else if (/security|crypto|auth|oauth|cve|vuln|pentest/.test(hay)) {
    tags.push("Security");
    base = POKEDEX.Umbreon;
  } else if (/infra|devops|kubernetes|k8s|terraform|ansible|docker|helm|sre|platform/.test(hay)) {
    tags.push("Infra");
    base = POKEDEX.Golem;
  } else if (
    /machine-learning|ml-|deep-learning|llm|neural|pytorch|tensorflow|jupyter|data-sci|nlp/.test(hay) ||
    (repo.language === "Python" && /model|train|dataset|ml/.test(hay))
  ) {
    tags.push("ML");
    base = POKEDEX.Alakazam;
  } else if (
    /frontend|react|vue|svelte|css|design-system|ui-|ux|figma|tailwind|next\.?js|component/.test(hay) ||
    ["HTML", "CSS", "Vue"].includes(repo.language)
  ) {
    tags.push("Frontend");
    base = POKEDEX.Sylveon;
  } else if (scores.testing >= 8.2 && signals.hasTests && signals.hasCi) {
    tags.push("Testing");
    base = POKEDEX.Blissey;
  } else if (
    ((scores.testing >= 7 && signals.hasCi && signals.hasTests) ||
      /reliability|resilience|hardening|observability|robust/.test(hay)) &&
    (scores.maintenance >= 7 || scores.architecture >= 7)
  ) {
    tags.push("Robust");
    base = POKEDEX.Blastoise;
  } else if (/experiment|prototype|playground|sandbox|hack|demo|wip/.test(hay)) {
    tags.push("Experimental");
    base = POKEDEX.Ditto;
  } else {
    const mature = stars >= 80 || size >= 2000 || (days < 180 && size >= 500 && stars >= 20);
    const smallFocused = size < 400 && stars < 200 && days < 365;

    if (mature && (scores.maintenance >= 7 || stars >= 200) && size >= 800) {
      tags.push("Mature", repo.language || "Backend");
      base = {
        ...POKEDEX.Dragonite,
        blurb: `Mature · ${repo.language || "Polyglot"} · Powerful`,
      };
    } else if (scores.complexity >= 8 && size >= 500) {
      tags.push("Complex");
      base = POKEDEX.Alakazam;
    } else if (smallFocused || (size < 250 && days < 120)) {
      tags.push("Focused");
      base = POKEDEX.Pikachu;
    } else if (stars < 5 && days < 90 && size < 800) {
      tags.push("Early");
      base = POKEDEX.Eevee;
    } else if (size >= 1000 || stars >= 50) {
      tags.push(repo.language || "General");
      base = POKEDEX.Dragonite;
    } else if (scores.testing >= 7) {
      tags.push("Testing");
      base = POKEDEX.Blissey;
    } else {
      tags.push(repo.language || "General");
      base = POKEDEX.Eevee;
    }
  }

  const pokemon = { ...base, tags };
  pokemon.why = explainPokemon(pokemon.name, repo, scores, signals);
  return pokemon;
}
