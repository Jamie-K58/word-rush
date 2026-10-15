const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(root).filter(file => /\.(?:js|cjs)$/.test(file));
files.push(...fs.readdirSync(__dirname).filter(file => /\.cjs$/.test(file)).map(file => path.join('tests', file)));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }
}
process.stdout.write(`Syntax checked ${files.length} JavaScript files.\n`);
