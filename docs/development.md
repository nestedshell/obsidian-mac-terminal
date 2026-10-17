# Development

How to build, test and release Embedded Mac Terminal. For a short overview, see the [README](../README.md).

## Build from source

You need Node.js 20 or later. The build embeds the compiled helper kept in the repository (`native/mt-pty`), so it needs no compiler.

```sh
git clone https://github.com/nestedshell/obsidian-mac-terminal.git
cd obsidian-mac-terminal
npm install
npm run build
npm run install-plugin -- "/path/to/your/vault" --enable
```

Then, in Obsidian: **Settings → Community plugins**, turn community plugins on if needed, and enable **Embedded Mac Terminal**. If Obsidian was already open on that vault, reload it first (⌘P → *Reload app without saving*).

`install-plugin` keeps your settings when you update. Without `--enable` it only copies the files, and you enable the plugin yourself.

## Commands

```sh
npm run dev           # rebuild on change
npm run check         # typecheck, tests, build
npm test              # unit and integration tests (they compile mt-pty and drive real shells)
npm run package       # build and zip the plugin folder into dist/mac-terminal-<version>.zip
npm run build:helper  # compile native/mt-pty.c into native/mt-pty, the copy the build embeds
npm run check:helper  # check that native/mt-pty matches the source on this Mac
```

Tests and the helper scripts need the Xcode Command Line Tools (`xcode-select --install`). Commit `native/mt-pty` together with any change to `native/mt-pty.c`.

## Release

Set the new version in `manifest.json`, `package.json` and `versions.json`, then push a tag with the same name (`git tag 1.0.1 && git push origin 1.0.1`). GitHub Actions tests, builds, attests and publishes the release.

## Layout

| Path | What it is |
| --- | --- |
| `src/main.ts` | Plugin entry: commands, ribbon, file menu, settings |
| `src/terminal-view.ts` | The terminal tab: xterm.js, keyboard, clipboard, lifecycle |
| `src/pty.ts` | Starts and talks to the helper |
| `native/mt-pty.c`, `native/mt-pty` | The pseudo-terminal helper and its compiled copy (the build puts it inside `main.js`) |
| `src/shell.ts`, `src/paths.ts`, `src/text.ts` | Shell and environment, vault paths, sanitizing and quoting |
| `src/banner.ts`, `src/theme.ts`, `src/icon.ts` | Startup art, colors, icon |
| `src/tag.ts`, `src/tag-modal.ts` | Name and color of a terminal |
| `src/guards.ts` | Limits on escape sequences that would freeze the terminal |
| `scripts/build.mjs`, `scripts/install.mjs`, `scripts/package.mjs` | Build into `dist/mac-terminal`, install into a vault, zip for release (`scripts/plugin-files.mjs` lists the files) |
| `scripts/helper.mjs` | Compiles the helper |
| `.github/workflows/release.yml` | Builds, attests and publishes a release for each version tag |

## Why a separate helper

Native terminal modules such as node-pty crash the whole of Obsidian on *Reload app*, and Obsidian can't run Node.js scripts as separate processes. So the pseudo-terminal lives in `mt-pty`, about 400 lines of C started as a plain child process.

## xterm.js notes

The build patches one line of xterm.js: it detects Node.js-like environments and then ignores the Mac, which would turn Option into Meta. The build stops if a future xterm version changes that line.

The cursor doesn't blink, as in Terminal.app: a blinking cursor keeps the CPU busy and costs battery.
