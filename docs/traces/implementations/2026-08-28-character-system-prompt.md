# Implementation Trace: Character System Prompt

Date: 2026-08-28
Source: 用户请求“preset里也应该要写上character agent的systemprompt”
Language: 中文

## Entries

### 1. 映射到 DSH scoped persona

Type: unresolved-implementation-decision

Context:
请求要求 Character preset 声明 System Prompt，但没有约定是替换完整 Prompt Assembly，还是替换宿主 persona 并保留 Harness identity、工具说明及运行时上下文。

Decision:
每个 Character 必须声明非空 `systemPrompt`。Theater 将其作为 scoped `deployment:persona` 注册，覆盖宿主 persona，但保留 DSH 的其他原生 Prompt section；该值进入 `theater/configured` 并参与 Resume/Fork 兼容性判断。

Reason:
这是 DSH 为 Agent preset 提供的原生覆盖点，既消除默认 Coding persona，又不重复实现 System Prompt 组装。将值持久化可保证恢复或分支不会在 Character 行为定义已变化时静默继续。

Follow-up:
None.

### 2. 删除 Headless 全局 persona workaround

Type: deviation

Context:
Headless patch 先前在部署全局覆盖 persona，导致所有 Character 只能共享同一 Prompt，且配置不属于 Performance preset。

Decision:
删除 Headless patch 的全局 persona 覆盖，由两个 Character 的 `systemPrompt` 分别负责。

Reason:
新的 preset 字段已经覆盖该需求，保留全局 workaround 会造成两个配置来源。

Follow-up:
None.
