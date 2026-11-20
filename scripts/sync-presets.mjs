#!/usr/bin/env node
/**
 * Discover shipped `presets/<id>/` directories across workspace packages and
 * sync them into DSH's user preset directory (`${DSH_HOME:-$HOME/.dsh}/.agent-presets`).
 *
 * Usage:
 *   node scripts/sync-presets.mjs [--dest <dir>] [--link] [--only <id1,id2>] [--list] [--dry-run]
 */

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_ROOTS = ['packages', 'example']

export function discoverPresets(repoRoot = REPO_ROOT) {
  const found = []
  const seen = new Set()
  for (const group of SCAN_ROOTS) {
    const groupDir = join(repoRoot, group)
    if (!existsSync(groupDir)) continue
    for (const pkgEntry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!pkgEntry.isDirectory()) continue
      const presetsDir = join(groupDir, pkgEntry.name, 'presets')
      if (!existsSync(presetsDir)) continue
      for (const presetEntry of readdirSync(presetsDir, { withFileTypes: true })) {
        if (!presetEntry.isDirectory()) continue
        const presetDir = join(presetsDir, presetEntry.name)
        if (!existsSync(join(presetDir, 'agent.cordis.yml'))) continue
        if (seen.has(presetEntry.name)) {
          throw new Error(`duplicate preset id ${JSON.stringify(presetEntry.name)}`)
        }
        seen.add(presetEntry.name)
        found.push({
          id: presetEntry.name,
          packageDir: `${group}/${pkgEntry.name}`,
          sourceDir: presetDir,
        })
      }
    }
  }
  return found.sort((a, b) => a.id.localeCompare(b.id))
}

export function syncPresets(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT
  const dshHome = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  const destRoot = resolve(options.dest ?? join(dshHome, '.agent-presets'))
  const all = discoverPresets(repoRoot)
  const filter = options.only && options.only.length > 0 ? new Set(options.only) : undefined

  if (filter !== undefined) {
    const known = new Set(all.map(item => item.id))
    const unknown = [...filter].filter(id => !known.has(id))
    if (unknown.length > 0) {
      throw new Error(`unknown preset id(s): ${unknown.join(', ')} (available: ${all.map(item => item.id).join(', ')})`)
    }
  }

  const selected = filter === undefined ? all : all.filter(item => filter.has(item.id))
  if (options.dryRun) {
    return { destRoot, synced: selected }
  }

  mkdirSync(destRoot, { recursive: true })
  for (const preset of selected) {
    const targetDir = join(destRoot, preset.id)
    if (existsSync(targetDir) || safeLstat(targetDir) !== undefined) {
      rmSync(targetDir, { recursive: true, force: true })
    }
    if (options.link) {
      symlinkSync(preset.sourceDir, targetDir, 'dir')
    } else {
      cpSync(preset.sourceDir, targetDir, { recursive: true })
    }
  }
  return { destRoot, synced: selected }
}

function safeLstat(path) {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

function parseCli(argv) {
  const opts = { dest: undefined, link: false, list: false, dryRun: false, only: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--') continue
    if (token === '--link') {
      opts.link = true
      continue
    }
    if (token === '--list') {
      opts.list = true
      continue
    }
    if (token === '--dry-run') {
      opts.dryRun = true
      continue
    }
    if (token === '--dest' || token.startsWith('--dest=')) {
      const value = token.includes('=') ? token.slice(token.indexOf('=') + 1) : argv[++i]
      if (!value) throw new Error('missing value for --dest')
      opts.dest = value
      continue
    }
    if (token === '--only' || token.startsWith('--only=')) {
      const value = token.includes('=') ? token.slice(token.indexOf('=') + 1) : argv[++i]
      if (!value) throw new Error('missing value for --only')
      opts.only.push(...value.split(',').map(s => s.trim()).filter(Boolean))
      continue
    }
    if (!token.startsWith('-')) {
      opts.only.push(token)
      continue
    }
    throw new Error(`unknown option: ${token}`)
  }
  return opts
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseCli(process.argv.slice(2))
    if (opts.list) {
      for (const preset of discoverPresets()) {
        process.stdout.write(`${preset.id}\t${preset.packageDir}\n`)
      }
      process.exit(0)
    }
    const { destRoot, synced } = syncPresets(opts)
    const verb = opts.dryRun ? 'Would sync' : opts.link ? 'Linked' : 'Synced'
    for (const preset of synced) {
      process.stdout.write(`${verb} ${preset.id} -> ${join(destRoot, preset.id)}\n`)
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
