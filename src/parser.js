const { preprocess } = require('./lexer.js');

// =====================================================================
// False Code -> AST parser.
//
// The language is indentation-driven (like Python) with optional `{`...
// `}` blocks.  All "simple" statements keep their raw token array; the
// generator performs every C++ rewrite step.
//
// AST node kinds:
//   {kind:'def', name, params:[{name,array,type}], ret:[tokens], body:[stmts]}
//   {kind:'if', cond:[tokens], then:[stmts], elifs:[{cond,body}], els:{block}|null}
//   {kind:'switch', cond:[tokens], body:[case-cross]}
//   {kind:'case', val:[tokens], body:[stmts]}     (only valid inside switch body)
//   {kind:'for', init:[tokens], cond:[tokens], step:[tokens], body:[stmts]}
//   {kind:'while', cond:[tokens], body:[stmts]}
//   {kind:'block', stmts:[stmts]}
//   {kind:'stmt', tokens:[tokens], body?:[stmts]}   // raw statement + optional brace body
//   {kind:'return', tokens:[tokens]} | {kind:'out', args:[tokens]} | {kind:'input', tokens:[tokens]}
//   {kind:'break'} | {kind:'continue'} | {kind:'empty'}   // empty == Die
// =====================================================================

function parse(sourceText) {
  const lines = preprocess(sourceText);
  let pos = 0;

  const peek = () => lines[pos];
  const atEnd = () => pos >= lines.length;
  const err = (msg, line) => { throw new Error(`[line ${line ? line.lineNo : '?'}] ${msg}`); };

  // Validate delimiter pairing (`()`, `[]`, `{}`) before parsing. String /
  // char / comment contents are skipped, so unbalanced delimiters inside
  // literals don't false-positive.
  (function checkDelimiters() {
    const open = { '(': ')', '[': ']', '{': '}' };
    const stack = [];  // {ch, icon}
    for (const l of lines) {
      for (const t of l.tokens) {
        if (t.type === 'comment' || t.type === 'triquote' ||
            t.type === 'str' || t.type === 'chr') continue;
        const v = t.value;
        if (open[v]) stack.push({ ch: v, lineNo: l.lineNo });
        else if (v === ')' || v === ']' || v === '}') {
          const last = stack[stack.length - 1];
          if (!last) throw err(`unexpected '${v}' with no matching '${parentOpen(v)}'`, l);
          const expect = open[last.ch];
          if (expect !== v) {
            throw err(`mismatched '${v}': expected '${expect}' to close '${last.ch}' (opened line ${last.lineNo})`, l);
          }
          stack.pop();
        }
      }
    }
    if (stack.length) {
      const last = stack[stack.length - 1];
      throw err(`unclosed '${last.ch}' (opened line ${last.lineNo})`, last);
    }
    function parentOpen(closer) {
      return closer === ')' ? '(' : closer === ']' ? '[' : '{';
    }
  })();

  // ---- small token helpers -------------------------------------------
  const words = (tokens) => tokens.filter((t) => t.type !== 'comment');
  const stripSemi = (tokens) => tokens.filter((t) => t.value !== ';');

  function keywordOf(tokens) {
    const w = words(tokens);
    return w.length ? w[0].value.toLowerCase() : null;
  }

  function isCommentLine(l) {
    return l.tokens.length === 0 ||
      l.tokens.every((t) => t.type === 'comment' || t.type === 'triquote');
  }

  function isCloseOnly(l) {
    const w = words(l.tokens);
    return w.length > 0 && w.every((t) => t.value === '}');
  }

  function hasOpen(l) {
    return words(l.tokens).some((t) => t.value === '{');
  }

  function hasClose(l) {
    return words(l.tokens).some((t) => t.value === '}');
  }

  function lastToken(tokens) {
    return tokens.length ? tokens[tokens.length - 1] : null;
  }

  function splitComma(tokens) {
    const out = [[]];
    for (const t of tokens) {
      if (t.value === ',') out.push([]);
      else out[out.length - 1].push(t);
    }
    return out;
  }

  function splitSemi(tokens) {
    const out = [[]];
    for (const t of tokens) {
      if (t.value === ';') out.push([]);
      else out[out.length - 1].push(t);
    }
    return out;
  }

  // content between the first '(' and its matching `)`, and everything after
  function parenSplit(tokens) {
    let depth = 0, start = -1, end = -1;
    for (let i = 0; i < tokens.length; i++) {
      const v = tokens[i].value;
      if (v === '(') { if (depth === 0) start = i; depth++; }
      else if (v === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (start < 0 || end < start) return { inner: [], tail: tokens };
    return { inner: tokens.slice(start + 1, end), tail: tokens.slice(end + 1) };
  }

  // turn a token slice into a standalone statement node (inline `Then`)
  function emitSingle(tokens) {
    const w = words(tokens).filter((t) => t.value !== '?');
    if (!w.length) return { kind: 'empty' };
    const k = w[0].value.toLowerCase();
    const rest = w.slice(1);
    if (k === 'then') return emitSingle(rest);
    switch (k) {
      case 'break': return { kind: 'break' };
      case 'continue': return { kind: 'continue' };
      case 'die':
      case 'pass': return { kind: 'empty' };
      case 'return': return { kind: 'return', tokens: rest };
      case 'out':
      case 'output': return { kind: 'out', tokens: rest };
      case 'input': return { kind: 'input', tokens: rest };
      default: return { kind: 'stmt', tokens: w };
    }
  }

  // strip wrapping parentheses from a bare-expression token list
  function unparen(tokens) {
    const w = words(tokens);
    if (w.length && w[0].value === '(' && lastOf(w).value === ')') {
      return w.slice(1, -1);
    }
    return w;
  }

  function readCondition(line) {
    // tokens after keyword
    let toks = words(line.tokens).slice(1);
    let end = toks.length;
    if (end && lastOf(toks).value === '?') end--;   // `?`-terminated header
    // look for a top-level `then`
    let depth = 0, thenIdx = -1;
    for (let i = 0; i < end; i++) {
      const v = toks[i].value;
      if (v === '(' || v === '[') depth++;
      else if (v === ')' || v === ']') depth--;
      else if (depth === 0 && v.toLowerCase() === 'then') { thenIdx = i; break; }
    }
    if (thenIdx >= 0) {
      return {
        cond: unparen(toks.slice(0, thenIdx)),
        inline: emitSingle(toks.slice(thenIdx + 1)),
      };
    }
    return { cond: unparen(toks.slice(0, end)), inline: null };
  }

  // ---------------- core block readers --------------------------------

  function readBlock(headerIndent) {
    const stmts = [];
    while (!atEnd()) {
      const l = peek();
      if (isCommentLine(l)) { pos++; continue; }
      if (isCloseOnly(l)) { pos++; continue; }
      if (l.indent <= headerIndent) break;
      pos++;
      parseLine(l, stmts);
    }
    return stmts;
  }

  function readTop() {
    const stmts = [];
    while (!atEnd()) {
      const l = peek();
      if (isCommentLine(l)) { pos++; continue; }
      if (isCloseOnly(l)) { pos++; continue; }
      pos++;
      parseLine(l, stmts);
    }
    return stmts;
  }

  // parse a single physical line into AST. `l` was consumed already.
  function parseLine(l, stmts) {
    let toks = words(l.tokens);
    if (!toks.length) return;
    // body lines may begin with `Then` (spec examples) — drop it
    if (toks[0].value.toLowerCase() === 'then') {
      toks = toks.slice(1);
      if (!toks.length) return;
    }
    const k = toks[0].value.toLowerCase();
    const line = { tokens: toks, indent: l.indent, lineNo: l.lineNo };
    // preprocessor lines (#define, #include, ...) pass through verbatim
    if (toks[0].value === '#') {
      stmts.push({ kind: 'raw', text: l.text });
      return;
    }
    switch (k) {
      case 'if':
      case 'elif': parseIf(line, stmts); return;
      case 'else': parseElse(line, stmts); return;
      case 'switch': parseSwitch(line, stmts); return;
      case 'case': parseCase(line, stmts); return;
      case 'for': parseFor(line, stmts); return;
      case 'while': parseWhile(line, stmts); return;
      case 'def': parseDef(line, stmts); return;
      case 'struct':
      case 'class':
      case 'union': {
        // pass the whole brace block through verbatim (C++ struct/class)
        const raw = [l.text];
        let depth = 0;
        for (const t of l.tokens) {
          if (t.value === '{') depth++;
          else if (t.value === '}') depth--;
        }
        while (!atEnd() && depth > 0) {
          const n = peek();
          pos++;
          raw.push(n.text);
          for (const t of n.tokens) {
            if (t.value === '{') depth++;
            else if (t.value === '}') depth--;
          }
        }
        stmts.push({ kind: 'raw', text: raw.join('\n') });
        return;
      }
      case 'return': stmts.push({ kind: 'return', tokens: stripSemi(toks.slice(1)) }); return;
      case 'out':
      case 'output': stmts.push({ kind: 'out', tokens: stripSemi(toks.slice(1)) }); return;
      case 'input':
      case 'in': stmts.push({ kind: 'input', tokens: stripSemi(toks.slice(1)) }); return;
      case 'break': stmts.push({ kind: 'break' }); return;
      case 'continue': stmts.push({ kind: 'continue' }); return;
      case 'die':
      case 'pass': stmts.push({ kind: 'empty' }); return;
      default: {
        const last = lastOf(toks);
        if (last && (last.value === '{' || last.value === '}')) {
          // trailing `{`/`}` only: `x = 1; { y = 2; }` or `f() {` + indented body
          const head = stripSemi(toks).filter((t) => t.value !== '{' && t.value !== '}');
          stmts.push({ kind: 'stmt', tokens: head, body: last.value === '}' ? [] : readBlock(line.indent) });
        } else {
          stmts.push({ kind: 'stmt', tokens: stripSemi(toks) });
        }
      }
    }
  }

  // ---------------------------- If / Elif / Else ---------------------
  function parseIf(l, stmts) {
    const c = read(l);
    const node = { kind: 'if', cond: c.cond, then: null, elifs: [], els: null };
    if (c.inline) {
      node.then = [c.inline];
      node.then.inline = true;
    } else {
      node.then = readBlock(l.indent);
      node.then.inline = false;
    }
    // chain elif / else at the same indent
    while (!atEnd()) {
      const n = peek();
      if (isCommentLine(n)) { pos++; continue; }
      const nk = kw(n);
      if (nk !== 'elif' && nk !== 'else') break;
      if (n.indent !== l.indent) break;
      pos++;
      if (nk === 'elif') {
        const e = read(n);
        const then = e.inline ? [e.inline] : readBlock(n.indent);
        then.inline = !!e.inline;
        node.elifs.push({ cond: e.cond, then });
      } else {
        node.els = parseElseBody(n);
      }
    }
    stmts.push(node);
  }

  function parseElse(l, stmts) {
    stmts.push({ kind: 'if', cond: null, then: [], elifs: [], els: parseElseBody(l) });
  }

  function parseElseBody(l) {
    let toks = words(l.tokens).slice(1);
    const stmts = [];
    if (!toks.length || hasAny('{', toks) || (lastOf(toks) && lastOf(toks).value === '?')) {
      const b = readBlock(l.indent);
      b.inline = false;
      return { kind: 'block', stmts: b };
    }
    if (toks[0].value.toLowerCase() === 'then') {
      const b = [emitSingle(toks.slice(1))];
      b.inline = true;
      return { kind: 'block', stmts: b };
    }
    const b2 = [emitSingle(toks)];
    b2.inline = true;
    return { kind: 'block', stmts: b2 };
  }

  // ---------------------------- Switch / Case ------------------------
  function parseSwitch(l, stmts) {
    const toks = words(l.tokens).slice(1).filter((t) => t.value !== '{');
    let body = readBlock(l.indent);
    // an `Else` inside a switch means `default:`; it parses as an
    // `{kind:'if', cond:null, els:{...}}` — convert that here.
    body = body.map((n) => {
      if (n.kind === 'if' && n.cond === null && n.els) {
        return { kind: 'case', val: null, body: n.els.stmts };
      }
      return n;
    });
    stmts.push({ kind: 'switch', cond: toks, body });
  }

  function parseCase(l, stmts) {
    const toks = words(l.tokens).slice(1);
    let thenIdx = toks.findIndex((t) => t.value.toLowerCase() === 'then');
    let val, body;
    if (thenIdx >= 0) {
      val = toks.slice(0, thenIdx).filter((t) => t.value !== '?');
      body = [emitSingle(toks.slice(thenIdx + 1))];
    } else {
      val = toks.filter((t) => t.value !== '?');
      body = readBlock(l.indent);
    }
    stmts.push({ kind: 'case', val, body });
  }

  // ---------------------------- For / While --------------------------
  function parseFor(l, stmts) {
    let toks = words(l.tokens).slice(1);
    let parts, bodyTail;
    if (toks.length && toks[0].value === '(') {
      // parenthesized C-style header: `For (i = 0 -> int; i < 4; ++i) {`
      const { inner, tail } = parenSplit(toks);
      parts = splitSemi(inner);
      bodyTail = tail;
    } else {
      // bare header (no leading parentheses):
      // `For i = f(1); i < 5; ++i {` — parens may still appear in calls
      const braceIdx = toks.findIndex((t) => t.value === '{');
      const head = braceIdx >= 0 ? toks.slice(0, braceIdx) : toks;
      parts = splitSemi(head);
      bodyTail = braceIdx >= 0 ? toks.slice(braceIdx) : [];
    }
    const node = {
      kind: 'for',
      init: parts[0] || [],
      cond: parts[1] || [],
      step: parts[2] || [],
      body: parseLoopBody(l, bodyTail),
    };
    stmts.push(node);
  }

  function parseWhile(l, stmts) {
    const toks = words(l.tokens).slice(1);
    let cond, bodyTail;
    if (toks.length && toks[0].value === '(') {
      // parenthesized: `While (x < n) {` / `While (true)`
      const { inner, tail } = parenSplit(toks);
      cond = inner;
      bodyTail = tail;
    } else {
      // bare: `while x < n {` / `while true` / `while f(x) < n {`
      const stop = toks.findIndex((t) =>
        t.value === '{' || t.value === '?' ||
        t.value.toLowerCase() === 'then');
      const end = stop >= 0 ? stop : toks.length;
      cond = toks.slice(0, end);
      bodyTail = stop >= 0 ? toks.slice(stop) : [];
    }
    stmts.push({ kind: 'while', cond, body: parseLoopBody(l, bodyTail) });
  }

  // For/While body: `{...}` (same line) -> brace block;
  // `Then <stmt>` -> single; otherwise read a following `Then`-line.
  function parseLoopBody(l, tail) {
    const openIdx = tail.findIndex((t) => t.value === '{');
    if (openIdx >= 0) {
      const closeIdx = tail.findIndex((t) => t.value === '}');
      if (closeIdx > openIdx) {
        // same-line `{ stmt; stmt; }` block
        const b = splitTopSemi(tail.slice(openIdx + 1, closeIdx))
          .filter((g) => g.length)
          .map((g) => emitSingle(g));
        b.inline = true;
        return b;
      }
      const b = readBlock(l.indent);
      b.inline = false;
      return b;
    }
    if (tail.length && tail[0].value === '?') {
      const b = readBlock(l.indent);
      b.inline = false;
      return b;
    }
    if (tail.length && tail[0].value.toLowerCase() === 'then') {
      const b = [emitSingle(tail.slice(1))];
      b.inline = true;
      return b;
    }
    if (tail.length) {
      const b = [emitSingle(tail)];   // e.g. `while(x) stmt;`
      b.inline = true;
      return b;
    }
    // look ahead: a `Then ...` line directly following at >= our indent
    if (!atEnd()) {
      const n = peek();
      if (kw(n) === 'then') {
        pos++;
        const rest = words(n.tokens).slice(1);
        const b = [emitSingle(rest)];
        b.inline = true;
        return b;
      }
    }
    return [];
  }

  // ---------------------------- Def ----------------------------------
  function parseDef(l, stmts) {
    let toks = words(l.tokens).slice(1);
    const name = toks.shift().value;
    const { inner, tail } = parenSplit(toks);
    const params = splitComma(inner)
      .filter((g) => g.length)
      .map((g) => {
        const arrIdx = g.findIndex((t) => t.value === '[');
        const annIdx = g.findIndex((t) => t.value === '->');
        let cut = g.length;
        if (annIdx >= 0) cut = annIdx;
        if (arrIdx >= 0 && arrIdx < cut) cut = arrIdx;
        const size = arrIdx >= 0
          ? toText(g.slice(arrIdx + 1, g.findIndex((t) => t.value === ']')))
          : '';
        return {
          name: g.slice(0, cut).map((t) => t.value).join(''),
          array: arrIdx >= 0,
          size,
          type: annIdx >= 0 ? toText(g.slice(annIdx + 1)) : '',
        };
      });
    // remaining header tokens: possibly `-> RetType`, then `{`/`:`/`?`
    let ret = [];
    let h = tail;
    while (h.length && !['{', ':', '?'].includes(h[0].value)) {
      const t = h.shift();
      if (t.value === '->') continue;
      ret.push(t);
    }
    let body;
    if (h.length && h[0].value === '{') {
      // inline body on the same line: `def f(...) { stmt; stmt; }`
      // (a lone `{` or `{ }` means the body follows on indented lines)
      let inner = h.slice(1);
      const last = inner[inner.length - 1];
      if (last && last.value === '}') inner = inner.slice(0, -1);
      if (inner.some((t) => t.value !== ';')) {
        body = splitTopSemi(inner)
          .filter((g) => g.length)
          .map((g) => emitSingle(g));
      } else {
        body = readBlock(l.indent);
      }
    } else {
      body = readBlock(l.indent);
    }
    stmts.push({ kind: 'def', name, params, ret, body });
  }

  // ---------------------------- misc ---------------------------------
  function toText(tokens) { return tokens.map((t) => t.value).join(' '); }

  // split on top-level `;` (not inside (), [], {})
  function splitTopSemi(tokens) {
    const out = [[]];
    let depth = 0;
    for (const t of tokens) {
      if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
      if (t.value === ')' || t.value === ']' || t.value === '}') depth--;
      if (t.value === ';' && depth === 0) out.push([]);
      else out[out.length - 1].push(t);
    }
    if (out[out.length - 1].length === 0 && out.length > 1) out.pop();
    return out;
  }

  const lastOf = (arr) => arr[arr.length - 1];
  const hasAny = (v, arr) => arr.some((t) => t.value === v);
  const kw = (l) => keywordOf(words(l.tokens));

  // used by read() / parseIf above
  function read(line) {
    return readConditionOf(line);
  }
  function readConditionOf(line) {
    let w = words(line.tokens).slice(1);
    let end = w.length;
    if (end && (lastOf(w).value === '?' || lastOf(w).value === '{')) end--;
    let depth = 0, thenIdx = -1;
    for (let i = 0; i < end; i++) {
      const v = w[i].value;
      if (v === '(' || v === '[') depth++;
      else if (v === ')' || v === ']') depth--;
      else if (depth === 0 && v.toLowerCase() === 'then') { thenIdx = i; break; }
    }
    let cond, inline = null;
    if (thenIdx >= 0) {
      let condToks = w.slice(0, thenIdx);
      // a `?` before `Then` is the header terminator, not a ternary
      if (condToks.length && lastOf(condToks).value === '?') {
        condToks = condToks.slice(0, -1);
      }
      cond = unparen(condToks);
      inline = emitSingle(w.slice(thenIdx + 1));
    } else {
      cond = unparen(w.slice(0, end));
    }
    return { cond, inline };
  }

  return readTop();
}

module.exports = { parse };