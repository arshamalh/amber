#!/usr/bin/env node
// Downloads the pinned Tinymist release, verifies its SHA-256, and installs it
// as a Tauri sidecar at src-tauri/binaries/tinymist-<target-triple>[.exe].
//
// Usage: node scripts/fetch-tinymist.mjs [target-triple]
// The triple defaults to the host's (from `rustc -vV`).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = readFileSync(join(root, "src-tauri/tinymist.version"), "utf8").trim();
const triple =
  process.argv[2] ??
  /host: (\S+)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))[1];
const windows = triple.includes("windows");
const exe = windows ? ".exe" : "";
const dest = join(root, "src-tauri/binaries", `tinymist-${triple}${exe}`);
const stamp = `${dest}.version`;

if (existsSync(dest) && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === version) {
  console.log(`tinymist ${version} for ${triple} already present`);
  process.exit(0);
}

const asset = `tinymist-${triple}.${windows ? "zip" : "tar.gz"}`;
const base = `https://github.com/Myriad-Dreamin/tinymist/releases/download/${version}`;

async function download(name) {
  const res = await fetch(`${base}/${name}`);
  if (!res.ok) throw new Error(`GET ${base}/${name}: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

console.log(`fetching ${asset} (${version})`);
const [archive, sums] = await Promise.all([download(asset), download("sha256.sum")]);

const expected = sums
  .toString()
  .split("\n")
  .map((l) => l.trim().split(/\s+\*?/))
  .find(([, name]) => name === asset)?.[0];
const actual = createHash("sha256").update(archive).digest("hex");
if (!expected) throw new Error(`${asset} is not listed in sha256.sum`);
if (expected !== actual) throw new Error(`checksum mismatch for ${asset}: ${actual} != ${expected}`);

const work = mkdtempSync(join(tmpdir(), "amber-tinymist-"));
try {
  const archivePath = join(work, asset);
  writeFileSync(archivePath, archive);
  // bsdtar (macOS, Windows 10+) reads zip too; GNU tar handles the Linux .tar.gz.
  execFileSync("tar", ["-xf", archivePath, "-C", work], { stdio: "inherit" });
  const candidates = [join(work, `tinymist-${triple}`, `tinymist${exe}`), join(work, `tinymist${exe}`)];
  const bin = candidates.find(existsSync);
  if (!bin) throw new Error(`tinymist${exe} not found in ${asset}`);
  copyFileSync(bin, dest);
  if (!windows) chmodSync(dest, 0o755);
  writeFileSync(stamp, `${version}\n`);
  console.log(`installed ${dest}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
