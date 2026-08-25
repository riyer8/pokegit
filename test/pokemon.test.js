import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assignPokemon, explainPokemon, POKEDEX } from "../src/lib/pokemon.js";

function baseRepo(overrides = {}) {
  return {
    name: "demo-app",
    description: "A small useful tool",
    language: "JavaScript",
    topics: [],
    stargazers: 3,
    forks: 0,
    size: 120,
    pushedAt: new Date().toISOString(),
    createdAt: new Date(Date.now() - 100 * 864e5).toISOString(),
    archived: false,
    ...overrides,
  };
}

const scores = {
  architecture: 6,
  testing: 5,
  maintenance: 7,
  documentation: 6,
  complexity: 5,
  activity: 7,
};

describe("assignPokemon", () => {
  it("is deterministic for the same inputs", () => {
    const repo = baseRepo();
    const signals = { hasTests: false, hasCi: false, rootFiles: ["package.json"] };
    const a = assignPokemon(repo, scores, signals);
    const b = assignPokemon(repo, scores, signals);
    assert.equal(a.name, b.name);
    assert.ok(a.why);
    assert.ok(a.personality);
  });

  it("assigns Snorlax to archived repos", () => {
    const poke = assignPokemon(baseRepo({ archived: true }), scores, {});
    assert.equal(poke.name, "Snorlax");
  });

  it("assigns Blissey when tests and CI are strong", () => {
    const poke = assignPokemon(
      baseRepo({ name: "well-tested", size: 800 }),
      { ...scores, testing: 9 },
      { hasTests: true, hasCi: true, rootFiles: ["package.json", "vitest.config.ts"] }
    );
    assert.equal(poke.name, "Blissey");
  });

  it("keeps every Pokémon in the POKEDEX", () => {
    assert.ok(POKEDEX.Pikachu);
    assert.ok(POKEDEX.Dragonite);
    assert.equal(explainPokemon("Pikachu", baseRepo(), scores, {}).includes("focused"), true);
  });
});
