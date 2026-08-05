const TOKEN_TYPES = {
  WORD: 'word',       // identifier/keyword/type name
  NUM: 'num',         // numeric literal
  STR: 'string',      // "..." (string)
  CHR: 'char',        // '...' (char literal)
  OP: 'op',           // operator
  TQ: 'triquote',     // ``` (multiline comment delimiter)
  COMMENT: 'comment', // `//` line remainder
};

// Multi-char operators, longest first so greedy matching works.
const OPERATORS = [
  '^^=',
  '^^',
  '++',
  '--',
  '==',
  '!=',
  '<=',
  '>=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '^=',
  '|=',
  '&=',
  '>>=',
  '<<=',
  '&&',
  '||',
  '<<',
  '>>',
  '->',
  '::',
  '~=',
  '##',
  '...',
  '=',
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '&',
  '|',
  '!',
  '~',
  '<',
  '>',
  '?',
  ':',
  ';',
  ',',
  '```',
];

/**
 * Tokenize a single source line (leading whitespace stripped).
 * Returns an array of token objects: {type, value, raw}
 */
function tokenizeLine(line) {
  const tokens = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i];
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }

    // Multi-line / inverted string handling.
    if (c === '`') {
      const triple = line.startsWith('```', i);
      if (triple) {
        tokens.push({ type: TOKEN_TYPES.TQ, value: '```' });
        i += 3;
        continue;
      }
      // single backtick: treat as a comment token to end of line
      tokens.push({ type: TOKEN_TYPES.COMMENT, value: line.slice(i) });
      break;
    }
    // `//` line comment (C++-style) — kept as a comment token so the
    // generator can emit it into the C++ output.
    if (c === '/' && line[i + 1] === '/') {
      tokens.push({ type: TOKEN_TYPES.COMMENT, value: line.slice(i) });
      break;
    }
    // `/* ... */` C-style block comment on one line — kept as a comment
    // token; an unclosed `/*` runs to end of line (C++ keeps swallowing it,
    // exactly like hand-written C++).
    if (c === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2);
      const stop = end >= 0 ? end + 2 : n;
      tokens.push({ type: TOKEN_TYPES.COMMENT, value: line.slice(i, stop) });
      i = stop;
      continue;
    }
    // strip `\`-escaped `\x` forms handled below via operators.
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && line[j] !== c) {
        if (line[j] === '\\') j++;
        j++;
      }
      const raw = line.slice(i, Math.min(j + 1, n));
      tokens.push({
        type: c === '"' ? TOKEN_TYPES.STR : TOKEN_TYPES.CHR,
        value: raw,
      });
      i = j + 1;
      continue;
    }
    if (isWordStart(c)) {
      let j = i;
      while (j < n && isWordChar(line[j])) j++;
      const value = line.slice(i, j);
      tokens.push({ type: TOKEN_TYPES.WORD, value });
      i = j;
      continue;
    }
    if (isDigit(c) || (c === '.' && i + 1 < n && isDigit(line[i + 1]))) {
      let j = i;
      if (c === '0' && (line[i + 1] === 'x' || line[i + 1] === 'X')) {
        // hex literal: 0x1F, 0x3f3f3f3f
        j = i + 2;
        while (j < n && /[0-9a-fA-F]/.test(line[j])) j++;
      } else if (c === '0' && (line[i + 1] === 'b' || line[i + 1] === 'B')) {
        // binary literal: 0b101
        j = i + 2;
        while (j < n && /[01]/.test(line[j])) j++;
      } else {
        while (j < n && (isDigit(line[j]) || line[j] === '.' ||
               line[j] === 'e' || line[j] === 'E' ||
               ((line[j] === '+' || line[j] === '-') && j > i &&
                (line[j - 1] === 'e' || line[j - 1] === 'E')))) j++;
      }
      // numeric suffix: 9223372036854775807LL, 3.14f, 123u, 0x1fULL
      while (j < n && /[uUlLfF]/.test(line[j])) j++;
      tokens.push({ type: TOKEN_TYPES.NUM, value: line.slice(i, j) });
      i = j;
      continue;
    }
    // Operator — longest match first.
    const op = OPERATORS.find((o) => line.startsWith(o, i));
    if (op) {
      tokens.push({ type: TOKEN_TYPES.OP, value: op });
      i += op.length;
      continue;
    }
    // Unknown character (shouldn't happen for valid inputs)
    tokens.push({ type: TOKEN_TYPES.OP, value: c });
    i++;
  }
  return tokens;
}

function isWordStart(c) {
  return /[A-Za-z_]/.test(c);
}
function isWordChar(c) {
  return /[A-Za-z0-9_]/.test(c);
}
function isDigit(c) {
  return /[0-9]/.test(c);
}

/**
 * Compute indentation level from leading whitespace.
 * A tab counts as 1 level; a run of spaces counts as ceil(len/2).
 */
function indentLevelOf(line) {
  let tabs = 0;
  let spaces = 0;
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '\t') { tabs++; i++; continue; }
    if (c === ' ') { spaces++; i++; continue; }
    break;
  }
  // 2 spaces = 1 level (so 2-space and 4-space indents stay distinct;
  // ceil(x/4) would collapse 2 and 4 spaces into the same level and break
  // blocks like `if (...) {` + 4-space body)
  return tabs + Math.ceil(spaces / 2);
}

/**
 * Split raw source into a list of physical lines, handling:
 *  - the backtick triple multiline comment (python-style docstring)
 *  - `//` line comments
 * Returns [{text, indent, lineNo, tokens}]
 */
