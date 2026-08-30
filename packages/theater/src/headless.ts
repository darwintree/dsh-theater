import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from './service.js'

export const name = '@darwintree/dsh-theater/headless'
export const inject = ['theater']

export interface Config {
  readonly presetId: string
}

async function run(ctx: Context, presetId: string, exit: (code: number) => void): Promise<void> {
  let stopAfterFirstSegment: (() => boolean) | undefined
  try {
    await (ctx.get('loader') as { await(): Promise<void> } | undefined)?.await()
    const performanceId = SessionId(`performance-${randomUUID()}`)
    let segmentStarted = false
    stopAfterFirstSegment = ctx.on('session/flush', (session) => {
      if (session.id !== performanceId || segmentStarted
        || session.events.at(-1)?.type !== 'theater/segment-started') return
      segmentStarted = true
      ctx.theater.setAutoAdvance(performanceId, false)
    })
    await ctx.theater.create({ performanceId, presetId, cwd: process.cwd() })
    await ctx.theater.whenIdle(performanceId)
    if (!segmentStarted) throw new Error('headless Performance produced no Character Segment')
    for (let completed = 1; completed < 4; completed += 1) {
      await ctx.theater.advance(performanceId)
    }
    const performance = ctx.theater.read(performanceId)
    process.stdout.write(`${JSON.stringify(performance, null, 2)}\n`)
    exit(0)
  } catch (error) {
    process.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
    exit(1)
  } finally {
    stopAfterFirstSegment?.()
  }
}

/** Run four Character Segments from a preset-composed Performance. */
export function apply(ctx: Context, config: Config): void {
  if (typeof config.presetId !== 'string' || config.presetId.trim() === '') {
    throw new Error('presetId must be non-empty')
  }
  const exit = ctx.get('appExit') as ((code: number) => void) | undefined
  if (exit === undefined) throw new Error('theater headless runner requires the DSH launcher')
  void run(ctx, config.presetId, exit)
}
