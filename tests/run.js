const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

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

  // `err_*.fc` fixtures are expected to FAIL transpilation (a transpiler
  // diagnostic). Their point is that the error is raised, not that the
  // generated C++ compiles.
  if (basename.startsWith('err_')) {
    const source = fs.readFileSync(fc, 'utf8');
    try {
      transpile(source);
      fail++;
      console.log(`FAIL ${basename}: expected a transpile error, but it transpiled OK`);
    } catch (e) {
      pass++;
      console.log(`PASS ${basename}: ${String(e.message).split('\n')[0]}`);
    }
    return;
  }

  const source = fs.readFileSync(fc, 'utf8');
  const outCpp = transpile(source);
  fs.writeFileSync(cpp, outCpp);

  // 1. the transpiled result must compile
  const gxx = (process.env.GXX ? [process.env.GXX] : []).concat(['g++', 'g++.exe'])
    .find((c) => spawnSync(c, ['--version'], { stdio: 'ignore' }).error === undefined);
  if (!gxx) {
    fail++;
    console.log(`FAIL ${basename}: no C++ compiler (set GXX or add g++/g++.exe to PATH)`);
    return;
  }
  const comp = spawnSync(gxx, ['-std=c++11', '-O0', '-w', cpp, '-o', exe],
    { stdio: 'pipe' });
  if (comp.error || comp.status !== 0) {
    fail++;
    const msg = ((comp.stderr || comp.error?.message || '') + '').split('\n').filter(Boolean);
    const first = msg.slice(0, 6).join('\n');
    console.log(`FAIL ${basename}: compile error\n${first}`);
    if (fs.existsSync(cpp)) { try { fs.unlinkSync(cpp); } catch {} }
    return;
  }

  // 2. run it with optional stdin
  const stdin = has(basename + '.in') ? fs.readFileSync(stdinFile) : undefined;
  const res = spawnSync(exe, {
    input: stdin,
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 10000,
  });
  // a non-zero exit code (e.g. a fixture `Return 0xab;`) is tolerated when an
  // expected output exists and stdout was still produced.
  if (res.error) {
    fail++;
    console.log(`FAIL ${basename}: runtime error\n${res.error.message}`);
    return;
  }
  if (res.status !== 0 && !(has(basename + '.out') && res.stdout != null)) {
    fail++;
    console.log(`FAIL ${basename}: runtime error (exit ${res.status})\n${res.stderr || ''}`);
    return;
  }
  const stdout = (res.stdout || '').replace(/\r/g, '').trim();

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