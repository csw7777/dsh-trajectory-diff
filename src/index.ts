/**
 * Human-facing `/diff` command for deterministic comparisons of two Session
 * trajectories. The command only reads logs; it never starts model or tool work.
 * @module dsh-trajectory-diff
 */

import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CommandDefinitionId } from '@deepseek-ai/dsh-commands/types'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import z from '@deepseek-ai/schemastery'
import { diffTrajectories, renderDiffReport } from './diff.ts'

export type * from './diff.ts'

export const name = 'trajectory-diff'
export const inject = ['commands', 'sessionQuery']

const USAGE = 'Usage: /diff [--json] <other-session-id>'

/** Validated plugin configuration supplied through cordis.yml. */
export interface TrajectoryDiffConfig {
  /** Maximum Unicode code points printed for each side of one event. */
  maxPreviewCodePoints: number
}

/** Schemastery validation for {@link TrajectoryDiffConfig}. */
export const Config: z<TrajectoryDiffConfig> = z.object({
  maxPreviewCodePoints: z.number().default(600),
})

function usageError(): CommandResult {
  return { kind: 'error', text: USAGE }
}

/** Load and compare the receiving Session with one other live or persisted Session. */
async function executeDiff(
  ctx: Context,
  config: TrajectoryDiffConfig,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const parts = invocation.rawInput.trim().split(/\s+/u).filter(Boolean)
  const json = parts.includes('--json')
  const targets = parts.filter(part => part !== '--json')
  if (targets.length !== 1 || targets.some(part => part.startsWith('--'))) return usageError()
  const targetId = targets[0]!
  const currentId = invocation.agent.session.id
  if (targetId === currentId) {
    return { kind: 'error', text: 'Choose a different Session to compare with the current one.' }
  }

  const [left, right] = await Promise.all([
    ctx.sessionQuery.readSession(currentId),
    ctx.sessionQuery.readSession(brandString<SessionId>(targetId)),
  ])
  const report = diffTrajectories(
    { sessionId: left.session.id, events: left.events },
    { sessionId: right.session.id, events: right.events },
  )
  return {
    kind: 'success',
    text: json ? JSON.stringify(report, null, 2) : renderDiffReport(report, config.maxPreviewCodePoints),
  }
}

/** Register the command and its disposal through the composed command registry. */
export function apply(ctx: Context, config: TrajectoryDiffConfig): void {
  if (!Number.isSafeInteger(config.maxPreviewCodePoints) || config.maxPreviewCodePoints < 80) {
    throw new Error('trajectory-diff requires maxPreviewCodePoints to be an integer of at least 80')
  }
  ctx.commands.register({
    definitionId: brandString<CommandDefinitionId>('dsh-trajectory-diff'),
    name: 'diff',
    description: 'Compare this session with another agent trajectory',
    input: { hint: '[--json] <other-session-id>' },
    recordInput: false,
    handler: invocation => executeDiff(ctx, config, invocation),
  })
}
