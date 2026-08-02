## 这是一个编程语言项目，你可以用任何一种语言来实现他。(图灵完备)
## 就像伪代码，你需要写一个解释器，让这个语言的代码转义为可运行的C++代码，注意，这个语言不需要编译，仅需要转译为C++
## 实现大多C++竞赛语法.
- 使用```多行注释,//单行
- 不需要include，like python
- When Only one 语句. Use "Then"
- Else . Use "{}"
- 默认语句不区分大小写，自定义变量/函数区分。
---
# 语法
## Out/Output(都行) : Output 语法:
- 	Out a,b,c,d... 
-   用','分割
-	NL/Nl/nl/nL:换行
## In/Input(都行) : Input 语法
- 	In to a,b,c...
-   getchar同C++语法
## 赋值使用：
- 	变量名=数值->类型; 等号可以省略(变量名->类型;)
-   不可以重名
## 数组使用：
- 同C++	
```False Code
a[] -> int; //Vector
b[10] -> char; //Array
a.add(1); //pushback
a.remove(0); //popback
Out a.len // 获取数组长度
a[0]=1; //Let the first one be 1.
In to b[0];
```
## 字符串/字符同C++语法(""使用string,''使用char)
## 基本类型同C++
- string,char,int,long,float,double,uint8_t,uint16_t,uint32_t,uint64_t,int8_t,int16_t,int32_t,int64_t ...
- long long 可简写为 ll;unsigned long long 可简写为 ull
## 实现sizeof，同C++
## 函数定义使用：
```FalseCode
 	Def FunctionName() -> ReturnType:
		...
		Return ...;
```
## 程序开始
- Def Main() {}
## 空语句
- 使用Die/Pass/...
## 符号使用:
-	==
-	!=
-	^=
-	^^= (次方)
-	%=
-	/=
-	## (设为0)
-	++
-	--
-	~= (取反)
-	...
---
- If,Elif,Else后使用 ?+Tab/Then,like python
- Case后使用?+Tab/Then,like python
- while,for,switch使用{}或者Then+单语句
---
## 再加别的，自己想。
```FalseCode
Def Main() { //可以写argc,argv Def Main(argc -> int,argv -> string[])
	a=1 -> int;
	b=2 -> long;
	If a == 1?
		Then Output "Hello World";
		Out Nl;
	Elif a==2?
		Then In to a;
		Out Nl; // Like cout << endl; in C++
	Elif a==3 Then continue;
	Else Then continue;
	Out a;
	switch a {
		Case 2? Then Break;
		Case 0?
			Out 1;
	}
	F=1->float;
	For (i = 0->int;++i<100) { // Like C++
		a |= 1; // Or
		a ^^= 1; // Pow
		a ^= 1; // Xor
		a %= 1; // Mod
	}
	While (true)
	Then break;
	
	Return 0;
}
```