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

> Windows / PowerShell 提示:PowerShell 的默认执行策略会拦截 npm 的 `.ps1` 包装脚本(表现为 `npm test` 报 "无法加载 npm.ps1"),但 `.cmd` 版本不受影响。在本机验证可行的两种方式:
>
> 1. 直接调用 `.cmd` 版本:`npm.cmd test`、`falsecode.cmd <in.fc>`
> 2. 放开当前用户的脚本执行策略(推荐,之后 `npm`/`falsecode` 都能直接用):
>    ```powershell
>    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
>    ```
>    无需管理员权限;查看当前策略:`Get-ExecutionPolicy -Scope CurrentUser`。

## 安装为全局命令

注册全局 `falsecode` 命令后,任意目录都能用:

```bash
npm link
falsecode hello.fc          # 等价于 node src/main.js hello.fc
```

`npm link` 会在全局目录生成 `falsecode.cmd` / `falsecode.ps1` 等包装脚本(本机为 `C:\Users\<用户名>\AppData\Roaming\npm\`)。命令名特意取 `falsecode` 而非 `fc`,因为 PowerShell 内置了 `fc` 这个别名。

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

---

AI 制作提示:本项目由 **DeepSeek** 辅助开发与维护。
