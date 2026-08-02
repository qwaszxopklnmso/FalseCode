const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const { transpile } = require('../src/main.js');

const TESTS_DIR = __dirname;
let pass = 0, fail = 0;

function has(name) {
  return fs.existsSync(path.join(TESTS_DIR, name));
}

function runCase(basename) {
  const fc = path.join(TESTS_DIR, basename + '.fc');
  const cpp = path.join(TESTS_DIR, basename + '.cpp');
  const exe = path.join(TESTS_DIR, basename + '.exe');
  const stdinFile = path.join(TESTS_DIR, basename + '.in');
  const expectedFile = path.join(TESTS_DIR, basename + '.out');

  const source = fs.readFileSync(fc, 'utf8');
  const outCpp = transpile(source);
  fs.writeFileSync(cpp, outCpp);

  // 1. the transpiled result must compile
  try {
    execFileSync('g++', ['-std=c++11', '-O0', '-w', cpp, '-o', exe],
      { stdio: 'pipe' });
  } catch (e) {
    fail++;
    const msg = (e.stderr || e.message || '').toString().split('\n').filter(Boolean);
    const first = msg.slice(0, 6).join('\n');
    console.log(`FAIL ${basename}: compile error\n${first}`);
    if (fs.existsSync(cpp)) { try { fs.unlinkSync(cpp); } catch {} }
    return;
  }

  // 2. run it with optional stdin
  const stdin = has(basename + '.in') ? fs.readFileSync(stdinFile) : undefined;
  let stdout;
  try {
    stdout = execFileSync(exe, {
      input: stdin,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 10000,
    }).replace(/\r/g, '').trim();
  } catch (e) {
    fail++;
    console.log(`FAIL ${basename}: runtime error\n${e.stderr || e.message}`);
    return;
  }

  // 3. compare to expected output
  const expected = has(basename + '.out')
    ? fs.readFileSync(expectedFile, 'utf8').replace(/\r/g, '').trim()
    : null;
  if (expected !== null && stdout !== expected) {
    fail++;
    console.log(`FAIL ${basename}`);
    console.log(`  expected:\n${JSON.stringify(expected)}`);
    console.log(`  actual:\n${JSON.stringify(stdout)}`);
    return;
  }
  pass++;
  console.log(`PASS ${basename}`);

  // clean up build artifacts
  for (const p of [cpp, exe]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

for (const f of fs.readdirSync(TESTS_DIR)) {
  if (f.endsWith('.fc')) runCase(f.slice(0, -3));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);