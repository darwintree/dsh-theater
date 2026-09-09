import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import * as AgentInstructions from '@deepseek-ai/dsh-agent-instructions'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, {
  LlmAdapter,
  ReasoningEffortId,
  type ContentBlock,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { MockLlmAdapter, type Behaviour, type MockResponse } from '@darwintree/dsh-llm-mock'
import StageService from '@darwintree/dsh-stage'
import TheaterService, { characterSessionId } from '@darwintree/dsh-theater'
import * as RolePlay from '../src/index.ts'

const here = dirname(fileURLToPath(import.meta.url))
function blockText(blocks: readonly ContentBlock[]): string {
  return blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

function latestUserText(options: Parameters<Behaviour>[0]): string {
  const message = [...options.messages].reverse().find(candidate =>
    candidate.role === 'user' && blockText(candidate.content).length > 0)
  return message === undefined ? '' : blockText(message.content)
}

function call(id: string, name: string, args: unknown) {
  return { type: 'tool-call' as const, id, name, arguments: JSON.stringify(args) }
}

function sessionTitle(session: Session): string | undefined {
  const event = session.events.findLast(candidate => String(candidate.type) === 'session/title')
  return (event as unknown as { data?: { title?: string } } | undefined)?.data?.title
}

class RolePlayMockAdapter extends LlmAdapter {
  constructor(private readonly behaviour: Behaviour) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      inputModalities: ['text'],
      reasoning: { efforts: [
        { id: ReasoningEffortId('low'), name: 'Low' },
        { id: ReasoningEffortId('medium'), name: 'Medium' },
        { id: ReasoningEffortId('high'), name: 'High' },
      ] },
    })
  }

  override stream(options: Parameters<Behaviour>[0]): AsyncIterable<StreamChunk> {
    return new MockLlmAdapter(this.behaviour, { model: options.model }).stream(options)
  }
}

async function setup(behaviour: Behaviour, persistenceRoot?: string): Promise<Context> {
  const presetRoot = await mkdtemp(join(tmpdir(), 'role-play-preset-'))
  const preset = join(presetRoot, 'v3')
  await mkdir(preset)
  const plugin = fileURLToPath(new URL('../dist/preset.js', import.meta.url))
  await writeFile(join(preset, 'agent.cordis.yml'), `- id: v3\n  name: ${JSON.stringify(plugin)}\n`)

  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(here).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  if (persistenceRoot !== undefined) {
    await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot, compression: 'none' })
  }
  await ctx.plugin(StageService)
  await ctx.plugin(SystemPrompt, { persona: 'Host persona.' })
  ctx.systemPrompt.context({ name: 'test:ambient', order: 0, text: 'ambient runtime context' })
  await ctx.plugin(LocalFileSystem, { cwd: '/' })
  await ctx.plugin(AgentInstructions, { dshHome: presetRoot, maxBytes: 65536 })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
  await ctx.plugin(AgentDefaultModel, { provider: 'mock', model: 'scripted' })
  await ctx.plugin(AgentPresets, {
    default: 'v3',
    roots: [{ path: presetRoot, trust: 'system' }],
    includeUserRoot: false,
  })
  ctx.llm.registerAdapter(['commandcode'], new RolePlayMockAdapter(behaviour))
  await ctx.plugin(TheaterService)
  await ctx.plugin(RolePlay)
  return ctx
}

