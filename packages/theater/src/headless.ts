import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from './service.js'

export const name = '@darwintree/dsh-theater/headless'
export const inject = ['theater']

export interface Config {
  readonly presetId?: string
  readonly maxSegments?: number | null
  readonly cwd?: string
  readonly performanceId?: string
}

export interface ResolvedHeadlessOptions {
  readonly presetId: string
  readonly maxSegments: number | null
  readonly cwd: string
  readonly performanceId: string
}

interface CmdlineArgsLike {
  get(): readonly string[]
}

function readFlagValue(argv: readonly string[], index: number, flag: string): { value: string; nextIndex: number } {
  const token = argv[index] ?? ''
  const eq = token.indexOf('=')
  if (eq >= 0) return { value: token.slice(eq + 1), nextIndex: index }
  const next = argv[index + 1]
  if (next === undefined) throw new Error(`missing value for ${flag}`)
  return { value: next, nextIndex: index + 1 }
}

function parseMaxSegmentsValue(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw === 'string') {
    const trimmed = raw.trim().toLowerCase()
    if (trimmed === '' || trimmed === 'all' || trimmed === 'none') return null
    const parsed = Number(trimmed)
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw new Error(`maxSegments must be a positive integer or "all", received ${JSON.stringify(raw)}`)
    }
    return parsed
  }
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw < 1) {
      throw new Error(`maxSegments must be a positive integer or null, received ${String(raw)}`)
    }
    return raw
  }
  throw new Error('maxSegments must be a positive integer or null')
}

/** Merge YAML config with optional DSH `cmdlineArgs` flags (`--preset`, `--max-segments`, `--cwd`, `--performance-id`). */
export function parseHeadlessOptions(
  config: Config | undefined,
  argv: readonly string[] = [],
  defaultCwd: string = process.cwd(),
): ResolvedHeadlessOptions {
  let presetId = config?.presetId
  let maxSegments: number | null = parseMaxSegmentsValue(config?.maxSegments)
  let cwd = config?.cwd ?? defaultCwd
  let performanceId = config?.performanceId

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? ''
    if (token === '--') continue
    if (token === '--preset' || token.startsWith('--preset=')) {
      const { value, nextIndex } = readFlagValue(argv, i, '--preset')
      presetId = value
      i = nextIndex
      continue
    }
    if (token === '--max-segments' || token.startsWith('--max-segments=')) {
      const { value, nextIndex } = readFlagValue(argv, i, '--max-segments')
      maxSegments = parseMaxSegmentsValue(value)
      i = nextIndex
      continue
    }
    if (token === '--cwd' || token.startsWith('--cwd=')) {
      const { value, nextIndex } = readFlagValue(argv, i, '--cwd')
      cwd = value
      i = nextIndex
      continue
    }
    if (token === '--performance-id' || token.startsWith('--performance-id=')) {
      const { value, nextIndex } = readFlagValue(argv, i, '--performance-id')
      performanceId = value
      i = nextIndex
      continue
    }
    throw new Error(`unknown theater headless flag: ${token}`)
  }

  if (typeof presetId !== 'string' || presetId.trim() === '') {
    throw new Error('presetId must be non-empty (set config.presetId or pass --preset <id>)')
  }
  if (typeof cwd !== 'string' || cwd.trim() === '') {
    throw new Error('cwd must be non-empty')
  }
  const resolvedPerformanceId = performanceId === undefined
    ? `performance-${randomUUID()}`
    : performanceId.trim()
  if (resolvedPerformanceId === '') {
    throw new Error('performanceId must be non-empty')
  }

  return {
    presetId: presetId.trim(),
    maxSegments,
    cwd: cwd.trim(),
    performanceId: resolvedPerformanceId,
  }
}

function completedTopLevelSegments(ctx: Context, performanceId: SessionId): number {
  const session = ctx.sessions.get(performanceId)
  if (session === undefined) return 0
  let depth = 0
  let completed = 0
  for (const event of session.snapshotEvents()) {
    if (event.type === 'theater/segment-started') depth += 1
    else if (event.type === 'theater/segment-ended') {
      depth -= 1
      if (depth === 0) completed += 1
    }
  }
  return completed
}

/** Run a preset-composed Theater Performance in headless mode and print its final read as JSON. */
export async function runHeadless(
  ctx: Context,
  options: ResolvedHeadlessOptions,
  io: {
    stdout?: (chunk: string) => void
    stderr?: (chunk: string) => void
    exit: (code: number) => void
  },
): Promise<void> {
  const stdout = io.stdout ?? (chunk => { process.stdout.write(chunk) })
  const stderr = io.stderr ?? (chunk => { process.stderr.write(chunk) })
  let stopAfterFirstSegment: (() => boolean) | undefined
  try {
    await (ctx.get('loader') as { await(): Promise<void> } | undefined)?.await()
    const performanceId = SessionId(options.performanceId)
    let pausedAutoAdvance = false
    if (options.maxSegments !== null) {
      stopAfterFirstSegment = ctx.on('session/flush', (session) => {
        if (session.id !== performanceId || pausedAutoAdvance
          || session.snapshotEvents().at(-1)?.type !== 'theater/segment-started') return
        pausedAutoAdvance = true
        ctx.theater.setAutoAdvance(performanceId, false)
      })
    }

    await ctx.theater.create({
      performanceId,
      presetId: options.presetId,
      cwd: options.cwd,
    })
    await ctx.theater.whenIdle(performanceId)

    while (ctx.theater.read(performanceId).phase === 'active') {
      const completed = completedTopLevelSegments(ctx, performanceId)
      if (options.maxSegments !== null && completed >= options.maxSegments) break
      await ctx.theater.advance(performanceId)
    }

    const performance = ctx.theater.read(performanceId)
    stdout(`${JSON.stringify(performance, null, 2)}\n`)
    io.exit(0)
  } catch (error) {
    stderr(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
    io.exit(1)
  } finally {
    stopAfterFirstSegment?.()
  }
}

/** Run a preset-composed Performance via DSH's launcher, honoring optional `cmdlineArgs`. */
export function apply(ctx: Context, config: Config = {}): void {
  const exit = ctx.get('appExit') as ((code: number) => void) | undefined
  if (exit === undefined) throw new Error('theater headless runner requires the DSH launcher')
  const cmdline = ctx.get('cmdlineArgs') as CmdlineArgsLike | undefined
  const argv = cmdline !== undefined && typeof cmdline.get === 'function' ? cmdline.get() : []
  const options = parseHeadlessOptions(config, argv)
  void runHeadless(ctx, options, { exit })
}
