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
  const stripSemi = (tokens) => {
    const t2 = [...tokens];
    while (t2.length && t2[t2.length - 1].value === ';') t2.pop();
    return t2;
  };

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
    const w0 = words(tokens);
    // a trailing `?` is a Python-style header terminator; a mid-expression
    // `?` is a ternary and must be kept
    const w = w0.length && lastOf(w0).value === '?' ? w0.slice(0, -1) : w0;
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
      case 'if': {
        // same-line `If cond Then stmt` (nested inside a `Then` body):
        // `While x < n Then If y < m Then Out ...;`
        const thenIdx = rest.findIndex((t) => t.value.toLowerCase() === 'then');
        const end = thenIdx >= 0 ? thenIdx : rest.length;
        const cond = rest.slice(0, end);
        const body = emitSingle(rest.slice(thenIdx >= 0 ? thenIdx + 1 : 0));
        const b = [body];
        b.inline = true;
        return { kind: 'if', cond, then: b, elifs: [], els: null };
      }
      case '{': {
        // same-line C++ block with False Code statements:
        // `if (x) { Return y; }` -> inner stmts converted
        let close = -1, depth = 0;
        for (let i = 0; i < w.length; i++) {
          if (w[i].value === '{') depth++;
          else if (w[i].value === '}') {
            depth--;
            if (depth === 0) { close = i; break; }
          }
        }
        if (close >= 0) {
          const inner = splitTopSemi(w.slice(1, close))
            .filter((g) => g.length).map((g) => emitSingle(g));
          inner.inline = true;
          return { kind: 'inlineCpp', head: [], inner, tail: stripSemi(w.slice(close + 1)) };
        }
        return { kind: 'stmt', tokens: w };
      }
      default: return { kind: 'stmt', tokens: w };
    }
  }

  // strip wrapping parentheses from a bare-expression token list
  function unparen(tokens) {
    const w = words(tokens);
    if (w.length && w[0].value === '(' && lastOf(w).value === ')') {
      // only strip when the first '(' closes exactly at the end —
      // `(A) && (B)` is NOT a wrapping pair, `(A && B)` is.
      let depth = 0, wrapsAll = true;
      for (let i = 0; i < w.length; i++) {
        if (w[i].value === '(') depth++;
        else if (w[i].value === ')') {
          depth--;
          if (depth === 0 && i !== w.length - 1) { wrapsAll = false; break; }
        }
      }
      if (wrapsAll) return w.slice(1, -1);
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
      // preprocessor lines (`#ifdef`/`#endif`/...) are usually flush-left even
      // inside indented blocks — don't let them end the block
      const w0 = words(l.tokens);
      if (w0.length && w0[0].value === '#') { pos++; parseLine(l, stmts); continue; }
      if (l.indent <= headerIndent) break;
      if (isCloseOnly(l)) { pos++; continue; }
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
    // do-while tail: `} While (cond);` after a `do {` block
    if (toks[0].value === '}' && toks[1] && toks[1].value.toLowerCase() === 'while') {
      stmts.push({ kind: 'dowhile', cond: stripSemi(toks.slice(2)) });
      return;
    }
    // preprocessor lines (#define, #include, ...) pass through verbatim
    if (toks[0].value === '#') {
      stmts.push({ kind: 'raw', text: l.text });
      return;
    }
    // template header lines pass through verbatim (adding `;` breaks them)
    if (toks[0].value === 'template') {
      stmts.push({ kind: 'raw', text: l.text });
      return;
    }
    switch (k) {
      case 'if':
      case 'elif': parseIf(line, stmts); return;
      case 'else': parseElse(line, stmts); return;
      case 'switch': parseSwitch(line, stmts); return;
      case 'case':
      case 'default': parseCase(line, stmts); return;
      case 'for': parseFor(line, stmts); return;
      case 'while': parseWhile(line, stmts); return;
      case 'do': parseDo(line, stmts); return;
      case 'def': parseDef(line, stmts); return;
      case 'struct':
      case 'class':
      case 'union': {
        // header line passes through verbatim; interior lines are parsed
        // as False Code (C++-style content still passes through as stmts)
        stmts.push({ kind: 'raw', text: l.text });
        let depth = 0;
        for (const t of l.tokens) {
          if (t.value === '{') depth++;
          else if (t.value === '}') depth--;
        }
        const braceDelta = (toks) => toks.reduce((d, t) =>
          t.value === '{' ? d + 1 : t.value === '}' ? d - 1 : d, 0);
        while (!atEnd() && depth > 0) {
          const n = peek();
          const d = braceDelta(n.tokens);
          if (depth + d <= 0) {
            // closing line (`};` / `}a[105];`) — pass through verbatim
            pos++;
            depth += d;
            stmts.push({ kind: 'raw', text: n.text });
            break;
          }
          if (isCloseOnly(n)) {
            // a `}` closing an inner block (e.g. a Def method body)
            pos++;
            depth += d;
            continue;
          }
          const start = pos;
          pos++;
          parseLine(n, stmts);
          // parseLine may consume several lines (block bodies); count the
          // braces of every line it consumed so depth stays accurate.
          for (let i = start; i < pos; i++) depth += braceDelta(lines[i].tokens);
        }
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
        // single-line C++ function / lambda / block whose `{...}` body sits
        // on the same line: `bool isEven(int x) { Return x % 2 == 0; };`,
        // `f = [](int x) -> int { Return x * x; };`
        // (a trailing `-> type` after the block means a False Code decl —
        // `arr = {1,2,3} -> int[3];` — leave it to stmtCpp)
        let braceIdx = -1, depth = 0;
        for (let i = 0; i < toks.length; i++) {
          const v = toks[i].value;
          if (v === '(' || v === '[') depth++;
          else if (v === ')' || v === ']') depth--;
          else if (v === '{' && depth === 0) { braceIdx = i; break; }
        }
        if (braceIdx >= 0) {
          let closeIdx = -1, depth = 0;
          for (let i = braceIdx; i < toks.length; i++) {
            if (toks[i].value === '{') depth++;
            else if (toks[i].value === '}') {
              depth--;
              if (depth === 0) { closeIdx = i; break; }
            }
          }
          const after = closeIdx >= 0 ? toks.slice(closeIdx + 1) : [];
          if (closeIdx >= 0 && !after.some((t) => t.value === '->')) {
            const inner = splitTopSemi(toks.slice(braceIdx + 1, closeIdx))
              .filter((g) => g.length).map((g) => emitSingle(g));
            inner.inline = true;
            stmts.push({
              kind: 'inlineCpp',
              head: toks.slice(0, braceIdx),
              inner,
              tail: stripSemi(after),
            });
            return;
          }
        }
        if (last && last.value === '{') {
          // brace-init list: `arr[2][3] = { ... };` / `rmap[...] = { ... };`
          // — pass the whole block through verbatim (C++ initializer)
          let eqDepth = 0, hasEq = false;
          for (const t of toks) {
            if (t.value === '(' || t.value === '[') eqDepth++;
            else if (t.value === ')' || t.value === ']') eqDepth--;
            else if (eqDepth === 0 && t.value === '=') { hasEq = true; break; }
          }
          if (hasEq) {
            const raw = [l.text];
            let depth = 1;
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
          // function/block form: `f() {` / `x = 1; { y = 2; }` + indented body
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
    const inlineHead = node.then.inline === true;
    while (!atEnd()) {
      const chainStart = pos;
      let n = peek();
      if (isCommentLine(n)) { pos++; continue; }
      // `} Else {` / `} Elif ...` on one line: the `}` closes the previous
      // branch, the rest is the next branch head
      const w0 = words(n.tokens);
      let consumed = false;
      if (w0.length > 1 && w0[0].value === '}') {
        if (inlineHead) break; // an inline `if (c) stmt;` has no block to close
        pos++;
        n = { tokens: w0.slice(1), indent: n.indent, lineNo: n.lineNo };
        consumed = true;
      } else if (isCloseOnly(n)) {
        if (inlineHead) break;
        pos++;
        continue;
      }
      const nk = kw(n);
      if (nk !== 'elif' && nk !== 'else') {
        // nothing of this if-chain followed; give the skipped lines back
        // (a bare `}` may be the enclosing block's closer, not ours)
        if (node.els === null && node.elifs.length === 0) pos = chainStart;
        break;
      }
      if (n.indent !== l.indent) {
        if (node.els === null && node.elifs.length === 0) pos = chainStart;
        break;
      }
      if (!consumed) pos++;
      if (nk === 'elif') {
        const e = read(n);
        const then = e.inline ? [e.inline] : readBlock(n.indent);
        then.inline = !!e.inline;
        node.elifs.push({ cond: e.cond, then });
      } else {
        // `else if (cond) stmt;` is an elif chain, not a final else
        const etoks = words(n.tokens).slice(1);
        if (etoks.length && etoks[0].value.toLowerCase() === 'if') {
          const e = read({ tokens: etoks, indent: n.indent, lineNo: n.lineNo });
          const then = e.inline ? [e.inline] : readBlock(n.indent);
          then.inline = !!e.inline;
          node.elifs.push({ cond: e.cond, then });
          continue;
        }
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
    // case labels may sit at the same indent as the switch header (C++ style)
    if (!body.some((n) => n.kind === 'case')) {
      while (!atEnd()) {
        const l2 = peek();
        const w0 = words(l2.tokens);
        const k0 = w0.length ? w0[0].value.toLowerCase() : '';
        if (l2.indent !== l.indent || (k0 !== 'case' && k0 !== 'else' && k0 !== 'default')) break;
        if (isCommentLine(l2)) { pos++; continue; }
        pos++;
        parseLine(l2, body);
      }
    }
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
      let colonIdx = -1, depth = 0;
      for (let i = 0; i < toks.length; i++) {
        const v = toks[i].value;
        if (v === '(' || v === '[') depth++;
        else if (v === ')' || v === ']') depth--;
        else if (v === ':' && depth === 0) { colonIdx = i; break; }
      }
      if (colonIdx >= 0 && colonIdx < toks.length - 1) {
        // `case 1: stmt;` — statement on the same line
        val = toks.slice(0, colonIdx);
        const b = [emitSingle(stripSemi(toks.slice(colonIdx + 1)))];
        b.inline = true;
        body = b;
      } else {
        val = toks.filter((t) => t.value !== '?' && t.value !== ':');
        body = readBlock(l.indent);
      }
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
      // an inline `Then` body ends the header: `For i=0; i<5; ++i; Then Out i;`
      const braceIdx = toks.findIndex((t) => t.value === '{');
      let thenIdx = -1, depth = 0;
      for (let i = 0; i < toks.length; i++) {
        const v = toks[i].value;
        if (v === '(' || v === '[') depth++;
        else if (v === ')' || v === ']') depth--;
        else if (depth === 0 && v.toLowerCase() === 'then') { thenIdx = i; break; }
      }
      const splitAt = braceIdx >= 0 ? braceIdx : (thenIdx >= 0 ? thenIdx : toks.length);
      const head = toks.slice(0, splitAt);
      parts = splitSemi(head);
      bodyTail = braceIdx >= 0 ? toks.slice(braceIdx) : (thenIdx >= 0 ? toks.slice(thenIdx) : []);
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

  function parseDo(l, stmts) {
    // forms:
    //   `do {` ... `} While cond;`     multi-line block + tail (dowhile node)
    //   `do Out 1; While false;`       single-line single statement
    //   `do { stmt; } While cond;`     single-line brace block
    const toks = words(l.tokens).slice(1);
    if (toks.length && toks[0].value === '{') {
      // brace block on the same line or following lines: `do {` / `do { x; }`
      const openIdx = toks.findIndex((t) => t.value === '{');
      const closeIdx = toks.findIndex((t) => t.value === '}');
      if (closeIdx > openIdx) {
        const b = splitTopSemi(toks.slice(openIdx + 1, closeIdx))
          .filter((g) => g.length)
          .map((g) => emitSingle(g));
        b.inline = true;
        let tail = toks.slice(closeIdx + 1);
        if (tail.length && tail[0].value.toLowerCase() === 'while') tail = tail.slice(1);
        stmts.push({ kind: 'do', body: b, cond: stripSemi(tail) });
        return;
      }
      stmts.push({ kind: 'do', body: readBlock(l.indent), cond: [] });
      return;
    }
    // single statement form: `do Out 1; While false;`
    // find the top-level `while` keyword (depth-aware)
    let depth = 0, wi = -1;
    for (let i = 0; i < toks.length; i++) {
      const v = toks[i].value;
      if (v === '(' || v === '[') depth++;
      else if (v === ')' || v === ']') depth--;
      else if (depth === 0 && v.toLowerCase() === 'while') { wi = i; break; }
    }
    const head = wi >= 0 ? toks.slice(0, wi) : toks;
    const tail = wi >= 0 ? toks.slice(wi + 1) : [];
    const b = splitTopSemi(head).filter((g) => g.length).map((g) => emitSingle(g));
    b.inline = true;
    stmts.push({ kind: 'do', body: b, cond: stripSemi(tail) });
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
        const ltIdx = g.findIndex((t) => t.value === '<' || t.value === '<<');
        const annIdx = g.findIndex((t) => t.value === '->');
        let cut = g.length;
        if (annIdx >= 0) cut = annIdx;
        if (arrIdx >= 0 && arrIdx < cut) cut = arrIdx;
        if (ltIdx >= 0 && ltIdx < cut) cut = ltIdx;
        const size = arrIdx >= 0
          ? toText(g.slice(arrIdx + 1, g.findIndex((t) => t.value === ']')))
          : '';
        let nesting = 0;
        if (ltIdx >= 0) {
          const flat = g.slice(ltIdx, annIdx >= 0 ? annIdx : g.length)
            .flatMap((t) => t.value === '<<' ? ['<', '<'] : t.value === '>>' ? ['>', '>'] : [t.value]);
          nesting = flat.filter((v) => v === '<').length;
        }
        let name, type;
        if (annIdx >= 0) {
          type = toText(g.slice(annIdx + 1));
          name = g.slice(0, cut).map((t) => t.value).join('');
        } else {
          // C++-style prefix params: `Vec o`, `int a[]`, `Node* p`, `const Big& b`
          let nameIdx = -1;
          for (let i = g.length - 1; i >= 0; i--) {
            if (g[i].type === 'word') { nameIdx = i; break; }
          }
          if (nameIdx > 0) {
            name = g[nameIdx].value;
            type = toText(g.slice(0, nameIdx));
          } else {
            name = g.slice(0, cut).map((t) => t.value).join('');
            type = '';
          }
        }
        return {
          name,
          array: arrIdx >= 0,
          size,
          nesting,
          type,
        };
      });
    // remaining header tokens: possibly `-> RetType`, then `{`/`:`/`?`
    // a trailing `;` means a pure forward declaration (`def g() -> int;`)
    let ret = [];
    let h = tail;
    let declareOnly = false;
    if (h.length && h[h.length - 1].value === ';') {
      declareOnly = true;
      h = h.slice(0, -1);
    }
    while (h.length && !['{', ':', '?'].includes(h[0].value)) {
      const t = h.shift();
      if (t.value === '->') continue;
      ret.push(t);
    }
    let body = null;
    if (!declareOnly) {
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
      const w2 = w.slice(0, end);
      // C++-style inline: `if (cond) stmt;` — first `(` ... `)` pair is the
      // condition, the rest is a single statement ending in `;`.
      if (w2.length && w2[0].value === '(') {
        const { inner, tail } = parenSplit(w2);
        if (tail.length && lastOf(tail).value === ';') {
          cond = inner;
          inline = emitSingle(stripSemi(tail));
          return { cond, inline };
        }
      }
      cond = unparen(w2);
    }
    return { cond, inline };
  }

  return readTop();
}

module.exports = { parse };