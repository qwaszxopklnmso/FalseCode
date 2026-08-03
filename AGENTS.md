# AGENTS.md

## Project

"False Code": a Turing-complete programming language that is transpiled (not compiled) into C++ code, targeting common C++ contest syntax. A JS/Node transpiler already exists (`lexer -> parser -> generator -> CLI`).

## Commands

- In WSL: `source .env.wsl.sh` first (bridges Windows `node`/`g++` into PATH; file is machine-specific and git-ignored, do not commit it).
- Transpile a file: `node src/main.js <in.fc> [out.cpp]` (default out = `in name + .cpp` next to input).
- Run the end-to-end suite (transpiles → compiles with `g++` → runs each fixture against its `.out`): `node tests/run.js` (or `npm.cmd test`; plain `npm test` fails because `npm.ps1` is blocked by the execution policy on this machine).
- Fixtures live in `tests/*.fc` with expected stdout in `tests/*.out` (`*.in` supplies stdin). Add a fixture for any new syntax WIP.

## Sources of truth

- `First.md` — the language spec. It is the only canonical reference; treat it as authoritative. Do not invent syntax that contradicts it.
- `src/lexer.js` — per-line tokenizer; strips `//` comments (regex simply strips any `//` comment), and pairs ```` ` ``` ```` as the multiline comment.

## Traps agents will hit

- **Transpile, don't compile:** False Code runs by being translated into C++ source; there is no interpreter execution and no `include` (Python-style).
- **Case sensitivity is inverted:** the language is case-insensitive by default, but `自定义变量/函数` (user-defined variables/functions) are case-sensitive.
- **Entry point is `Def Main(){}`** (optionally with `argc -> int, argv -> string[]`).
- **Type annotation syntax:** `name = value -> type;` or `name -> type;` (the `=` may be omitted; a variable may not be redeclared). Arrays: `x<> -> int` is a vector (nested `<<>>` → `vector<vector<int>>`; `<<<>>>` → 3 levels), `b[10] -> char` is a fixed array, `c[2][3] -> int` a multi-dim fixed array, `c[] -> char` → `char c[];` (C-style array; `c[] = "hi" -> char;` → `char c[] = {"hi"};` with length inferred), all with `.add()`, `.remove()`, `.len` (vector only). Multi-word/pointer types work: `x -> long long;`, `p = &y -> int*;`. Shorthands: `ll`→`long long`, `ull`→`unsigned long long` (valid in decls, params, return types).
- **C++ passthrough:** anything not False Code syntax is emitted (almost) verbatim — `#define`/`#` lines, `::`, ternaries `a ? b : c`, member access `p->x`, `std::cout`, lambdas, etc. `->` counts as a type annotation ONLY when followed by a type keyword (`int*`, `long long`, ...); otherwise it is C++ `->` member access.
- **Inline C++ blocks on one line:** a line whose top-level `{...}` closes on the same line becomes an `inlineCpp` node — its inner statements are parsed as False Code. This covers single-line C++ functions (`bool isEven(int x) { Return x % 2 == 0; };` → body converted), single-line lambda declarations (`f = [](int x) -> int { Return x * x; };` → `auto f = ...;`), and `if (x) { Return y; }` style inline blocks. A `{` nested inside `(...)` (e.g. `vec.add({1,2});`) is NOT an inline block; a `-> type` after the block (e.g. `arr = {1,2,3} -> int[3];`) means a False Code declaration, not an inline block. Lambda bodies inside *expressions* (`Out [](int n){ If n > 2 Then Return n; Return -n; }(7);`) also get their `Return`/`Break`/`Continue`/`If…Then` keywords lowercased to C++ (via `convertBraceKeywords` in `exp`).
- **Inline bodies:** `def f(i->int)->int { return i * 2; }` and `For/While ... { stmt; stmt; }` on one line work; a trailing `{` alone (or `{ }`) still means the body follows on indented lines. C++ nested functions inside `main` are illegal C++ regardless of the transpiler.
- **Operator quirks (not C++)**: `^^=` is power, `##` sets to zero, `^=` is XOR. Note `^`/`^=` themselves are plain C++ bitwise XOR and pass through verbatim (`a^=b` stays `a ^= b;`, `b = a ^ b` stays as-is) — only `^^`/`^^=` are False Code's power operator.
- **Block syntax:** `If/Elif/Case` use `?` + Tab or `Then` (Python-style), while `Else` uses `{}`; `while/for/switch` use `{}` or `Then` + single statement. `Break`/`Continue` are capitalised in examples.
- Comments: triple-backtick `python-style multiline` and `//` for single line.
- **Spec is intentionally open-ended:** it ends with "再加别的，自己想" (add the rest yourself). Reasonable extensions are expected, but keep existing rules intact.
- Input/output: `Out a,b,c...` (comma-separated, `Nl` = newline), `In to a,b,c...`, `getchar` follows C++ semantics.
- `Def Fn() -> ReturnType:` ... `Return ...;` for functions.

