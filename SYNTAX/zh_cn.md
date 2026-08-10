# SYNTAX

False Code 语法规范。所有写法都按「句式模板」给出，`Name = Value -> Type` 就是声明语句的模板。每条规则以 First_for_Agent.md（语言规格）为准，本文件是它的人话版。

> 约定：`值` 可以是变量、常量或表达式；`类型` 见文末「类型表」；`[?]` 表示可省略。

---

## 1. 基本规则

| 规则 | 说明 |
|------|------|
| 大小写 | 关键字不区分大小写（`Out`/`out`/`OUT` 都行）；**你自己定义的变量/函数名区分大小写** |
| 注释 | `//` 单行；三个反引号 ``` ``` ``` 多行 |
| 结尾 | 语句以 `;` 结尾（与 C++ 一致） |
| 入口 | `Def Main() { ... }`（可选参数 `argc -> int, argv -> string[]`） |
| 不 include | 不用写 `#include`，自动包含 C++ 竞赛头文件 |

---

## 2. 声明（最常用）

模板：`变量 = 值 -> 类型;` 或 `变量 -> 类型;`（`= 值` 可省略，但不能重名声明）

```
a = 10 -> int;        // int a = 10;
b -> long long;       // long long b;
x = 3.14 -> double;   // double x = 3.14;
s = "hi" -> string;   // string s = "hi";
p = &b -> int*;       // 指针 int* p = &b;
```

多变量一行声明（逗号分隔，类型只写一次）：

```
a, b -> int;          // int a, b;
c, d = 1, 2 -> int;   // int c = 1, d = 2;   （初值个数须与变量数一致）
```

> 注意：一个类型注解只能有一种类型，`i, s -> int, string` 不支持（会报错）。

### 数组

| 模板 | 生成 | 说明 |
|------|------|------|
| `a[10] -> int;` | `int a[10];` | 定长数组 |
| `a[2][3] -> int;` | `int a[2][3];` | 多维 |
| `a[3] = {1,2,3} -> int;` | `int a[3] = {1,2,3};` | 带初始化 |
| `arr = {1,2,3} -> int[3];` | `int arr[3] = {1,2,3};` | 类型里写长度也行 |
| `c[] = "hi" -> char;` | `char c[] = {"hi"};` | C 风格，长度自动推 |
| `v<> -> int;` | `vector<int> v;` | **动态数组**（`<` 越多层数越深：`v<<>> -> int` = `vector<vector<int>>`） |

> 类型注解优先：`v<> -> char[10]` = `char v[10]`（写 `<>` 多余）；`d[10] -> char<>` = `vector<char> d[10]`。

### 容器操作（vector 等）

| 模板 | 生成 |
|------|------|
| `v.add(1);` | `v.push_back(1);` |
| `v.remove(0);` | `v.pop_back();` |
| `Out v.len;` | `cout << v.size();` |
| `s.len` | 字符串时生成 `.length()` |
| `st.add(x);` / `st.remove(x);` | `set`/`map` 时生成 `insert`/`erase` |
| `q -> queue<int>;` | `queue<int> q;`（也可 `map<int,int>`、`set<int>`、`std::unique_ptr<int>` 等模板类型） |

---

## 3. 输入输出

| 模板 | 说明 |
|------|------|
| `Out a, b, c;` | 输出，逗号分隔，各表达式自动加括号防错 |
| `Out Nl;` | 换行（等价 `endl`） |
| `Out a & b;` | 表达式随意：`Out a ? b : c;` 也行 |
| `In to a, b;` | 输入 |
| `getchar()` | 与 C++ 一致 |

---

## 4. 函数

模板：

```
Def 函数名(参数 -> 类型, ...) -> 返回类型 {
	...
	Return 返回值;
}
```

```
Def Add(a -> int, b -> int) -> int {   // 无返回类型 = int；纯 C++ 风格 `def f(int a, int b)` 也行
	Return a + b;
}
Def Main() {
	Out Add(2, 3), Nl;
	Return 0;
}
```

