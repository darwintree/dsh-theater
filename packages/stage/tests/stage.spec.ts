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
    const pending = ctx.stages.ensure('s', { session, factory: counterFactory, config: { initial: 1, target: 3 } })
      .then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false)
    expect(session.events).toMatchObject([{ type: 'stage/configured', data: { stageId: 's', machine: 'counter', version: '1', config: { initial: 1, target: 3 } } }])
    released()
    await pending
    expect(ctx.stages.read('s')).toMatchObject({ value: 1, target: 3 })
    expect(ctx.stages.completed('s')).toBe(false)
  })

  it('ensures idempotently and rejects a conflicting second configuration', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('stage-unique'))
    await ctx.stages.ensure('u', { session, factory: counterFactory, config: { initial: 2, target: 4 } })
    await ctx.stages.ensure('u', { session, factory: counterFactory, config: { initial: 2, target: 4 } })
    expect(session.events.filter(e => e.type === 'stage/configured')).toHaveLength(1)
    await expect(ctx.stages.ensure('u', { session, factory: counterFactory, config: { initial: 9, target: 9 } }))
      .resolves.toBe(undefined)
    expect(session.events.filter(e => e.type === 'stage/configured')).toHaveLength(1)
  })

  it('accepts an interaction, flushes before success, and rejects domain rejections without persisting', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('stage-interact'))
    let flushes = 0
    ctx.on('session/flush', () => { flushes += 1 })
    await ctx.stages.ensure('i', { session, factory: applyingFactory, config: { initial: 0, target: 3 } })

    const accepted = await ctx.stages.interact('i', { kind: 'add', amount: 2 })
    expect(accepted).toEqual({ kind: 'accepted' })
    expect(ctx.stages.read('i')).toMatchObject({ value: 2, target: 3 })

    const rejected = await ctx.stages.interact('i', { kind: 'reject', reason: 'not now' })
    expect(rejected).toEqual({ kind: 'domain-rejected', reason: 'not now' })
    expect(ctx.stages.read('i')).toMatchObject({ value: 2, target: 3 })

    const ops = session.events.filter(e => e.type === 'stage/op')
    expect(ops).toHaveLength(1)
    expect(ops[0]?.data).toMatchObject({ stageId: 'i', op: { kind: 'add', amount: 2 } })
    expect(ops[0]?.data).not.toHaveProperty('outcome')
    expect(flushes).toBeGreaterThanOrEqual(2)
  })

  it('rejects a flush failure without promising rollback of advanced live state', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('stage-flush-fail'))
    await ctx.stages.ensure('f', { session, factory: applyingFactory, config: { initial: 0, target: 3 } })
    ctx.on('session/flush', () => { throw new Error('durability unknown') })
    await expect(ctx.stages.interact('f', { kind: 'add', amount: 1 })).rejects.toThrow('durability unknown')
    expect(ctx.stages.read('f')).toMatchObject({ value: 1, target: 3 })
    expect(session.events.filter(e => e.type === 'stage/op')).toHaveLength(1)
  })

  it('throws on a program fault without persisting a Stage Op', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('stage-throw'))
    await ctx.stages.ensure('t', { session, factory: applyingFactory, config: { initial: 0, target: 3 } })
    await expect(ctx.stages.interact('t', { kind: 'throw', message: 'boom' })).rejects.toThrow('boom')
    expect(session.events.filter(e => e.type === 'stage/op')).toHaveLength(0)
    expect(ctx.stages.read('t')).toMatchObject({ value: 0, target: 3 })
  })

  it('returns a detached read that cannot mutate live state', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('stage-read'))
    await ctx.stages.ensure('r', { session, factory: applyingFactory, config: { initial: 0, target: 1 } })
    await ctx.stages.interact('r', { kind: 'add', amount: 1 })
    const snapshot = ctx.stages.read('r') as { value: number }
    snapshot.value = 999
    expect((ctx.stages.read('r') as { value: number }).value).toBe(1)
  })

  it('reports completion from the live State Machine', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('stage-completed'))
    await ctx.stages.ensure('c', { session, factory: applyingFactory, config: { initial: 0, target: 2 } })
    expect(ctx.stages.completed('c')).toBe(false)
    await ctx.stages.interact('c', { kind: 'add', amount: 2 })
    expect(ctx.stages.completed('c')).toBe(true)
  })

  it('reconstructs the same State Machine by replaying persisted accepted ops in order', async () => {
    const liveCtx = await setup()
    const live = liveCtx.sessions.create(SessionId('stage-replay'))
    await liveCtx.stages.ensure('rp', { session: live, factory: applyingFactory, config: { initial: 1, target: 5 } })
    await liveCtx.stages.interact('rp', { kind: 'add', amount: 2 })
    await liveCtx.stages.interact('rp', { kind: 'reject', reason: 'no' })
    await liveCtx.stages.interact('rp', { kind: 'add', amount: 2 })

    // cold resume: a fresh process + fresh session seeded with the persisted events.
    const coldCtx = await setup()
    const cold = coldCtx.sessions.create(SessionId('stage-replay'), { seed: live.events })
    await coldCtx.stages.ensure('rp', { session: cold, factory: applyingFactory })
    expect(coldCtx.stages.read('rp')).toMatchObject({ value: 5, target: 5 })
    expect(coldCtx.stages.completed('rp')).toBe(true)
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
    await ctx.stages.ensure('rt', { session, factory: applyingFactory, config: { initial: 0, target: 1 } })
    await ctx.stages.interact('rt', { kind: 'add', amount: 1 })
    session.append('turn/start', { turn: 1 })
    const routed = stageEvents(session.events, 'rt')
    expect(routed).toHaveLength(2)
    expect(isStageConfiguredEvent(routed[0]!)).toBe(true)
    expect(isStageOpEvent(routed[1]!)).toBe(true)
  })

  it('fails to interact with a Stage that was never ensured', async () => {
    const ctx = await setup()
    ctx.sessions.create(SessionId('stage-missing'))
    expect(() => ctx.stages.read('missing')).toThrow('not live')
    expect(() => ctx.stages.completed('missing')).toThrow('not live')
    await expect(ctx.stages.interact('missing', { kind: 'add', amount: 1 })).rejects.toThrow('not live')
  })

  it('retains the optional observational outcome in the persisted Stage Op', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('stage-outcome'))
    await ctx.stages.ensure('o', { session, factory: counterFactory, config: { initial: 0, target: 3 } })
    const accepted = await ctx.stages.interact('o', { kind: 'add', amount: 1 })
    expect(accepted).toEqual({ kind: 'accepted', outcome: { value: 1 } })
    const op = session.events.filter(e => e.type === 'stage/op')[0]
    expect(op?.data).toMatchObject({ stageId: 'o', op: { kind: 'add', amount: 1 }, outcome: { value: 1 } })
  })
});
