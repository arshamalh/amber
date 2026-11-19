#!/usr/bin/env node
// Builds the updater feed (latest.json) for a GitHub release from its
// uploaded update files and their .sig signatures.
//
// Runs once in the release workflow's publish job, after every platform has
// built. (Letting each platform job update latest.json itself races when two
// jobs finish together: one deletes the file while the other reads it.)
//
// Usage: node scripts/updater-json.mjs <tag> <out.json>   (needs `gh`, GH_TOKEN)

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [tag, out] = process.argv.slice(2);
if (!tag || !out) {
  console.error("usage: node scripts/updater-json.mjs <tag> <out.json>");
  process.exit(1);
}
const gh = (...args) => execFileSync("gh", args, { cwd: root, encoding: "utf8" });
const repo =
  process.env.GITHUB_REPOSITORY ?? gh("repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner").trim();

// Updater platform keys → the release asset that serves them. The plain
// `os-arch` keys are what older updaters read; `os-arch-bundle` keys let an
// installed copy pick the same kind of package it was installed from.
const RULES = [
  { keys: ["darwin-aarch64", "darwin-aarch64-app"], match: /_aarch64\.app\.tar\.gz$/ },
  { keys: ["darwin-x86_64", "darwin-x86_64-app"], match: /_x64\.app\.tar\.gz$/ },
  { keys: ["windows-x86_64", "windows-x86_64-nsis"], match: /_x64-setup\.exe$/ },
  { keys: ["windows-x86_64-msi"], match: /_x64_en-US\.msi$/ },
  { keys: ["linux-x86_64", "linux-x86_64-appimage"], match: /_amd64\.AppImage$/ },
  { keys: ["linux-x86_64-deb"], match: /_amd64\.deb$/ },
  { keys: ["linux-x86_64-rpm"], match: /\.x86_64\.rpm$/ },
];
const REQUIRED = ["darwin-aarch64", "darwin-x86_64", "windows-x86_64", "linux-x86_64"];

const assets = JSON.parse(gh("release", "view", tag, "--json", "assets")).assets.map((a) => a.name);
const sigDir = mkdtempSync(join(tmpdir(), "amber-sigs-"));
try {
  gh("release", "download", tag, "--pattern", "*.sig", "--dir", sigDir);
  const sigs = new Map(readdirSync(sigDir).map((f) => [f.replace(/\.sig$/, ""), readFileSync(join(sigDir, f), "utf8").trim()]));

  const platforms = {};
  for (const rule of RULES) {
    const name = assets.find((a) => rule.match.test(a) && sigs.has(a));
    if (!name) continue;
    for (const key of rule.keys) {
      platforms[key] = {
        signature: sigs.get(name),
        url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`,
      };
    }
  }
  const missing = REQUIRED.filter((k) => !platforms[k]);
  if (missing.length) {
    console.error(`missing update files for: ${missing.join(", ")}`);
    process.exit(1);
  }

  const notes = [`docs/releases/${tag}.md`, "docs/releases/_footer.md"]
    .map((f) => readFileSync(join(root, f), "utf8").trim())
    .join("\n\n");
  const feed = { version: tag.replace(/^v/, ""), notes, pub_date: new Date().toISOString(), platforms };
  writeFileSync(out, `${JSON.stringify(feed, null, 2)}\n`);
  console.log(`wrote ${out}: ${feed.version}, ${Object.keys(platforms).length} platform entries`);
} finally {
  rmSync(sigDir, { recursive: true, force: true });
}
