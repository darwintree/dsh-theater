# dsh-theater

当前包提供一个用于验证 DeepSeek Harness 插件集成流程的 `greet` 工具。

## 本地集成

以下目录假设 `dsh-theater-new` 与 `deepseek-harness` 位于同一父目录。

先构建插件：

```sh
cd dsh-theater-new
pnpm install --frozen-lockfile
pnpm build
```

将本地 checkout 安装进 DeepSeek Harness 的 Web profile：

```sh
cd ../deepseek-harness
pnpm dsh plugin --profile web add link:../dsh-theater-new/packages/theater
pnpm dsh web --dump-config
```

配置输出中出现 `@darwintree/dsh-theater` 后，启动 Web：

```sh
pnpm dsh web
```

打开 `http://127.0.0.1:3080`，新建会话并输入：

```text
Use the greet tool to greet Ada.
```

模型会调用 `greet`，工具结果为 `Hello, Ada!`。

移除本地插件：

```sh
pnpm dsh plugin --profile web remove @darwintree/dsh-theater
```
