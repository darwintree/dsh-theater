# 实现追踪：Gomoku Agent Preset

Date: 2026-08-20
Source: 用户请求“theater没有入口，new 里应该加个preset吧”
Language: 中文

## Entries

### 1. 通过用户 preset root 暴露第三方入口

Type: unresolved-implementation-decision

Context:
用户要求给新版 Theater 增加 Web 入口，但 DeepSeek Harness 的 CLI 会在组合 profile 时固定系统 preset root，第三方 bundle 不能追加自己的系统 root；Harness 仍会自动扫描 `$DSH_HOME/.agent-presets`。

Decision:
把完整 Gomoku preset 随 `@darwintree/dsh-theater-gomoku` 包发布，并在本地调试时将该目录复制到隔离 DSH home 的 `.agent-presets/gomoku`；Harness 的 preset 扫描器只接收真实目录，明确忽略符号链接。

Reason:
复用 Harness 已有的 preset 发现协议即可得到 Web 入口，不修改 Harness，也不让插件在启动时写用户目录。

Follow-up:
若 Harness 后续支持 bundle 声明 preset roots，再改为安装即自动发现。

### 2. Preset 只承担游戏身份

Type: unresolved-implementation-decision

Context:
Gomoku 插件目前由 host bundle 全局注册 `place_stone`，用户没有要求改变工具作用域；在 preset 中再次挂载插件会重复运行时组合。

Decision:
Preset 只挂载完整的 Gomoku persona，继续复用 host 已注册的 `place_stone` 和 `StageService`。

Reason:
这是产生可选入口和正确游戏提示所需的最小改动，也保持当前插件加载契约不变。

Follow-up:
None.

### 3. 用单个开发脚本组装纯净环境

Type: unresolved-implementation-decision

Context:
用户要求在保留 preset 时提供 setup 脚本或文档，但没有规定调试环境是否复用现有 profile；现有 profile 可能继续携带旧 Theater bundle。

Decision:
新增 `scripts/dev-web.sh`：构建当前工作区、创建临时 DSH home、复制 Gomoku preset、生成只注入新版 Stage 与 Gomoku 的绝对路径 overlay，再启动相邻的 `deepseek-harness`。非相邻 checkout 通过 `DSH_HARNESS_DIR` 指定。

Reason:
一条命令即可稳定重现本次确认过的纯净环境，同时不修改用户已有的 `~/.dsh` profile。

Follow-up:
None.

### 4. 以官方 profile/plugin 流程替代开发脚本

Type: deviation

Context:
用户确认只提供 Harness 官方指引，不保留仓库自定义 setup 脚本。官方 `dsh plugin` 只会激活声明了 `dsh.bundle` 的包，而 Gomoku 运行时又要求先提供 `ctx.stages`。

Decision:
删除 `scripts/dev-web.sh`，将 `@darwintree/dsh-stage` 声明为独立 bundle；文档改为依次通过 `dsh plugin --profile web add` 安装 Stage 与 Gomoku，并把包内 preset 复制到 Harness 官方用户 preset root。

Reason:
安装、组合检查、启动和移除都走 Harness 已有 CLI；Stage 与 Gomoku 的加载顺序也由两个明确的 bundle 层表达，不再依赖绝对路径 overlay。

Follow-up:
None.
