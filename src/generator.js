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
  //  token -> text with sane spacing
  function toText(tokens) {
    let s = tokens.map((t) => t.value).join(' ');
    s = s.replace(/\s+/g, ' ');
    s = s.replace(/([\(\[])\s+/g, '$1');
    s = s.replace(/\s+([\)\]\]])/g, '$1');
    s = s.replace(/\s*([,;])\s*/g, '$1 ');
    // remove spaces around dot accessors
    s = s.replace(/\s*\.\s*/g, '.');
    s = s.replace(/\s*::\s*/g, '::');
    // tighten array subscripts: c [ 0 ] -> c[0]
    s = s.replace(/(\S)\s+\[/g, '$1[');
    s = s.replace(/\[\s+/g, '[');
    s = s.replace(/\s+\]/g, ']');
    return s.trim();
  }

  function exp(tokens) {
    let s = toText(tokens);
    s = s.replace(/\.add\s*\(/g, '.push_back(');
    s = s.replace(/\.remove\s*\([^()]*\)/g, '.pop_back()');
    s = s.replace(/\.len\b/g, '.size()');
    // power infix: `a ^^ b` -> `pow(a, b)`
    s = s.replace(/([\w\.\[\]]+)\s*\^\^\s*([\w\.\(\)\d]+)/g, 'pow($1, $2)');
    // set-to-zero `##`:  `a ## b ...` -> `(a = (b...))`? No: it's prefix/suffix lvalue
    //   `## x`  -> `(x = 0)`, `x ##` -> `(x = 0)`
    s = s.replace(/\s*##\s*([A-Za-z_][\w\.\[\]]*)/g, '($1 = 0)');
    s = s.replace(/([A-Za-z_][\w\.\[\]]*)\s+##/g, '($1 = 0)');
    return s.trim();
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
  const TYPE_WORD = /^(int|long|short|char|float|double|bool|void|string|auto|unsigned|signed|size_t|ll|u?int(8|16|32|64)_t|__int128|long\s+long)$/i;

  function stmtCpp(tokens) {
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

      // open or sized array: `a[] -> T` / `a[N] -> T`  (or `a[...][...]`)
      const arrIdx = tokens.findIndex((t) => t.value === '[');
      if (arrIdx >= 0) {
        const name = tokens.slice(0, arrIdx).map((t) => t.value).join('');
        const closeIdx = tokens.findIndex((t) => t.value === ']');
        const sizeTok = tokens.slice(arrIdx + 1, closeIdx);
        if (sizeTok.length) {
          const size = expNoSemi(sizeTok);
          // `i[10]=0->int;` -> `int i[10] = {0};`
          if (eqIdx >= 0 && closeIdx < eqIdx && eqIdx < annIdx) {
            const initVal = expNoSemi(tokens.slice(eqIdx + 1, annIdx));
            arrays.set(name, { kind: 'fixed' });
            return `${typeText2} ${name}[${size}] = {${initVal}};`;
          }
          arrays.set(name, { kind: 'fixed' });
          return `${typeText2} ${name}[${size}];`;
        }
        arrays.set(name, { kind: 'vector' });
        if (eqIdx >= 0 && eqIdx < annIdx) {
          throw new Error(`dynamic array '${name}[]' cannot take an initializer ('= ${expNoSemi(tokens.slice(eqIdx + 1, annIdx))}')`);
        }
        return `vector<${typeText2}> ${name};`;
      }

      // `x = value -> T`
      if (eqIdx >= 0 && eqIdx < annIdx) {
        const lhs = tokens.slice(0, eqIdx).map((t) => t.value).join('');
        const val = expNoSemi(tokens.slice(eqIdx + 1, annIdx));
        arrays.delete(lhs);
        return `${typeText2} ${lhs} = ${val};`;
      }
      // `x -> T`
      const lhs = tokens.slice(0, annIdx).map((t) => t.value).join('');
      arrays.delete(lhs);
      return `${typeText2} ${lhs};`;
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
    const ann = tokens.findIndex((t) => t.value === '->');
    if (ann >= 0) {
      const type = tokens.slice(ann + 1).map((t) => t.value).join(' ').trim();
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

  function hasReturn(stmts) {
    for (const s of stmts) {
      if (s.kind === 'return') return true;
      if (s.kind === 'if') {
        for (const a of [s.then, ...s.elifs.map((e) => e.then)]) {
          if (hasReturn(a)) return true;
        }
      }
    }
    return false;
  }

  function hasReturnValue(stmts) {
    for (const s of stmts) {
      if (s.kind === 'return' && s.tokens.length) return true;
      if (s.kind === 'if') {
        for (const a of [s.then, ...s.elifs.map((e) => e.then)]) {
          if (hasReturnValue(a)) return true;
        }
      }
    }
    return false;
  }

  // ---------------------------------------------------------------
  //  Statement dispatcher
  function genBlock(stmts, indent) {
    for (const st of stmts) genStmt(st, indent);
  }

  // True when `tokens[zeroIdx]` is a statement-level `##`, not one embedded
  // in a bigger expression (i.e. everything before it is a plain lvalue).
  function isPureLvalueCtx(tokens, zeroIdx) {
    if (zeroIdx === 0) return true; // `## x` prefix
    const pre = tokens.slice(0, zeroIdx);
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
          return exp(a);
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
          emit(`${p}${stmtCpp(node.tokens)}`);
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
          return exp(a);
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
        const plainType = (s) => (s || '').replace(/\[[^\]]*\]/g, '').trim();
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
            ? expNoSemi(node.ret)
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