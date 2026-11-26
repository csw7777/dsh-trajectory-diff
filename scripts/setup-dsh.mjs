#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const worktrees = resolve(root, '../worktrees')
const dsh = resolve(worktrees, 'deepseek-harness')

function run(command, args, directory) {
  execFileSync(command, args, { cwd: directory, stdio: 'inherit' })
}

if (!existsSync(dsh)) {
  mkdirSync(worktrees, { recursive: true })
  run('git', ['clone', '--depth', '1', 'https://github.com/deepseek-ai/deepseek-harness.git', dsh], root)
}

run('pnpm', ['--dir', dsh, 'install', '--frozen-lockfile'], root)
run('pnpm', ['--dir', dsh, 'run', 'build:artifacts'], root)
console.log(`DSH development runtime is ready at ${dsh}`)
