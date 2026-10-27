#!/usr/bin/env node
/**
 * Install the repo's git hooks into the active git directory.
 *
 * Git never versions `.git/hooks`, so a fresh clone would silently lose the
 * auto-rebuild step. The hook sources live in `scripts/git-hooks/`; this
 * installer copies them into place (shared by every worktree of the repo).
 *
 * Usage: node scripts/install-git-hooks.cjs
 */

const { execFileSync } = require('node:child_process')
const { copyFileSync, readdirSync, chmodSync, mkdirSync } = require('node:fs')
const { join, resolve } = require('node:path')

const repoRoot = resolve(__dirname, '..')
const sourceDir = join(repoRoot, 'scripts', 'git-hooks')

const hooksDir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim()

const target = resolve(repoRoot, hooksDir)
mkdirSync(target, { recursive: true })

const files = readdirSync(sourceDir)
for (const file of files) {
  const to = join(target, file)
  copyFileSync(join(sourceDir, file), to)
  try {
    chmodSync(to, 0o755)
  } catch {
    // Windows ignores the executable bit; git runs hooks through sh anyway.
  }
  console.log(`installed ${file} -> ${to}`)
}

console.log(`\n${files.length} hook file(s) installed.`)
