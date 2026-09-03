import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { CharacterTurnRead, TheaterToolContext, TheaterToolFactory } from '@darwintree/dsh-theater'
import { successfulToolCalls } from './history.js'
import { PERCEIVE_OR_RECALL, projectCharacterTurn } from './projection.js'

export { PERCEIVE_OR_RECALL } from './projection.js'

export const PERCEPTION_RESULT = 'perception_result'
export const THINK = 'think'
export const VOICE_OVER = 'voice_over'
export const WARN = 'warn'
export const RECOMMEND_NEXT_CHARACTER = 'recommend_next_character'
export const END_PERFORMANCE = 'end_performance'

const TERMINAL_TOOLS: readonly string[] = [RECOMMEND_NEXT_CHARACTER, END_PERFORMANCE]

export interface VoiceOverSegment {
  readonly visibleTo: readonly string[]
  readonly content: string
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} requires exactly { ${keys.join(', ')} }`)
  }
}

function emptyConfig(input: unknown): JsonValue {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Role-play Tool config must be an object')
  }
  exact(input as Record<string, unknown>, [], 'Role-play Tool config')
  return {}
}

function requireAgent(exec: ToolRunContext): NonNullable<ToolRunContext['agent']> {
  if (exec.agent === undefined) throw new Error('Role-play Tool requires a calling Agent')
  return exec.agent
}

function requireDm(context: TheaterToolContext, kind: 'top-level' | 'nested'): void {
  if (context.characterId !== 'dm' || context.currentTurnKind() !== kind) {
    throw new Error(`This Tool is available to dm during a ${kind} Turn`)
  }
}

function requireOrdinaryTopLevel(context: TheaterToolContext): void {
  if (context.characterId === 'dm' || context.currentTurnKind() !== 'top-level') {
    throw new Error('This Tool is available to an ordinary Character during a top-level Turn')
  }
}

function validateVoiceOverSegments(value: unknown, context: TheaterToolContext): void {
  if (!Array.isArray(value)) throw new Error('voice_over.segments must be an array')
  const ordinary = context.characterIds.filter(id => id !== 'dm')
  const known = new Set(ordinary)
  const correction = `可用的普通 Character ID：${ordinary.join('、')}。每次 voice_over 的 visibleTo 并集需要覆盖全部普通 Character；无可见内容时使用 content: ""。`
  const covered = new Set<string>()
  value.forEach((raw, index) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`voice_over.segments[${index}] must be an object`)
    }
    const item = raw as Record<string, unknown>
    exact(item, ['visibleTo', 'content'], `voice_over.segments[${index}]`)
    if (!Array.isArray(item.visibleTo)) {
      throw new Error(`voice_over.segments[${index}].visibleTo 必须是 Character ID 数组。${correction}`)
    }
    const invalid = item.visibleTo.filter(id => typeof id !== 'string' || !known.has(id))
    if (invalid.length > 0) {
      const rendered = invalid.map(id => JSON.stringify(id) ?? String(id)).join('、')
      throw new Error(`voice_over.segments[${index}].visibleTo 包含无效 Character ID：${rendered}。${correction}`)
    }
    if (typeof item.content !== 'string') throw new Error(`voice_over.segments[${index}].content must be a string`)
    for (const id of item.visibleTo) covered.add(id)
  })
  const missing = ordinary.filter(id => !covered.has(id))
  if (missing.length > 0) {
    throw new Error(`voice_over.segments 的 visibleTo 并集缺少普通 Character：${missing.join('、')}。补充这些 Character；无可见内容时使用 content: ""。`)
  }
}

function currentTurnStart(events: readonly { readonly type: string }[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === 'turn/start') return index
  }
  return 0
}

function hasVoiceOverSinceTerminal(exec: ToolRunContext): boolean {
  const events = requireAgent(exec).session.events
  const calls = successfulToolCalls(events)
  const lastTerminal = calls.filter(call => TERMINAL_TOOLS.includes(call.name)).at(-1)
  return calls.some(call => call.name === VOICE_OVER && call.resultSeq > (lastTerminal?.resultSeq ?? -1))
}

function requireFirstCurrentCall(
  exec: ToolRunContext,
  names: readonly string[],
  message = `当前 Turn 只接受一次 ${names.join(' 或 ')}`,
): void {
  const events = requireAgent(exec).session.events
  const calls = events.slice(currentTurnStart(events)).filter(event =>
    event.type === 'tool/call' && names.includes(event.data.name))
  if (calls.findIndex(event => event.type === 'tool/call' && event.data.callId === exec.callId) > 0) {
    throw new Error(message)
  }
}

function perceptionResult(turn: CharacterTurnRead): string | undefined {
  const results = successfulToolCalls(turn.events, PERCEPTION_RESULT)
  return results.length === 1 && typeof results[0]?.arguments.content === 'string'
    ? results[0].arguments.content
    : undefined
}

const noOutput = { schema: { type: 'null' as const }, render: () => [] }

export const thinkToolFactory: TheaterToolFactory = {
  kind: THINK,
  resolveConfig: emptyConfig,
  create() {
    return defineTool({
      name: THINK,
      description: [
        '记录不可被其他角色感知的内心独白、隐秘动机与考量，作为后续正文言行的因果源头。',
        '每轮发言开始时必须首先调用；在调用 perceive_or_recall 获取新信息后亦可按需调用。',
        '本次调用不结束 Character Turn，成功后继续生成公开正文或调用其他工具；严禁在公开正文中直接描写心理。',
        '思考内容对 DM 可见，对其他普通角色完全保密（其他角色仅能感知你调用了 think）。',
      ].join(' '),
      parameters: {
        thought: {
          type: 'string',
          required: true,
          description: '以角色第一人称展开的内心活动、动机推演、对他人言行的揣度与后续行动考量。',
        },
      },
      output: noOutput,
      async execute() {
        return null
      },
    })
  },
}

export const perceiveOrRecallToolFactory: TheaterToolFactory = {
  kind: PERCEIVE_OR_RECALL,
  resolveConfig: emptyConfig,
  create(_config, context) {
    return defineTool({
      name: PERCEIVE_OR_RECALL,
      description: [
        '向 DM 探查未知的环境细节或检索未明说的个人记忆；严禁擅自捏造或脑补未知事实。',
        '调用后将由 DM 触发私下裁定并返回结果；本次调用不结束 Character Turn，角色获取结果后继续推进当前发言。',
        '每个 Character Turn 最多调用一次。',
        '问题与裁定结果仅当前角色与 DM 可知，其他普通角色仅能感知你调用了该工具。',
      ].join(' '),
      parameters: {
        content: {
          type: 'string',
          required: true,
          description: '以角色视角向 DM 提出的具体环境感知或记忆检索问题。',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { content: { type: 'string', required: true } },
        },
        render: (_args, value) => [{ type: 'text', text: value.content }],
      },
      async execute(args, exec) {
        exact(args, ['content'], PERCEIVE_OR_RECALL)
        requireOrdinaryTopLevel(context)
        const agent = requireAgent(exec)
        const start = currentTurnStart(agent.session.events)
        requireFirstCurrentCall(
          exec,
          [PERCEIVE_OR_RECALL],
          '当前 Character Turn 已经使用过 perceive_or_recall',
        )

        const prefix: CharacterTurnRead = {
          characterId: context.characterId,
          outcome: 'completed',
          events: agent.session.events.slice(start),
        }
        let instruction = projectCharacterTurn(prefix)
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          const turn = await context.runNestedTurn('dm', [{ type: 'text', text: instruction }])
          const content = perceptionResult(turn)
          if (content !== undefined) return { content }
          instruction = '上一轮感知/回忆裁定未完成：缺少一次成功的 perception_result。'
        }
        agent.cancel({ kind: 'parent' })
        throw new Error('DM 连续三轮未完成感知/回忆裁定')
      },
    })
  },
}

export const perceptionResultToolFactory: TheaterToolFactory = {
  kind: PERCEPTION_RESULT,
  resolveConfig: emptyConfig,
  create(_config, context) {
    return defineTool({
      name: PERCEPTION_RESULT,
      description: '完成当前嵌套感知或回忆裁定。content 写入请求角色可在当前行动中使用的私有事实、记忆、感官判断或不确定性。',
      parameters: { content: { type: 'string', required: true } },
      output: noOutput,
      async execute(args, exec) {
        exact(args, ['content'], PERCEPTION_RESULT)
        requireDm(context, 'nested')
        requireFirstCurrentCall(exec, [PERCEPTION_RESULT])
        exec.concludeTurn()
        return null
      },
    })
  },
}

export const voiceOverToolFactory: TheaterToolFactory = {
  kind: VOICE_OVER,
  resolveConfig: emptyConfig,
  create(_config, context) {
    return defineTool({
      name: VOICE_OVER,
      description: '将 DM 裁定写成各角色实际可见的事实。segments 中每段包含 visibleTo 与 content；所有普通角色均需被覆盖，content 可为空字符串。',
      parameters: {
        segments: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              visibleTo: { type: 'array', required: true, items: { type: 'string' } },
              content: { type: 'string', required: true },
            },
          },
        },
      },
      output: noOutput,
      async execute(args) {
        exact(args, ['segments'], VOICE_OVER)
        requireDm(context, 'top-level')
        validateVoiceOverSegments(args.segments, context)
        return null
      },
    })
  },
}

export const warnToolFactory: TheaterToolFactory = {
  kind: WARN,
  resolveConfig: emptyConfig,
  create(_config, context) {
    return defineTool({
      name: WARN,
      description: '警告一名普通角色的不合规行动。警告会公开给所有普通角色。',
      parameters: {
        target: { type: 'string', required: true, description: '需要警告的普通 Character ID。' },
        reason: { type: 'string', required: true, description: '警告原因。' },
      },
      output: noOutput,
      async execute(args) {
        exact(args, ['target', 'reason'], WARN)
        requireDm(context, 'top-level')
        if (args.target === 'dm' || !context.characterIds.includes(args.target)) {
          throw new Error('warn.target must name an ordinary Character')
        }
        return null
      },
    })
  },
}

export const recommendNextCharacterToolFactory: TheaterToolFactory = {
  kind: RECOMMEND_NEXT_CHARACTER,
  resolveConfig: emptyConfig,
  create(_config, context) {
    return defineTool({
      name: RECOMMEND_NEXT_CHARACTER,
      description: '在当前裁定完成后选择下一位普通角色。reason 用于记录选择依据。',
      parameters: {
        character: { type: 'string', required: true },
        reason: { type: 'string', required: true },
      },
      output: noOutput,
      async execute(args, exec) {
        exact(args, ['character', 'reason'], RECOMMEND_NEXT_CHARACTER)
        requireDm(context, 'top-level')
        if (args.character === 'dm' || !context.characterIds.includes(args.character)) {
          throw new Error('recommend_next_character.character must name an ordinary Character')
        }
        if (!hasVoiceOverSinceTerminal(exec)) throw new Error('当前裁定还需要一次成功的 voice_over')
        exec.concludeTurn()
        return null
      },
    })
  },
}

export const endPerformanceToolFactory: TheaterToolFactory = {
  kind: END_PERFORMANCE,
  resolveConfig: emptyConfig,
  create(_config, context) {
    return defineTool({
      name: END_PERFORMANCE,
      description: '在当前裁定自然收束后结束整场演出。',
      parameters: {},
      output: noOutput,
      async execute(args, exec) {
        exact(args, [], END_PERFORMANCE)
        requireDm(context, 'top-level')
        if (!hasVoiceOverSinceTerminal(exec)) throw new Error('当前裁定还需要一次成功的 voice_over')
        exec.concludeTurn()
        return null
      },
    })
  },
}

export const rolePlayToolFactories = [
  thinkToolFactory,
  perceiveOrRecallToolFactory,
  perceptionResultToolFactory,
  voiceOverToolFactory,
  warnToolFactory,
  recommendNextCharacterToolFactory,
  endPerformanceToolFactory,
] as const