## Transpiler behaviour (decisions, already baked into src/)

- Generated C++ is self-contained: a hard-coded `#include <bits/stdc++.h>` + `using namespace std;` header; source never contains `Main`-level `include`.
- `Def Main()` → `int main()`, params `argc -> int`→`int argc`, `argv -> string[]`→`char** argv`; an implicit `return 0;` is added if main has no `Return`.
- `For`/`While` headers may use parentheses OR omit them (`For (i=0 -> int; i<4; ++i)` and `For i=0 -> int; i<4; ++i {` are equivalent; note the spec sample splits fields with `;`). Parentheses are treated as the header form ONLY when the header's first token is `(`; otherwise a leading `(...)` is a function call in the condition (e.g. `While f(n) < 10 {`). A `->` in the head is a type annotation only if followed by a type keyword — `For i = p->a; ...` is member access.
- `Then` may start a body line (`Then Break;`) or follow the condition inline (`Elif x==3 Then Continue;`). `Break`/`Continue`/`Return` are case-insensitive. `Die`/`Pass` emit an empty statement.
- do-while: `do { ... } While cond;` (multi-line block, `} While` tail line becomes a `dowhile` node) or single-line `do Out 1; While false;` / `do { Out 1; } While cond;`. Generator has `case 'do'` and `case 'dowhile'`.
- struct/class/union: header line + closing line (`};` / `}a[105];`) pass through verbatim; interior lines are parsed as False Code (so members/methods can be written in False Code), and C++-style `if (cond) stmt;` / `else` inside works (readConditionOf handles `(`-wrapped inline stmts ending in `;`; parseIf chain skips leading `}` on `} Else {` lines).
- Multi-line C++ brace initializers (`arr[2][3] = { ... };` or `rmap[...] = {...};`): a line whose top-level `=` is followed by a trailing `{` passes the whole block through verbatim until braces balance (e.g. global `int16_t rmap[3][2] = {...};`). Lines starting with `#` (`#ifdef`/`#endif`/...) never end an indented block, even flush-left — they are emitted with current indent (leading whitespace before `#` is legal C++).
- Beware `using namespace std;` in the header: a user global named `map` clashes with `std::map` under `<bits/stdc++.h>` (works with bare `<iostream>`). Rename the variable (e.g. `mp`) when porting such code.
- The `First.md` sample uses `pass` where an out-of-loop placeholder is needed (a loop-less `Continue` passes through verbatim and won't compile — same as C++).
- Functions with `Return` but no `-> ret` fall back to `int`; otherwise `void`.
- Declarations: `x -> T;`, `x = v -> T;`, `x[] -> T`→`T x[]` (C-style, empty bracket kept verbatim; `c[] = "hi" -> char`→`char c[] = {"hi"};`), `x<> -> T`→`vector<T>` (nested `<>` pairs → nested vectors; `<<`/`>>` lex as shift ops and are re-split in the declarator), `x[N] -> T`→`T x[N]`, `x[N] = v -> T`→`T x[N] = {v};` (whole-array init; an already-braced init `= {1,2,3}` is not double-wrapped), `x[N][M] -> T`→`T x[N][M]`. A type annotation may carry a C++-style array suffix: `arr = {1,2,3} -> int[3];` → `int arr[3] = {1,2,3};`, and the annotation suffix wins over the declarator: `v<> -> char[10]`→`char v[10]`, `d[10] -> elem<>`→`vector<elem> d[10]`, `E[10] -> char<>`→`vector<char> E[10]`, `c -> char[10]`→`char c[10]`. Anything without `->` is a plain assignment (no implicit declaration).
- `def` params support C++-style prefix types: `def Dot(Vec o) -> int`, `def f(int a[], int n)` (→ `vector<int>` when `[]`), `def g(Node* p)`. Without `->`/prefix the param type defaults to `int`.
- Operator mapping in `generator.js`: `^^=`→`pow`, `##`→`= 0` (statement-level on a declared array: fixed→`memset(a,0,sizeof(a))`, vector→`a.assign(a.size(),0)`, declared string→`a.clear()`; in expressions `##`→`(x = 0)`); `.add()`→`push_back`, `.remove(i)`→`pop_back()` (arg dropped), `.len`→`.size()`. The generator keeps small `arrays` and `strings` registries (name → fixed/vector / is-string) built from declarations & def params, so pure-lvalue `a##` can zero whole arrays; scalar names fall back to `a = 0;`.
- Type annotation `->` also fires on **template types** (`x -> vector<int>;`, `m -> map<int,int>;`, `u -> std::unique_ptr<int>;`) and any qualified `ns::Name` (`gen -> std::mt19937;`); member access `p->x` / `1 < struct1->a` stay C++ passthrough. `squeezeSemi`/`stripSemi` only strip *trailing* `;` — embedded `;` (e.g. a lambda body `{ a = 42; }`, `for(;;)`) survives.
- `Out` prints each argument wrapped in parentheses: `Out a & b;` → `cout << (a & b);`, `Out a ? b : c;` → `cout << (a ? b : c);` (avoids `<<` precedence bugs); `Nl` → `endl`/`'\n'` (no parens). Chained `^^` (power) is converted right-to-left with balanced paren/call scanning: `a ^^ 3 ^^ 2` → `pow(a, pow(3, 2))`.
- `Else` inside `switch` becomes `default:`. Parser is line + indentation based; pure `}` lines are block terminators, never statements. `case` labels may sit at the same indent as the `switch` header (C++ style); `case 1: stmt;` on the same line works; a bare `default:` line parses like a case with no value.
- **Indentation levels:** `indentLevelOf = tabs + ceil(spaces/2)` — 2 and 4 spaces are distinct levels (a 2-space body inside a 2-space header nests correctly).
- **Forward declarations:** `Def f(x -> bool);` emits a C++ prototype; with no `-> ret` its return type is inferred from the later definition (`defRet` pre-scan: value-returning → `int`, else `void`). Declaration and definition must agree on type and name (names are case-sensitive).
- **`else if` chains:** `else if (cond) stmt;` / `else if (cond) { ... }` lines parse as elif links, not as a final else; a bare `}` line after an inline `if (c) stmt;` is never consumed by the if-chain (only block-form ifs close with `}`).
- **Ternary `?`:** only a *trailing* `?` is a header terminator; mid-expression `?` (ternary) is kept — `if (a) return b ? c : d;` works.
- **Bare `{}` blocks** are C++ local scopes: declarations inside are isolated in a registry snapshot (they do not leak out; a same-named global array stays zeroable via `##` outside the block). Snapshot is taken from the *current* registry, not the global one, so function-local arrays and def-param vectors survive nested blocks.
- Sample input/output files live in `problems_test/standard/*.in|.out` and are committed (gitignore exemption); do not write `.in`/`.out` into the project root.

## Working style

Keep this a self-contained project. Work against documented C++ output correctness, and update `First.md` if the spec needs amending while implementing edge cases.

## Rules

- Speak Chinese no matter what language I say.
- List Bugs before Fix bugs. (List -> wait-ask -> Fix)