# AGENTS.md

## Project

"False Code": a Turing-complete programming language that is transpiled (not compiled) into C++ code, targeting common C++ contest syntax. A JS/Node transpiler already exists (`lexer -> parser -> generator -> CLI`).

## Commands

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
- **Type annotation syntax:** `name = value -> type;` or `name -> type;` (the `=` may be omitted; a variable may not be redeclared). Arrays: `a[] -> int` is a vector, `b[10] -> char` is a fixed array, `c[2][3] -> int` a multi-dim fixed array, with `.add()`, `.remove()`, `.len`. Multi-word/pointer types work: `x -> long long;`, `p = &y -> int*;`. Shorthands: `ll`→`long long`, `ull`→`unsigned long long` (valid in decls, params, return types).
- **C++ passthrough:** anything not False Code syntax is emitted (almost) verbatim — `#define`/`#` lines, `struct/class/union { ... }` blocks, `::`, ternaries `a ? b : c`, member access `p->x`, `std::cout`, lambdas, etc. `->` counts as a type annotation ONLY when followed by a type keyword (`int*`, `long long`, ...); otherwise it is C++ `->` member access.
- **Inline bodies:** `def f(i->int)->int { return i * 2; }` and `For/While ... { stmt; stmt; }` on one line work; a trailing `{` alone (or `{ }`) still means the body follows on indented lines. C++ nested functions inside `main` are illegal C++ regardless of the transpiler.
- **Operator quirks (not C++)**: `^^=` is power, `##` sets to zero, `~=` is bitwise NOT (取反), `^=` is XOR.
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
- The `First.md` sample uses `pass` where an out-of-loop placeholder is needed (a loop-less `Continue` passes through verbatim and won't compile — same as C++).
- Functions with `Return` but no `-> ret` fall back to `int`; otherwise `void`.
- Declarations: `x -> T;`, `x = v -> T;`, `x[] -> T`→`vector<T>`, `x[N] -> T`→`T x[N]`, `x[N] = v -> T`→`T x[N] = {v};` (whole-array init), `x[N][M] -> T`→`T x[N][M]` (any empty dim → vector). Anything without `->` is a plain assignment (no implicit declaration).
- Operator mapping in `generator.js`: `^^=`→`pow`, `~=`→bitwise NOT, `##`→`= 0` (statement-level on a declared array: fixed→`memset(a,0,sizeof(a))`, vector→`a.assign(a.size(),0)`; in expressions `##`→`(x = 0)`); `.add()`→`push_back`, `.remove(i)`→`pop_back()` (arg dropped), `.len`→`.size()`. The generator keeps a small `arrays` registry (name → fixed/vector) built from declarations & def params, so pure-lvalue `a##` can zero whole arrays; scalar names fall back to `a = 0;`.
- `Out` prints each argument wrapped in parentheses: `Out a & b;` → `cout << (a & b);`, `Out a ? b : c;` → `cout << (a ? b : c);` (avoids `<<` precedence bugs); `Nl` → `endl`/`'\n'` (no parens). Chained `^^` (power) is converted right-to-left with balanced paren/call scanning: `a ^^ 3 ^^ 2` → `pow(a, pow(3, 2))`.
- `Else` inside `switch` becomes `default:`. Parser is line + indentation based; pure `}` lines are block terminators, never statements.

## Working style

Keep this a self-contained project. Work against documented C++ output correctness, and update `First.md` if the spec needs amending while implementing edge cases.

## Rules

- Speak Chinese no matter what language I say.
- List Bugs before Fix bugs. (List -> wait-ask -> Fix)