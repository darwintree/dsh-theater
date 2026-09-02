# Implementation Trace: DM voice_over guidance

Date: 2026-09-02
Source: 用户反馈“没有告诉 DM 在场角色有哪些，voice_over 的错误响应也没有提供明确指示”
Language: 中文

## Entries

### 1. 动态角色 ID 的提示词归属

Type: unresolved-implementation-decision

Context:
需求要求 DM 在调用 `voice_over` 前知道普通 Character ID，但没有规定动态名单的提示文案存放位置。项目此前已决定将通用提示词放入 preset YML，而 Character ID 来自同一 YML 的角色声明。

Decision:
在 preset YML 增加带 `{characterIds}` 占位符的 DM 在场角色提示，preset contribution 用声明顺序生成 ID 列表并替换占位符。

Reason:
提示文案继续由 YML 管理，TS 只负责把当前 preset 的真实角色集合投影进 system prompt，其他角色阵容可复用同一机制。

Follow-up:
None.

### 2. voice_over 校验错误的修正信息

Type: unresolved-implementation-decision

Context:
需求要求错误响应明确，但没有规定错误消息结构。校验器已经拥有合法 ID、非法值和缺失覆盖项。

Decision:
非法 ID 错误返回完整合法 ID 集合、全员覆盖规则和空内容写法；覆盖不足错误返回具体缺失 ID 和空内容写法。

Reason:
DM 可以仅依据当前 Tool Result 修正下一次调用，不需要猜测角色标识，也不需要重新读取其他上下文。

Follow-up:
None.
