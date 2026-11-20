# 0009. Free distribution: ad-hoc signing and a built-in updater

Date: 2026-11-19 · Status: accepted

## Context

Unsigned macOS builds show "Amber is damaged" and needed a terminal command, again for every release. Removing Gatekeeper's warning entirely requires a Developer ID certificate and notarization, which need the paid Apple Developer Program. The project does not spend money on distribution.

## Decision

- **Ad-hoc sign** macOS builds (`signingIdentity: "-"`). The first launch shows the standard "can't verify" message, cleared with **Open Anyway** in System Settings, with no terminal. This happens once per install.
- **Self-update with `tauri-plugin-updater`**, fed from GitHub Releases. No server: `latest.json` lives at `releases/latest/download/latest.json`. Updates are signed with a free project key (minisign) and verified against the public key in `tauri.conf.json`. Amber downloads updates itself, so they are not quarantined and macOS doesn't re-check them.
- The check runs a few seconds after startup and can be turned off in Settings ("Check for updates when Amber starts"). Updates install only after the user clicks Update, and never in development builds.
- Releases are drafts only while building; a final workflow job writes `latest.json` from the uploaded update files and signatures (`scripts/updater-json.mjs`), then publishes the release as "latest" once every platform has succeeded, so updates never point at missing files. (Letting each platform job update `latest.json` raced when two finished together.) They are no longer marked pre-release, because GitHub's `latest` ignores pre-releases.
- Update files (`createUpdaterArtifacts`) are built only in CI (`src-tauri/tauri.updater.conf.json`), so local builds need no key.

## Alternatives

- **Apple Developer ID + notarization ($99/year):** no warning at all. Rejected on cost; the workflow can add it later through tauri-action's Apple secrets.
- **Own update server:** unnecessary; GitHub Releases is free and already used.
- **Homebrew cask:** Homebrew is phasing out casks that fail Gatekeeper.
- **`curl | sh` installer:** skips Gatekeeper but teaches a risky habit and needs a terminal.

## Consequences

- Each user approves Amber once, on first install.
- Losing the update key means installed copies can't update; it must be backed up.
- Verified on macOS (2026-11-19): an installed copy updated itself to v0.1.3 from inside the app. macOS asks once for "App Management" permission the first time Amber replaces itself.
- Checking for updates contacts GitHub (the user's IP is visible to it); the setting allows turning it off.
