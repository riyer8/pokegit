import test from "node:test";
import assert from "node:assert/strict";
import { stripMarkdown, preciseBlurb } from "../src/lib/text.js";

test("stripMarkdown removes common markdown markers", () => {
  assert.equal(stripMarkdown("**bold** and *italic*"), "bold and italic");
  assert.equal(stripMarkdown("Use `npm test` please"), "Use npm test please");
  assert.equal(stripMarkdown("[PokéGit](https://example.com) rocks"), "PokéGit rocks");
  assert.equal(stripMarkdown("# Title\n\nHello **world**"), "Title Hello world");
});

test("preciseBlurb keeps short readable copy", () => {
  const long =
    "PokéGit is a chrome extension that analyzes public github profiles. " +
    "It also inspects repositories for tests, structure, and AI tooling signals. " +
    "There is a lot more detail after that which should be cut.";
  const out = preciseBlurb(long, { maxChars: 160, maxSentences: 2 });
  assert.ok(out.length <= 160);
  assert.match(out, /PokéGit/);
  assert.ok(!out.includes("**"));
});

test("preciseBlurb strips badge-y markdown leftovers", () => {
  const raw = "a chrome extension that analyzes public github profiles. a fun < 1 hour hack!";
  assert.equal(preciseBlurb(`**${raw}**`, { maxChars: 200, maxSentences: 2 }), raw);
});
