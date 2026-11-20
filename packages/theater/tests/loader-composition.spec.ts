import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include, { entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import yaml from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import * as TheaterPlugin from '../src/index.js'
import type { TheaterScenario } from '../src/scenario.js'

const theaterPatchPath = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))

async function loadPatchFile(path: string): Promise<PatchOptions[]> {
  const raw = await readFile(path, 'utf8')
  const parsed = yaml.load(raw, { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new Error(`expected YAML patch array in ${path}`)
  return parsed as PatchOptions[]
}

let tempDir: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (tempDir !== undefined) await rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

describe('Theater Cordis Loader composition', () => {
  it('loads @darwintree/dsh-theater via cordis.patch.yml with real SessionStore and manages performance lifecycle', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dsh-theater-loader-'))
    const configPath = join(tempDir, 'cordis.yml')
    await writeFile(configPath, [
      "- id: session",
      "  name: '@deepseek-ai/dsh-session'",
      '',
    ].join('\n'))

    const patches = await loadPatchFile(theaterPatchPath)

    context = new Context()
    context.baseUrl = `${pathToFileURL(tempDir).href}/`
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@darwintree/dsh-theater', TheaterPlugin],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>

    await context.loader.create({
      name: 'cordis:include',
      config: {
        path: pathToFileURL(configPath).href,
        patches,
      },
    })
    await context.loader.await()

    const pending = [...context.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)
    expect(pending).toEqual([])
    expect(context.get('sessions')).toBeDefined()
    expect(context.get('theater')).toBeDefined()
    expect(context.theater.listScenarios()).toEqual([])

    const createdSessions: string[] = []
    const flushedSessions: string[] = []
    const disposedSessions: string[] = []
    context.on('session/created', session => {
      createdSessions.push(session.id)
    })
    context.on('session/flush', session => {
      flushedSessions.push(session.id)
    })
    context.on('session/disposed', session => {
      disposedSessions.push(session.id)
    })

    const fakeScenario: TheaterScenario<{ title: string }> = {
      id: 'fake-stage',
      parseConfig(input) {
        const record = (input ?? {}) as Record<string, unknown>
        return { title: typeof record.title === 'string' ? record.title : 'untitled' }
      },
      characters: () => ['alice', 'bob'],
      nextTurn: () => null,
    }
    const unregister = context.theater.registerScenario(fakeScenario)
    expect(context.theater.listScenarios()).toEqual(['fake-stage'])

    const performance = await context.theater.create<{ title: string }>({
      performanceId: 'show-1',
      scenarioId: 'fake-stage',
      config: { title: 'Opening Night' },
      characterSessions: {
        alice: SessionId('agent:alice'),
        bob: SessionId('agent:bob'),
      },
    })

    expect(createdSessions).toEqual([SessionId('theater:show-1')])
    expect(flushedSessions).toEqual([SessionId('theater:show-1')])
    expect(context.sessions.get(performance.session.id)).toBe(performance.session)
    expect(performance.eventLog()).toHaveLength(1)
    expect(performance.eventLog()[0]?.type).toBe('theater/configured')

    const reopened = context.theater.open<{ title: string }>(performance.session)
    expect(reopened.id).toBe('show-1')
    expect(reopened.config).toEqual({ title: 'Opening Night' })
    expect(reopened.characterSessions).toEqual({
      alice: SessionId('agent:alice'),
      bob: SessionId('agent:bob'),
    })

    await performance.dispose()
    expect(flushedSessions).toEqual([SessionId('theater:show-1'), SessionId('theater:show-1')])
    expect(disposedSessions).toEqual([SessionId('theater:show-1')])
    expect(context.sessions.get(performance.session.id)).toBeUndefined()

    unregister()
    expect(context.theater.listScenarios()).toEqual([])
  })

  it('activates optional scenario plugins mounted via patch and unregisters them when disabled', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dsh-theater-optional-'))
    const configPath = join(tempDir, 'cordis.yml')
    await writeFile(configPath, [
      "- id: session",
      "  name: '@deepseek-ai/dsh-session'",
      '',
    ].join('\n'))

    const fakeScenarioPlugin = {
      name: '@example/theater-fake',
      inject: ['theater'] as const,
      apply(ctx: Context) {
        return ctx.theater.registerScenario({
          id: 'fake-optional',
          parseConfig: () => ({}),
          characters: () => ['solo'],
          nextTurn: () => null,
        })
      },
    }

    const theaterPatches = await loadPatchFile(theaterPatchPath)
    const optionalPatch: PatchOptions[] = [
      {
        insert: [
          {
            id: 'theater-fake-optional',
            name: '@example/theater-fake',
          },
        ],
      },
    ]

    context = new Context()
    context.baseUrl = `${pathToFileURL(tempDir).href}/`
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@darwintree/dsh-theater', TheaterPlugin],
      ['@example/theater-fake', fakeScenarioPlugin],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>

    const includeId = await context.loader.create({
      name: 'cordis:include',
      config: {
        path: pathToFileURL(configPath).href,
        patches: [...theaterPatches, ...optionalPatch],
      },
    })
    await context.loader.await()
    expect(context.theater.listScenarios()).toEqual(['fake-optional'])

    const includeEntry = [...context.loader.entries()].find(entry => entry.id === includeId)
    expect(includeEntry).toBeDefined()

    // Disabling the optional bundle row unregisters its scenario while keeping ctx.theater live.
    await includeEntry?.update({
      config: {
        path: pathToFileURL(configPath).href,
        patches: [...theaterPatches, ...optionalPatch, { id: 'theater-fake-optional', disabled: true }],
      },
    })
    await context.loader.await()
    expect(context.theater).toBeDefined()
    expect(context.theater.listScenarios()).toEqual([])
  })
})
