# Implementation Trace: Role-play system prompt preview

Date: 2026-09-02
Source: 用户要求“有一个办法来预览组装后的 system prompt”
Language: 中文

## Entries

### 1. 首版预览范围

Type: unresolved-implementation-decision

Context:
需求随后明确需要预览普通 Character prompt，但没有要求启动完整运行时。

Decision:
提供 package-local 命令，调用真实 preset contribution，并根据可选 Character ID 原样输出对应 system prompt；省略 ID 时默认输出 DM。

Reason:
同一个入口可检查 DM 与普通 Character；复用真实组装路径能避免预览逻辑与运行逻辑漂移，同时无需创建 Performance 或调用模型。

Follow-up:
None.
