import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  redactSecrets,
  isPlausibleGithubToken,
  isPlausibleOpenAIKey,
} from "../src/lib/secret-safety.js";

function sample(prefix, n) {
  return `${prefix}${"a".repeat(n)}`;
}

describe("secret-safety", () => {
  it("redacts GitHub and OpenAI material from error text", () => {
    const ghp = sample("ghp_", 36);
    const sk = sample("sk-", 36);
    const out = redactSecrets(`Bearer ${ghp} failed ${sk}`);
    assert.equal(out.includes("ghp_"), false);
    assert.equal(out.includes("sk-aa"), false);
    assert.match(out, /\[redacted\]/);
  });

  it("accepts plausible token shapes and rejects junk", () => {
    assert.equal(isPlausibleGithubToken(sample("ghp_", 36)), true);
    assert.equal(isPlausibleGithubToken(sample("github_pat_", 22)), true);
    assert.equal(isPlausibleGithubToken("not-a-token"), false);
    assert.equal(isPlausibleGithubToken("ghp_short"), false);
    assert.equal(isPlausibleOpenAIKey(sample("sk-", 36)), true);
    assert.equal(isPlausibleOpenAIKey(sample("sk-proj-", 32)), true);
    assert.equal(isPlausibleOpenAIKey("password"), false);
  });
});
