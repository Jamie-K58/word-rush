const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.resolve(root, 'dist');
if (path.dirname(output) !== root || path.basename(output) !== 'dist') throw new Error('Invalid build output directory.');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const copied = new Set();

function copy(relative) {
  const input = path.resolve(root, relative);
  const target = path.resolve(output, relative);
  if (!input.startsWith(root + path.sep) || !target.startsWith(output + path.sep)) throw new Error(`Asset escapes project: ${relative}`);
  if (copied.has(relative)) return;
  const body = fs.readFileSync(input);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
  copied.add(relative);
  const contents = body.toString('utf8');
  const references = relative.endsWith('.html')
    ? [...contents.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1])
    : relative.endsWith('.css')
      ? [...contents.matchAll(/url\(["']?([^\s"')]+)["']?\)/g)].map(match => match[1])
      : [];
  for (const ref of references) {
    if (/^(?:[a-z]+:|\/\/|#)/i.test(ref)) continue;
    copy(path.normalize(path.join(path.dirname(relative), decodeURIComponent(ref.split(/[?#]/)[0]))));
  }
}

copy('index.html');
// Preserve the original downloadable entry point in the distributable.
fs.copyFileSync(path.join(output, 'index.html'), path.join(output, '单词冲刺-免费网页版.html'));
copied.add('单词冲刺-免费网页版.html');
if (fs.existsSync(path.join(root, 'assets/OFL-Space-Grotesk.txt'))) copy('assets/OFL-Space-Grotesk.txt');
const size = [...copied].reduce((total, file) => total + fs.statSync(path.join(output, file)).size, 0);
process.stdout.write(`Built ${copied.size} public files into dist (${Math.round(size / 1024)} KiB).\n`);
