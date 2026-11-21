import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import {
  AnonymousEntries,
  ScopedLayers,
  scopeOf,
  type ScopeKey,
  type ScopeLayer,
} from '@deepseek-ai/dsh-scope'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import type { StageService, StateMachineFactory } from '@darwintree/dsh-stage'
import { failure, nonEmpty, structuralIncompatibility } from './configuration.js'
import type {
  Director,
  DirectorOverrideOptions,
  TheaterCharacterContribution,
  TheaterConfigured,
  TheaterToolFactory,
} from './types.js'

interface ContributionLayer extends ScopeLayer {
  readonly titles: AnonymousEntries<string>
  readonly characters: AnonymousEntries<TheaterCharacterContribution>
  readonly directors: AnonymousEntries<Director>
}

export interface ResolvedCharacterContribution {
  readonly id: string
  readonly title: string
  readonly model?: ModelSelection
  readonly systemPrompt: string
  readonly tools: readonly { readonly factory: TheaterToolFactory; readonly config: JsonValue }[]
}

export interface TheaterContributions {
  readonly title: string
  readonly characters: readonly ResolvedCharacterContribution[]
  readonly stages: readonly {
    readonly stageId: string
    readonly factory: StateMachineFactory
    readonly config: JsonValue
  }[]
  readonly director?: Director
}

interface PresetStructure {
  readonly title: string
  readonly characterTitles: ReadonlyMap<string, string>
  readonly characterIds: readonly string[]
  readonly stages: readonly { readonly stageId: string; readonly machine: string; readonly version: string }[]
  readonly director?: Director
}

export interface RuntimeCompatibilityResult {
  readonly title: string
  readonly characterTitles: ReadonlyMap<string, string>
  readonly director?: Director
  readonly error?: Error
}

export function stageServiceOf(ctx: Context): StageService | undefined {
  return ctx.get('stages' as never) as StageService | undefined
}

/**
 * Host-registered Tool factories and preset-scoped Theater contributions,
 * together with preset resolution and ADR-0006 structural compatibility checks.
 */
export class TheaterCatalog {
  private readonly layers = new ScopedLayers<ContributionLayer>(
    () => ({
      titles: new AnonymousEntries<string>(),
      characters: new AnonymousEntries<TheaterCharacterContribution>(),
      directors: new AnonymousEntries<Director>(),
      isEmpty() {
        return this.titles.isEmpty() && this.characters.isEmpty() && this.directors.isEmpty()
      },
    }),
    () => undefined,
  )
  private readonly toolFactories = new Map<string, TheaterToolFactory>()

  registerCharacter(ctx: Context, character: TheaterCharacterContribution): () => void {
    return this.registerContribution(ctx, character, layer => layer.characters, 'registerCharacter')
  }

  registerTitle(ctx: Context, title: string): () => void {
    return this.registerContribution(ctx, nonEmpty(title, 'Performance title'), layer => layer.titles, 'registerTitle')
  }

  registerDirector(ctx: Context, director: Director): () => void {
    return this.registerContribution(ctx, director, layer => layer.directors, 'registerDirector')
  }

  registerToolFactory(ctx: Context, factory: TheaterToolFactory): () => void {
    const kind = nonEmpty(factory.kind, 'Theater Tool factory kind')
    if (scopeOf(ctx) !== undefined) {
      throw new Error('theater.registerToolFactory() requires the host scope')
    }
    return ctx.effect(() => {
      if (this.toolFactories.has(kind)) {
        throw new Error(`duplicate Theater Tool factory kind ${JSON.stringify(kind)}`)
      }
      this.toolFactories.set(kind, factory)
      return () => {
        if (this.toolFactories.get(kind) === factory) this.toolFactories.delete(kind)
      }
    }, `theater.registerToolFactory(${kind})`)
  }

  getToolFactory(kind: string): TheaterToolFactory | undefined {
    return this.toolFactories.get(kind)
  }

  resolveEffectiveDirector(
    presetId: string,
    presetDirector: Director | undefined,
    options: DirectorOverrideOptions,
  ): Director {
    const base = options.director ?? presetDirector
    if (base === undefined) {
      throw new Error(`Agent Preset ${JSON.stringify(presetId)} must contribute exactly one Theater Director; found 0`)
    }
    return options.wrapDirector === undefined ? base : options.wrapDirector(base)
  }

  async resolveContributions(
    owner: Context,
    presetId: string,
    allowMissingDirector = false,
  ): Promise<TheaterContributions> {
    const lease = await owner.agentPresets.acquireScope(presetId)
    try {
      const key: ScopeKey = lease.key
      const layer = this.layers.peek(key)
      const titles = layer === undefined ? [] : [...layer.titles.values()]
      if (titles.length > 1) {
        throw new Error(`Agent Preset ${JSON.stringify(presetId)} must contribute at most one Theater title; found ${titles.length}`)
      }
      const directors = layer === undefined ? [] : [...layer.directors.values()]
      if (directors.length > 1 || (!allowMissingDirector && directors.length !== 1)) {
        throw new Error(`Agent Preset ${JSON.stringify(presetId)} must contribute exactly one Theater Director; found ${directors.length}`)
      }
      const registeredCharacters = layer === undefined ? [] : [...layer.characters.values()]
      const characters = registeredCharacters.map((character) => ({
        id: character.id,
        title: nonEmpty(character.title ?? character.id, `Title for Character ${JSON.stringify(character.id)}`),
        ...character.model === undefined ? {} : { model: character.model },
        systemPrompt: character.systemPrompt,
        tools: character.tools.map((declaration) => {
          const kind = nonEmpty(declaration.factory, `Tool factory for Character ${JSON.stringify(character.id)}`)
          const factory = this.toolFactories.get(kind)
          if (factory === undefined) {
            throw new Error(`no Theater Tool factory registered for kind ${JSON.stringify(kind)}`)
          }
          const config = snapshotJsonValue(factory.resolveConfig(declaration.params ?? {}))
          if (config === undefined) {
            throw new Error(`Theater Tool factory ${JSON.stringify(kind)} returned non-JSON configuration`)
          }
          return { factory, config }
        }),
      }))
      const stagesService = stageServiceOf(owner)
      const stages = stagesService === undefined
        ? []
        : [...stagesService.resolveDeclarations(key)].map(([stageId, declaration]) => ({
            stageId,
            ...declaration,
          }))
      return {
        title: nonEmpty(titles[0] ?? presetId, 'Performance title'),
        characters,
        stages,
        ...directors[0] === undefined ? {} : { director: directors[0] },
      }
    } finally {
      await lease[Symbol.asyncDispose]()
    }
  }

