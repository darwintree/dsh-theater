# Implementation Trace: Stage-free Role-play

Date: 2026-09-01
Source: `.issues/20260901_open_implement-stage-free-role-play-scheduling.md` and the user's `v3.md` prompt requirement
Language: Chinese

## Entries

### 1. v3 提示词的装配边界

Type: interpretation

Context:
Spec 规定 Role-play 包负责 Director 与五个 Tool，场景、角色名单和 system prompt 继续使用 Theater preset contribution；用户进一步指定使用 `docs/character/raw/v3.md`，但该文档没有 DM 卡，也没有规定 Markdown 在发布包中的加载方式。

Decision:
Role-play 包提供调度所需的 DM/普通角色提示词片段，并提供从 `v3.md` 读取共同场景卡、三张角色卡与开场词的 V3 preset contribution。DM prompt 由共同场景卡、开场词和 DM 调度职责组成；普通角色 prompt 由共同场景卡、对应私有角色卡和普通角色调度职责组成。

Reason:
这直接使用用户指定的内容，同时不把 Fate 场景固化进通用 Director 或 Tool。仓库当前是私有 workspace，V3 preset 直接读取仓库内的源 Markdown，暂不增加生成脚本或复制资产。

Follow-up:
若 Role-play 包需要独立发布，再把 `v3.md` 作为 package asset 随包分发。

### 2. 未成功的感知 Tool Result 投影

Type: unresolved-implementation-decision

Context:
Spec 要求完整投影 Tool calls/results，并规定成功 `perception_result` 的文本格式，但没有规定重复调用或参数错误产生的错误 Tool Result 如何投影给顶层 DM。

Decision:
成功结果使用 `[角色感知/回忆结果]`；错误结果使用 `[角色感知/回忆失败]`，保留其模型可见错误文本。

Reason:
顶层 DM 需要看到完整 ReAct 过程，失败不能被误写成已成立的感知事实。

Follow-up:
None.

### 3. V3 原始材料不作为运行时依赖

Type: conflict

Context:
第 1 项将 `docs/character/raw/v3.md` 视为 preset 的运行时输入；用户随后明确该文件只是一次性参考材料，最终会被删除。

Decision:
将共同场景、三张角色卡和开场词原样固化到 V3 preset 源码中，不保留文件读取或路径依赖。

Reason:
preset 应当自包含；删除原始材料不会改变构建或运行行为。

Follow-up:
None.

### 4. V3 场景数据改为 package-local YAML

Type: requirement-change

Context:
用户希望场景数据具有通用格式，而不是固化在 TypeScript 中。

Decision:
`preset/v3.yml` 保存共同场景、开场词和任意数量的 `{ id, card }`；V3 preset 读取并校验该 package asset。DM 与普通角色的调度提示继续由 Role-play 代码提供。

Reason:
替换故事与角色名单只需修改数据文件，调度规则仍集中在 Role-play module 内；YAML 随 package 发布，不依赖仓库外原始材料。

Follow-up:
None.

### 5. YAML 中提示词包装字段的形状

Type: unresolved-implementation-decision

Context:
用户要求将剩余的 system guidance 与包装标签移入 YAML，但没有规定标签如何表达随角色序号变化的内容。

Decision:
在 `prompts` 下保存 `dmGuidance`、`characterGuidance`、`characterCardHeading` 与 `openingHeading`；`characterCardHeading` 可包含 `{index}`，由 preset 装配时替换为一基序号。

Reason:
四个字段覆盖当前全部 system prompt 固定文本，只引入一个必要的占位符，不增加模板引擎。

Follow-up:
None.

## Discussion Trace Audit

Source: `docs/traces/discussion/2026-09-01-role-play-scheduling.md`

- 1.1 — implemented: Theater accepts zero Stages; V3 contributes none.
- 1.2 — implemented: no Role-play Transcript; reads are rebuilt from Performance and Character Sessions.
- 1.3 — out of scope as decided: no user override API or state.
- 1.4 — implemented: ordinary assistant text is projected as a public attempt; no `speak_or_action` Tool exists.
- 2.1 — implemented: `DirectorContext.readSettledTurns()` is public.
- 2.2 — implemented: the shared read is exactly `{ characterId, outcome, events }`; top-level reads omit nested Turns.
- 2.3 — implemented: `TheaterToolContext.runNestedTurn()` owns nested execution and returns that read.
- 2.4 — implemented and integration-tested: nested DM settles LIFO, bypasses Director, and outer ReAct continues.
- 2.5 — implemented: existing flat Segment Events are unchanged; kind is derived from the stack.
- 3.1 — implemented: the first Instruction is exactly `开始演出。`; V3 scene and cast live in DM system prompt.
- 3.2 — implemented: a settled ordinary Turn is projected in full to top-level DM.
- 3.3 — implemented: terminal Tools require a prior successful `voice_over`; recommendation or end concludes the Turn.
- 3.4 — implemented and tested: incomplete top-level DM gets failure-only repair, at most three Turns.
- 3.5 — implemented and tested: successful voice-overs in an incomplete Turn remain facts and satisfy its repair.
- 3.6 — implemented: `character` schedules; `reason` remains only in the durable Tool call.
- 4.1 — implemented from current outer Turn Events; no counter is stored.
- 4.2 — implemented and tested: a second call is an error result and opens no nested Segment.
- 4.3 — implemented and tested: the first nested Instruction is the outer projection through the current call.
- 4.4 — implemented: missing `perception_result` opens a failure-only retry, at most three nested Turns.
- 4.5 — implemented and tested: three failures cancel the outer Agent Turn and fail the Main Loop.
- 5.1 — implemented: projector keeps assistant text and Tool calls/results, excluding instruction and execution metadata.
- 5.2 — implemented and exact-string tested with the agreed natural-language labels and no wrapper.
- 5.3 — implemented: nested receives the prefix; top-level receives the completed Turn.
- 5.4 — implemented and tested: selection delivers chronological visible voice-overs since that Character's previous action, including empty strings.
- 5.5 — implemented: facts enter a Character Session only through its selected Turn Instruction.
- 6.1 — implemented: the package registers exactly the five agreed Role-play Tools; no d20 or auxiliary category.
- 6.2 — implemented: Tool schemas and execution checks enforce the agreed exact fields.
- 6.3 — implemented and tested: `visibleTo` accepts only ordinary IDs, covers the roster union, and permits empty content.
- 6.4 — implemented: V3 catalogs are static; every Tool validates DM identity and derived Turn kind at execution.
- 6.5 — implemented: successful perception/recommendation/end calls use native `concludeTurn()`; failures continue ReAct.
- 7.1 — implemented: Director uses an O(n) durable scan; no cursor, inbox, retry record, or projection cache exists.
- 7.2 — implemented: projection remains Role-play-owned; no new contribution point, dynamic Tool catalog, or hidden state object exists.
- 7.3 — respected: Stage, Transcript, d20, user override, compatibility adapter, and speculative extension points remain absent.
