import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const options = { absWorkingDir: fileURLToPath(root), minify: true, target: 'es2022' };
await build({
  ...options,
  entryPoints: ['src/app.js'],
  outfile: 'docs/assets/app.js',
  bundle: true,
  legalComments: 'linked',
  format: 'esm'
});

const shell = [
  'index.html',
  'manifest.webmanifest',
  'assets/app.js',
  'assets/style.css',
  'assets/landscape.webp',
  'assets/icon.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable.png',
  'assets/apple-touch-icon.png'
];
const digest = createHash('sha256');
for (const path of [...shell.map(file => 'docs/' + file), 'src/sw.js']) {
  digest.update(await readFile(new URL(path, root)));
}
await build({
  ...options,
  entryPoints: ['src/sw.js'],
  outfile: 'docs/sw.js',
  define: {
    SHELL_FILES: JSON.stringify(shell.map(path => path === 'index.html' ? './' : './' + path)),
    SHELL_REVISION: JSON.stringify(digest.digest('hex').slice(0, 16))
  }
});