- 没有 `Return` 的函数自动是 `void`；`Main` 没有 `Return` 时自动补 `return 0;`。
- 递归、引用 `int& x`、指针参数 `Node* p` 都支持。
- `template <typename T>` 行、`namespace`、`struct`/`class` 头尾行直接透传，内部行按 False Code 写。

---

## 5. 分支

| 模板 | 说明 |
|------|------|
| `If 条件? Then 语句;` | 单行 |
| `If 条件?` + 缩进多行 | Python 风格（`?` + Tab） |
| `Elif 条件? Then ...;` | 否则如果 |
| `Else { ... }` | 否则（用大括号） |

```
If a == 1?
	Then Out "one", Nl;
Elif a == 2?
	Then Out "two", Nl;
Else {
	Out "other", Nl;
}
```

`Switch`：`Switch 值 { Case 值: ... Else ... }`——`Else` 在 switch 里变成 `default:`；`case` 标签可以跟 switch 同缩进（C++ 风格）。

---

## 6. 循环

| 模板 | 说明 |
|------|------|
| `While 条件 { ... }` | 也可 `Then 单语句;` |
| `For 初值; 条件; 步进 { ... }` | 括号可有可无：`For i=0 -> int; i<n; ++i {` |
| `do { ... } While 条件;` | 多行或单行都行 |
| `Break;` / `Continue;` | 跳出 / 跳过本轮（大小写不敏感） |

```
For i = 0 -> int; i < 5; ++i {
	If i == 2 Then Continue;
	Out i, " ";
}
```

---

## 7. 运算符

| 符号 | 含义 |
|------|------|
| `^^=` | 次方：`a ^^= b;` → `a = pow(a, b);` |
| `a ^^ b` | 次方（表达式）：`Out 2 ^^ 3 ^^ 2;` → `pow(2, pow(3, 2))`（右结合） |
| `a ##` / `## a` | 归零：`a##;` → `a = 0;`；数组整体清零（`memset`）；vector/字符串 `clear()` |
| `^` / `^=` | 按位异或，原样透传（同 C++） |
| 其余 | `==` `!=` `+=` `-=` `*=` `/=` `%=` `++` `--` `?:` 等，全部同 C++ |

---

## 8. 类型表

`int long float double char string bool` + 定宽类型（`int64_t` 等）都支持。

| 简写 | 展开 |
|------|------|
| `ll` | `long long` |
| `ull` | `unsigned long long` |

其他：`char*`、`int*`、`long long`、`unsigned long long` 等指针/多词类型；模板类型 `vector<int>`、`map<int,int>`、`pair<int,int>`、`set<...>`、`queue<...>`、`std::...`。

---

## 9. 杂项

| 写法 | 说明 |
|------|------|
| `Die;` / `Pass;` / `...` | 空语句（不是退出程序）；`...` 后可省略分号（换行结尾即可），空语句行不会打断 `If/Elif/Else` 链 |
| `#define X 1` / `#ifdef` | 预处理器行原样透传（哪怕顶格） |
| `std::sort`、`next_permutation` | 任何 C++ 标识符直接透传，STL 随便用 |
| `a ? b : c`、`p->x`、`lambda` | C++ 表达式原样透传（`->` 后跟类型关键字才算类型注解） |
| 单行 C++ 函数 | `bool isEven(int x) { Return x % 2 == 0; };` 行内 `{}` 里的 False Code 关键字自动转 C++ |

## 规则红线

1. `变量 = 类型名;` 是错的——`=` 右边是值，不是类型（写 `m -> map<int,int>;` 而不是 `m = map<int,int> -> map<int,int>;`）。
2. 成员访问不能带类型注解：`head->next = x;` 而不是 `head->next = x -> int;`。
3. 变量不能重名声明。
4. 循环外的 `Continue` 不合法（与 C++ 一致）。
5. `^` 是异或，`^^` 才是次方，别搞混。
