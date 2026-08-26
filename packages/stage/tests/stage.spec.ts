import { Context } from '@deepseek-ai/cordis'
import { SessionId, type JsonValue } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import StageService, {
  isStageConfiguredEvent,
  isStageOpEvent,
  registerStageSessionEventTypes,
  STAGE_REQUIRED_EVENT_TYPES,
  stageEvents,
  type StateMachine,
  type StateMachineFactory,
} from '../src/index.ts'

interface CounterConfig { initial: number; target: number }
interface CounterState { value: number; target: number }
type CounterOp = { kind: 'add'; amount: number } | { kind: 'reject'; reason: string } | { kind: 'throw'; message: string }

class CounterMachine implements StateMachine {
  readonly kind = 'counter'
  readonly version = '1'
  private state: CounterState
  constructor(config: JsonValue) {
    const c = config as CounterConfig
    this.state = { value: c.initial, target: c.target }
  }
  transition(op: JsonValue) {
    const interaction = op as CounterOp
    if (interaction.kind === 'reject') return { kind: 'domain-rejected' as const, reason: interaction.reason }
    if (interaction.kind === 'throw') throw new Error(interaction.message)
    return { kind: 'accepted' as const, outcome: { value: this.state.value + interaction.amount } as JsonValue }
  }
  read(): JsonValue {
    return { ...this.state } as unknown as JsonValue
  }
  get completed(): boolean { return this.state.value >= this.state.target }
}

const counterFactory: StateMachineFactory = {
  kind: 'counter',
  version: '1',
  resolveConfig(input) {
    const value = input as Partial<CounterConfig>
    return { initial: value.initial ?? 0, target: value.target ?? 1 } as unknown as JsonValue
  },
  create(config) { return new CounterMachine(config) },
}

// advance live state so accepted ops actually mutate the machine
class ApplyingCounterMachine implements StateMachine {
  readonly kind = 'counter'
  readonly version = '1'
  private state: CounterState
  constructor(config: JsonValue) {
    const c = config as CounterConfig
    this.state = { value: c.initial, target: c.target }
  }
  transition(op: JsonValue) {
    const interaction = op as CounterOp
    if (interaction.kind === 'reject') return { kind: 'domain-rejected' as const, reason: interaction.reason }
    if (interaction.kind === 'throw') throw new Error(interaction.message)
    this.state = { value: this.state.value + interaction.amount, target: this.state.target }
    return { kind: 'accepted' as const }
  }
  read(): JsonValue { return { ...this.state } as unknown as JsonValue }
  get completed(): boolean { return this.state.value >= this.state.target }
}

const applyingFactory: StateMachineFactory = {
  kind: 'counter',
  version: '1',
  resolveConfig(input) {
    const value = input as Partial<CounterConfig>
    return { initial: value.initial ?? 0, target: value.target ?? 1 } as unknown as JsonValue
  },
  create(config) { return new ApplyingCounterMachine(config) },
}

async function setup() {
  const ctx = new Context()
  const { SessionStore } = await import('@deepseek-ai/dsh-session')
  await ctx.plugin(SessionStore)
  await ctx.plugin(StageService)
  return ctx
}

