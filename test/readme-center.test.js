import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseReadmeVitals,
  parsePackageHints,
  buildReadmeCenter,
  estimateReadmeUx,
} from "../src/lib/readme-center.js";

const libReadme = `# left-pad

A tiny library that left-pads strings.

## Install

\`\`\`bash
npm install left-pad
\`\`\`

## Usage

\`\`\`js
import leftPad from 'left-pad'
\`\`\`
`;

const infraReadme = `# cluster-box

Self-hosted Kubernetes ingress for small teams.

## Getting started

Requires Docker and a cluster.

\`\`\`bash
docker compose up -d
helm install cluster-box ./chart
\`\`\`

Set \`API_KEY\` in \`.env\` before the first run.
`;

const creativeReadme = `# pigment-studio

A canvas playground for generative pixel art and shaders.

Draw, animate, and export loops. Built with p5.js.

## Quick start

\`\`\`bash
npm install
npm start
\`\`\`
`;

describe("README Pokémon Center", () => {
  it("reads a library README as Library with a fast install", () => {
    const center = buildReadmeCenter({
      repo: { name: "left-pad", description: "string padding library", topics: ["npm"] },
      readme: { text: libReadme },
      signals: { hasReadme: true, rootFiles: ["package.json", "index.js"] },
      packageHints: { hasMain: true, hasBin: false, description: "left pad strings" },
    });
    assert.equal(center.dna.id, "library");
    assert.equal(center.dna.label, "Library");
    assert.equal(center.vitals.installMinutes, 1);
    assert.ok(center.vitals.understandSeconds <= 20);
    assert.match(center.vitals.quote, /second|minute/i);
    assert.equal(center.types.filter((t) => t.active).length, 1);
  });

  it("reads docker/helm + env as Infrastructure with a slower install", () => {
    const center = buildReadmeCenter({
      repo: { name: "cluster-box", description: "self-hosted ingress", topics: ["kubernetes"] },
      readme: { text: infraReadme },
      signals: { hasReadme: true, rootFiles: ["Dockerfile", "docker-compose.yml", "chart"] },
    });
    assert.equal(center.dna.id, "infrastructure");
    assert.ok(center.vitals.installMinutes >= 4);
    assert.match(center.vitals.quote, /install/i);
  });

  it("reads a studio/playground as Creative Tool", () => {
    const center = buildReadmeCenter({
      repo: { name: "pigment-studio", topics: ["art", "creative"] },
      readme: { text: creativeReadme },
      signals: { hasReadme: true, rootFiles: ["src"] },
    });
    assert.equal(center.dna.id, "creative");
    assert.equal(center.dna.emoji, "🎨");
  });

  it("treats a missing README as Experimental", () => {
    const center = buildReadmeCenter({
      repo: { name: "scratch", stargazers: 0, size: 12 },
      readme: null,
      signals: { hasReadme: false, rootFiles: [] },
    });
    assert.equal(center.dna.id, "experimental");
    assert.equal(center.missingReadme, true);
    assert.match(center.vitals.quote, /README/i);
  });

  it("parses package.json hints without throwing on junk", () => {
    assert.equal(parsePackageHints("{not json"), null);
    const hints = parsePackageHints(JSON.stringify({ name: "x", main: "i.js", bin: { x: "cli.js" } }));
    assert.equal(hints.hasMain, true);
    assert.equal(hints.hasBin, true);
  });

  it("flags badge-heavy tops and early what-sentences", () => {
    const badges = Array.from({ length: 6 }, (_, i) => `![ci](https://img.shields.io/badge/${i})`).join("\n");
    const vitals = parseReadmeVitals(`${badges}\n\n# Tool\n\nThis is a library that lets you parse CSV files.\n`);
    assert.equal(vitals.badgeHeavy, true);
    assert.equal(vitals.hasWhatEarly, true);
    const ux = estimateReadmeUx(vitals);
    assert.ok(ux.understandSeconds >= 12);
  });

  it("avoids em dashes in lab copy", () => {
    const center = buildReadmeCenter({
      repo: { name: "left-pad", description: "library" },
      readme: { text: libReadme },
      signals: { hasReadme: true, rootFiles: ["package.json"] },
      packageHints: { hasMain: true, hasBin: false },
    });
    const blob = `${center.dna.why} ${center.vitals.quote} ${center.notes.map((n) => n.text).join(" ")}`;
    assert.equal(/[\u2013\u2014]/.test(blob), false);
  });
});
