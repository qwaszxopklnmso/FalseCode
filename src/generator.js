// =====================================================================
// False Code -> C++ generator.
//
// This is where the semantically special tokens become C++:
//   ^^ / ^^=  -> pow()
//   ##        -> set-to-zero
//   .add()/.remove()/.len       -> vector interface
//   attr `x = v -> T`, `x -> T`, `x[] -> T`, `x[N] -> T` -> declarations
// =====================================================================

const HEADER = `#include <bits/stdc++.h>
using namespace std;`;

function gen(ast) {
  const lines = [];
  const emit = (s = '') => lines.push(s);
  const pad = (n) => '\t'.repeat(n);

  // Record declared array shapes so statements like `i##;` can know
  // whether a name is a fixed C array, a vector, or a scalar.
  const arrays = new Map();

  // Custom type names (typedef / #define / struct / class / union / enum /
  // namespace) so `->` and `<>` annotations accept them as types.
  const typeNames = new Set();

  // Names declared as `string` (incl. def params): their `.len` maps to
  // `.length()` instead of `.size()`.
  const strings = new Set();

  // Names declared as `queue<...>`: `q##` must rebuild an empty queue
  // (queue has no clear()), keep the full type text for `q = type();`.
  const queues = new Map();

  // Names declared as `set<...>`/`map<...>`: `.add()` -> `insert`,
  // `.remove()` -> `erase`.
  const sets = new Set();
  // Names declared as `map<...>`/`unordered_map<...>`: `.add(k, v)` ->
  // `m[k] = v;` (map::insert only takes a pair).
  const maps = new Set();

  const isSetType = (text) => /^(std\s*::\s*)?(set|map|unordered_map)\s*</i.test(text || '');
  const isMapType = (text) => /^(std\s*::\s*)?(map|unordered_map)\s*</i.test(text || '');

  // Scoped registry: `reg` points at the global tables outside functions,
  // and at a per-function snapshot inside a `def` body. This way a local
  // `arr = 0 -> int;` in F() cannot corrupt the global `arr[5] -> int;`
  // entry used by `arr##` in main().
  let reg = { arrays, strings, sets, maps, queues };

  const isStringType = (text) => (text || '').replace(/\s+/g, '').endsWith('string');

  // walk the whole AST first so every custom type name is registered
  ast.forEach(collectTypes);

  function collectTypes(node) {
    if (!node) return;
    const words = (node.tokens || []).filter((t) => t.type === 'word');
    const first = words.length && words[0].value.toLowerCase();
    if (first === 'typedef' && words.length >= 2) {
      typeNames.add(words[words.length - 1].value);
    } else if (['struct', 'class', 'union', 'enum', 'namespace'].includes(first) && words.length >= 2) {
      typeNames.add(words[1].value);
    } else if (node.kind === 'raw') {
      const line0 = node.text.split('\n')[0];
      const m = line0.match(/^\s*#\s*define\s+([A-Za-z_]\w*)/);
      if (m) typeNames.add(m[1]);
      const nm = line0.match(/^\s*namespace\s+([A-Za-z_]\w*)/);
      if (nm) typeNames.add(nm[1]);
      const sm = line0.match(/^\s*(struct|class|union|enum)\s+([A-Za-z_]\w*)/);
      if (sm) typeNames.add(sm[2]);
    }
    if (node.body) (Array.isArray(node.body) ? node.body : [node.body]).forEach(collectTypes);
    if (node.then) node.then.forEach(collectTypes);
    if (node.elifs) node.elifs.forEach(collectTypes);
    if (node.els) {
      if (node.els.stmts) node.els.stmts.forEach(collectTypes);
      else collectTypes(node.els);
    }
  }

  // is tokens[i] (`->`) a False Code type annotation? Built-in TYPE_WORD,
  // a registered custom type name, a qualified `ns::Name` / `std::string`,
  // or a template type `name<...>` / `ns::name<...>`.
  function isTypeLike(tokens, i) {
    const rest = tokens.slice(i + 1)
      .filter((x) => x.value !== '*' && x.value !== '[' && x.value !== ']');
    // a top-level `=` right after the annotation target means member
    // assignment, not a type: `p->int = 2;` (a declaration's `=` sits
    // *before* the `->`: `x = 1 -> int;`)
    {
      let depth = 0;
      for (const x of rest) {
        const v = x.value;
        if (v === '<' || v === '(' || v === '[') depth++;
        else if (v === '>' || v === ')' || v === ']') depth--;
        else if (depth === 0 && v === '=') return false;
      }
    }
    // a top-level `=` *before* the `->` (`x = v -> T;`) makes a BARE custom
    // type name ambiguous: `x = p -> node;` is member access, not a
    // declaration. A type that carries a modifier (`node*`, `vec<>`) is
    // unambiguous, so it still counts.
    let eqBefore = false;
    let braceInit = false;
    {
      let depth = 0;
      for (let k = 0; k < i; k++) {
        const v = tokens[k].value;
        if (v === '<' || v === '(' || v === '[') depth++;
        else if (v === '>' || v === ')' || v === ']') depth--;
        else if (depth === 0 && v === '=') {
          eqBefore = true;
          // `e0 = {0,1,4} -> Edge;` — a brace literal right after `=` can only
          // be an initializer, so the following `-> T` is a declaration, not
          // a member access (`{...}->field` is meaningless)
          const nx = tokens[k + 1];
          if (nx && (nx.value === '{' || (nx.type === 'word' && nx.value === '{'))) braceInit = true;
          break;
        }
      }
    }
    // filtered `[]`/`*` were dropped from `rest`; if any were present the
    // annotation is clearly a type (`-> node*`), not a member `.field`.
    const bareWord = (eqBefore && rest.length === tokens.slice(i + 1).length);
    const ambiguous = !braceInit && bareWord && rest.length === 1 && rest[0].type === 'word' &&
      !TYPE_WORD.test(rest[0].value);
    const joined = rest.map((x) => x.value).join(' ');
    if (TYPE_WORD.test(joined)) return true;
    if (!rest.length || rest[0].type !== 'word') return false;
    const names = [];
    let k = 0;
    while (k < rest.length && rest[k].type === 'word') {
      names.push(rest[k].value);
      k++;
      if (rest[k] && rest[k].value === '::') { k++; continue; }
      break;
    }
    if (!names.length) return false;
    // template type: `std::vector<int>`, `map<int,int>`, `set<long long>`...
    if (rest[k] && (rest[k].value === '<' || rest[k].value === '<<')) {
      let depth = 0, ok = true;
      for (let j = k; j < rest.length; j++) {
        const v = rest[j].value;
        if (v === '<<') depth += 2;
        else if (v === '<') depth += 1;
        else if (v === '>>') depth -= 2;
        else if (v === '>') depth -= 1;
        if (depth < 0) { ok = false; break; }
      }
      if (ok && depth === 0) return true;
    }
    const last = names[names.length - 1];
    // qualified name (`ns::Name`, names crosses a `::`) is always a type
    return (!ambiguous && typeNames.has(last)) || names.length >= 2 || TYPE_WORD.test(last);
  }

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
    s = s.replace(/\s*->\s*/g, '->');
    // tighten array subscripts: c [ 0 ] -> c[0]
    s = s.replace(/(\S)\s+\[/g, '$1[');
    s = s.replace(/\[\s+/g, '[');
    s = s.replace(/\s+\]/g, ']');
    for (let i = 0; i < strs.length; i++) {
      s = s.split(`\u0000${i}\u0000`).join(strs[i]);
    }
    return s.trim();
  }

  // False Code keywords inside same-line `{ ... }` blocks in *expressions*
  // (lambda bodies): `Return`/`Break`/`Continue` -> lowercase C++ keywords.
  // Statement-level blocks are handled by the parser (inlineCpp); this only
  // patches things like `Out [](int x){ Return x * x; }(3);`.
  function convertBraceKeywords(s) {
    let out = '';
    let i = 0;
    while (i < s.length) {
      if (s[i] === '{') {
        let depth = 0, close = -1;
        for (let j = i; j < s.length; j++) {
          if (s[j] === '{') depth++;
          else if (s[j] === '}') {
            depth--;
            if (depth === 0) { close = j; break; }
          }
        }
        if (close >= 0) {
          const body = s.slice(i + 1, close);
          const converted = body
            .replace(/\bIf\b\s+([^;{}]+?)\s+Then\s+/gi, 'if ($1) ')
            .replace(/\b(Return|Break|Continue)\b/g, (m) => m.toLowerCase());
          out += '{' + converted + '}';
          i = close + 1;
          continue;
        }
      }
      out += s[i];
      i++;
    }
    return out;
  }

  function exp(tokens) {
    // Protect string/char literals from ALL rewrites below (incl.
    // convertBraceKeywords, which would mangle `"{ Return }"` inside a string)
    const strs = [];
    let s = toText(tokens).replace(/(["'])(?:\\.|(?!\1).)*\1/g, (m) => {
      strs.push(m);
      return `\u0000${strs.length - 1}\u0000`;
    });
    s = convertBraceKeywords(s);
    s = s.replace(/([A-Za-z_]\w*)\.(add|remove)\s*\(/g, '\u0002$1\u0003$2(');
    s = dropParenArgs(s);
    s = s.replace(/([A-Za-z_]\w*(?:\[[^\]]*\])*|\)|\])\.len\b/g, (m, recv) => {
      const base = (recv.match(/^[A-Za-z_]\w*/) || [''])[0];
      if (recv === base) {
        const ai = reg.arrays.get(base);
        if (ai && ai.kind === 'fixed') return `(sizeof(${base}) / sizeof(${base}[0]))`;
        return reg.strings.has(base) ? `${base}.length()` : `${base}.size()`;
      }
      return `${recv}.size()`;
    });
    // power infix: `a ^^ b`, `(a+1) ^^ 2` -> `pow(...)`
    s = convertPower(s);
    // set-to-zero `##`: `## x` -> `(x = 0)`, `x ##` -> `(x = 0)`
    s = s.replace(/\s*##\s*([A-Za-z_][\w\.\[\]]*)/g, '($1 = 0)');
    s = s.replace(/([A-Za-z_](?:[\w.\[\]]|->)*)\s+##/g, '($1 = 0)');
    for (let i = 0; i < strs.length; i++) {
      s = s.split(`\u0000${i}\u0000`).join(strs[i]);
    }
    return s.trim();
  }

  // split a string on top-level (paren/bracket/brace-aware) commas
  function splitTopComma(s) {
    const parts = [];
    let depth = 0, cur = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
      cur += c;
    }
    parts.push(cur);
    return parts.map((p) => p.trim());
  }

  // drop everything from each `\u0002name\u0003op(` marker through its matching `)`
  function dropParenArgs(s) {
    let out = '';
    let i = 0;
    while (i < s.length) {
      if (s[i] === '\u0002') {
        const end = s.indexOf('\u0003', i);
        const nm = s.slice(i + 1, end);
        const opEnd = s.indexOf('(', end);
        const op = s.slice(end + 1, opEnd);
        i = opEnd; // now at `(`
        let depth = 1;
        const argStart = i + 1;
        i++;
        while (i < s.length && depth > 0) {
          if (s[i] === '(') depth++;
          else if (s[i] === ')') depth--;
          i++;
        }
        const arg = s.slice(argStart, i - 1);
        // nested `.add()` inside the argument (`a.add(b.add(1))`) leaves
        // markers in `arg` — recurse so they expand too
        const argOut = arg.includes('\u0002') ? dropParenArgs(arg) : arg;
        const isSet = reg.sets.has(nm);
        if (op === 'add') {
          if (reg.maps.has(nm)) {
            const kv = splitTopComma(argOut);
            out += kv.length === 2 ? `${nm}[${kv[0]}] = ${kv[1]}` : `${nm}.insert(${argOut})`;
          } else {
            out += isSet ? `${nm}.insert(${argOut})` : `${nm}.push_back(${argOut})`;
          }
        } else {
          out += isSet ? `${nm}.erase(${argOut})` : `${nm}.pop_back()`;
        }
      } else {
        out += s[i];
        i++;
      }
    }
    return out;
  }

  // balanced-paren aware `LHS ^^ RHS` -> `pow(LHS, RHS)`.

  // scan backwards from `j` over one operand: identifier/member chain
  // (`p->v`, `ns::x`, `arr[0]->v`, `(a+b)->v`) — any mix of identifier
  // chars, `->`/`::` links and `(...)`/`[...]` groups. Returns the start.
  function scanOperandStart(s, j) {
    let i = j;
    while (i >= 0) {
      const c = s[i];
      if (c === ')' || c === ']') {
        const open = c === ')' ? '(' : '[';
        let depth = 0;
        do {
          if (s[i] === c) depth++;
          else if (s[i] === open) depth--;
          i--;
        } while (i >= 0 && depth > 0);
        continue;
      }
      if (i >= 1 && ((c === '>' && s[i - 1] === '-') || (c === ':' && s[i - 1] === ':'))) {
        i -= 2;
        continue;
      }
      if (/[\w\.]/.test(c)) { i--; continue; }
      break;
    }
    return i + 1;
  }

  // scan forwards from `k` over one operand (identifier / member chain /
  // follow-on call-subscript groups), returning the end index.
  function scanOperandEnd(s, k) {
    let j = k;
    while (j < s.length) {
      const c = s[j];
      if (c === '(' || c === '[') {
        const close = c === '(' ? ')' : ']';
        let depth = 0;
        do {
          if (s[j] === c) depth++;
          else if (s[j] === close) depth--;
          j++;
        } while (j < s.length && depth > 0);
        continue;
      }
      if (j + 1 < s.length && ((c === '-' && s[j + 1] === '>') || (c === ':' && s[j + 1] === ':'))) {
        j += 2;
        continue;
      }
      if (/[\w\.]/.test(c)) { j++; continue; }
      break;
    }
    return j - 1;
  }

  function convertPower(s) {
    // convert inside balanced parens first (deepest first), so nested
    // `(2 ^^ 3) ^^ 2` -> `pow(pow(2, 3), 2)` — otherwise the inner `^^`
    // positions shift and get skipped after the outer replacement.
    let i = 0;
    const parts = [];
    while (i < s.length) {
      if (s[i] === '(') {
        let depth = 0, close = -1;
        for (let k = i; k < s.length; k++) {
          if (s[k] === '(') depth++;
          else if (s[k] === ')') {
            depth--;
            if (depth === 0) { close = k; break; }
          }
        }
        if (close >= 0) {
          parts.push('(' + convertPower(s.slice(i + 1, close)) + ')');
          i = close + 1;
          continue;
        }
      }
      parts.push(s[i]);
      i++;
    }
    const flat = parts.join('');
    const positions = [];
    for (let j = 0; j + 1 < flat.length; j++) {
      if (flat[j] === '^' && flat[j + 1] === '^' && flat[j + 2] !== '=') {
        positions.push(j);
      }
    }
    // replace right-to-left so earlier positions stay valid
    for (let idx = positions.length - 1; idx >= 0; idx--) {
      const p = positions[idx];
      if (!(flat[p] === '^' && flat[p + 1] === '^')) continue;
      let j = p - 1;
      while (j >= 0 && flat[j] === ' ') j--;
      let k = p + 2;
      while (k < flat.length && flat[k] === ' ') k++;
      const lhsStart = j >= 0 ? scanOperandStart(flat, j) : -1;
      const rhsEnd = k < flat.length ? scanOperandEnd(flat, k) : -1;
      if (lhsStart >= 0 && lhsStart <= j && rhsEnd >= k) {
        const lhs = flat.slice(lhsStart, j + 1);
        const rhs = flat.slice(k, rhsEnd + 1);
        const suffix = flat.slice(rhsEnd + 1);
        return convertPower(flat.slice(0, lhsStart) +
          `pow(${lhs}, ${rhs})`) + suffix;
      }
    }
    return flat;
  }

  // raw transcription without expression rewrites
  const expTo = (tokens) =>
    (tokens || []).filter((t) => t.value !== ';')
      .map((t) => t.value).join(' ');

  // a `?` only ever appears as a trailing line suffix (If/While/Case);
  // keep any other `?` (e.g. ternary) intact. Only trailing `;` is
  // statement noise — embedded ones (e.g. a lambda body `{ a = 42; }`)
  // are real C++ and must survive.
  function squeezeSemi(tokens) {
    const t2 = [...tokens];
    while (t2.length && t2[t2.length - 1].value === ';') t2.pop();
    if (t2.length && t2[t2.length - 1].value === '?') t2.pop();
    return t2;
  }

  function expNoSemi(tokens) {
    return exp(squeezeSemi(tokens));
  }

  // a type annotation may carry `<>`: `x -> char<>` == `x<> -> char`
  // (declarator suffix is redundant then); `v<>` -> `vector<v>`.
  const parseAnnotationAngle = (typeTok) => {
    const lt = typeTok.findIndex((t) => t.value === '<' || t.value === '<<');
    if (lt < 0) return null;
    const flat = typeTok.slice(lt).flatMap((t) =>
      t.value === '<<' ? ['<', '<'] : t.value === '>>' ? ['>', '>'] : [t.value]);
    const open = flat.filter((v) => v === '<').length;
    const close = flat.filter((v) => v === '>').length;
    if (!open || open !== close || flat.some((v) => v !== '<' && v !== '>')) return null;
    return { base: typeTok.slice(0, lt).map((t) => t.value).join(' ').trim(), open };
  };

  // def return type: `-> string<>` -> `vector<string>`, `-> int` -> `int`
  const retTypeCpp = (tokens) => {
    const angle = parseAnnotationAngle(tokens);
    if (angle) {
      return `${'vector<'.repeat(angle.open)}${typeCpp(angle.base)}${'>'.repeat(angle.open)}`;
    }
    return typeCpp(expNoSemi(tokens));
  };

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

    // a type annotation may carry a C++-style array suffix: `x = {...} -> int[3]`
    const splitTypeSuffix = (typeTok) => {
      const parts = [];
      const dims = [];
      let i = 0;
      while (i < typeTok.length) {
        if (typeTok[i].value === '[') {
          let depth = 0, close = -1;
          for (let k = i; k < typeTok.length; k++) {
            if (typeTok[k].value === '[') depth++;
            else if (typeTok[k].value === ']') {
              depth--;
              if (depth === 0) { close = k; break; }
            }
          }
          if (close < 0) { parts.push(typeTok[i].value); i++; continue; }
          dims.push(`[${expNoSemi(typeTok.slice(i + 1, close))}]`);
          i = close + 1;
        } else { parts.push(typeTok[i].value); i++; }
      }
      return { type: parts.join(' '), dims: dims.join('') };
    };

    // a type annotation may carry `<>`: `x -> char<>` == `x<> -> char`
    // (declarator suffix is redundant then); `v<>` -> `vector<v>`.
    // (defined at generator scope, shared with the def return-type path)

    // declaration name: the single identifier before any `[`/`<`/`=` suffix
    const nameFrom = (slice) => {
      let end = slice.length;
      for (let i = 0; i < slice.length; i++) {
        const v = slice[i].value;
        if (v === '[' || v === '<' || v === '<<' || v === '=') { end = i; break; }
      }
      return declName(slice.slice(0, end));
    };

    // collect declarator array dims: `c[10]` -> `[10]`
    const declDims = (slice) => {
      let out = '';
      let i = 0;
      while (i < slice.length) {
        if (slice[i].value === '[') {
          let depth = 0, close = -1;
          for (let k = i; k < slice.length; k++) {
            if (slice[k].value === '[') depth++;
            else if (slice[k].value === ']') {
              depth--;
              if (depth === 0) { close = k; break; }
            }
          }
          if (close < 0) break;
          out += `[${expNoSemi(slice.slice(i + 1, close))}]`;
          i = close + 1;
        } else i++;
      }
      return out;
    };

    // `->` is a False Code type annotation only when followed by a type
    // keyword, a registered custom type, or `ns::Name`; otherwise it is
    // plain C++ member access (`p->x`).
    const annIdx = tokens.findIndex((t, i) =>
      t.value === '->' && isTypeLike(tokens, i));
    const eqIdx = tokens.findIndex((t) => t.value === '=');

    // -------- declarations (annotation present) --------
    if (annIdx >= 0) {
      const typeTok = tokens.slice(annIdx + 1);
      const typeSfx = splitTypeSuffix(typeTok);
      const typeText2 = typeSfx.type;
      const annAngle = parseAnnotationAngle(typeTok);
      const declLHS = tokens.slice(0, eqIdx >= 0 && eqIdx < annIdx ? eqIdx : annIdx);

      // multiple types on one annotation (`i, s -> int, string`) is not
      // supported — reject rather than emit garbage (a `,` inside `<...>`
      // template args like `map<int,int>` is fine)
      {
        let tDepth = 0, tComma = false;
        for (const tt of typeTok) {
          const tv = tt.value;
          if (tv === '<' || tv === '<<') tDepth++;
          else if (tv === '>' || tv === '>>') tDepth--;
          else if (tv === ',' && tDepth === 0) { tComma = true; break; }
        }
        if (tComma) {
          throw new Error(`invalid type list '${typeTok.map((t) => t.value).join(' ')}': only one type per declaration (multi-var is 'a, b -> T;')`);
        }
      }

      // annotation `<>` wins over the declarator: `c[10] -> v<>` -> `vector<v> c[10]`
      if (annAngle) {
        const name = nameFrom(declLHS);
        reg.arrays.set(name, { kind: 'vector', nested: annAngle.open > 1 });
        if (eqIdx >= 0 && eqIdx < annIdx) {
          return `${'vector<'.repeat(annAngle.open)}${typeCpp(annAngle.base)}${'>'.repeat(annAngle.open)} ${name}${declDims(declLHS)} = ${expNoSemi(tokens.slice(eqIdx + 1, annIdx))};`;
        }
        return `${'vector<'.repeat(annAngle.open)}${typeCpp(annAngle.base)}${'>'.repeat(annAngle.open)} ${name}${declDims(declLHS)};`;
      }

      // angle-bracket dynamic array: `x<> -> T` -> vector<T>,
      // `vec<<>> -> T` -> vector<vector<T>> (`<<`/`>>` lex as shift ops)
      const ltIdx = tokens.findIndex((t) => t.value === '<' || t.value === '<<');
      if (ltIdx >= 0 && (eqIdx < 0 || ltIdx < eqIdx) && (annIdx < 0 || ltIdx < annIdx)) {
        // annotation array suffix wins over `<>`: `v<> -> char[10]` -> `char v[10]`
        if (typeSfx.dims) {
          const name = nameFrom(tokens.slice(0, ltIdx));
          reg.arrays.set(name, { kind: 'fixed' });
          return `${typeCpp(typeText2.replace(/\s*<\s*>\s*/g, ''))} ${name}${typeSfx.dims};`;
        }
        const name = nameFrom(tokens.slice(0, ltIdx));
        const flat = tokens.slice(ltIdx, annIdx).flatMap((t) =>
          t.value === '<<' ? ['<', '<'] : t.value === '>>' ? ['>', '>'] : [t.value]);
        const openCount = flat.filter((v) => v === '<').length;
        const closeCount = flat.filter((v) => v === '>').length;
        if (openCount !== closeCount || !openCount) {
          throw new Error(`invalid dynamic array '${name}<>': expected balanced '<' '>' pairs (e.g. x<> or vec<<>>)`);
        }
        // `d<<<<int>>>> -> int` — a base type may live INSIDE the angle pairs;
        // otherwise the `->` type is the base (`vec<<>> -> int`). The inner
        // type wins only when it is a real type; a placeholder like
        // `w<<<<thing>>>> -> int` falls back to the `->` type.
        const innerToks = tokens.slice(ltIdx, annIdx).filter((t) => !/^[<>]+$/.test(t.value));
        const innerText = innerToks.map((t) => t.value).join(' ');
        const innerType = innerToks.length ? innerText : null;
        const known = (s) => TYPE_WORD.test(s) || typeNames.has(s);
        reg.arrays.set(name, { kind: 'vector', nested: openCount > 1 });
        if (eqIdx >= 0 && eqIdx < annIdx) {
          throw new Error(`dynamic array '${name}<>' cannot take an initializer ('= ${expNoSemi(tokens.slice(eqIdx + 1, annIdx))}')`);
        }
        const baseType = innerType && innerType !== typeText2 && !known(innerType)
          ? typeText2 : (innerType || typeText2);
        return `${'vector<'.repeat(openCount)}${typeCpp(baseType)}${'>'.repeat(openCount)} ${name};`;
      }

      // open or sized array: `a[] -> T` / `a[N] -> T` / `a[N][M] -> T`
      // (the `[` must be part of the declarator — before `=`, so `x = a[0] -> T;` stays scalar)
      const arrIdx = tokens.findIndex((t) => t.value === '[');
      if (arrIdx >= 0 && (eqIdx < 0 || arrIdx < eqIdx) && (annIdx < 0 || arrIdx < annIdx)) {
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
        reg.arrays.set(name, { kind: 'fixed' });
        // annotation dims (e.g. `-> int[2][2]`) take precedence over the
        // declarator's own brackets
        const sizeSuffix = typeSfx.dims
          ? typeSfx.dims
          : allSizes.map((s) => `[${s}]`).join('');
        // `i[10]=0->int;` -> `int i[10] = {0};` (already-braced init kept as-is)
        if (eqIdx >= 0 && eqIdx < annIdx) {
          const initVal = expNoSemi(tokens.slice(eqIdx + 1, annIdx));
          const initText = /^\s*\{/.test(initVal) ? initVal : `{${initVal}}`;
          return `${typeCpp(typeText2)} ${name}${sizeSuffix} = ${initText};`;
        }
        return `${typeCpp(typeText2)} ${name}${sizeSuffix};`;
      }

      // `x = value -> T`
      if (eqIdx >= 0 && eqIdx < annIdx) {
        // comma list with initializers: `a, b = 1, 2 -> int` -> `int a = 1, b = 2;`
        const lhsToks = tokens.slice(0, eqIdx);
        const valToks = tokens.slice(eqIdx + 1, annIdx);
        if (lhsToks.some((t) => t.value === ',')) {
          const names = splitComma(lhsToks).map((g) => declName(g));
          const vals = splitComma(valToks);
          if (vals.length === names.length) {
            names.forEach((n, i) => reg.arrays.delete(n));
            if (isStringType(typeText2)) names.forEach((n) => reg.strings.add(n));
if (isSetType(typeText2)) names.forEach((n) => reg.sets.add(n));
            if (isMapType(typeText2)) names.forEach((n) => reg.maps.add(n));
            if (typeSfx.dims) names.forEach((n) => reg.arrays.set(n, { kind: 'fixed' }));
            const parts = names.map((n, i) => {
              const v = vals[i].length ? expNoSemi(vals[i]) : '';
              return `${n}${typeSfx.dims}${v ? ` = ${v}` : ''}`;
            });
            return `${typeCpp(typeText2)} ${parts.join(', ')};`;
          }
          throw new Error(`declaration '${lhsToks.map((t) => t.value).join('')} = ${valToks.map((t) => t.value).join('')}' needs one initializer per name`);
        }
        const lhs = declName(lhsToks);
        const val = expNoSemi(valToks);
        reg.arrays.delete(lhs);
        reg.sets.delete(lhs);
        reg.maps.delete(lhs);
        if (isStringType(typeText2)) reg.strings.add(lhs);
        if (isSetType(typeText2)) reg.sets.add(lhs);
        if (isMapType(typeText2)) reg.maps.add(lhs);
        if (typeSfx.dims) reg.arrays.set(lhs, { kind: 'fixed' });
        return `${typeCpp(typeText2)} ${lhs}${typeSfx.dims} = ${val};`;
      }
      // `x -> T`
      {
        // comma list without initializers: `a, b -> int` -> `int a, b;`
        const lhsToks = tokens.slice(0, annIdx);
        if (lhsToks.some((t) => t.value === ',')) {
          const names = splitComma(lhsToks).map((g) => declName(g));
          names.forEach((n) => {
            reg.arrays.delete(n);
            reg.strings.delete(n);
            reg.queues.delete(n);
            reg.sets.delete(n);
            reg.maps.delete(n);
          });
          if (isStringType(typeText2)) names.forEach((n) => reg.strings.add(n));
          if (/^queue\s*</i.test(typeText2)) names.forEach((n) => reg.queues.set(n, typeText2));
          if (isSetType(typeText2)) names.forEach((n) => reg.sets.add(n));
          if (isMapType(typeText2)) names.forEach((n) => reg.maps.add(n));
          return `${typeCpp(typeText2)} ${names.map((n) => n + typeSfx.dims).join(', ')};`;
        }
        const lhs = declName(lhsToks);
        reg.arrays.delete(lhs);
        reg.strings.delete(lhs);
        reg.queues.delete(lhs);
        reg.sets.delete(lhs);
        reg.maps.delete(lhs);
        if (isStringType(typeText2)) reg.strings.add(lhs);
        if (/^queue\s*</i.test(typeText2)) reg.queues.set(lhs, typeText2);
        if (isSetType(typeText2)) reg.sets.add(lhs);
        if (isMapType(typeText2)) reg.maps.add(lhs);
        return `${typeCpp(typeText2)} ${lhs}${typeSfx.dims};`;
      }
    }

    // -------- custom single operators --------
    const powEq = tokens.findIndex((t) => t.value === '^^=');
    if (powEq >= 0) {
      const lhs = tokens.slice(0, powEq).map((t) => t.value).join('');
      const rhs = expNoSemi(tokens.slice(powEq + 1));
      return `${lhs} = pow(${lhs}, ${rhs});`;
    }
    // set-to-zero operator `##`  (no backslash prefix needed)
    const zeroIdx = tokens.findIndex((t) => t.value === '##');
    if (zeroIdx >= 0 && isPureLvalueCtx(tokens, zeroIdx)) {
      const strReset = (name) => reg.strings.has(name) ? `${name}.clear();` : null;
      const setReset = (name) => reg.sets.has(name) ? `${name}.clear();` : null;
      const queReset = (name) => reg.queues.has(name) ? `${name} = ${reg.queues.get(name)}();` : null;
      if (zeroIdx === 0) {
        // prefix form: `##i` -> `i = 0;`  (analogous to `++i` / `--i`)
        const rhs = expNoSemi(tokens.slice(1));
        const info = reg.arrays.get(rhs);
        if (info && info.kind === 'fixed') return `memset(${rhs}, 0, sizeof(${rhs}));`;
        if (info && info.kind === 'vector') return `${rhs}.clear();`;
        return strReset(rhs) || setReset(rhs) || queReset(rhs) || `${rhs} = 0;`;
      }
      const lhs = tokens.slice(0, zeroIdx).map((t) => t.value).join('');
      const info = reg.arrays.get(lhs);
      if (info && info.kind === 'fixed') return `memset(${lhs}, 0, sizeof(${lhs}));`;
      if (info && info.kind === 'vector') return `${lhs}.clear();`;
      return strReset(lhs) || setReset(lhs) || queReset(lhs) || `${lhs} = 0;`;
    }

    // -------- ordinary expression statement --------
    return `${exp(tokens)};`;
  }

  // -------- for-head => C++ fragment --------
  function headDecl(tokens) {
    // `->` is a type annotation only when followed by a type keyword or
    // registered custom type (same rule as stmtCpp); otherwise `p->x`.
    const ann = tokens.findIndex((t, i) =>
      t.value === '->' && isTypeLike(tokens, i));
    if (ann >= 0) {
      const type = typeCpp(tokens.slice(ann + 1).map((t) => t.value).join(' ').trim());
      const before = tokens.slice(0, ann);
      const eq = before.findIndex((t) => t.value === '=');
      // `name -> type;` (no `=`) declares without initializer
      const name = before.slice(0, eq >= 0 ? eq : before.length).map((t) => t.value).join('');
      const val = eq >= 0 ? expNoSemi(before.slice(eq + 1)) : '';
      return `${type} ${name}${eq >= 0 ? ` = ${val}` : ''}`;
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
      case 'inlineCpp':
        return [s.inner];
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
      /^[A-Za-z_][A-Za-z_0-9]*$/.test(t.value) ||
      t.value === '.' || t.value === '->' ||
      t.value === '[' || t.value === ']');
  }

  // C++-style function headers with False Code annotations in the params:
  // `void pr(int n -> int) {` -> `void pr(int n) {`, `(n -> int)` -> `(int n)`.
  // Only touches the first top-level `(...)` group; `p->x` inside stays put.
  function fixCppParams(tokens) {
    let open = -1, depth = 0;
    for (let i = 0; i < tokens.length; i++) {
      const v = tokens[i].value;
      if (v === '(' && depth === 0) { open = i; break; }
    }
    if (open < 0) return tokens;
    let close = -1;
    depth = 0;
    for (let i = open; i < tokens.length; i++) {
      const v = tokens[i].value;
      if (v === '(') depth++;
      else if (v === ')') { depth--; if (depth === 0) { close = i; break; } }
    }
    if (close < 0) return tokens;
    const head = tokens.slice(0, open);
    const inner = tokens.slice(open + 1, close);
    const tail = tokens.slice(close + 1);
    const groups = splitComma(inner);
    const fixed = groups.map((g) => {
      const ann = g.findIndex((t, i) => t.value === '->' && isTypeLike(g, i));
      if (ann < 0) return g;
      const typeText = g.slice(ann + 1).map((t) => t.value).join(' ');
      const pre = g.slice(0, ann);
      const first = pre[0];
      const isPreTyped = first && first.type === 'word' &&
        (TYPE_WORD.test(first.value) || typeNames.has(first.value));
      if (isPreTyped) return pre;                 // `int n -> int` -> `int n`
      return [{ type: 'word', value: typeCpp(typeText) }].concat(pre); // `n -> int` -> `int n`
    });
    return head.concat([{ type: 'op', value: '(' }],
      fixed.flatMap((g, i) => (i ? [{ type: 'op', value: ',' }] : []).concat(g)),
      [{ type: 'op', value: ')' }], tail);
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
      case 'if': {
        // nested inline `If cond { ... }` (from emitSingle) — recursively render
        // as a block; if every branch is a single inline stmt, stay on one line.
        const parts = [];
        const push = (head, stmts) => {
          if (stmts && stmts.inline && stmts.length === 1) {
            const s = inlineStmt(stmts[0]);
            if (s !== null) { parts.push(`${head} ${s.trim()}${s.endsWith('}') ? '' : ';'}`); return; }
          }
          parts.push(`${head} {`);
          for (const st of stmts || []) {
            const inner = genStmtText(st);
            if (inner !== null) parts.push(`  ${inner}`);
          }
          parts.push('}');
        };
        if (node.cond !== null) push(`if (${expNoSemi(node.cond)})`, node.then);
        for (const el of node.elifs) push(`else if (${expNoSemi(el.cond)})`, el.then);
        if (node.els) push('else', node.els.stmts);
        return parts.join(' ');
      }
      case 'inlineCpp': {
        const parts = node.inner.map((s) => {
          const c = inlineStmt(s);
          if (c === null || c === '') return '';
          // a block result (`{ ... }` / `if (...) {...}`) needs no `;`
          return c.endsWith('}') ? c : c + ';';
        }).filter((c) => c !== '');
        let headCpp = expNoSemi(fixCppParams(node.head));
        // `f = [] (int x) -> int { ... };` is a lambda *declaration*:
        // the RHS has no type, so emit `auto f = ...;`
        if (node.head.length >= 2 && node.head[0].type === 'word' &&
            node.head[1].value === '=' && node.head[0].value.toLowerCase() !== 'return') {
          headCpp = `auto ${headCpp}`;
        }
        return `${headCpp} { ${parts.join(' ')} }` +
          (node.tail.length ? ` ${expNoSemi(node.tail)}` : '');
      }
      case 'empty': return '';
      default: return null;
    }
  }

  // Render one statement as a single line of C++ (no trailing newline), or
  // null when it cannot be expressed on one line. Used by inlineStmt('if')
  // to lay out nested inline blocks.
  function genStmtText(node) {
    const s = inlineStmt(node);
    if (s !== null) return `${s};`;
    if (node.kind === 'if') return inlineStmt(node);
    return null;
  }

  // Whole if / elif / else chain where every branch is a single inline stmt -> one line.
  function emitBlockMerged(node, indent) {
    const p = pad(node.indent ?? indent);
    const parts = [];
    let ok = true;
    const push = (head, stmts) => {
      if (ok && stmts && stmts.inline && stmts.length === 1) {
        const s = inlineStmt(stmts[0]);
        if (s !== null) { parts.push(`${head} ${s.trim()}${s.endsWith('}') ? '' : ';'}`); return; }
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
    const p = pad(node.indent ?? indent);
    const tl = node.tail ? ` ${node.tail}` : '';
    switch (node.kind) {
      case 'inlineCpp': {
        emit(`${p}${inlineStmt(node)}${node.tail.length ? '' : ';'}`);
        return;
      }
      case 'stmt': {
        if (node.body) {
          emit(`${p}${expNoSemi(fixCppParams(node.tokens))} {`);
          // bare `{}` block: C++ local scope — declarations inside must not
          // leak into the enclosing function's registry
          const savedReg = reg;
          reg = {
            arrays: new Map(reg.arrays),
            strings: new Set(reg.strings),
sets: new Set(reg.sets),
            maps: new Set(reg.maps),
            queues: new Map(reg.queues),
          };
          genBlock(node.body, indent + 1);
          reg = savedReg;
          emit(`${p}}`);
        } else {
          emit(`${p}${stmtCpp(squeezeSemi(node.tokens))}${tl}`);
        }
        return;
      }
      case 'raw':
        for (const ln of node.text.split('\n')) emit(`${p}${ln.replace(/^\s+/, '')}`);
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
        if (parts.length) emit(`${p}cout << ${parts.join(' << ')};${tl}`);
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
        if (parsed.length) emit(`${p}cin >> ${parsed.join(' >> ')};${tl}`);
        return;
      }
      case 'return': {
        const e = node.tokens.length ? expNoSemi(node.tokens) : '';
        emit(`${p}return ${e};${tl}`);
        return;
      }
      case 'break':
        emit(`${p}break;${tl}`);
        return;
      case 'continue':
        emit(`${p}continue;${tl}`);
        return;
      case 'empty':
        emit(`${p}${tl}`);
        return;
      case 'if': {
        if (node.cond !== null) {
          emitBlockMerged(node, indent);
        } else if (node.els) {
          const es = node.els.stmts;
          if (es.inline && es.length === 1) {
            const s = inlineStmt(es[0]);
            if (s !== null) {
              emit(`${p}else ${s}${s.endsWith('}') ? '' : ';'}`);
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
            emit(`${p}\tdefault: {`);
            genBlock(c.body, indent + 2);
            emit(`${p}\t}`);
            continue;
          }
          emit(`${p}\tcase ${expNoSemi(c.val)}: {`);
          genBlock(c.body, indent + 2);
          emit(`${p}\t\tbreak;`);
          emit(`${p}\t}`);
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
      case 'dowhile': {
        const cond = node.cond.length ? expNoSemi(node.cond) : 'true';
        emit(`${p}while (${cond});`);
        return;
      }
      case 'do': {
        const cond = node.cond.length ? expNoSemi(node.cond) : null;
        if (node.body.inline && node.body.length === 1 && cond !== null) {
          const s = inlineStmt(node.body[0]);
          if (s !== null) {
            emit(`${p}do ${s}; while (${cond});`);
            return;
          }
        }
        emit(`${p}do {`);
        genBlock(node.body, indent + 1);
        emit(`${p}}`);
        if (cond !== null) emit(`${p}while (${cond});`);
        return;
      }
      case 'def': {
        const isMain = node.name.toLowerCase() === 'main';
        const plainType = (s) => typeCpp((s || '').replace(/\[[^\]]*\]/g, '').trim());
        // forward declaration: `def g() -> int;` -> `int g(params);`
        if (node.body === null) {
          const params = node.params.map((pp) => {
            const t = plainType(pp.type) || 'int';
            if (pp.nesting) return `${'vector<'.repeat(pp.nesting)}${t}${'>'.repeat(pp.nesting)}& ${pp.name}`;
            if (pp.array) return pp.size ? `${t} ${pp.name}[${pp.size}]` : `vector<${t}>& ${pp.name}`;
            return `${t} ${pp.name}`;
          }).join(', ');
          // ret is unknown from the declaration alone; use the later
          // definition's inferred return type when available
          const ret = isMain ? 'int'
            : (node.ret.length ? retTypeCpp(node.ret)
              : (defRet.get(node.name) || 'void'));
          emit(`${p}${ret} ${node.name}(${params});`);
          return;
        }
        // register params in a fresh scope so they never leak into the
        // global registry (a `def f(v<> -> int)` must not overwrite a
        // global `v[10] -> int`)
        const savedReg = reg;
        reg = {
          arrays: new Map(reg.arrays),
          strings: new Set(reg.strings),
sets: new Set(reg.sets),
          maps: new Set(reg.maps),
          queues: new Map(reg.queues),
        };
        const params = node.params.map((pp) => {
          if (pp.name === 'argc') return 'int argc';
          if (pp.name === 'argv') return 'char** argv';
          const t = plainType(pp.type) || 'int';
          if (pp.nesting) {
            reg.arrays.set(pp.name, { kind: 'vector' });
            return `${'vector<'.repeat(pp.nesting)}${t}${'>'.repeat(pp.nesting)}& ${pp.name}`;
          }
          if (pp.array) {
            if (pp.size) {
              reg.arrays.set(pp.name, { kind: 'fixed' });
              return `${t} ${pp.name}[${pp.size}]`;
            }
            reg.arrays.set(pp.name, { kind: 'vector' });
            return `vector<${t}>& ${pp.name}`;
          }
          if (isStringType(pp.type)) reg.strings.add(pp.name);
          if (isSetType(pp.type)) reg.sets.add(pp.name);
          if (isMapType(pp.type)) reg.maps.add(pp.name);
          return `${t} ${pp.name}`;
        }).join(', ');
        const ret = isMain
          ? 'int'
          : (node.ret.length
            ? retTypeCpp(node.ret)
            : (hasReturnValue(node.body) ? 'int' : 'void'));
        const fname = isMain ? 'main' : node.name;
        emit(`${p}${ret} ${fname}(${params}) {`);
        genBlock(node.body, indent + 1);
        reg = savedReg;
        if (isMain && !hasReturn(node.body)) emit(`${p}\treturn 0;`);
        emit(`${p}}`);
        return;
      }
      default:
        throw new Error(`unknown node kind: ${node.kind}`);
    }
  }

  // forward declarations (`Def f(...);`) need the return type of the later
  // definition, so pre-scan the whole AST for each function's inferred ret
  const defRet = new Map();
  (function collectDefs(stmts) {
    for (const s of stmts) {
      if (s.kind === 'def' && s.name && s.body && !defRet.has(s.name)) {
        defRet.set(s.name, hasReturnValue(s.body) ? 'int' : 'void');
      }
      for (const b of childBodies(s)) collectDefs(b);
    }
  })(ast);

  genBlock(ast, 0);
  return HEADER + '\n\n' + lines.join('\n') + '\n';
}

module.exports = { gen };