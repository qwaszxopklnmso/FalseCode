# False Code

一门转译为 C++ 的编程语言（Transpile，非编译）：`*.fc` 源文件经 JS 转译器生成 C++ 源码，再用 g++ 编译运行。零依赖的纯 Node.js 项目。

## 安装

```sh
npm install -g @qwaszxopklnm/falsecode
```

需要 Node.js ≥ 18 和 C++ 编译器（`g++` / `g++.exe`，可用环境变量 `GXX` 指定编译器）。

## 使用

```sh
falsecode hello.fc            # 转译 hello.fc -> hello.cpp
falsecode hello.fc out.cpp    # 指定输出路径
falsecode hello.fc -c         # 转译后用 g++ 自动编译（等价写法：falsecode -c hello.fc）
falsecode -v                  # 输出版本号
falsecode -u                  # 语言语法参考（英文：falsecode -u en）
falsecode -d                  # 显示本说明
```

## 快速上手

- 入口：`Def Main() { ... }`（自动补 `return 0;`）
- 类型注解：`x = 1 -> int;`、`v<> -> int`（vector 动态数组）、`b[10] -> char`（定长数组）、`c[] -> char`（C 风格数组）
- 控制流：`If cond {` / `If cond Then 语句;`、`For` / `While`、`Switch` / `Case`
- 输入输出：`Out a, b, c;`（`Nl` 换行）、`In to a, b, c;`
- 函数：`def Fn(a -> int) -> int { Return a * 2; }`
- C++ 语法可直接透传：`#define`、`struct {}`、`std::cout`、`p->x`、三元 `?:` 等

## 示例

```
Def Main() {
    n = 0 -> int;
    For (i = 1 -> int; i <= 10; ++i) {
        n = n + i;
    }
    Out "sum = ", n, Nl;
}
```

## 许可证

MIT