describe('Stage-free Role-play', () => {
  it('keeps Character ReAct open across nested perception and adjudicates the complete Turn', async () => {
    const systems = new Map<string, string | undefined>()
    const behaviour: Behaviour = (options): MockResponse => {
      const sessionId = String(options.sessionId)
      systems.set(sessionId, options.system)
      const user = latestUserText(options)
      if (sessionId.endsWith('/characters/dm')) {
        const count = options.messages.filter(message => message.role === 'assistant').length
        if (user === '开始演出。') return count === 0
          ? { content: [call('opening', 'voice_over', { segments: [
              { visibleTo: ['saber', 'rider', 'archer'], content: '征服王举起酒杯，邀请三位王者开宴。' },
            ] })] }
          : { content: [call('choose-rider', 'recommend_next_character', {
              character: 'rider', reason: '宴会由征服王发起。',
            })] }
        if (count === 2 && user.includes('【rider】询问：')) return { content: [
          call('perception', 'perception_result', { content: '酒香正常，庭院结界仍有微弱裂隙。' }),
        ] }
        if (user.includes('[rider尝试说话/行动]')) return count === 3
          ? { content: [call('closing', 'voice_over', { segments: [
              { visibleTo: ['saber', 'rider'], content: '酒液在月光下泛起清亮的波纹。' },
              { visibleTo: ['archer'], content: '' },
            ] })] }
          : { content: [call('choose-archer', 'recommend_next_character', {
              character: 'archer', reason: 'Archer 可以回应 Rider 的举杯。',
            })] }
        if (user.includes('[archer尝试说话/行动]')) return count === 5
          ? { content: [call('final', 'voice_over', { segments: [
              { visibleTo: ['saber', 'rider', 'archer'], content: 'Archer 接过酒杯。' },
            ] })] }
          : { content: [call('end', 'end_performance', {})] }
      }
      if (sessionId.endsWith('/characters/rider')) {
        const count = options.messages.filter(message => message.role === 'assistant').length
        if (count === 0) return { content: [
          call('think-opening', 'think', { thought: '酒宴还未真正开始，我先观察另外两位王。' }),
        ] }
        return count === 1
          ? { content: [
              { type: 'text', text: 'Rider仰头大笑，先闻了闻桶中的酒。' },
              call('ask-wine', 'perceive_or_recall', { content: '这桶酒或庭院里是否有异常魔力？' }),
            ] }
          : { content: [{ type: 'text', text: '他把酒斟满三杯，向另外两位王举杯。' }] }
      }
      if (sessionId.endsWith('/characters/archer')) {
        return { content: [{ type: 'text', text: '我接过酒杯，审视其中的酒液。' }] }
      }
      throw new Error(`unexpected model request for ${sessionId}: ${user}`)
    }

    const ctx = await setup(behaviour)
    const performanceId = SessionId('role-play-success')
    await ctx.theater.create({ performanceId, presetId: 'v3', cwd: here })
    await ctx.theater.whenIdle(performanceId)

    for (const character of ['dm', 'saber', 'rider', 'archer']) {
      const session = ctx.sessions.get(characterSessionId(performanceId, character))!
      expect(session.events.some(event => event.type === 'user/message'
        && event.data.source.kind === 'agent-instructions')).toBe(false)
      expect(session.events.some(event => event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt')).toBe(false)
    }

    expect(ctx.theater.read(performanceId)).toMatchObject({ phase: 'completed', stages: {} })
    const performance = ctx.sessions.get(performanceId)!
    expect(performance.events.find(event => event.type === 'theater/configured')).toMatchObject({
      data: {
        characters: [
          { id: 'dm', model: { provider: 'commandcode', model: 'google/gemini-3.8-flash', reasoningEffort: 'medium' } },
          { id: 'saber', model: { provider: 'commandcode', model: 'google/gemini-3.8-flash', reasoningEffort: 'low' } },
          { id: 'rider', model: { provider: 'commandcode', model: 'google/gemini-3.8-flash', reasoningEffort: 'low' } },
          { id: 'archer', model: { provider: 'commandcode', model: 'google/gemini-3.8-flash', reasoningEffort: 'low' } },
        ],
      },
    })
    expect(sessionTitle(performance)).toBe('王之酒宴')
    expect(performance.events
      .filter(event => event.type === 'theater/segment-started' || event.type === 'theater/segment-ended')
      .map(event => [event.type, event.data.characterId])).toEqual([
      ['theater/segment-started', 'dm'],
      ['theater/segment-ended', 'dm'],
      ['theater/segment-started', 'rider'],
      ['theater/segment-started', 'dm'],
      ['theater/segment-ended', 'dm'],
      ['theater/segment-ended', 'rider'],
      ['theater/segment-started', 'dm'],
      ['theater/segment-ended', 'dm'],
      ['theater/segment-started', 'archer'],
      ['theater/segment-ended', 'archer'],
      ['theater/segment-started', 'dm'],
      ['theater/segment-ended', 'dm'],
    ])

    const rider = ctx.sessions.get(characterSessionId(performanceId, 'rider'))!
    expect(sessionTitle(rider)).toBe('王之酒宴 · Rider')
    expect(sessionTitle(ctx.sessions.get(characterSessionId(performanceId, 'saber'))!))
      .toBe('王之酒宴 · Saber')
    expect(sessionTitle(ctx.sessions.get(characterSessionId(performanceId, 'archer'))!))
      .toBe('王之酒宴 · Archer')
    const riderInstructions = rider.events
      .filter(event => event.type === 'user/message')
      .map(event => blockText(event.data.content))
    expect(riderInstructions[0]).toBe('征服王举起酒杯，邀请三位王者开宴。')
    expect(rider.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(rider.events.filter(event => event.type === 'assistant/message')).toHaveLength(3)
    const thinkResult = rider.events.find(event => event.type === 'tool/result'
      && event.data.message.source.callId === 'think-opening')
    expect(thinkResult?.type === 'tool/result' && thinkResult.data.message.content[0].isError).toBe(false)
    expect(thinkResult?.type === 'tool/result'
      && blockText(thinkResult.data.message.content[0].content)).toBe('')

    const archer = ctx.sessions.get(characterSessionId(performanceId, 'archer'))!
    const archerInstruction = archer.events.find(event => event.type === 'user/message')
    expect(archerInstruction?.type === 'user/message' && archerInstruction.data.content).toEqual([
      { type: 'text', text: '征服王举起酒杯，邀请三位王者开宴。' },
      { type: 'text', text: '<character_tool character="rider" name="think" />' },
      { type: 'text', text: '<character_message character="rider">\nRider仰头大笑，先闻了闻桶中的酒。\n</character_message>' },
      { type: 'text', text: '<character_tool character="rider" name="perceive_or_recall" />' },
      { type: 'text', text: '<character_message character="rider">\n他把酒斟满三杯，向另外两位王举杯。\n</character_message>' },
      { type: 'text', text: '' },
    ])

    const dm = ctx.sessions.get(characterSessionId(performanceId, 'dm'))!
    expect(dm.events.find(event => event.type === 'request/header')).toMatchObject({
      data: { header: { config: { provider: 'commandcode', model: 'google/gemini-3.8-flash', reasoningEffort: 'medium' } } },
    })
    expect(rider.events.find(event => event.type === 'request/header')).toMatchObject({
      data: { header: { config: { provider: 'commandcode', model: 'google/gemini-3.8-flash', reasoningEffort: 'low' } } },
    })
    expect(sessionTitle(dm)).toBe('王之酒宴 · DM')
    const dmInstructions = dm.events
      .filter(event => event.type === 'user/message' && event.data.source.kind === 'plugin')
      .map(event => blockText(event.data.content))
    expect(dmInstructions).toHaveLength(4)
    expect(dmInstructions[1]).toContain('【rider】询问：这桶酒或庭院里是否有异常魔力？')
    expect(dmInstructions[2]).toBe([
      '[rider调用think]',
      '{"thought":"酒宴还未真正开始，我先观察另外两位王。"}',
      '[rider工具结果:think]',
      '',
      '[rider尝试说话/行动]',
      'Rider仰头大笑，先闻了闻桶中的酒。',
      '【rider】询问：这桶酒或庭院里是否有异常魔力？',
      '[rider感知/回忆结果]',
      '酒香正常，庭院结界仍有微弱裂隙。',
      '[rider尝试说话/行动]',
      '他把酒斟满三杯，向另外两位王举杯。',
    ].join('\n'))
    expect(dmInstructions[2]).not.toContain('本回合指令')
    expect(blockText(archerInstruction?.type === 'user/message' ? archerInstruction.data.content : []))
      .not.toContain('酒宴还未真正开始，我先观察另外两位王。')
    expect(blockText(archerInstruction?.type === 'user/message' ? archerInstruction.data.content : []))
      .not.toContain('这桶酒或庭院里是否有异常魔力？')
    const dmSystem = systems.get(String(characterSessionId(performanceId, 'dm'))) ?? ''
    expect(dmSystem).not.toContain('You are an AI agent powered by DeepSeek Harness.')
    expect(dmSystem).not.toContain('Check the [exit code: N] marker on every bash result')
    expect(dmSystem).not.toContain('Use the ralph tool ONLY when the direct human explicitly asks')
    expect(dmSystem).toContain('<dm_guidance>\n你正在参与一场多人角色扮演模拟。你是这场角色扮演的 DM')
    expect(dmSystem).toContain('</dm_guidance>\n\n<common_scene_card>')
    expect(dmSystem).toContain('</common_scene_card>\n\n<character_cards>')
    expect(dmSystem).toContain('</character_cards>\n\n<opening>')
    expect(dmSystem).toMatch(/<opening>[\s\S]*<\/opening>$/)
    expect(dmSystem).toContain([
      '【在场角色】',
      'voice_over、warn 与 recommend_next_character 使用以下 Character ID：saber、rider、archer。',
    ].join('\n'))
    expect(dmSystem.indexOf('voice_over、warn 与 recommend_next_character 使用以下 Character ID'))
      .toBeLessThan(dmSystem.indexOf('</dm_guidance>'))
    const riderSystem = systems.get(String(characterSessionId(performanceId, 'rider'))) ?? ''
    expect(riderSystem).toContain('<character_guidance>\n你正在参与一场多人角色扮演模拟。')
    expect(riderSystem).toContain('</character_guidance>\n\n<common_scene_card>')
    expect(riderSystem).toContain('</common_scene_card>\n\n<character_card>\n你是Rider。')

    const childId = SessionId('role-play-fork')
    await ctx.theater.fork({
      sourcePerformanceId: performanceId,
      cursor: ctx.theater.read(performanceId).forkablePositions[1]!,
      childPerformanceId: childId,
    })
    await ctx.theater.whenIdle(childId)
    expect(ctx.theater.read(childId)).toMatchObject({ phase: 'completed', stages: {} })
    expect(sessionTitle(ctx.sessions.get(childId)!)).toBe('王之酒宴')
    const childRider = ctx.sessions.get(characterSessionId(childId, 'rider'))!
    expect(sessionTitle(childRider)).toBe('王之酒宴 · Rider')
    expect(childRider.events
      .filter(event => event.type === 'user/message')
      .map(event => blockText(event.data.content))[0])
      .toBe('征服王举起酒杯，邀请三位王者开宴。')
  })

  it('tells DM how to correct invalid voice_over visibility', async () => {
    const behaviour: Behaviour = (options): MockResponse => {
      const sessionId = String(options.sessionId)
      const count = options.messages.filter(message => message.role === 'assistant').length
      if (!sessionId.endsWith('/characters/dm')) throw new Error(`unexpected request for ${sessionId}`)
      if (count === 0) return { content: [call('unknown-character', 'voice_over', { segments: [
        { visibleTo: ['caster'], content: '无效目标。' },
      ] })] }
      if (count === 1) return { content: [call('missing-characters', 'voice_over', { segments: [
        { visibleTo: ['saber'], content: '仅 Saber 可见。' },
      ] })] }
      if (count === 2) return { content: [call('valid', 'voice_over', { segments: [
        { visibleTo: ['saber'], content: 'Saber 可见。' },
        { visibleTo: ['rider', 'archer'], content: '' },
      ] })] }
      if (count === 3) return { content: [call('end', 'end_performance', {})] }
      throw new Error(`unexpected DM request ${count}`)
    }

    const ctx = await setup(behaviour)
    const performanceId = SessionId('role-play-voice-over-guidance')
    await ctx.theater.create({ performanceId, presetId: 'v3', cwd: here })
    await ctx.theater.whenIdle(performanceId)

    const dm = ctx.sessions.get(characterSessionId(performanceId, 'dm'))!
    const errorText = (callId: string) => {
      const event = dm.events.find(candidate =>
        candidate.type === 'tool/result' && candidate.data.message.source.callId === callId)
      if (event?.type !== 'tool/result') return ''
      const result = event.data.message.content[0]
      return result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    }
    expect(errorText('unknown-character')).toContain('可用的普通 Character ID：saber、rider、archer')
    expect(errorText('unknown-character')).toContain('无可见内容时使用 content: ""')
    expect(errorText('missing-characters')).toContain('缺少普通 Character：rider、archer')
    expect(errorText('missing-characters')).toContain('无可见内容时使用 content: ""')
  })

  it('repairs a top-level DM adjudication without repeating its projection', async () => {
    const behaviour: Behaviour = (options): MockResponse => {
      const sessionId = String(options.sessionId)
      const count = options.messages.filter(message => message.role === 'assistant').length
      if (sessionId.endsWith('/characters/dm')) {
        if (count === 0) return { content: [call('opening', 'voice_over', { segments: [
          { visibleTo: ['saber', 'rider', 'archer'], content: '第一轮旁白已经成为事实。' },
        ] })] }
        if (count === 1) return { content: [{ type: 'text', text: 'DM 暂停整理下一步。' }] }
        if (count === 2) return { content: [call('recommend', 'recommend_next_character', {
          character: 'rider', reason: '由发起者回应。',
        })] }
        if (count === 3) return { content: [call('closing', 'voice_over', { segments: [
          { visibleTo: ['saber', 'rider', 'archer'], content: '酒宴的第一问落下。' },
        ] })] }
        if (count === 4) return { content: [call('end', 'end_performance', {})] }
      }
      if (sessionId.endsWith('/characters/rider')) {
        return { content: [{ type: 'text', text: 'Rider把酒杯举向月色。' }] }
      }
      throw new Error(`unexpected request for ${sessionId}`)
    }

    const ctx = await setup(behaviour)
    const performanceId = SessionId('role-play-repair')
    await ctx.theater.create({ performanceId, presetId: 'v3', cwd: here })
    await ctx.theater.whenIdle(performanceId)

    const dm = ctx.sessions.get(characterSessionId(performanceId, 'dm'))!
    const instructions = dm.events
      .filter(event => event.type === 'user/message' && event.data.source.kind === 'plugin')
      .map(event => blockText(event.data.content))
    expect(instructions[0]).toBe('开始演出。')
    expect(instructions[1]).toBe('上一轮顶层裁定未完成：缺少一次成功的 recommend_next_character 或 end_performance。')
    expect(instructions[1]).not.toContain('第一轮旁白已经成为事实。')
    expect(instructions[2]).toBe('[rider尝试说话/行动]\nRider把酒杯举向月色。')
    const rider = ctx.sessions.get(characterSessionId(performanceId, 'rider'))!
    expect(rider.events
      .filter(event => event.type === 'user/message')
      .map(event => blockText(event.data.content))[0])
      .toBe('第一轮旁白已经成为事实。')
  })

  it('cancels the outer Character Turn after three invalid nested DM Turns', async () => {
    const behaviour: Behaviour = (options): MockResponse => {
      const sessionId = String(options.sessionId)
      const count = options.messages.filter(message => message.role === 'assistant').length
      if (sessionId.endsWith('/characters/dm')) {
        if (count === 0) return { content: [call('opening', 'voice_over', { segments: [
          { visibleTo: ['saber', 'rider', 'archer'], content: '轮到 Rider。' },
        ] })] }
        if (count === 1) return { content: [call('recommend', 'recommend_next_character', {
          character: 'rider', reason: '开始行动。',
        })] }
        return { content: [{ type: 'text', text: 'DM 没有提交 perception_result。' }] }
      }
      if (sessionId.endsWith('/characters/rider')) return { content: [
        { type: 'text', text: 'Rider观察酒桶。' },
        call('ask', 'perceive_or_recall', { content: '酒里有什么？' }),
      ] }
      throw new Error(`unexpected request for ${sessionId}`)
    }

    const ctx = await setup(behaviour)
    const performanceId = SessionId('role-play-nested-failure')
    await ctx.theater.create({ performanceId, presetId: 'v3', cwd: here })
    await expect(ctx.theater.whenIdle(performanceId)).rejects.toThrow('Character action aborted')

    expect(ctx.theater.read(performanceId).phase).toBe('failed')
    const performance = ctx.sessions.get(performanceId)!
    const starts = performance.events.filter(event => event.type === 'theater/segment-started')
    const ends = performance.events.filter(event => event.type === 'theater/segment-ended')
    expect(starts.map(event => event.data.characterId)).toEqual(['dm', 'rider', 'dm', 'dm', 'dm'])
    expect(ends.map(event => [event.data.characterId, event.data.outcome])).toEqual([
      ['dm', 'completed'],
      ['dm', 'completed'],
      ['dm', 'completed'],
      ['dm', 'completed'],
      ['rider', 'aborted'],
    ])
  })

  it('returns an error for a second perception call and continues the same outer ReAct Turn', async () => {
    const behaviour: Behaviour = (options): MockResponse => {
      const sessionId = String(options.sessionId)
      const count = options.messages.filter(message => message.role === 'assistant').length
      if (sessionId.endsWith('/characters/dm')) {
        if (count === 0) return { content: [call('opening', 'voice_over', { segments: [
          { visibleTo: ['saber', 'rider', 'archer'], content: 'Rider开始观察酒宴。' },
        ] })] }
        if (count === 1) return { content: [call('recommend', 'recommend_next_character', {
          character: 'rider', reason: '开始行动。',
        })] }
        if (count === 2) return { content: [call('wrong-mode', 'voice_over', { segments: [
          { visibleTo: ['saber', 'rider', 'archer'], content: '这条错误模式旁白不会成为事实。' },
        ] })] }
        if (count === 3) return { content: [call('perception', 'perception_result', { content: '酒没有异味。' })] }
        if (count === 4) return { content: [call('closing', 'voice_over', { segments: [
          { visibleTo: ['saber', 'rider', 'archer'], content: 'Rider结束了观察。' },
        ] })] }
        if (count === 5) return { content: [call('end', 'end_performance', {})] }
      }
      if (sessionId.endsWith('/characters/rider')) {
        if (count === 0) return { content: [call('ask-one', 'perceive_or_recall', { content: '酒有异味吗？' })] }
        if (count === 1) return { content: [call('ask-two', 'perceive_or_recall', { content: '再确认一次？' })] }
        return { content: [{ type: 'text', text: 'Rider接受第一次观察结果，继续举杯。' }] }
      }
      throw new Error(`unexpected request for ${sessionId}`)
    }

    const ctx = await setup(behaviour)
    const performanceId = SessionId('role-play-duplicate-perception')
    await ctx.theater.create({ performanceId, presetId: 'v3', cwd: here })
    await ctx.theater.whenIdle(performanceId)

    const performance = ctx.sessions.get(performanceId)!
    expect(performance.events
      .filter(event => event.type === 'theater/segment-started')
      .map(event => event.data.characterId)).toEqual(['dm', 'rider', 'dm', 'dm'])
    const rider = ctx.sessions.get(characterSessionId(performanceId, 'rider'))!
    expect(rider.events
      .filter(event => event.type === 'tool/result')
      .map(event => event.data.message.content[0].isError === true)).toEqual([false, true])
    expect(rider.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(rider.events.filter(event => event.type === 'assistant/message')).toHaveLength(3)
    const dm = ctx.sessions.get(characterSessionId(performanceId, 'dm'))!
    const wrongMode = dm.events.find(event =>
      event.type === 'tool/result' && event.data.message.source.callId === 'wrong-mode')
    expect(wrongMode?.type === 'tool/result' && wrongMode.data.message.content[0].isError).toBe(true)
  })

  it('stops after three incomplete top-level DM Turns', async () => {
    const ctx = await setup(() => ({ content: [{ type: 'text', text: 'DM 尚未提交结构化裁定。' }] }))
    const performanceId = SessionId('role-play-top-level-failure')
    await ctx.theater.create({ performanceId, presetId: 'v3', cwd: here })
    await expect(ctx.theater.whenIdle(performanceId)).rejects.toThrow('DM 连续三轮未完成顶层裁定')

    const performance = ctx.sessions.get(performanceId)!
    expect(performance.events
      .filter(event => event.type === 'theater/segment-started')
      .map(event => event.data.characterId)).toEqual(['dm', 'dm', 'dm'])
    expect(ctx.theater.read(performanceId).phase).toBe('failed')
  })

  it('delivers accumulated public text and visible facts from the Character watermark', async () => {
    const behaviour: Behaviour = (options): MockResponse => {
      const sessionId = String(options.sessionId)
      const count = options.messages.filter(message => message.role === 'assistant').length
      if (sessionId.endsWith('/characters/dm')) {
        const voice = (id: string, segments: unknown[]) => ({ content: [call(id, 'voice_over', { segments })] })
        if (count === 0) return { content: [call('warning', 'warn', {
          target: 'saber', reason: '越权 <代操>',
        })] }
        if (count === 1) return voice('v0', [
          { visibleTo: ['saber'], content: 'S0' },
          { visibleTo: ['rider'], content: 'R0' },
          { visibleTo: ['archer'], content: '' },
        ])
        if (count === 2) return { content: [call('to-saber', 'recommend_next_character', {
          character: 'saber', reason: 'first reason',
        })] }
        if (count === 3) return voice('v1', [
          { visibleTo: ['saber'], content: 'S1' },
          { visibleTo: ['rider'], content: 'R1' },
          { visibleTo: ['archer'], content: 'A1' },
        ])
        if (count === 4) return { content: [call('to-archer', 'recommend_next_character', {
          character: 'archer', reason: 'second reason',
        })] }
        if (count === 5) return voice('v2', [
          { visibleTo: ['saber'], content: 'S2' },
          { visibleTo: ['rider'], content: 'R2' },
          { visibleTo: ['archer'], content: 'A2' },
        ])
        if (count === 6) return { content: [call('to-rider', 'recommend_next_character', {
          character: 'rider', reason: 'third reason',
        })] }
        if (count === 7) return voice('v3', [
          { visibleTo: ['saber', 'rider', 'archer'], content: 'F' },
        ])
        if (count === 8) return { content: [call('back-to-saber', 'recommend_next_character', {
          character: 'saber', reason: 'Saber should answer the other kings.',
        })] }
        if (count === 9) return voice('v4', [
          { visibleTo: ['saber', 'rider', 'archer'], content: 'Done' },
        ])
        if (count === 10) return { content: [call('end', 'end_performance', {})] }
      }
      if (sessionId.endsWith('/characters/saber')) {
        const count = options.messages.filter(message => message.role === 'assistant').length
        return { content: [{ type: 'text', text: count === 0 ? 'Saber raises <cup> & waits.' : 'Saber acts again.' }] }
      }
      if (sessionId.endsWith('/characters/archer')) return { content: [{ type: 'text', text: 'Archer acts.' }] }
      if (sessionId.endsWith('/characters/rider')) return { content: [{ type: 'text', text: 'Rider acts.' }] }
      throw new Error(`unexpected request for ${sessionId}`)
    }

    const ctx = await setup(behaviour)
    const performanceId = SessionId('role-play-visibility')
    await ctx.theater.create({ performanceId, presetId: 'v3', cwd: here })
    await ctx.theater.whenIdle(performanceId)

    const dm = ctx.sessions.get(characterSessionId(performanceId, 'dm'))!
    const warningResult = dm.events.find(event => event.type === 'tool/result'
      && event.data.message.source.callId === 'warning')
    expect(warningResult?.type === 'tool/result'
      && blockText(warningResult.data.message.content[0].content)).toBe('')

    const instructions = (characterId: string) => ctx.sessions.get(characterSessionId(performanceId, characterId))!.events
      .filter(event => event.type === 'user/message')
    const saberInstructions = instructions('saber')
    expect(saberInstructions[0]?.type === 'user/message' && saberInstructions[0].data.content).toEqual([
      { type: 'text', text: '<dm_warning>saber 因为 越权 &lt;代操&gt; 被dm警告了</dm_warning>' },
      { type: 'text', text: 'S0' },
    ])
    expect(saberInstructions[1]?.type === 'user/message' && saberInstructions[1].data.content).toEqual([
      { type: 'text', text: 'S1' },
      { type: 'text', text: '<character_message character="archer">\nArcher acts.\n</character_message>' },
      { type: 'text', text: 'S2' },
      { type: 'text', text: '<character_message character="rider">\nRider acts.\n</character_message>' },
      { type: 'text', text: 'F' },
    ])
    const archerInstruction = instructions('archer')[0]
    expect(archerInstruction?.type === 'user/message' && archerInstruction.data.content).toEqual([
      { type: 'text', text: '<dm_warning>saber 因为 越权 &lt;代操&gt; 被dm警告了</dm_warning>' },
      { type: 'text', text: '' },
      { type: 'text', text: '<character_message character="saber">\nSaber raises &lt;cup&gt; &amp; waits.\n</character_message>' },
      { type: 'text', text: 'A1' },
    ])
    const riderInstruction = instructions('rider')[0]
    expect(riderInstruction?.type === 'user/message' && riderInstruction.data.content).toEqual([
      { type: 'text', text: '<dm_warning>saber 因为 越权 &lt;代操&gt; 被dm警告了</dm_warning>' },
      { type: 'text', text: 'R0' },
      { type: 'text', text: '<character_message character="saber">\nSaber raises &lt;cup&gt; &amp; waits.\n</character_message>' },
      { type: 'text', text: 'R1' },
      { type: 'text', text: '<character_message character="archer">\nArcher acts.\n</character_message>' },
      { type: 'text', text: 'R2' },
    ])
    expect(blockText(riderInstruction?.type === 'user/message' ? riderInstruction.data.content : []))
      .not.toContain('third reason')
  })

  it('cold-resumes a zero-Stage Performance from its settled Director Point', async () => {
    const persistenceRoot = await mkdtemp(join(tmpdir(), 'role-play-resume-'))
    const performanceId = SessionId('role-play-resume')
    const behaviour: Behaviour = (options): MockResponse => {
      const sessionId = String(options.sessionId)
      const count = options.messages.filter(message => message.role === 'assistant').length
      if (sessionId.endsWith('/characters/dm')) {
        if (count === 0) return { content: [call('opening', 'voice_over', { segments: [
          { visibleTo: ['saber', 'rider', 'archer'], content: '可恢复的开场事实。' },
        ] })] }
        if (count === 1) return { content: [call('recommend', 'recommend_next_character', {
          character: 'rider', reason: '继续演出。',
        })] }
        if (count === 2) return { content: [call('closing', 'voice_over', { segments: [
          { visibleTo: ['saber', 'rider', 'archer'], content: '恢复后的演出收束。' },
        ] })] }
        if (count === 3) return { content: [call('end', 'end_performance', {})] }
      }
      if (sessionId.endsWith('/characters/rider')) return { content: [{ type: 'text', text: 'Rider继续演出。' }] }
      throw new Error(`unexpected request for ${sessionId}`)
    }

    try {
      const writer = await setup(behaviour, persistenceRoot)
      let stopped = false
      writer.on('session/flush', (session) => {
        if (stopped || session.id !== performanceId
          || session.events.at(-1)?.type !== 'theater/segment-started') return
        stopped = true
        writer.theater.setAutoAdvance(performanceId, false)
      })
      await writer.theater.create({ performanceId, presetId: 'v3', cwd: here })
      await writer.theater.whenIdle(performanceId)
      expect(writer.theater.read(performanceId)).toMatchObject({ phase: 'active', autoAdvance: false, stages: {} })
      await writer.fiber.dispose()

      const reader = await setup(behaviour, persistenceRoot)
      await reader.theater.resume({ performanceId })
      await reader.theater.whenIdle(performanceId)
      expect(reader.theater.read(performanceId)).toMatchObject({ phase: 'completed', stages: {} })
      const rider = reader.sessions.get(characterSessionId(performanceId, 'rider'))!
      expect(rider.events
        .filter(event => event.type === 'user/message')
        .map(event => blockText(event.data.content))[0]).toBe('可恢复的开场事实。')
      await reader.fiber.dispose()
    } finally {
      await rm(persistenceRoot, { recursive: true, force: true })
    }
  })
})