describe('Stage Service', () => {
  it('persists configuration and flushes before ensure resolves', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('stage-create'))
    let released!: () => void
    const flush = new Promise<void>(r => { released = r })
    ctx.on('session/flush', () => flush)
    let resolved = false
    const pending = ctx.stages.ensure(session, 's', { factory: counterFactory, config: { initial: 1, target: 3 } })
      .then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false)
    expect(session.events).toMatchObject([{ type: 'stage/configured', data: { stageId: 's', machine: 'counter', version: '1', config: { initial: 1, target: 3 } } }])
    released()
    await pending
    expect(ctx.stages.read(session, 's')).toMatchObject({ value: 1, target: 3 })
    expect(ctx.stages.completed(session, 's')).toBe(false)
  })

  it('ensures idempotently and rejects a conflicting second configuration', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('stage-unique'))
    await ctx.stages.ensure(session, 'u', { factory: counterFactory, config: { initial: 2, target: 4 } })
    await ctx.stages.ensure(session, 'u', { factory: counterFactory, config: { initial: 2, target: 4 } })
    expect(session.events.filter(e => e.type === 'stage/configured')).toHaveLength(1)
    await expect(ctx.stages.ensure(session, 'u', { factory: counterFactory, config: { initial: 9, target: 9 } }))
      .resolves.toBe(undefined)
    expect(session.events.filter(e => e.type === 'stage/configured')).toHaveLength(1)
  })

  it('routes the same Stage ID independently for each owning Session', async () => {
    const ctx = await setup()
    const first = ctx.sessions.create(SessionId('stage-owner-first'))
    const second = ctx.sessions.create(SessionId('stage-owner-second'))

    await ctx.stages.ensure(first, 'shared', {
      factory: applyingFactory,
      config: { initial: 0, target: 3 },
    })
    await ctx.stages.ensure(second, 'shared', {
      factory: applyingFactory,
      config: { initial: 10, target: 20 },
    })
    await ctx.stages.interact(first, 'shared', { kind: 'add', amount: 1 })
    await ctx.stages.interact(second, 'shared', { kind: 'add', amount: 2 })

    expect(ctx.stages.read(first, 'shared')).toMatchObject({ value: 1, target: 3 })
    expect(ctx.stages.read(second, 'shared')).toMatchObject({ value: 12, target: 20 })
    expect(first.events.filter(event => event.type === 'stage/op')).toHaveLength(1)
    expect(second.events.filter(event => event.type === 'stage/op')).toHaveLength(1)
  })

  it('accepts an interaction, flushes before success, and rejects domain rejections without persisting', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('stage-interact'))
    let flushes = 0
    ctx.on('session/flush', () => { flushes += 1 })
    await ctx.stages.ensure(session, 'i', { factory: applyingFactory, config: { initial: 0, target: 3 } })

    const accepted = await ctx.stages.interact(session, 'i', { kind: 'add', amount: 2 })
    expect(accepted).toEqual({ kind: 'accepted' })
    expect(ctx.stages.read(session, 'i')).toMatchObject({ value: 2, target: 3 })

    const rejected = await ctx.stages.interact(session, 'i', { kind: 'reject', reason: 'not now' })
    expect(rejected).toEqual({ kind: 'domain-rejected', reason: 'not now' })
    expect(ctx.stages.read(session, 'i')).toMatchObject({ value: 2, target: 3 })

    const ops = session.events.filter(e => e.type === 'stage/op')
    expect(ops).toHaveLength(1)
    expect(ops[0]?.data).toMatchObject({ stageId: 'i', op: { kind: 'add', amount: 2 } })
    expect(ops[0]?.data).not.toHaveProperty('outcome')
    expect(flushes).toBeGreaterThanOrEqual(2)
  })

  it('rejects a flush failure without promising rollback of advanced live state', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('stage-flush-fail'))
    await ctx.stages.ensure(session, 'f', { factory: applyingFactory, config: { initial: 0, target: 3 } })
    ctx.on('session/flush', () => { throw new Error('durability unknown') })
    await expect(ctx.stages.interact(session, 'f', { kind: 'add', amount: 1 })).rejects.toThrow('durability unknown')
    expect(ctx.stages.read(session, 'f')).toMatchObject({ value: 1, target: 3 })
    expect(session.events.filter(e => e.type === 'stage/op')).toHaveLength(1)
  })

  it('throws on a program fault without persisting a Stage Op', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('stage-throw'))
    await ctx.stages.ensure(session, 't', { factory: applyingFactory, config: { initial: 0, target: 3 } })
    await expect(ctx.stages.interact(session, 't', { kind: 'throw', message: 'boom' })).rejects.toThrow('boom')
    expect(session.events.filter(e => e.type === 'stage/op')).toHaveLength(0)
    expect(ctx.stages.read(session, 't')).toMatchObject({ value: 0, target: 3 })
  })

  it('returns a detached read that cannot mutate live state', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('stage-read'))
    await ctx.stages.ensure(session, 'r', { factory: applyingFactory, config: { initial: 0, target: 1 } })
    await ctx.stages.interact(session, 'r', { kind: 'add', amount: 1 })
    const snapshot = ctx.stages.read(session, 'r') as { value: number }
    snapshot.value = 999
    expect((ctx.stages.read(session, 'r') as { value: number }).value).toBe(1)
  })

  it('reports completion from the live State Machine', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('stage-completed'))
    await ctx.stages.ensure(session, 'c', { factory: applyingFactory, config: { initial: 0, target: 2 } })
    expect(ctx.stages.completed(session, 'c')).toBe(false)
    await ctx.stages.interact(session, 'c', { kind: 'add', amount: 2 })
    expect(ctx.stages.completed(session, 'c')).toBe(true)
  })

  it('reconstructs the same State Machine by replaying persisted accepted ops in order', async () => {
    const liveCtx = await setup()
    const live = liveCtx.sessions.create(SessionId('stage-replay'))
    await liveCtx.stages.ensure(live, 'rp', { factory: applyingFactory, config: { initial: 1, target: 5 } })
    await liveCtx.stages.interact(live, 'rp', { kind: 'add', amount: 2 })
    await liveCtx.stages.interact(live, 'rp', { kind: 'reject', reason: 'no' })
    await liveCtx.stages.interact(live, 'rp', { kind: 'add', amount: 2 })

    // cold resume: a fresh process + fresh session seeded with the persisted events.
    const coldCtx = await setup()
    const cold = coldCtx.sessions.create(SessionId('stage-replay'), { seed: live.events })
    await coldCtx.stages.ensure(cold, 'rp', { factory: applyingFactory })
    expect(coldCtx.stages.read(cold, 'rp')).toMatchObject({ value: 5, target: 5 })
    expect(coldCtx.stages.completed(cold, 'rp')).toBe(true)
    // rejected request did not become a Stage Op
    expect(cold.events.filter(e => e.type === 'stage/op')).toHaveLength(2)
  })

  it('registers required Stage Session Event types for the Service lifecycle', async () => {
    const { KNOWN_SESSION_EVENT_TYPES } = await import('@deepseek-ai/dsh-session')
    const original = new Map(STAGE_REQUIRED_EVENT_TYPES.map(type => [type, KNOWN_SESSION_EVENT_TYPES.has(type)]))
    const dispose = registerStageSessionEventTypes()
    try {
      expect(STAGE_REQUIRED_EVENT_TYPES.every(type => KNOWN_SESSION_EVENT_TYPES.has(type))).toBe(true)
      dispose()
      expect(STAGE_REQUIRED_EVENT_TYPES.map(type => KNOWN_SESSION_EVENT_TYPES.has(type)))
        .toEqual(STAGE_REQUIRED_EVENT_TYPES.map(type => original.get(type)))
    } finally {
      dispose()
      for (const [type, known] of original) {
        if (known) KNOWN_SESSION_EVENT_TYPES.add(type)
        else KNOWN_SESSION_EVENT_TYPES.delete(type)
      }
    }
    // re-register through a real Service to confirm append works end-to-end
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('stage-routing'))
    await ctx.stages.ensure(session, 'rt', { factory: applyingFactory, config: { initial: 0, target: 1 } })
    await ctx.stages.interact(session, 'rt', { kind: 'add', amount: 1 })
    session.append('turn/start', { turn: 1 })
    const routed = stageEvents(session.events, 'rt')
    expect(routed).toHaveLength(2)
    expect(isStageConfiguredEvent(routed[0]!)).toBe(true)
    expect(isStageOpEvent(routed[1]!)).toBe(true)
  })

  it('fails to interact with a Stage that was never ensured', async () => {
    const ctx = await setup()
    ctx.sessions.create(SessionId('stage-missing'))
    const session = ctx.sessions.get(SessionId('stage-missing'))!
    expect(() => ctx.stages.read(session, 'missing')).toThrow('not live')
    expect(() => ctx.stages.completed(session, 'missing')).toThrow('not live')
    await expect(ctx.stages.interact(session, 'missing', { kind: 'add', amount: 1 })).rejects.toThrow('not live')
  })

  it('retains the optional observational outcome in the persisted Stage Op', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('stage-outcome'))
    await ctx.stages.ensure(session, 'o', { factory: counterFactory, config: { initial: 0, target: 3 } })
    const accepted = await ctx.stages.interact(session, 'o', { kind: 'add', amount: 1 })
    expect(accepted).toEqual({ kind: 'accepted', outcome: { value: 1 } })
    const op = session.events.filter(e => e.type === 'stage/op')[0]
    expect(op?.data).toMatchObject({ stageId: 'o', op: { kind: 'add', amount: 1 }, outcome: { value: 1 } })
  })
});
