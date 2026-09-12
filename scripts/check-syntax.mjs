import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const roots = ['.', 'netlify/functions', 'scripts'];
const files = [];
for (const root of roots) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name) && entry.name !== 'check-syntax.mjs')
      files.push(`${root}/${entry.name}`);
  }
}
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${file}\n${result.stderr || result.stdout}`);
}
console.log(`Syntax OK: ${files.length} files`);
