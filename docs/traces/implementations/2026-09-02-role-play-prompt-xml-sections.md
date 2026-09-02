# Implementation Trace: Role-play prompt XML sections

Date: 2026-09-02
Source: 用户要求“组装提示词时，不同的构成部分用 XML 标签包裹”
Language: 中文

## Entries

### 1. 标签边界与名称

Type: unresolved-implementation-decision

Context:
需求明确了组件需要标签，但没有指定标签名称，也没有要求把整个 prompt 作为可供 XML parser 解析的文档。

Decision:
按现有组装组件增加语义化 section 标签，不增加根标签。DM 使用 `dm_guidance`、`common_scene_card`、`character_cards`、`opening`、`cast`；普通 Character 使用 `common_scene_card`、`character_card`、`character_guidance`。

Reason:
标签与 agent 实际获得的信息边界一一对应，同时保持 DM guidance 仍是 prompt 顶部的第一个 section；不引入解析器、转义或新的 preset 字段。

Follow-up:
None.

### 2. 普通 Character guidance 顺序

Type: requirement-change

Context:
用户要求 `character_guidance` 也放到最前。

Decision:
普通 Character 的 section 顺序调整为 `character_guidance`、`common_scene_card`、`character_card`；DM 顺序不变。

Reason:
角色在阅读场景和私有角色卡前先获得本轮行为规则。

Follow-up:
None.

### 3. 在场角色并入 DM guidance

Type: requirement-change

Context:
用户要求删除独立 `dmCast`，将其内容直接合并到 `dmGuidance`。

Decision:
`dmGuidance` 自身包含 `{characterIds}` 占位符和在场角色说明；组装时替换该占位符，不再生成独立 `cast` section。

Reason:
DM 的工具参数约束属于 DM 行为指导，同一 section 已提供执行这些工具所需的全部角色 ID。

Follow-up:
None.
