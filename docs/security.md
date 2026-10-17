# Security

What Embedded Mac Terminal can reach, and what it protects you from. For a short overview, see the [README](../README.md).

## What the plugin accesses

- **Runs programs.** It starts your login shell, and what you type runs with your user's permissions, as in Terminal.app.
- **Files outside the vault.** A terminal is not limited to the vault: you can `cd` anywhere, and the commands you run can read and change any file your account can. The plugin itself writes only its settings (`data.json`, in its plugin folder) and the copy of its helper, in a private folder of the macOS temporary directory (`$TMPDIR/mac-terminal-<user id>/`). To start the shell the way Terminal.app does, it also looks up your account's shell and the installed locales.
- **Clipboard, only when you ask.** It writes the selection when you copy (⌘C or the menu) and reads the clipboard only when you paste (⌘V or the menu). Pasted text is cleaned first (see [Safe paste](#protections)).
- **No network, no accounts, no telemetry.** The plugin makes no network requests. Links you ⌘-click open in your browser.
- **All open source, helper included.** The long base64 string in `main.js` is `native/mt-pty`, compiled from `native/mt-pty.c` in this repository. `npm run build` gives the same `main.js`, byte for byte, on macOS and Linux, and every release is built by GitHub Actions from its tag, with a build provenance attestation (`gh attestation verify main.js --repo nestedshell/obsidian-mac-terminal`).

## Protections

- **No shell in between.** The plugin runs your shell directly with an argument list; folder names are never put into a command line.
- **Stays in the vault.** The folder stored in the workspace is resolved inside the vault; anything that points outside falls back to the vault root. A folder that is a symbolic link to somewhere else still opens (linking a project into the vault is common), but the terminal shows where it really is before the shell starts.
- **No shell starts by itself.** Only a terminal you open starts its shell right away. A tab restored from the saved workspace, a file a synced or shared vault could alter, waits for Enter.
- **Verified helper.** `mt-pty` travels inside `main.js` together with its SHA-256. Before every start the plugin checks the bytes, writes them to a folder in the macOS temporary directory that only your user can write to, and checks that copy again, so a modified, swapped or linked file is replaced, never run.
- **Nothing leaks into the shell.** The helper closes every inherited file descriptor, so the shell can't reach Obsidian's sockets or files. Variables left by other terminals (iTerm, VS Code, tmux) and by Obsidian's own process (Electron, bundle id, allocator settings) are removed.
- **Safe paste.** Pasted and dropped text is stripped of escape and control characters before it reaches the shell, so clipboard content can't break out of bracketed paste and run commands.
- **Exact paths.** Dropped files are quoted for your shell (zsh and bash, fish, tcsh, elvish, nushell). Names with control or invisible bidi characters are refused, never silently altered.
- **Safe display.** Vault, folder and terminal names are cleaned before they are printed in the startup art or shown in a tab, so a crafted name can't inject escape sequences or hide text with bidi controls. Dot colors are limited to the theme's own colors.
- **Output can't freeze Obsidian.** Escape sequences that ask the terminal to repeat an action billions of times are dropped, and huge runs of combining marks are shortened, so `cat` on a hostile file can't hang the app.
- **Safe links.** Only ⌘-click opens links, only `http:` and `https:`, and never a link with a user name in it (`https://bank.com@evil.example`). Hovering a link shows its real host first, in plain ASCII, so look-alike letters and hyperlinks whose text differs from their target stand out.
- **Clean shutdown.** Closing a tab hangs up the shell and its jobs (SIGHUP, then SIGKILL after a grace period). So do disabling the plugin, reloading and quitting Obsidian.
- **Bounded resources.** The helper uses fixed-size buffers; when Obsidian falls behind on a flood of output, the shell is paused instead of filling memory. Input for a program that stopped reading is capped too.
- **Strict settings.** Settings and saved state are validated on load; unknown or malformed values fall back to defaults.
- **Safe installer.** `install-plugin` replaces only the plugin's own files and refuses a symlinked plugin folder, so it can never delete anything else. With `--enable` it adds the plugin to your list of enabled plugins and keeps the others; if that list can't be read, it changes nothing.

## Obsidian stays untouched

The plugin doesn't modify Obsidian or its libraries and patches no global object. Its styles only apply inside the terminal, and its keyboard handling only applies while the terminal has focus. It never writes to your notes: it only stores its settings (`data.json`) through Obsidian's API, and keeps the verified copy of its helper in the macOS temporary folder. Everything it registers is removed when you disable it. To uninstall, delete `.obsidian/plugins/mac-terminal`.
