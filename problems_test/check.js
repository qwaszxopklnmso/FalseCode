const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const { transpile } = require('../src/main.js');

const DIR = __dirname;
const STD = path.join(DIR, 'standard');
const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-check-'));
let pass = 0, fail = 0, skip = 0;

function coreOf(name) {
  return name.replace(/\.(fc|in|out)$/, '').replace(/^(Cppybt_|Luogu_)/, '');
}

const fcFiles = fs.readdirSync(DIR).filter((f) => f.endsWith('.fc')).sort();
const stdFiles = fs.readdirSync(STD);

for (const fc of fcFiles) {
  const core = coreOf(fc);
  const inFile = stdFiles.find((n) => n.endsWith('.in') && coreOf(n) === core);
  const outFile = inFile && inFile.replace(/\.in$/, '.out');
  if (!inFile || !fs.existsSync(path.join(STD, outFile))) {
    skip++;
    console.log(`SKIP ${fc} (no standard data)`);
    continue;
  }

  const base = path.join(BUILD, core);
  const cpp = base + '.cpp';
  const exe = base + '.exe';

  let outCpp;
  try {
    outCpp = transpile(fs.readFileSync(path.join(DIR, fc), 'utf8'));
  } catch (e) {
    fail++;
    console.log(`FAIL ${fc}: transpile error\n  ${e.message}`);
    continue;
  }
  fs.writeFileSync(cpp, outCpp);

  try {
    execFileSync('g++', ['-std=c++11', '-O0', '-w', cpp, '-o', exe], { stdio: 'pipe' });
  } catch (e) {
    fail++;
    const err = (e.stderr || e.message || '').toString();
    console.log(`FAIL ${fc}: compile error\n  ${err.split('\n').slice(0, 6).join('\n  ')}`);
    continue;
  }

  const stdin = fs.readFileSync(path.join(STD, inFile));
  let stdout;
  try {
    stdout = execFileSync(exe, {
      input: stdin,
      encoding: 'utf8',
      timeout: 10000,
    }).replace(/\r/g, '').trim();
  } catch (e) {
    stdout = e.stdout != null ? e.stdout.toString().replace(/\r/g, '').trim() : '';
    if (!stdout) {
      fail++;
      console.log(`FAIL ${fc}: runtime error\n  ${e.stderr || e.message}`);
      continue;
    }
  }

  const expected = fs.readFileSync(path.join(STD, outFile), 'utf8').replace(/\r/g, '').trim();
  if (stdout === expected) {
    pass++;
    console.log(`PASS ${fc}`);
  } else {
    fail++;
    console.log(`FAIL ${fc}`);
    console.log(`  expected: ${JSON.stringify(expected)}`);
    console.log(`  actual:   ${JSON.stringify(stdout)}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail ? 1 : 0);
