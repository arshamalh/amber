#!/usr/bin/env node
// Cuts a release: sets the version everywhere, commits, tags, and pushes.
// Needs docs/releases/<tag>.md (the release notes) first. The tag push starts
// .github/workflows/release.yml, which builds every platform and publishes
// the release when all succeed.
//
// Usage: make release v0.0.2   (or: node scripts/release.mjs v0.0.2)

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRANCH = "main";

function fail(msg) {
  console.error(`release: ${msg}`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const out = execFileSync(cmd, args, { cwd: root, encoding: "utf8", ...opts });
  return (out ?? "").trim(); // null when stdio is inherited
}

const tag = process.argv[2];
if (!tag) fail("missing version. Usage: make release v0.0.2");
const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag);
if (!match) fail(`"${tag}" is not a version like v0.0.2 or v0.1.0-rc.1`);
const version = match[1];

// Release notes are written per version before releasing.
const notes = `docs/releases/${tag}.md`;
if (!existsSync(join(root, notes))) {
  fail(`write the release notes first: ${notes} (see docs/RELEASING.md)`);
}

// Preconditions: on main, clean (except this version's notes), up to date, tag unused.
const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== BRANCH) fail(`switch to ${BRANCH} first (on ${branch})`);
// -uall lists files inside new folders; output lines are "XY path".
const dirty = run("git", ["status", "--porcelain", "-uall"])
  .split("\n")
  .filter((l) => l && /^\S{1,2}\s+(.+)$/.exec(l.trim())?.[1] !== notes);
if (dirty.length) fail(`working tree has uncommitted changes:\n  ${dirty.join("\n  ")}`);
run("git", ["fetch", "--quiet", "origin", BRANCH, "--tags"]);
const [behind] = run("git", ["rev-list", "--count", `HEAD..origin/${BRANCH}`]).split("\n");
if (behind !== "0") fail(`${BRANCH} is ${behind} commit(s) behind origin; pull first`);
if (run("git", ["tag", "--list", tag])) fail(`tag ${tag} already exists`);

// Set the version in every file that carries it.
function replaceFirst(file, pattern, replacement) {
  const path = join(root, file);
  const text = readFileSync(path, "utf8");
  if (!pattern.test(text)) fail(`no version field found in ${file}`);
  writeFileSync(path, text.replace(pattern, replacement));
}
replaceFirst("src-tauri/tauri.conf.json", /"version":\s*"[^"]*"/, `"version": "${version}"`);
replaceFirst("src-tauri/Cargo.toml", /^version = "[^"]*"/m, `version = "${version}"`);
replaceFirst(
  "src-tauri/Cargo.lock",
  /(\[\[package\]\]\nname = "amber"\nversion = )"[^"]*"/,
  `$1"${version}"`,
);
// npm updates package.json and package-lock.json together.
run("npm", ["version", version, "--no-git-tag-version", "--allow-same-version"], {
  shell: process.platform === "win32",
});

const files = [
  notes,
  "package.json",
  "package-lock.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
];
run("git", ["add", ...files]);
if (run("git", ["diff", "--cached", "--name-only"])) {
  run("git", ["commit", "--quiet", "-m", `Release ${tag}`]);
} else {
  console.log(`version is already ${version}; tagging the current commit`);
}
run("git", ["tag", "-a", tag, "-m", `Amber ${tag}`]);

// One atomic push: either both the branch and the tag land, or neither.
try {
  run("git", ["push", "--atomic", "origin", BRANCH, tag], { stdio: "inherit" });
} catch {
  fail(
    `push failed. Your local commit and tag ${tag} are kept; fix the problem and run:\n` +
      `  git push --atomic origin ${BRANCH} ${tag}\n` +
      `or undo with: git tag -d ${tag} && git reset --hard HEAD~1`,
  );
}

const repo = run("git", ["remote", "get-url", "origin"])
  .replace(/^git@github\.com:/, "https://github.com/")
  .replace(/\.git$/, "");
console.log(`\nReleased ${tag}. Builds are running (about 15–20 minutes); the release is published at:\n  ${repo}/releases`);
