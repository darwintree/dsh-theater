import { existsSync, lstatSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverPresets, syncPresets } from '../scripts/sync-presets.mjs'

let tempDir: string | undefined

afterEach(async () => {
  if (tempDir !== undefined) await rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

describe('scripts/sync-presets.mjs', () => {
  it('discovers all shipped workspace presets across packages and examples', () => {
    const ids = discoverPresets().map(preset => preset.id)
    expect(ids).toEqual([
      'gomoku',
      'role-play-v3',
      'three-board-gomoku',
      'two-character-gomoku',
    ])
  })

  it('copies or symlinks selected presets into a destination directory and rejects unknown ids', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dsh-sync-presets-'))

    const copied = syncPresets({ dest: tempDir, only: ['gomoku', 'role-play-v3'] })
    expect(copied.synced.map(p => p.id)).toEqual(['gomoku', 'role-play-v3'])
    expect(existsSync(join(tempDir, 'gomoku', 'agent.cordis.yml'))).toBe(true)
    expect(existsSync(join(tempDir, 'role-play-v3', 'agent.cordis.yml'))).toBe(true)
    expect(lstatSync(join(tempDir, 'gomoku')).isSymbolicLink()).toBe(false)

    const linked = syncPresets({ dest: tempDir, link: true, only: ['gomoku'] })
    expect(linked.synced.map(p => p.id)).toEqual(['gomoku'])
    expect(lstatSync(join(tempDir, 'gomoku')).isSymbolicLink()).toBe(true)

    expect(() => syncPresets({ dest: tempDir, only: ['nonexistent'] })).toThrow('unknown preset id')
  })
})
