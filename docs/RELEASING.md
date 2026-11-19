# Releasing Amber

## Every release

1. Write the notes in `docs/releases/vX.Y.Z.md` (the format is below).
2. Run:

   ```sh
   make release vX.Y.Z
   ```

## Release notes

`docs/releases/vX.Y.Z.md` is the release's description on GitHub and the notes the in-app updater receives. Keep it short: an optional one-line summary, then **one line per change, each starting with an emoji**, written for users (what they can now do), not as commit messages. `docs/releases/_footer.md` (first-install steps) is appended automatically.

```markdown
Writing feels like writing now. ✍️

- ✨ Notes open in a **writing view**: markup hides until you click into it
- 🧮 Maths and figures show as real Typst output while you write
- ⌨️ Type `/` for headings, tables, images, callouts and more
- 🐛 Fixed links not updating after renaming a folder
```

Common emoji: ✨ new, ⚡️ faster, 🎨 look, 🐛 fix, 🔒 safety, 📄 export, 🔗 links, 🔍 search, 🗂️ chests and files, 🔄 updates, 🧮 maths.

This checks that the notes exist, bumps the version everywhere, commits (with the notes), tags and pushes. The tag runs `.github/workflows/release.yml`, which builds installers for Linux, macOS (Apple Silicon and Intel) and Windows, together with signed update files and `latest.json`. They collect in a draft release that is **published automatically once all four platforms have built**. If any build fails, the release stays a draft: fix the problem and release a new version, or publish the draft by hand if the failure doesn't matter.

Publishing is what delivers the update. Installed copies of Amber read
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
