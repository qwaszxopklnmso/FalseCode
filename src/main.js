const fs = require('fs');
const path = require('path');
const { parse } = require('./parser.js');
const { gen } = require('./generator.js');

function transpile(source) {
  const ast = parse(source);
  return gen(ast);
}

function main(argv) {
  const args = argv.slice(2);
  const srcPath = args[0];
  if (!srcPath) {
    console.error('usage: node src/main.js <input.fc> [output.cpp]');
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
  const outPath = args[1] || srcPath.replace(/\.[^.]+$/, '') + '.cpp';
  fs.writeFileSync(outPath, output, 'utf8');
  console.log(`transpiled ${srcPath} -> ${outPath}`);
}

module.exports = { transpile, main };

if (require.main === module) main(process.argv);