// Packs the built plugin into dist/mac-terminal-<version>.zip:
//   npm run package
// The zip holds one folder, mac-terminal/, with exactly the files Obsidian needs.
// Unzipped into <vault>/.obsidian/plugins/, it is a working install.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const dist = path.join(root, 'dist', manifest.id);
const SHIPPED = ['main.js', 'manifest.json', 'styles.css', 'mt-pty'];

for (const file of SHIPPED) {
	if (!fs.existsSync(path.join(dist, file))) {
		console.error('✗ Build first: npm run build');
		process.exit(1);
	}
}

// Copy only the shipped files, so nothing else in dist/ ends up in the zip.
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-terminal-package-'));
try {
	const folder = path.join(stage, manifest.id);
	fs.mkdirSync(folder);
	for (const file of SHIPPED) fs.copyFileSync(path.join(dist, file), path.join(folder, file));
	fs.chmodSync(path.join(folder, 'mt-pty'), 0o755);

	const zip = path.join(root, 'dist', `${manifest.id}-${manifest.version}.zip`);
	fs.rmSync(zip, { force: true });
	// ditto keeps the executable bit and leaves out macOS metadata (._ files).
	execFileSync('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--noextattr', '--noqtn', '--keepParent', folder, zip]);

	const sha = createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
	console.log(`✓ ${path.relative(root, zip)} (${Math.round(fs.statSync(zip).size / 1024)} KB)`);
	console.log(`  sha256 ${sha}`);
	console.log(`  Unzip it into <vault>/.obsidian/plugins/ and enable "${manifest.name}" in Obsidian.`);
} finally {
	fs.rmSync(stage, { recursive: true, force: true });
}
