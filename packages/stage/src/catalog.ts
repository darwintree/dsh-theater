import type { Context } from '@deepseek-ai/cordis'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-session'
import {
  NamedEntries,
  ScopedLayers,
  scopeOf,
  type ScopeLayer,
} from '@deepseek-ai/dsh-scope'
import type { StateMachineFactory } from './machine.js'

/** One preset-owned Stage declaration. */
export interface StageDeclaration {
  /** Registered State Machine factory kind. */
  readonly machine: string
  /** Factory-owned first-use configuration input. */
  readonly params?: unknown
}

/** Stage declarations keyed by Stage ID. */
export type StageDeclarations = Readonly<Record<string, StageDeclaration>>

export interface ResolvedStageDeclaration {
  readonly factory: StateMachineFactory
  readonly config: JsonValue
}

interface DeclarationLayer extends ScopeLayer {
  readonly declarations: NamedEntries<ResolvedStageDeclaration>
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be non-empty`)
  }
  return value
}

/** Process factories and preset-scoped resolved Stage declarations. */
export class StageCatalog {
  private readonly factories = new Map<string, StateMachineFactory>()
  private readonly declarationLayers = new ScopedLayers<DeclarationLayer>(
    () => ({
      declarations: new NamedEntries(stageId =>
        new Error(`duplicate Stage ID ${JSON.stringify(stageId)}`)),
      isEmpty() { return this.declarations.isEmpty() },
    }),
    () => undefined,
  )

  registerFactory(ctx: Context, factory: StateMachineFactory): () => void {
    if (scopeOf(ctx) !== undefined) {
      throw new Error('stages.registerFactory() requires the host scope')
    }
    const kind = nonEmpty(factory.kind, 'State Machine kind')
    nonEmpty(factory.version, 'State Machine version')
    return ctx.effect(() => {
      if (this.factories.has(kind)) {
        throw new Error(`duplicate State Machine factory kind ${JSON.stringify(kind)}`)
      }
      this.factories.set(kind, factory)
      return () => {
        if (this.factories.get(kind) === factory) this.factories.delete(kind)
      }
    }, `stages.registerFactory(${kind})`)
  }

  declare(ctx: Context, declarations: StageDeclarations): () => void {
    if (scopeOf(ctx) === undefined) {
      throw new Error('stages.declare() requires an Agent Preset standing scope')
    }
    if (typeof declarations !== 'object' || declarations === null || Array.isArray(declarations)) {
      throw new Error('Stage declarations must be an object keyed by Stage ID')
    }
    const entries = Object.entries(declarations)
    if (entries.length === 0) throw new Error('Stage declarations must not be empty')
    const resolved = entries.map(([rawStageId, declaration]) => {
      const stageId = nonEmpty(rawStageId, 'Stage ID')
      if (typeof declaration !== 'object' || declaration === null || Array.isArray(declaration)) {
        throw new Error(`Stage ${JSON.stringify(stageId)} declaration must be an object`)
      }
      const unknown = Object.keys(declaration)
        .find(key => key !== 'machine' && key !== 'params')
      if (unknown !== undefined) {
        throw new Error(`Stage ${JSON.stringify(stageId)} has unknown field ${JSON.stringify(unknown)}`)
      }
      const machine = nonEmpty(
        declaration.machine,
        `State Machine kind for Stage ${JSON.stringify(stageId)}`,
      )
      const factory = this.factories.get(machine)
      if (factory === undefined) {
        throw new Error(`no State Machine factory registered for kind ${JSON.stringify(machine)}`)
      }
      const params = Object.hasOwn(declaration, 'params') ? declaration.params : {}
      const config = snapshotJsonValue(factory.resolveConfig(params))
      if (config === undefined) {
        throw new Error(`Stage ${JSON.stringify(stageId)} configuration must be lossless JSON`)
      }
      return [stageId, { factory, config }] as const
    })
    return this.declarationLayers.effect(
      ctx,
      (layer) => {
        for (const [stageId] of resolved) {
          if (layer.declarations.has(stageId)) {
            throw new Error(`duplicate Stage ID ${JSON.stringify(stageId)}`)
          }
        }
        const undo = resolved.map(([stageId, declaration]) =>
          layer.declarations.insert(stageId, declaration))
        return () => {
          for (const dispose of undo) dispose()
        }
      },
      { label: 'stages.declare()', notify: false },
    )
  }

  resolve(ctx: Context, stageId: string): ResolvedStageDeclaration | undefined {
    return this.declarationLayers
      .merge(scopeOf(ctx), layer => layer.declarations)
      .get(stageId)
  }
}
