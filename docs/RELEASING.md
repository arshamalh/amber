# Releasing Amber

## Every release

```sh
make release vX.Y.Z
```

This bumps the version everywhere, commits, tags and pushes. The tag runs `.github/workflows/release.yml`, which builds installers for Linux, macOS (Apple Silicon and Intel) and Windows into a **draft** GitHub release, together with signed update files and `latest.json`.

Then on GitHub, under **Releases**: review the draft and click **Publish release**, leaving "Set as the latest release" ticked. Publishing is what delivers the update. Installed copies of Amber read
`https://github.com/arshamalh/amber/releases/latest/download/latest.json`, and GitHub's `latest` skips drafts and pre-releases.

## The update-signing key (one-time setup)

Amber only installs updates signed with the project's update key. Its public half is in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). This key is free and has nothing to do with Apple or Microsoft signing.

- Private key: `~/.tauri/amber.key`. Password: `~/.tauri/amber.key.password`.
- **Back up both** (a password manager is ideal). If the key is lost, installed copies can never be updated again; users would have to download a new version by hand.
- Never commit them.

Give them to GitHub Actions once:

```sh
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/amber.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD < ~/.tauri/amber.key.password
```

The release workflow stops with a clear error if they are missing.

## Why there is no Apple or Microsoft signing

Removing the first-launch warning needs a paid Apple Developer ID ($99/year) or a Windows signing service. Amber doesn't pay for either:

- **macOS:** the app is ad-hoc signed (`bundle.macOS.signingIdentity: "-"`, free). On first install macOS says it can't verify Amber. The user clicks **System Settings → Privacy & Security → Open Anyway** once. Updates are downloaded by Amber itself, not a browser, so macOS does not quarantine them and doesn't ask again.
- **Windows:** SmartScreen may warn on first install ("More info → Run anyway"). SignPath Foundation offers free signing for open-source projects if that becomes worth applying for.
- **Linux:** the AppImage updates itself; `.deb` and `.rpm` installs update through the package manager or by downloading the new version.

Builds made locally with `npm run tauri build` don't create update files and don't need the key.
