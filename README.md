# False Code

一门转译为 C++ 的编程语言(Transpile,非编译):`*.fc` 源文件经 JS 转译器生成 C++ 源码,再用 g++ 编译运行。零依赖的纯 Node.js 项目。

## 快速开始

前提:已安装 Node.js(≥ 18)和 g++(如 MinGW)。

```bash
# 转译单个文件:  node src/main.js <in.fc> [out.cpp]
node src/main.js hello.fc          # 生成 hello.cpp(默认输出到输入文件旁)
node src/main.js hello.fc out.cpp  # 指定输出路径

# 运行端到端测试套件(转译 → g++ 编译 → 对照 .out 运行)
node tests/run.js
```

> Windows 提示:`npm test` 可能被 PowerShell 执行策略拦截(`npm.ps1` 被禁),请直接运行 `node tests/run.js`。

## 安装为全局命令

注册全局 `falsecode` 命令后,任意目录都能用:

```bash
npm link
falsecode hello.fc          # 等价于 node src/main.js hello.fc
```

## 在新电脑上使用(clone 后)

1. 安装 Node.js(≥ 18)和 g++。
2. 克隆并进入项目:
   ```bash
   git clone https://github.com/qwaszxopklnmso/FalseCode.git
   cd FalseCode
   ```
3. 注册全局命令(每台机器各做一次):
   ```bash
   npm link
   ```
   不想注册的话,直接用 `node src/main.js <in.fc>` 即可。
4. 运行测试:`node tests/run.js`(需要 g++)。

项目零依赖,无需 `npm install`。

## 目录结构

```
src/         转译器(lexer → parser → generator → CLI)
bin/fc.js    全局命令入口
tests/       端到端测试(fixtures: *.fc + 期望输出 *.out)
example/     示例程序
Luogu_test/  用 False Code 写的洛谷题解
First.md     语言规范(唯一权威参考)
```

## 语言速览

- 入口:`Def Main() { ... }`,返回 `int`(可省略 `Return 0;`)
- 类型注解:`x = 1 -> int;`、`a[] -> int`(vector)、`b[10] -> char`(定长数组)
- 控制流:`If cond ?` / `If cond {` / `Then` 单语句、`For`/`While`、`Switch`/`Case`
- 输入输出:`Out a, b, c;`(`Nl` = 换行)、`In to a, b, c;`
- 函数:`def Fn(a -> int) -> int { Return a * 2; }`
- C++ 语法可直接透传:`#define`、`struct {}`、`std::cout`、`p->x`、三元 `?:` 等

完整规范见 [`First.md`](First.md),实现细节见 [`AGENTS.md`](AGENTS.md)。
