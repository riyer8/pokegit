import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isSafeGithubPath,
  isSafeGithubLogin,
  isSafeGithubRepoName,
} from "../src/lib/github-request.js";

describe("github-request paths", () => {
  it("allows relative GitHub API paths used by PokéGit", () => {
    assert.equal(isSafeGithubPath("/users/octocat"), true);
    assert.equal(
      isSafeGithubPath(
        "/users/octocat/repos?sort=updated&direction=desc&per_page=30&page=1&type=owner"
      ),
      true
    );
    assert.equal(isSafeGithubPath("/repos/octocat/hello-world/contents/.github"), true);
    assert.equal(isSafeGithubPath("/repos/octocat/hello-world/releases?per_page=1"), true);
  });

  it("rejects open URLs and traversal", () => {
    assert.equal(isSafeGithubPath("https://api.github.com/user"), false);
    assert.equal(isSafeGithubPath("/user?redirect=https://evil.example"), false);
    assert.equal(isSafeGithubPath("/repos/../users"), false);
    assert.equal(isSafeGithubPath("/users/%3a//evil.example"), false);
    assert.equal(isSafeGithubPath("users/octocat"), false);
  });

  it("accepts GitHub logins and repo names", () => {
    assert.equal(isSafeGithubLogin("octocat"), true);
    assert.equal(isSafeGithubLogin("a"), true);
    assert.equal(isSafeGithubLogin("-bad"), false);
    assert.equal(isSafeGithubLogin("octocat/../evil"), false);
    assert.equal(isSafeGithubRepoName("hello-world"), true);
    assert.equal(isSafeGithubRepoName("foo.bar_baz"), true);
    assert.equal(isSafeGithubRepoName("../etc"), false);
  });
});
