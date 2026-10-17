// Installs the built plugin into a vault:
//   npm run install-plugin -- "/path/to/My Vault" [--enable]
// Replaces only the files the plugin ships; everything else in the plugin folder
// (data.json with your settings, anything you put there) is left alone.
// --enable also turns the plugin on in .obsidian/community-plugins.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OBSOLETE, SHIPPED } from './plugin-files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const dist = path.join(root, 'dist', manifest.id);

const args = process.argv.slice(2);
const enable = args.includes('--enable');
const vaultArg = args.find((a) => !a.startsWith('--'));

function fail(message) {
	console.error(`✗ ${message}`);
	process.exit(1);
}

const isInside = (parent, child) => {
	const rel = path.relative(parent, child);
	return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
};

if (!vaultArg) fail('Usage: npm run install-plugin -- "/path/to/vault" [--enable]');
const vault = path.resolve(vaultArg);
const configDir = path.join(vault, '.obsidian');
if (!fs.existsSync(configDir)) fail(`${vault} is not an Obsidian vault (no .obsidian folder). Open it in Obsidian once first.`);
if (fs.lstatSync(configDir).isSymbolicLink()) fail(`${configDir} is a symbolic link. Install manually.`);
if (!fs.lstatSync(configDir).isDirectory()) fail(`${vault} is not an Obsidian vault (.obsidian is not a folder).`);
for (const file of SHIPPED) {
	if (!fs.existsSync(path.join(dist, file))) fail('Build first: npm run build');
}

// Read the list of enabled plugins before touching anything. If it can't be read,
// stop: rewriting it would turn off every other plugin in the vault.
const listFile = path.join(configDir, 'community-plugins.json');
let enabledList = null;
if (enable) {
	let list = [];
	if (isLink(listFile)) fail(`${listFile} is a symbolic link. Nothing was changed; install without --enable and enable the plugin in Obsidian.`);
	if (fs.existsSync(listFile)) {
		try {
			list = JSON.parse(fs.readFileSync(listFile, 'utf8'));
		} catch {
			list = null;
		}
		if (!Array.isArray(list) || !list.every((id) => typeof id === 'string')) {
			fail(`${listFile} is not a list of plugins. Nothing was changed; install without --enable and enable the plugin in Obsidian.`);
		}
	}
	if (!list.includes(manifest.id)) enabledList = [...list, manifest.id];
}

const pluginsDir = path.join(configDir, 'plugins');
const dest = path.join(pluginsDir, manifest.id);
if (fs.existsSync(pluginsDir) && fs.lstatSync(pluginsDir).isSymbolicLink()) {
	fail(`${pluginsDir} is a symbolic link. Install manually, or replace the link with a folder.`);
}
fs.mkdirSync(dest, { recursive: true });
// A symlinked plugin folder (a common development setup) would make us write into
// the repository itself. Refuse instead of guessing.
if (fs.lstatSync(dest).isSymbolicLink() || isInside(fs.realpathSync.native(root), fs.realpathSync.native(dest))) {
	fail(`${dest} is a symbolic link or points into this project. Remove the link and run again.`);
}
// Only files are replaced: a folder that happens to have the name of one is not ours.
for (const file of SHIPPED) {
	const target = path.join(dest, file);
	if (fs.existsSync(target) && !isLink(target) && fs.lstatSync(target).isDirectory()) {
		fail(`${target} is a folder. Move it away and run again.`);
	}
}

for (const file of SHIPPED) {
	const target = path.join(dest, file);
	if (fs.existsSync(target) || isLink(target)) fs.rmSync(target, { force: true });
}
for (const file of OBSOLETE) {
	const target = path.join(dest, file);
	if (fs.existsSync(target) || isLink(target)) fs.rmSync(target, { recursive: true, force: true });
}
for (const file of SHIPPED) fs.copyFileSync(path.join(dist, file), path.join(dest, file));

function isLink(p) {
	try {
		return fs.lstatSync(p).isSymbolicLink();
	} catch {
		return false;
	}
}

if (enabledList) {
	// Write next to the file, then rename: the list is never seen half-written.
	const mode = fs.existsSync(listFile) ? fs.statSync(listFile).mode & 0o777 : 0o644;
	const temp = `${listFile}.mac-terminal-${process.pid}.tmp`;
	fs.writeFileSync(temp, JSON.stringify(enabledList, null, 2), { mode });
	fs.chmodSync(temp, mode);
	fs.renameSync(temp, listFile);
}

console.log(`✓ ${manifest.name} ${manifest.version} installed in ${dest}`);
console.log(enable
	? '  Enabled. If Obsidian is open on this vault, reload it (⌘P → "Reload app without saving").'
	: '  Turn it on in Obsidian: Settings → Community plugins → Mac Terminal.');