  async checkCompatibility(
    owner: Context,
    durable: TheaterConfigured,
    options: DirectorOverrideOptions,
  ): Promise<RuntimeCompatibilityResult> {
    let title = durable.presetId
    let characterTitles: ReadonlyMap<string, string> = new Map(
      durable.characters.map(character => [character.id, character.id]),
    )
    const stagesService = stageServiceOf(owner)
    if (durable.stages.length > 0 && stagesService === undefined) {
      return {
        title,
        characterTitles,
        error: new Error('Stage service (@darwintree/dsh-stage) is required for durable Stages'),
      }
    }
    for (const durableStage of durable.stages) {
      const factory = stagesService!.getFactory(durableStage.machine)
      if (factory === undefined) {
        return {
          title,
          characterTitles,
          error: new Error(`incompatible State Machine factory: missing ${JSON.stringify(durableStage.machine)}`),
        }
      }
      if (factory.version !== durableStage.version) {
        return {
          title,
          characterTitles,
          error: new Error(`incompatible Stage ${JSON.stringify(durableStage.stageId)} version`),
        }
      }
    }
    for (const character of durable.characters) {
      for (const tool of character.tools) {
        if (!this.toolFactories.has(tool.factory)) {
          return {
            title,
            characterTitles,
            error: new Error(`incompatible Theater Tool factory: missing ${JSON.stringify(tool.factory)}`),
          }
        }
      }
    }

    let presetDirector: Director | undefined
    try {
      const structure = await this.resolvePresetStructure(owner, durable.presetId, options.director !== undefined)
      title = structure.title
      characterTitles = structure.characterTitles
      presetDirector = structure.director
      const mismatch = structuralIncompatibility(structure, durable)
      if (mismatch !== undefined) {
        return { title, characterTitles, error: new Error(mismatch) }
      }
    } catch (error) {
      if (options.director === undefined) {
        return {
          title,
          characterTitles,
          error: new Error(`current Theater contributions are unavailable: ${failure(error).message}`),
        }
      }
    }

    try {
      const director = this.resolveEffectiveDirector(durable.presetId, presetDirector, options)
      return { title, characterTitles, director }
    } catch (error) {
      return {
        title,
        characterTitles,
        error: error instanceof Error ? error : new Error(String(error)),
      }
    }
  }

  private registerContribution<T>(
    ctx: Context,
    contribution: T,
    entries: (layer: ContributionLayer) => AnonymousEntries<T>,
    method: string,
  ): () => void {
    if (scopeOf(ctx) === undefined) {
      throw new Error(`theater.${method}() requires an Agent Preset standing scope`)
    }
    return this.layers.effect(
      ctx,
      layer => entries(layer).append(contribution),
      { label: `theater.${method}()`, notify: false },
    )
  }

  private async resolvePresetStructure(
    owner: Context,
    presetId: string,
    allowMissingDirector: boolean,
  ): Promise<PresetStructure> {
    const lease = await owner.agentPresets.acquireScope(presetId)
    try {
      const key: ScopeKey = lease.key
      const layer = this.layers.peek(key)
      const titles = layer === undefined ? [] : [...layer.titles.values()]
      if (titles.length > 1) {
        throw new Error(`Agent Preset ${JSON.stringify(presetId)} must contribute at most one Theater title; found ${titles.length}`)
      }
      const directors = layer === undefined ? [] : [...layer.directors.values()]
      if (directors.length > 1 || (!allowMissingDirector && directors.length !== 1)) {
        throw new Error(`Agent Preset ${JSON.stringify(presetId)} must contribute exactly one Theater Director; found ${directors.length}`)
      }
      const registeredCharacters = layer === undefined ? [] : [...layer.characters.values()]
      const characterTitles = new Map<string, string>()
      const characterIds: string[] = []
      for (const character of registeredCharacters) {
        const id = nonEmpty(character.id, 'Character ID')
        if (characterTitles.has(id)) throw new Error(`duplicate Character ID ${JSON.stringify(id)}`)
        characterIds.push(id)
        characterTitles.set(id, nonEmpty(character.title ?? id, `Title for Character ${JSON.stringify(id)}`))
      }
      const stagesService = stageServiceOf(owner)
      const stages = stagesService === undefined
        ? []
        : [...stagesService.resolveDeclarations(key)].map(([stageId, declaration]) => ({
            stageId,
            machine: declaration.factory.kind,
            version: declaration.factory.version,
          }))
      return {
        title: nonEmpty(titles[0] ?? presetId, 'Performance title'),
        characterTitles,
        characterIds,
        stages,
        ...directors[0] === undefined ? {} : { director: directors[0] },
      }
    } finally {
      await lease[Symbol.asyncDispose]()
    }
  }
}
