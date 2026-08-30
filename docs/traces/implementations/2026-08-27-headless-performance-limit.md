# Implementation Trace: Headless Performance 上限

Date: 2026-08-27
Source: 用户请求“写一个 headless cli 试一下，不过我们需要限制一下轮数上限”
Language: 中文

## Entries

### 1. 将轮数上限解释为落子数

Type: interpretation

Context:
“轮数”可能表示一次 Character 行动，也可能表示黑白各行动一次组成的整轮；两者会在奇数限制及中途状态上产生不同语义。

Decision:
使用显式配置名 `maxMoves`，每个完成的 Character Segment（一次合法落子）计为一 move。独立的 headless Gomoku preset 配置为 4 moves；正式 preset 仍运行至棋局结束。

Reason:
Gomoku Stage 已有权威的 `moveNumber`，Director 可以直接读取并决定完成，无需 Theater 增加第二套计数或暂停状态。

Follow-up:
None.

### 2. Headless Character 不继承 coding workspace persona

Type: unresolved-implementation-decision

Context:
DSH headless profile 的默认 coding persona 引用了 `{{cwd}}`，而当前 Performance Character 没有 workspace 元数据，真实组装会在 prompt 渲染时失败。

Decision:
Gomoku headless patch 将系统 persona 替换为不依赖 workspace 变量的最小 Character persona，不给 Character 伪造 cwd。

Reason:
当前 Character 只有 Performance 分发的棋类 Tools，workspace 对其没有领域含义；覆盖入口组合比向 Theater 核心引入无效 cwd 更符合边界。

Follow-up:
None.

### 3. 动态推进取代专用 smoke 配置

Type: deviation

Context:
后续 Theater 已提供 process-local `setAutoAdvance()`，原先为限制 smoke 轮数而加入的 Gomoku `maxMoves` 和独立 preset 不再必要。

Decision:
Headless runner 复用正式 `two-character-gomoku` preset，在第一个 Character Segment 开始时关闭自动推进；该 Segment 结算后再显式推进三次，共完成四个 Segment。删除 `maxMoves`、独立 headless preset 及其专用测试。

Reason:
Smoke 只需验证有限次完整 Character 行动链路；使用 Theater 已有的运行时控制避免把测试上限混入 Gomoku Director 的领域完成条件。

Follow-up:
None.
