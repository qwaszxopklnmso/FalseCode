# False Code

A programming language that transpiles to C++. Write `*.fc` source files, get C++ code out, compile with g++. Zero dependencies, pure Node.js.

## Install

```sh
npm install -g @qwaszxopklnm/falsecode
```

Requires Node.js >= 18 and a C++ compiler (`g++` / `g++.exe`, set the `GXX` env var to override).

## Usage

```sh
falsecode hello.fc            # transpile hello.fc -> hello.cpp
falsecode hello.fc out.cpp    # specify the output path
falsecode hello.fc -c         # transpile + compile with g++ (also: falsecode -c hello.fc)
falsecode -v                  # version
falsecode -u                  # language syntax reference (zh/en: falsecode -u en)
falsecode -d                  # this README
```

## Quick tour

- Entry point: `Def Main() { ... }` (implicit `return 0;`)
- Type annotations: `x = 1 -> int;`, `v<> -> int` (vector), `b[10] -> char` (fixed array), `c[] -> char` (C-style array)
- Control flow: `If cond {` / `If cond Then stmt;`, `For`/`While`, `Switch`/`Case`
- I/O: `Out a, b, c;` (`Nl` = newline), `In to a, b, c;`
- Functions: `def Fn(a -> int) -> int { Return a * 2; }`
- C++ syntax passes through: `#define`, `struct {}`, `std::cout`, `p->x`, ternaries, etc.

## Example

```
Def Main() {
    n = 0 -> int;
    For (i = 1 -> int; i <= 10; ++i) {
        n = n + i;
    }
    Out "sum = ", n, Nl;
}
```

## License

MIT