function preprocess(src) {
  const rawLines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inBacktick = false;
  let block = null; // {head, indent, content: []} for ``` comment blocks
  let inCComm = false;
  let cblock = null; // {indent, content: []} for `/*...*/` comment blocks
  rawLines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    // in a `/* ... */` block comment — collect until a string-outside `*/`
    if (inCComm) {
      const ci = findC(raw, 0, true);
      if (ci < 0) { cblock.content.push(raw); return; }
      cblock.content.push(raw.slice(0, ci));
      inCComm = false;
      const content = cblock.content.join('\n');
      out.push({
        text: `/*${content ? '\n' + content + '\n' : ''}*/`,
        indent: cblock.indent,
        lineNo,
        comment: true,
        tokens: [],
      });
      cblock = null;
      raw = raw.slice(ci + 2);   // code after `*/` keeps being processed
      if (!raw.trim()) return;
    }
    const toggles = countTripleToggles(raw);
    if (inBacktick) {
      // collecting a ``` comment block
      if (toggles === 1) {
        // closing fence: flush the block as a /* */ comment line
        inBacktick = false;
        const content = block.content.join('\n');
        out.push({
          text: `/*${content ? '\n' + content + '\n' : ''}*/`,
          indent: block.indent,
          lineNo,
          comment: true,
          tokens: [],
        });
        block = null;
      } else if (toggles === 2) {
        // opening+closing on the same line inside a block: treat the
        // middle as content and close
        const i1 = raw.indexOf('```');
        const i2 = raw.indexOf('```', i1 + 3);
        block.content.push(raw.slice(i1 + 3, i2));
        inBacktick = false;
        const content = block.content.join('\n');
        out.push({
          text: `/*${content ? '\n' + content + '\n' : ''}*/`,
          indent: block.indent,
          lineNo,
          comment: true,
          tokens: [],
        });
        block = null;
      } else {
        block.content.push(raw);
      }
      return;
    }
    if (toggles === 1) {
      // opening triple comment; keep the code before it, then collect
      const idxTriple = raw.indexOf('```');
      let head = raw.slice(0, idxTriple);
      head = stripLineComment(head);
      inBacktick = true;
      block = { head, indent: indentLevelOf(raw), content: [] };
      if (head.trim().length === 0) return;
      raw = head;
    } else if (toggles === 2) {
      // inline ` ``` comment ``` ` pair on the same line -> /* comment */
      const i1 = raw.indexOf('```');
      const i2 = raw.indexOf('```', i1 + 3);
      const comment = raw.slice(i1 + 3, i2);
      const tail = raw.slice(i2 + 3);
      let head = stripLineComment(raw.slice(0, i1));
      const indent = indentLevelOf(raw);
      if (head.trim().length === 0 && tail.trim().length === 0) {
        out.push({
          text: `/*${comment}*/`,
          indent,
          lineNo,
          comment: true,
          tokens: [],
        });
        return;
      }
      // keep the comment as a trailing comment token so it survives into C++
      const tokens = tokenizeLine((head + ' ' + tail).trimStart());
      tokens.push({ type: TOKEN_TYPES.COMMENT, value: `/*${comment}*/` });
      out.push({ text: head + tail, indent, lineNo, tokens });
      return;
    } else {
      // `//` comments are now kept as comment tokens (C++-style) — the
      // code part still needs stripping for the code tokens below.
      raw = raw;
    }
    // a string-outside `/*` with no same-line `*/` opens a multi-line
    // block comment; keep the code before it, collect the rest later
    const cOpen = findC(raw, 0, false);
    if (cOpen >= 0 && findC(raw, cOpen + 2, true) < 0) {
      inCComm = true;
      cblock = {
        indent: indentLevelOf(raw),
        content: [raw.slice(cOpen + 2)],
      };
      raw = raw.slice(0, cOpen);
    }
    const indent = indentLevelOf(raw);
    const tokens = tokenizeLine(raw.trimStart());
    out.push({ text: raw, indent, lineNo, tokens });
  });
  return out;
}

/** Find position of first string-outside C block-comment marker at or
 *  after `from`: the open marker (slash-star) when close=false, the close
 *  marker (star-slash) when close=true. Returns -1 when absent. */
function findC(line, from, close) {
  const n = line.length;
  let i = from || 0;
  while (i < n) {
    const c = line[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && line[j] !== c) {
        if (line[j] === '\\') j++;
        j++;
      }
      i = Math.max(j + 1, i + 1);
      continue;
    }
    if (close) {
      if (c === '*' && line.charAt(i + 1) === '/' &&
          line.startsWith('*/', i)) return i;
    } else {
      if (c === '/' && line.charAt(i + 1) === '*' &&
          line.startsWith('/*', i)) return i;
    }
    i++;
  }
  return -1;
}

/** Count occurrences of the triple-backtick fence not inside strings
 *  or `//` line comments. */
function countTripleToggles(line) {
  let count = 0;
  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i];
    if (c === '`' && line.startsWith('```', i)) {
      count++;
      i += 3;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && line[j] !== c) {
        if (line[j] === '\\') j++;
        j++;
      }
      i = Math.max(j + 1, i + 1);
      continue;
    }
    if (c === '/' && line[i + 1] === '/') {
      return count;   // `//` comment: the rest of the line is not code
    }
    i++;
  }
  return count;
}

/** Drop a `//` line comment that is not inside a string. */
function stripLineComment(line) {
  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && line[j] !== c) {
        if (line[j] === '\\') j++;
        j++;
      }
      i = Math.max(j + 1, i + 1);
      continue;
    }
    if (c === '/' && line[i + 1] === '/') {
      return line.slice(0, i);
    }
    i++;
  }
  return line;
}

module.exports = { tokenizeLine, preprocess, indentLevelOf, TOKEN_TYPES };