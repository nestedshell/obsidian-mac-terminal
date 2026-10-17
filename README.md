# Mac Terminal for Obsidian

A real terminal inside Obsidian, already in the folder you are working in.

Open your own login shell (zsh, bash, fish…) inside Obsidian with one click: it opens in a split right next to the note you are reading, already in that note's folder, with full colors, mouse support and full-screen apps like `vim`, `htop` or `claude`. Give each terminal the name of its project and a colored dot, pick a background from a small palette (black, white and a few calm colors), and choose whether terminals open side by side, stacked, in a tab or in their own window.

**macOS only** (Apple silicon and Intel, macOS 11 or later).

![A note with a terminal next to it, opened in the note's folder](docs/screenshots/hero.png)

## Features

- **Opens where you work**: in a split next to your note (side by side or stacked, your choice), in the note's folder, the vault root, or any folder from the file explorer menu.
- **Your real shell**: your login shell with your `PATH` and profile, the same one Terminal.app opens.
- **Project names and colored dots** on terminal tabs, to find the right one at a glance.
- **Looks like Obsidian**: colors and font follow your theme, or pick black, white or one of a few other backgrounds, even with terminals already open; adjustable font size.
- **Feels like a Mac terminal**: Option types characters as in any Mac app (so `@ # [ ] { }` work on an Italian keyboard), ⌘C, ⌘V, ⌘K and the other usual shortcuts work, ⌘-click opens links.
- **Built carefully**: no native code inside Obsidian, a verified helper, and protections against hostile output, pastes and file names (see [Security](#security)).

![Three terminals, each with its project name and colored dot, on a black background](docs/screenshots/projects.png)

## Install

Requirements: macOS 11 or later and Obsidian 1.7.2 or later.

### With the plugin folder (recommended)

1. Get the `mac-terminal` folder: download `mac-terminal-<version>.zip` from the [latest release](https://github.com/nestedshell/mac-terminal/releases/latest) and double-click it to unzip. (Or build it yourself, see below.)
2. In Obsidian, open **Settings → Community plugins** and turn community plugins on if they are off.
3. Next to **Installed plugins**, click the folder icon: Finder opens your vault's plugins folder.
4. Drag the `mac-terminal` folder into it. You should end up with:

   ```
   Your Vault/
   └── .obsidian/
       └── plugins/
           └── mac-terminal/
               ├── main.js
               ├── manifest.json
               └── styles.css
   ```

5. Back in Obsidian, click the refresh icon next to **Installed plugins** and enable **Mac Terminal**.

   ![Mac Terminal enabled in Settings, Community plugins](docs/screenshots/install.png)

6. Click the octopus icon in the left ribbon, or run **Open terminal in current folder** from the command palette (⌘P).

You can also do it all in Finder: the plugins folder is `.obsidian/plugins` inside your vault (press **⌘⇧.** to show hidden folders).

**Updating:** copy the three new files into the existing `mac-terminal` folder, replacing the old ones, then reload Obsidian (⌘P → *Reload app without saving*). Don't replace the whole folder: it also holds your settings (`data.json`).

**Uninstalling:** disable the plugin, then delete the `mac-terminal` folder.

**Several Macs:** the whole plugin is these three files, so Obsidian Sync (with community plugins turned on in its settings) brings it to your other Macs by itself.

**About macOS security:** the small helper program that runs the terminal, `mt-pty`, travels inside `main.js`. When you open a terminal, the plugin checks it against its fingerprint (SHA-256), writes it to a private folder in the macOS temporary directory and runs it from there. You don't need to change any security setting.

### From source

Also needs Node.js 20 or later and the Xcode Command Line Tools (`xcode-select --install`), which compile the helper.

```sh
git clone https://github.com/nestedshell/mac-terminal.git
cd mac-terminal
npm install
npm run build
npm run install-plugin -- "/path/to/your/vault" --enable
```

Then, in Obsidian: **Settings → Community plugins**, turn community plugins on if needed, and enable **Mac Terminal**. If Obsidian was already open on that vault, reload it first (⌘P → *Reload app without saving*).

`install-plugin` keeps your settings when you update. Without `--enable` it only copies the files, and you enable the plugin yourself. `npm run package` builds the zip for the Releases page into `dist/`.

The plugin isn't in the Obsidian community directory, so you install it by hand.

## Opening a terminal

| How | Where it opens |
| --- | --- |
| Ribbon icon (the ninja octopus) | Folder of the active note |
| Command palette → **Open terminal in current folder** | Folder of the active note (or of the active terminal) |
| Command palette → **Open terminal in vault root** | Vault root |
| Right-click a folder or a note → **Open in terminal** | That folder, or the note's folder |

Other commands: **Set name and color of this terminal**, **Toggle black background** and **Toggle white background**.

![The "Open in terminal" entry in the file explorer menu](docs/screenshots/menu.png)

Terminals open in a split next to the note you are working on: side by side by default, or stacked below it (**Settings → Open terminals in**). A terminal opened while another terminal is active joins it as a tab, so the screen isn't split again and again, and an empty pane is simply reused. You can also choose a new tab or a new window, and drag terminals around like any other tab: moving one to another window keeps the shell running and the screen intact, even with `vim` or `htop` open.

Terminal tabs are saved with your workspace, together with their name and color. After a restart they come back with the startup art, and the shell starts when you press Enter.

![A terminal stacked below a note](docs/screenshots/stacked.png)

## Name and color

Give each terminal the name of its project and a colored dot, to find it at a glance among your tabs. Right-click inside the terminal (or on its tab) and choose **Name and color…**. The name replaces the folder name in the tab, and the dot shows up in the tab, in the header and in the startup art.

A new terminal opened from a named one (with **Open terminal in current folder**) keeps its name and color. The colors come from your Obsidian theme, so they match the rest of the app.

![The Name and color dialog](docs/screenshots/name-color.png)

## Settings

![Plugin settings](docs/screenshots/settings.png)

- **Font size**: 8 to 32 px.
- **Background**: one dot per background: the Obsidian theme's (the default), black, graphite, midnight blue, deep teal, plum, paper and white. Open terminals change right away, startup art included, and the text color adapts to stay readable. Black and white are also in the terminal's right-click menu and in the command palette.
- **Startup art**: the nestedshell ninja octopus and the folder info shown when a terminal opens (a compact one-liner in narrow panes).
- **Open terminals in**: split to the right (side by side, the default), split below (stacked), new tab, or new window.

Changes apply to open terminals immediately. Light themes get a light ANSI palette:

![Light theme](docs/screenshots/light.png)

## Keyboard and mouse

While the terminal has focus, keys go to the shell, including Esc, Ctrl+C, Ctrl+R and the others. Option types characters as usual, so `@ # [ ] { }` work on an Italian keyboard. ⌘ shortcuts stay with Obsidian (⌘P, ⌘O, ⌘W, ⌘, …), except these, which the terminal handles like Terminal.app or iTerm2:

| Keys | Action |
| --- | --- |
| ⌘C / ⌘V | Copy the selection / paste |
| ⌘K | Clear the screen and scrollback |
| ⌘A | Select all |
| ⌘← / ⌘→ | Start / end of line |
| ⌘⌫ | Delete to the start of the line |
| ⌥← / ⌥→ | Previous / next word |
| ⇧↩ | New line without running the command (zsh, Claude Code…) |
| Ctrl+Tab | Next Obsidian tab |
| ⌘-click a link | Open it in the browser (http and https only) |
| ⌥-drag | Select text even when an app captures the mouse |

Right-click opens a menu with Copy, Paste, Select all, Clear, Name and color, Black background and White background. Dropping files from Finder, or notes from the Obsidian file explorer, types their quoted paths.

Typing `exit` (or Ctrl+D) closes the tab. If the shell is killed or ends on its own, the tab stays open with the reason; press Enter to start a new shell in the same folder.

## How it works

```
Obsidian tab ── xterm.js (renders the terminal)
      │  keystrokes / output / resize (pipes)
      ▼
   mt-pty ── pseudo-terminal ── your login shell (in the vault folder)
```

- **xterm.js** draws the terminal inside the Obsidian view, themed from Obsidian's CSS variables. The cursor doesn't blink, as in Terminal.app: a blinking cursor keeps the CPU busy and costs battery.
- **mt-pty** (`native/mt-pty.c`, about 400 lines of C) owns the pseudo-terminal. It is built into `main.js`; the plugin writes it to a private temporary folder and starts it as a plain child process, so no native code runs inside Obsidian. Native terminal modules such as node-pty crash the whole app on *Reload app*; a separate helper can't.
- The shell is your account's login shell (the same one Terminal.app opens), started with `-l` so your `PATH` and profile are loaded even when Obsidian was launched from the Dock.

## Security

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

## Development

```sh
npm run dev        # rebuild on change
npm run check      # typecheck, tests, build
npm test           # unit and integration tests (they compile mt-pty and drive real shells)
npm run package    # build and zip the plugin folder into dist/mac-terminal-<version>.zip
```

| Path | What it is |
| --- | --- |
| `src/main.ts` | Plugin entry: commands, ribbon, file menu, settings |
| `src/terminal-view.ts` | The terminal tab: xterm.js, keyboard, clipboard, lifecycle |
| `src/pty.ts` | Starts and talks to the helper |
| `native/mt-pty.c` | The pseudo-terminal helper (the build puts it inside `main.js`) |
| `src/shell.ts`, `src/paths.ts`, `src/text.ts` | Shell and environment, vault paths, sanitizing and quoting |
| `src/banner.ts`, `src/theme.ts`, `src/icon.ts` | Startup art, colors, icon |
| `src/tag.ts`, `src/tag-modal.ts` | Name and color of a terminal |
| `src/guards.ts` | Limits on escape sequences that would freeze the terminal |
| `scripts/build.mjs`, `scripts/install.mjs`, `scripts/package.mjs` | Build into `dist/mac-terminal`, install into a vault, zip for release (`scripts/plugin-files.mjs` lists the files) |

The build also patches one line of xterm.js: it detects Node.js-like environments and then ignores the Mac, which would turn Option into Meta. The build stops if a future xterm version changes that line.

## Known limitations

- After *Reload app*, the helper processes of terminals that were open remain as inactive "zombie" entries (no CPU, no memory) until Obsidian quits. Their shells have already been closed.
- Obsidian uses native macOS menus by default; the right-click menu of the terminal follows that setting.

## License

MIT © nestedshell. Bundles [xterm.js](https://github.com/xtermjs/xterm.js) (MIT).
