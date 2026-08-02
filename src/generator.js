// =====================================================================
// False Code -> C++ generator.
//
// This is where the semantically special tokens become C++:
//   ^^ / ^^=  -> pow()
//   ##        -> set-to-zero
//   ~=        -> bitwise NOT
//   .add()/.remove()/.len       -> vector interface
//   attr `x = v -> T`, `x -> T`, `x[] -> T`, `x[N] -> T` -> declarations
// =====================================================================

const HEADER = `#include <bits/stdc++.h>
using namespace std;`;

function gen(ast) {
  const lines = [];
  const emit = (s = '') => lines.push(s);
  const pad = (n) => '  '.repeat(n);

  // Record declared array shapes so statements like `i##;` can know
  // whether a name is a fixed C array, a vector, or a scalar.
  const arrays = new Map();

  // ---------------------------------------------------------------
  // token -> text with sane spacing (string/char literals masked so the
  // spacing rules never rewrite inside them)
  function toText(tokens) {
    const strs = [];
    let s = tokens.map((t) => t.value).join(' ');
    s = s.replace(/(["'])(?:\\.|(?!\1).)*\1/g, (m) => {
      strs.push(m);
      return `\u0000${strs.length - 1}\u0000`;
    });
    s = s.replace(/\s+/g, ' ');
    s = s.replace(/([\(\[])\s+/g, '$1');
    s = s.replace(/\s+([\)\]\}])/g, '$1');
    s = s.replace(/\s*([,;])\s*/g, '$1 ');
    // remove spaces around dot accessors
    s = s.replace(/\s*\.\s*/g, '.');
    s = s.replace(/\s*::\s*/g, '::');
    // tighten array subscripts: c [ 0 ] -> c[0]
    s = s.replace(/(\S)\s+\[/g, '$1[');
    s = s.replace(/\[\s+/g, '[');
    s = s.replace(/\s+\]/g, ']');
    for (let i = 0; i < strs.length; i++) {
      s = s.split(`\u0000${i}\u0000`).join(strs[i]);
    }
    return s.trim();
  }

  function exp(tokens) {
    let s = toText(tokens);
    // Protect string/char literals from operator rewrites below.
    const strs = [];
    s = s.replace(/(["'])(?:\\.|(?!\1).)*\1/g, (m) => {
      strs.push(m);
      return `\u0000${strs.length - 1}\u0000`;
    });
    s = s.replace(/\.add\s*\(/g, '.push_back(');
    // `.remove(...)` -> `.pop_back()` (drop args, incl. nested parens)
    s = s.replace(/\.remove\s*\(/g, '\u0001');
    s = dropParenArgs(s);
    s = s.replace(/\.len\b/g, '.size()');
    // power infix: `a ^^ b`, `(a+1) ^^ 2` -> `pow(...)`
    s = convertPower(s);
    // set-to-zero `##`: `## x` -> `(x = 0)`, `x ##` -> `(x = 0)`
    s = s.replace(/\s*##\s*([A-Za-z_][\w\.\[\]]*)/g, '($1 = 0)');
    s = s.replace(/([A-Za-z_][\w\.\[\]]*)\s+##/g, '($1 = 0)');
    for (let i = 0; i < strs.length; i++) {
      s = s.split(`\u0000${i}\u0000`).join(strs[i]);
    }
    return s.trim();
  }

  // drop everything from each `\u0001` marker through its matching `)`
  function dropParenArgs(s) {
    let out = '';
    let i = 0;
    while (i < s.length) {
      if (s[i] === '\u0001') {
        let depth = 1;
        i++;
        while (i < s.length && depth > 0) {
          if (s[i] === '(') depth++;
          else if (s[i] === ')') depth--;
          i++;
        }
        out += '.pop_back()';
      } else {
        out += s[i];
        i++;
      }
    }
    return out;
  }

  // balanced-paren aware `LHS ^^ RHS` -> `pow(LHS, RHS)`
  function scanOperandStart(s, j) {
    let i = j;
    if (s[i] === ')') {
      let depth = 0;
      do {
        if (s[i] === ')') depth++;
        else if (s[i] === '(') depth--;
        i--;
      } while (i >= 0 && depth > 0);
      return i + 1;
    }
    if (s[i] === ']') {
      let depth = 0;
      do {
        if (s[i] === ']') depth++;
        else if (s[i] === '[') depth--;
        i--;
      } while (i >= 0 && depth > 0);
      return i + 1;
    }
    while (i >= 0 && /[\w\.]/.test(s[i])) i--;
    return i + 1;
  }

  function scanOperandEnd(s, k) {
    let j = k;
    if (s[j] === '(') {
      let depth = 0;
      do {
        if (s[j] === '(') depth++;
        else if (s[j] === ')') depth--;
        j++;
      } while (j < s.length && depth > 0);
      return j - 1;
    }
    if (s[j] === '[') {
      let depth = 0;
      do {
        if (s[j] === '[') depth++;
        else if (s[j] === ']') depth--;
        j++;
      } while (j < s.length && depth > 0);
      return j - 1;
    }
    while (j < s.length && /[\w\.]/.test(s[j])) j++;
    // swallow immediately-following call/subscript groups: `f(x)`, `arr[i]`
    while (j < s.length && (s[j] === '(' || s[j] === '[')) {
      const open = s[j];
      const close = open === '(' ? ')' : ']';
      let depth = 0;
      do {
        if (s[j] === open) depth++;
        else if (s[j] === close) depth--;
        j++;
      } while (j < s.length && depth > 0);
    }
    return j - 1;
  }

  function convertPower(s) {
    const positions = [];
    for (let i = 0; i + 1 < s.length; i++) {
      if (s[i] === '^' && s[i + 1] === '^' && s[i + 2] !== '=') {
        positions.push(i);
      }
    }
    // replace right-to-left so earlier positions stay valid
    for (let idx = positions.length - 1; idx >= 0; idx--) {
      const i = positions[idx];
      if (!(s[i] === '^' && s[i + 1] === '^')) continue;
      let j = i - 1;
      while (j >= 0 && s[j] === ' ') j--;
      let k = i + 2;
      while (k < s.length && s[k] === ' ') k++;
      const lhsStart = j >= 0 ? scanOperandStart(s, j) : -1;
      const rhsEnd = k < s.length ? scanOperandEnd(s, k) : -1;
      if (lhsStart >= 0 && lhsStart <= j && rhsEnd >= k) {
        s = s.slice(0, lhsStart) +
          `pow(${s.slice(lhsStart, j + 1)}, ${s.slice(k, rhsEnd + 1)})` +
          s.slice(rhsEnd + 1);
      }
    }
    return s;
  }

  // raw transcription without expression rewrites
  const expTo = (tokens) =>
    (tokens || []).filter((t) => t.value !== ';')
      .map((t) => t.value).join(' ');

  // a `?` only ever appears as a trailing line suffix (If/While/Case);
  // keep any other `?` (e.g. ternary) intact
  function squeezeSemi(tokens) {
    const t2 = tokens.filter((t) => t.value !== ';');
    if (t2.length && t2[t2.length - 1].value === '?') t2.pop();
    return t2;
  }

  function expNoSemi(tokens) {
    return exp(squeezeSemi(tokens));
  }

  // ---------------------------------------------------------------
  //  Statement-level translation (assignment / declaration / custom ops)
  const TYPE_WORD = /^(int|long|short|char|float|double|bool|void|string|auto|unsigned|signed|size_t|ll|ull|u?int(8|16|32|64)_t|__int128|long\s+long|unsigned\s+(char|short|int|long|long\s+long)(\s+int)?|signed\s+(char|short|int|long|long\s+long)(\s+int)?)$/i;

  // normalize abbreviated type words to real C++ types
  function typeCpp(s) {
    return (s || '').replace(/\bull\b/gi, 'unsigned long long')
      .replace(/\bll\b/gi, 'long long');
  }

  function stmtCpp(tokens) {
    // a declaration LHS must be exactly one identifier token:
    // `a[] -> T;`, `x = v -> T;`, `p = &y -> int*;`. Anything else
    // (e.g. C-style prefix `int a[][] -> int;`) is an error, not noise.
    const declName = (slice) => {
      const w = slice.filter((t) => t.type === 'word');
      if (slice.length !== 1 || w.length !== 1) {
        throw new Error(`invalid declaration name '${slice.map((t) => t.value).join('')}': use 'name = value -> type;' or 'name -> type;'`);
      }
      return w[0].value;
    };

    // `->` is a False Code type annotation only when followed by a type
    // keyword (pointers `int*` allowed); otherwise it is plain C++ member
    // access (`p->x`).
    const annIdx = tokens.findIndex((t, i) =>
      t.value === '->' && TYPE_WORD.test(tokens.slice(i + 1)
        .filter((x) => x.value !== '[' && x.value !== ']' && x.value !== '*')
        .map((x) => x.value).join(' ')));
    const eqIdx = tokens.findIndex((t) => t.value === '=');

    // -------- declarations (annotation present) --------
    if (annIdx >= 0) {
      const typeTok = tokens.slice(annIdx + 1);
      const typeText2 = typeTok.filter((t) => t.value !== '[' && t.value !== ']')
        .map((t) => t.value).join(' ');

      // open or sized array: `a[] -> T` / `a[N] -> T` / `a[N][M] -> T`
      // (the `[` must be part of the declarator — before `=`, so `x = a[0] -> T;` stays scalar)
      const arrIdx = tokens.findIndex((t) => t.value === '[');
      if (arrIdx >= 0 && (eqIdx < 0 || arrIdx < eqIdx)) {
        const name = declName(tokens.slice(0, arrIdx));
        // collect every dimension pair: `a[2][3]` -> sizes ['2','3']
        const dims = [];
        let ti = arrIdx;
        while (ti < tokens.length && tokens[ti].value === '[') {
          let depth = 0;
          let close = -1;
          for (let k = ti; k < tokens.length; k++) {
            if (tokens[k].value === '[') depth++;
            else if (tokens[k].value === ']') {
              depth--;
              if (depth === 0) { close = k; break; }
            }
          }
          if (close < 0) break;
          dims.push(tokens.slice(ti + 1, close));
          ti = close + 1;
        }
        const allSizes = dims.map((d) => expNoSemi(d));
        const openDim = dims.some((d) => d.length === 0);
        if (openDim) {
          // open dimension: `v[]` -> vector, `v[][]` -> vector<vector<...>>
          arrays.set(name, { kind: 'vector' });
          if (eqIdx >= 0 && eqIdx < annIdx) {
            throw new Error(`dynamic array '${name}[]' cannot take an initializer ('= ${expNoSemi(tokens.slice(eqIdx + 1, annIdx))}')`);
          }
          const openCount = dims.filter((d) => d.length === 0).length;
          return `${'vector<'.repeat(openCount)}${typeCpp(typeText2)}${'>'.repeat(openCount)} ${name};`;
        }
        arrays.set(name, { kind: 'fixed' });
        const sizeSuffix = allSizes.map((s) => `[${s}]`).join('');
        // `i[10]=0->int;` -> `int i[10] = {0};`
        if (eqIdx >= 0 && eqIdx < annIdx) {
          const initVal = expNoSemi(tokens.slice(eqIdx + 1, annIdx));
          return `${typeCpp(typeText2)} ${name}${sizeSuffix} = {${initVal}};`;
        }
        return `${typeCpp(typeText2)} ${name}${sizeSuffix};`;
      }

      // `x = value -> T`
      if (eqIdx >= 0 && eqIdx < annIdx) {
        const lhs = declName(tokens.slice(0, eqIdx));
        const val = expNoSemi(tokens.slice(eqIdx + 1, annIdx));
        arrays.delete(lhs);
        return `${typeCpp(typeText2)} ${lhs} = ${val};`;
      }
      // `x -> T`
      const lhs = declName(tokens.slice(0, annIdx));
      arrays.delete(lhs);
      return `${typeCpp(typeText2)} ${lhs};`;
    }

    // -------- custom single operators --------
    const powEq = tokens.findIndex((t) => t.value === '^^=');
    if (powEq >= 0) {
      const lhs = tokens.slice(0, powEq).map((t) => t.value).join('');
      const rhs = expNoSemi(tokens.slice(powEq + 1));
      return `${lhs} = pow(${lhs}, ${rhs});`;
    }
    const notEq = tokens.findIndex((t) => t.value === '~=');
    if (notEq >= 0) {
      const lhs = tokens.slice(0, notEq).map((t) => t.value).join('');
      const rhs = expNoSemi(tokens.slice(notEq + 1));
      if (rhs) return `${lhs} = ~(${rhs});`;
      return `${lhs} = ~(${lhs});`;
    }
    // set-to-zero operator `##`  (no backslash prefix needed)
    const zeroIdx = tokens.findIndex((t) => t.value === '##');
    if (zeroIdx >= 0 && isPureLvalueCtx(tokens, zeroIdx)) {
      if (zeroIdx === 0) {
        // prefix form: `##i` -> `i = 0;`  (analogous to `++i` / `--i`)
        const rhs = expNoSemi(tokens.slice(1));
        const info = arrays.get(rhs);
        if (info && info.kind === 'fixed') return `memset(${rhs}, 0, sizeof(${rhs}));`;
        if (info && info.kind === 'vector') return `${rhs}.assign(${rhs}.size(), 0);`;
        return `${rhs} = 0;`;
      }
      const lhs = tokens.slice(0, zeroIdx).map((t) => t.value).join('');
      const info = arrays.get(lhs);
      if (info && info.kind === 'fixed') return `memset(${lhs}, 0, sizeof(${lhs}));`;
      if (info && info.kind === 'vector') return `${lhs}.assign(${lhs}.size(), 0);`;
      return `${lhs} = 0;`;
    }

    // -------- ordinary expression statement --------
    return `${exp(tokens)};`;
  }

  // -------- for-head => C++ fragment --------
  function headDecl(tokens) {
    // `->` is a type annotation only when followed by a type keyword
    // (same rule as stmtCpp); otherwise it is `p->x` member access.
    const ann = tokens.findIndex((t, i) =>
      t.value === '->' && TYPE_WORD.test(tokens.slice(i + 1)
        .filter((x) => x.value !== '[' && x.value !== ']' && x.value !== '*')
        .map((x) => x.value).join(' ')));
    if (ann >= 0) {
      const type = typeCpp(tokens.slice(ann + 1).map((t) => t.value).join(' ').trim());
      const before = tokens.slice(0, ann);
      const eq = before.findIndex((t) => t.value === '=');
      const name = before.slice(0, eq).map((t) => t.value).join('');
      const val = expNoSemi(before.slice(eq + 1));
      return `${type} ${name} = ${val}`;
    }
    return expNoSemi(tokens);
  }

  function splitComma(tokens) {
    const out = [[]];
    let depth = 0;
    for (const t of tokens) {
      if (t.value === '(' || t.value === '[') depth++;
      if (t.value === ')' || t.value === ']') depth--;
      if (t.value === ',' && depth === 0) out.push([]);
      else out[out.length - 1].push(t);
    }
    if (out[out.length - 1].length === 0 && out.length > 1) out.pop();
    return out;
  }

  // bodies that must be scanned when a `Return` might hide inside
  function childBodies(s) {
    switch (s.kind) {
      case 'if':
        return [s.then, s.els ? s.els.stmts : null,
          ...s.elifs.map((e) => e.then)].filter(Boolean);
      case 'while':
      case 'for':
        return [s.body];
      case 'switch':
        return s.body.map((c) => c.body).filter(Boolean);
      case 'block':
        return [s.stmts];
      case 'stmt':
        return s.body ? [s.body] : [];
      default:
        return [];
    }
  }

  function hasReturn(stmts) {
    for (const s of stmts) {
      if (s.kind === 'return') return true;
      if (childBodies(s).some(hasReturn)) return true;
    }
    return false;
  }

  function hasReturnValue(stmts) {
    for (const s of stmts) {
      if (s.kind === 'return' && s.tokens.length) return true;
      if (childBodies(s).some(hasReturnValue)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------
  //  Statement dispatcher
  function genBlock(stmts, indent) {
    for (const st of stmts) genStmt(st, indent);
  }

  // True when `tokens[zeroIdx]` is a statement-level `##`, not one embedded
  // in a bigger expression (i.e. everything before it is a plain lvalue and
  // nothing follows it). `a## + b;` therefore falls through to `exp()`.
  function isPureLvalueCtx(tokens, zeroIdx) {
    if (zeroIdx === 0) {
      // `## x` prefix form needs a single plain target and nothing else
      const rest = tokens.slice(1);
      return rest.length > 0 && rest.every((t) =>
        t.value === ';' || /^[A-Za-z_][A-Za-z_0-9]*$/.test(t.value));
    }
    const pre = tokens.slice(0, zeroIdx);
    const post = tokens.slice(zeroIdx + 1);
    if (post.some((t) => t.value !== ';')) return false;
    if (pre.some((t) => t.value === '**')) return false;
    return pre.every((t) =>
      /^[A-Za-z_][A-Za-z_0-9]*$/.test(t.value) || t.value === '.');
  }

  // Single-line C++ for an inline `Then` statement, or null if it needs a block.
  function inlineStmt(node) {
    if (!node) return null;
    switch (node.kind) {
      case 'break': return 'break';
      case 'continue': return 'continue';
      case 'return': return `return ${node.tokens.length ? expNoSemi(node.tokens) : ''}`;
      case 'out': {
        const args = splitComma(node.tokens)
          .map((g) => squeezeSemi(g))
          .filter((a) => a.length);
        const parts = args.map((a) => {
          const t = a.map((t) => t.value).join(' ').trim();
          if (/^\s*nl\s*$/i.test(t)) return 'endl';
          // wrap: `cout << a & b` would parse as `(cout << a) & b`
          return `(${exp(a)})`;
        });
        return parts.length ? `cout << ${parts.join(' << ')}` : null;
      }
      case 'input': {
        let args = splitComma(node.tokens)
          .map((g) => squeezeSemi(g))
          .filter((a) => a.length);
        args = args.map((a) =>
          a[0] && a[0].value.toLowerCase() === 'to' ? a.slice(1) : a);
        const parsed = args.filter((a) => a.length).map((a) => exp(a));
        return parsed.length ? `cin >> ${parsed.join(' >> ')}` : null;
      }
      case 'stmt':
        return node.body ? null : stmtCpp(squeezeSemi(node.tokens)).replace(/;\s*$/, '');
      case 'empty': return '';
      default: return null;
    }
  }

  // Whole if / elif / else chain where every branch is a single inline stmt -> one line.
  function emitBlockMerged(node, indent) {
    const p = pad(indent);
    const parts = [];
    let ok = true;
    const push = (head, stmts) => {
      if (ok && stmts && stmts.inline && stmts.length === 1) {
        const s = inlineStmt(stmts[0]);
        if (s !== null) { parts.push(`${head} ${s};`); return; }
      }
      ok = false;
    };
    if (node.cond !== null) push(`if (${expNoSemi(node.cond)})`, node.then);
    else ok = false;
    for (const el of node.elifs) {
      if (!ok) break;
      push(`else if (${expNoSemi(el.cond)})`, el.then);
    }
    if (node.els && ok) push('else', node.els.stmts);
    if (!ok) {
      // not fully inline -> fall through to block emission
      emit(`${p}if (${expNoSemi(node.cond)}) {`);
      genBlock(node.then, indent + 1);
      for (const el of node.elifs) {
        emit(`${p}} else if (${expNoSemi(el.cond)}) {`);
        genBlock(el.then, indent + 1);
      }
      if (node.els) {
        emit(`${p}} else {`);
        genBlock(node.els.stmts, indent + 1);
      }
      emit(`${p}}`);
      return;
    }
    emit(`${p}${parts.join(' ')}`);
  }

  function genStmt(node, indent) {
    const p = pad(indent);
    switch (node.kind) {
      case 'stmt': {
        if (node.body) {
          emit(`${p}${expNoSemi(node.tokens)} {`);
          genBlock(node.body, indent + 1);
          emit(`${p}}`);
        } else {
          emit(`${p}${stmtCpp(squeezeSemi(node.tokens))}`);
        }
        return;
      }
      case 'raw':
        for (const ln of node.text.split('\n')) emit(`${p}${ln}`);
        return;
      case 'block':
        genBlock(node.stmts, indent);
        return;
      case 'out': {
        const args = splitComma(node.tokens)
          .map((g) => squeezeSemi(g))
          .filter((a) => a.length);
        const parts = args.map((a) => {
          const t = a.map((t) => t.value).join(' ').trim();
          if (/^\s*nl\s*$/i.test(t)) return 'endl';
          // wrap: `cout << a & b` would parse as `(cout << a) & b`
          return `(${exp(a)})`;
        });
        if (parts.length) emit(`${p}cout << ${parts.join(' << ')};`);
        return;
      }
      case 'input': {
        let args = splitComma(node.tokens)
          .map((g) => squeezeSemi(g))
          .filter((a) => a.length);
        // drop an initial `to` keyword (In to a,b,c)
        args = args.map((a) =>
          a[0] && a[0].value.toLowerCase() === 'to' ? a.slice(1) : a);
        const parsed = args.filter((a) => a.length).map((a) => exp(a));
        if (parsed.length) emit(`${p}cin >> ${parsed.join(' >> ')};`);
        return;
      }
      case 'return': {
        const e = node.tokens.length ? expNoSemi(node.tokens) : '';
        emit(`${p}return ${e};`);
        return;
      }
      case 'break':
        emit(`${p}break;`);
        return;
      case 'continue':
        emit(`${p}continue;`);
        return;
      case 'empty':
        emit(`${p}`);
        return;
      case 'if': {
        if (node.cond !== null) {
          emitBlockMerged(node, indent);
        } else if (node.els) {
          const es = node.els.stmts;
          if (es.inline && es.length === 1) {
            const s = inlineStmt(es[0]);
            if (s !== null) {
              emit(`${p}else ${s};`);
              return;
            }
          }
          emit(`${p}else {`);
          genBlock(es, indent + 1);
          emit(`${p}}`);
        }
        return;
      }
      case 'switch': {
        emit(`${p}switch (${expNoSemi(node.cond)}) {`);
        for (const c of node.body) {
          if (c.kind !== 'case') { genStmt(c, indent + 1); continue; }
          if (c.val === null || c.val.length === 0) {
            emit(`${p}  default: {`);
            genBlock(c.body, indent + 2);
            emit(`${p}  }`);
            continue;
          }
          emit(`${p}  case ${expNoSemi(c.val)}: {`);
          genBlock(c.body, indent + 2);
          emit(`${p}    break;`);
          emit(`${p}  }`);
        }
        emit(`${p}}`);
        return;
      }
      case 'for': {
        const init = headDecl(node.init);
        const cond = node.cond.length ? expNoSemi(node.cond) : '';
        const step = node.step.length ? expNoSemi(node.step) : '';
        if (node.body.inline && node.body.length === 1) {
          const s = inlineStmt(node.body[0]);
          if (s !== null) {
            emit(`${p}for (${init}; ${cond}; ${step}) ${s};`);
            return;
          }
        }
        emit(`${p}for (${init}; ${cond}; ${step}) {`);
        genBlock(node.body, indent + 1);
        emit(`${p}}`);
        return;
      }
      case 'while': {
        const cond = node.cond.length ? expNoSemi(node.cond) : 'true';
        if (node.body.inline && node.body.length === 1) {
          const s = inlineStmt(node.body[0]);
          if (s !== null) {
            emit(`${p}while (${cond}) ${s};`);
            return;
          }
        }
        emit(`${p}while (${cond}) {`);
        genBlock(node.body, indent + 1);
        emit(`${p}}`);
        return;
      }
      case 'def': {
        const isMain = node.name.toLowerCase() === 'main';
        const plainType = (s) => typeCpp((s || '').replace(/\[[^\]]*\]/g, '').trim());
        const params = node.params.map((pp) => {
          if (pp.name === 'argc') return 'int argc';
          if (pp.name === 'argv') return 'char** argv';
          const t = plainType(pp.type) || 'int';
          if (pp.array) {
            if (pp.size) {
              arrays.set(pp.name, { kind: 'fixed' });
              return `${t} ${pp.name}[${pp.size}]`;
            }
            arrays.set(pp.name, { kind: 'vector' });
            return `vector<${t}> ${pp.name}`;
          }
          return `${t} ${pp.name}`;
        }).join(', ');
        const ret = isMain
          ? 'int'
          : (node.ret.length
            ? typeCpp(expNoSemi(node.ret))
            : (hasReturnValue(node.body) ? 'int' : 'void'));
        const fname = isMain ? 'main' : node.name;
        emit(`${p}${ret} ${fname}(${params}) {`);
        genBlock(node.body, indent + 1);
        if (isMain && !hasReturn(node.body)) emit(`${p}  return 0;`);
        emit(`${p}}`);
        return;
      }
      default:
        throw new Error(`unknown node kind: ${node.kind}`);
    }
  }

  genBlock(ast, 0);
  return HEADER + '\n\n' + lines.join('\n') + '\n';
}

module.exports = { gen };