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
  -u, --usage      show SYNTAX/zh_cn.md (default), -u en shows English
  -h, --help       output this command list
  -c, --compile    auto-compile the generated .cpp with g++ after transpiling
`;

function main(argv) {
  const args = argv.slice(2);
  const flags = { version: false, describe: false, usage: false, help: false, compile: false };
  const rest = [];
  for (const a of args) {
    if (a === '-v' || a === '--version') flags.version = true;
    else if (a === '-d' || a === '--describe') flags.describe = true;
    else if (a === '-u' || a === '--usage') flags.usage = true;
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
  if (flags.usage) {
    const lang = rest[0] === 'en' ? 'en_us' : rest[0] === 'zh' ? 'zh_cn' : 'zh_cn';
    const syntax = path.join(__dirname, '..', 'SYNTAX', `${lang}.md`);
    console.log(fs.existsSync(syntax) ? fs.readFileSync(syntax, 'utf8') : `SYNTAX/${lang}.md not found`);
    return;
  }
  const srcPath = rest[0];
  if (!srcPath) {
    console.error('usage: falsecode <input.fc> [output.cpp] [-c] [-v] [-d] [-u] [-h]');
    process.exit(1);
  }
  if (!fs.existsSync(srcPath)) {
    console.error(`input not found: ${srcPath}`);
    process.exit(1);
  }
  if (fs.statSync(srcPath).isDirectory()) {
    console.error(`input is a directory, not a file: ${srcPath}`);
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
  try {
    fs.writeFileSync(outPath, output, 'utf8');
  } catch (e) {
    console.error(`[error] cannot write output: ${outPath} (${e.code || e.message})`);
    process.exit(1);
  }
  console.log(`transpiled ${srcPath} -> ${outPath}`);
  if (flags.compile) {
    const exePath = outPath.replace(/\.[^.]+$/, '') + '.exe';
    // pick the C++ compiler like regress does: $GXX -> g++ -> g++.exe
    const candidates = (process.env.GXX ? [process.env.GXX] : []).concat(['g++', 'g++.exe']);
    const gxx = candidates.find((c) => {
      try { execFileSync(c, ['--version'], { stdio: 'ignore' }); return true; }
      catch { return false; }
    });
    if (!gxx) {
      console.error('[error] g++ not found: set GXX env or add g++/g++.exe to PATH');
      process.exit(1);
    }
    try {
      execFileSync(gxx, ['-std=gnu++11', '-O0', '-w', outPath, '-o', exePath], { stdio: 'pipe' });
      console.log(`compiled ${outPath} -> ${exePath}`);
    } catch (e) {
      console.error(`[error] ${gxx} failed:\n${(e.stderr || e.message || '').toString().split('\n').slice(0, 6).join('\n')}`);
      process.exit(1);
    }
  }
}

module.exports = { transpile, main };

if (require.main === module) main(process.argv);