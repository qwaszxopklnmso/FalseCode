const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parse } = require('./parser.js');
const { gen } = require('./generator.js');

function transpile(source) {
  const ast = parse(source);
  return gen(ast);
}

const VERSION = (() => {
  try {
    return require('../package.json').version;
  } catch { return '0.0.0'; }
})();

const HELP = `falsecode - False Code transpiler (pseudo-code -> C++)

usage: falsecode <input.fc> [output.cpp] [options]

options:
  -v, --version    show version
  -d, --describe   show README.md
  -h, --help       output this command list
  -c, --compile    auto-compile the generated .cpp with g++ after transpiling
`;

function main(argv) {
  const args = argv.slice(2);
  const flags = { version: false, describe: false, help: false, compile: false };
  const rest = [];
  for (const a of args) {
    if (a === '-v' || a === '--version') flags.version = true;
    else if (a === '-d' || a === '--describe') flags.describe = true;
    else if (a === '-h' || a === '--help') flags.help = true;
    else if (a === '-c' || a === '--compile') flags.compile = true;
    else rest.push(a);
  }
  if (flags.help) { console.log(HELP); return; }
  if (flags.version) { console.log(VERSION); return; }
  if (flags.describe) {
    const readme = path.join(__dirname, '..', 'README.md');
    console.log(fs.existsSync(readme) ? fs.readFileSync(readme, 'utf8') : 'README.md not found');
    return;
  }
  const srcPath = rest[0];
  if (!srcPath) {
    console.error('usage: falsecode <input.fc> [output.cpp] [-c] [-v] [-d] [-h]');
    process.exit(1);
  }
  if (!fs.existsSync(srcPath)) {
    console.error(`input not found: ${srcPath}`);
    process.exit(1);
  }
  const source = fs.readFileSync(srcPath, 'utf8');
  let output;
  try {
    output = transpile(source);
  } catch (e) {
    console.error(`[error] ${e.message}`);
    process.exit(1);
  }
  const outPath = rest[1] || srcPath.replace(/\.[^.]+$/, '') + '.cpp';
  fs.writeFileSync(outPath, output, 'utf8');
  console.log(`transpiled ${srcPath} -> ${outPath}`);
  if (flags.compile) {
    const exePath = outPath.replace(/\.[^.]+$/, '') + '.exe';
    try {
      execFileSync('g++', ['-std=gnu++11', '-O0', '-w', outPath, '-o', exePath], { stdio: 'pipe' });
      console.log(`compiled ${outPath} -> ${exePath}`);
    } catch (e) {
      console.error(`[error] g++ failed:\n${(e.stderr || e.message || '').toString().split('\n').slice(0, 6).join('\n')}`);
      process.exit(1);
    }
  }
}

module.exports = { transpile, main };

if (require.main === module) main(process.argv);