# SYNTAX

False Code language reference. Every rule is given as a sentence template — `Name = Value -> Type` is the template for declarations. `First_for_Agent.md` (the spec) remains authoritative; this file is the readable version.

> Convention: `Value` may be a variable, constant, or expression; `Type` see the type table at the end; `[?]` means optional.

---

## 1. Basics

| Rule | Notes |
|------|-------|
| Case | Keywords are case-insensitive (`Out`/`out`/`OUT` all work); **your own variables/functions are case-sensitive** |
| Comments | `//` single line; triple backticks (```` ``` ````) for multi-line |
| Terminator | Statements end with `;` (same as C++) |
| Entry | `Def Main() { ... }` (optional params `argc -> int, argv -> string[]`) |
| No include | No `#include` needed; the C++ contest header is auto-included |
| Reserved keywords | `in`/`out` are I/O statement keywords — don't use them as ordinary variable names: `in -> T;` / `out -> T;` (no `=`) happen to parse as a declaration of a variable named in/out, but `in = v -> T;` is treated as an input/output statement — rename the variable |

---

## 2. Declarations (most common)

Template: `Name = Value -> Type;` or `Name -> Type;` (the `= Value` part is optional; no redeclaration)

```
a = 10 -> int;        // int a = 10;
b -> long long;       // long long b;
x = 3.14 -> double;   // double x = 3.14;
s = "hi" -> string;   // string s = "hi";
p = &b -> int*;       // pointer: int* p = &b;
```

Multiple variables on one line (comma-separated, one type):

```
a, b -> int;          // int a, b;
c, d = 1, 2 -> int;   // int c = 1, d = 2;   (one initializer per name required)
```

> Note: one annotation carries exactly one type; `i, s -> int, string` is rejected.

### Arrays

| Template | Emits | Notes |
|----------|-------|-------|
| `a[10] -> int;` | `int a[10];` | fixed-size array |
| `a[2][3] -> int;` | `int a[2][3];` | multi-dimensional |
| `a[3] = {1,2,3} -> int;` | `int a[3] = {1,2,3};` | with initializer |
| `arr = {1,2,3} -> int[3];` | `int arr[3] = {1,2,3};` | size may live in the type |
| `c[] = "hi" -> char;` | `char c[] = {"hi"};` | C-style, length inferred |
| `v<> -> int;` | `vector<int> v;` | **dynamic array** (more `<` = deeper: `v<<>> -> int` = `vector<vector<int>>`) |

> The type annotation wins: `v<> -> char[10]` = `char v[10]` (the `<>` is redundant); `d[10] -> char<>` = `vector<char> d[10]`.

### Containers

| Template | Emits |
|----------|-------|
| `v.add(1);` | `v.push_back(1);` |
| `v.remove(0);` | `v.pop_back();` |
| `Out v.len;` | `cout << v.size();` |
| `s.len` | `.length()` when `s` is a string |
| `st.add(x);` / `st.remove(x);` | `insert`/`erase` when `st` is a `set`/`map` |
| `q -> queue<int>;` | `queue<int> q;` (also `map<int,int>`, `set<int>`, `std::unique_ptr<int>`, any template type) |

---

## 3. Input / Output

| Template | Notes |
|----------|-------|
| `Out a, b, c;` | comma-separated; each expression auto-wrapped in parens to avoid `<<` precedence bugs |
| `Out Nl;` | newline (like `endl`) |
| `Out a & b;` | any expression works, e.g. `Out a ? b : c;` |
| `In to a, b;` | input |
| `getchar()` | C++ semantics |

---

## 4. Functions

Template:

```
Def Name(Param -> Type, ...) -> ReturnType {
	...
	Return ...;
}
```

```
Def Add(a -> int, b -> int) -> int {   // no return type = int; plain C++ style `def f(int a, int b)` works too
	Return a + b;
}
Def Main() {
	Out Add(2, 3), Nl;
	Return 0;
}
```

- No `Return` → automatically `void`; `Main` without `Return` gets an implicit `return 0;`.
- Recursion, references (`int& x`), pointer params (`Node* p`) all supported.
- `template <typename T>` lines, `namespace`, `struct`/`class` header/closing lines pass through verbatim; their bodies are parsed as False Code.

---

## 5. Branching

| Template | Notes |
|----------|-------|
| `If Cond? Then Stmt;` | single line |
| `If Cond?` + indented body | Python style (`?` + Tab) |
| `Elif Cond? Then ...;` | else-if |
| `Else { ... }` | else (uses braces) |

```
If a == 1?
	Then Out "one", Nl;
Elif a == 2?
	Then Out "two", Nl;
Else {
	Out "other", Nl;
}
```

`Switch`: `Switch Value { Case Val: ... Else ... }` — `Else` inside a switch becomes `default:`; `case` labels may sit at the same indent as `switch` (C++ style).

---

## 6. Loops

| Template | Notes |
|----------|-------|
| `While Cond { ... }` | or `Then SingleStmt;` |
| `For Init; Cond; Step { ... }` | parens optional: `For i=0 -> int; i<n; ++i {` |
| `do { ... } While Cond;` | multi-line or single-line |
| `Break;` / `Continue;` | break / skip iteration (case-insensitive) |

```
For i = 0 -> int; i < 5; ++i {
	If i == 2 Then Continue;
	Out i, " ";
}
```

---

## 7. Operators

| Symbol | Meaning |
|--------|---------|
| `^^=` | power: `a ^^= b;` → `a = pow(a, b);` |
| `a ^^ b` | power in expressions: `Out 2 ^^ 3 ^^ 2;` → `pow(2, pow(3, 2))` (right-assoc) |
| `a ##` / `## a` | set to zero: `a##;` → `a = 0;`; whole-array zeroing (`memset`); vector/string `clear()` |
| `^` / `^=` | bitwise XOR, passes through (same as C++) |
| everything else | `==` `!=` `+=` `-=` `*=` `/=` `%=` `++` `--` `?:` etc. — same as C++ |

---

## 8. Types

`int long float double char string bool` plus fixed-width types (`int64_t`, ...).

| Shorthand | Expands to |
|-----------|------------|
| `ll` | `long long` |
| `ull` | `unsigned long long` |

Also: pointer / multi-word types (`char*`, `int*`, `long long`, `unsigned long long`); template types (`vector<int>`, `map<int,int>`, `pair<int,int>`, `set<...>`, `queue<...>`, `std::...`).

---

## 9. Misc

| Form | Notes |
|------|-------|
| `Die;` / `Pass;` / `...` | empty statement (not program exit); the `;` after `...` is optional when the line ends there, and no-op lines do not break an `If/Elif/Else` chain |
| `#define X 1` / `#ifdef` | preprocessor lines pass through verbatim (even flush-left) |
| `std::sort`, `next_permutation` | any C++ identifier passes through; STL is fully usable |
| `a ? b : c`, `p->x`, lambdas | C++ expressions pass through (`->` is a type annotation only when followed by a type keyword) |
| single-line C++ functions | `bool isEven(int x) { Return x % 2 == 0; };` — False Code keywords inside inline `{}` are auto-lowered to C++ |

## Hard rules

1. `Name = TypeName;` is wrong — the right side of `=` is a value, not a type (write `m -> map<int,int>;`, not `m = map<int,int> -> map<int,int>;`).
2. Member access cannot carry a type annotation: `head->next = x;` not `head->next = x -> int;`.
3. No redeclaration of a variable.
4. `Continue` outside a loop is illegal (same as C++).
5. `^` is XOR, `^^` is power — don't mix them up.
