#!/usr/bin/env node
/**
 * Helper for optionally co-developing against a local `deepseek-harness` checkout
 * without hardcoding `link:../../../deepseek-harness/...` in package manifests.
 *
 * Usage:
 *   node scripts/dsh-local-links.mjs print [path/to/deepseek-harness]
 *   node scripts/dsh-local-links.mjs apply [path/to/deepseek-harness]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WORKSPACE_FILE = resolve(REPO_ROOT, 'pnpm-workspace.yaml')

const LOCAL_PACKAGE_MAP = {
  '@deepseek-ai/cordis': 'vendor/cordis',
  '@deepseek-ai/cordis-plugin-include': 'vendor/include',
  '@deepseek-ai/cordis-plugin-loader': 'vendor/loader',
  '@deepseek-ai/schemastery': 'vendor/schemastery',
  '@deepseek-ai/dsh-agent': 'packages/core/agent',
  '@deepseek-ai/dsh-agent-default-model': 'packages/core/agent-default-model',
  '@deepseek-ai/dsh-agent-instructions': 'packages/context/agent-instructions',
  '@deepseek-ai/dsh-agent-loop': 'packages/core/agent-loop',
  '@deepseek-ai/dsh-agent-presets': 'packages/preset/agent-presets',
  '@deepseek-ai/dsh-atomic-write': 'packages/util/atomic-write',
  '@deepseek-ai/dsh-brand': 'packages/util/brand',
  '@deepseek-ai/dsh-code-runtime': 'packages/ptc-runtime/code-runtime',
  '@deepseek-ai/dsh-fs': 'packages/fs/fs',
  '@deepseek-ai/dsh-fs-local': 'packages/fs/fs-local',
  '@deepseek-ai/dsh-home-paths': 'packages/util/home-paths',
  '@deepseek-ai/dsh-invariants': 'packages/util/invariants',
  '@deepseek-ai/dsh-llm': 'packages/llm/llm',
  '@deepseek-ai/dsh-persona': 'packages/preset/persona',
  '@deepseek-ai/dsh-scope': 'packages/core/scope',
  '@deepseek-ai/dsh-session': 'packages/core/session',
  '@deepseek-ai/dsh-session-persistence': 'packages/session/session-persistence',
  '@deepseek-ai/dsh-session-persistence-jsonl': 'packages/session/session-persistence-jsonl',
  '@deepseek-ai/dsh-session-projection': 'packages/session/session-projection',
  '@deepseek-ai/dsh-session-title': 'packages/session/session-title',
  '@deepseek-ai/dsh-settings': 'packages/settings/settings',
  '@deepseek-ai/dsh-system-prompt': 'packages/core/system-prompt',
  '@deepseek-ai/dsh-tools': 'packages/core/tools',
  '@deepseek-ai/dsh-typert-protocol': 'packages/typert/typert-protocol',
  '@deepseek-ai/dsh-user-approval': 'packages/interaction/user-approval',
  '@deepseek-ai/dsh-util-values': 'packages/util/values',
}

function buildOverrides(harnessDir) {
  const absHarness = resolve(process.cwd(), harnessDir)
  const entries = []
  for (const [pkg, subPath] of Object.entries(LOCAL_PACKAGE_MAP)) {
    const target = resolve(absHarness, subPath)
    if (!existsSync(target)) continue
    const rel = relative(REPO_ROOT, target).replaceAll('\\', '/')
    entries.push([pkg, `link:${rel}`])
  }
  return entries
}

function renderOverridesBlock(entries) {
  return [
    'overrides:',
    ...entries.map(([pkg, value]) => `  '${pkg}': '${value}'`),
  ].join('\n')
}

const [command = 'print', harnessPath = '../deepseek-harness'] = process.argv.slice(2)

if (command !== 'print' && command !== 'apply') {
  console.error('Usage: node scripts/dsh-local-links.mjs <print|apply> [path/to/deepseek-harness]')
  process.exit(1)
}

const entries = buildOverrides(harnessPath)
if (entries.length === 0) {
  console.error(`No deepseek-harness packages found under ${resolve(process.cwd(), harnessPath)}`)
  process.exit(1)
}

const block = renderOverridesBlock(entries)
if (command === 'print') {
  process.stdout.write(`${block}\n`)
  process.exit(0)
}

const current = readFileSync(WORKSPACE_FILE, 'utf8')
const replaced = current.replace(/^overrides:\n(?:  .*\n)*/m, `${block}\n`)
if (replaced === current) {
  console.error('Could not locate overrides section in pnpm-workspace.yaml')
  process.exit(1)
}
writeFileSync(WORKSPACE_FILE, replaced)
console.log(`Updated pnpm-workspace.yaml with ${entries.length} local link overrides from ${resolve(process.cwd(), harnessPath)}.`)
console.log('Run "pnpm install" to link, and "git checkout -- pnpm-workspace.yaml pnpm-lock.yaml && pnpm install" to restore npm pins.')
