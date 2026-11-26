import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { type Session, type SessionId } from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import type {
  SessionSearchHit,
  SessionSearchPage,
  SessionSearchRequest,
  SessionEventSearchHit,
  SessionEventSearchPage,
  SessionEventSearchRequest,
} from '@deepseek-ai/dsh-session-query'
import { createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm/message'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/types'
import { unsupportedModel, unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { brandString } from '@deepseek-ai/dsh-brand'
import * as TrajectoryDiff from '../src/index.ts'

class TestSessionQuery extends SessionQueryEngine {
  searchSessions(_request: SessionSearchRequest): Promise<SessionSearchPage<SessionSearchHit>> {
    return Promise.reject(new Error('searchSessions is not used by this test'))
  }

  searchEvents(_request: SessionEventSearchRequest): Promise<SessionEventSearchPage<SessionEventSearchHit>> {
    return Promise.reject(new Error('searchEvents is not used by this test'))
  }
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllEnvs()
})

function appendTrajectory(session: Session, callId: string, args: string): void {
  const brandedCallId = brandString<ToolCallId>(callId)
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Inspect the workspace' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('tool/call', { turn: 1, step: 1, callId: brandedCallId, name: 'bash', arguments: args })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: brandedCallId,
      content: [{ type: 'text', text: '/tmp' }],
      isError: false,
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
}

function idleAgent(ctx: Context, session: Session): Agent {
  const scope = ctx.plugin(() => {})
  let status: AgentStatus = 'idle'
  return {
    id: session.id,
    options: {},
    session,
    model: unsupportedModel(),
    inbox: unsupportedInbox(),
    ctx: scope.ctx,
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

describe('/diff real Loader composition', () => {
  it('compares two real Session logs without executing model or tool work', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-trajectory-diff-loader-'))
    vi.stubEnv('DSH_HOME', root)
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-commands'",
      "- name: '@deepseek-ai/dsh-session-query'",
      "- name: 'dsh-trajectory-diff'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-commands', CommandRuntime],
      ['@deepseek-ai/dsh-session-query', TestSessionQuery],
      ['dsh-trajectory-diff', TrajectoryDiff],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const current = context.sessions.create(brandString<SessionId>('current'))
    const same = context.sessions.create(brandString<SessionId>('same'))
    const changed = context.sessions.create(brandString<SessionId>('changed'))
    appendTrajectory(current, 'current-call', '{"command":"pwd"}')
    appendTrajectory(same, 'same-call', '{"command":"pwd"}')
    appendTrajectory(changed, 'changed-call', '{"command":"ls"}')
    const owner = idleAgent(context, current)
    await context.agents.register(owner)
    const signal = new AbortController().signal
    const modelMessagesBefore = current.deriveMessages().length

    expect(context.commands.list(owner).map(command => command.name)).toContain('diff')
    const identical = await context.commands.execute(owner, '/diff same', [], signal)
    expect(identical?.result.kind).toBe('success')
    expect(identical?.result.text).toContain('Trajectory diff: identical')

    const different = await context.commands.execute(owner, '/diff --json changed', [], signal)
    expect(different?.result.kind).toBe('success')
    const report = JSON.parse(different!.result.text!)
    expect(report.status).toBe('different')
    expect(report.firstDivergence).toMatchObject({ reason: 'payload' })
    expect(report.firstDivergence.left.type).toBe('tool/call')
    expect(report.firstDivergence.right.payload.arguments).toBe('{"command":"ls"}')

    const missingTarget = await context.commands.execute(owner, '/diff', [], signal)
    expect(missingTarget?.result).toEqual({ kind: 'error', text: 'Usage: /diff [--json] <other-session-id>' })
    const sameSession = await context.commands.execute(owner, '/diff current', [], signal)
    expect(sameSession?.result).toEqual({ kind: 'error', text: 'Choose a different Session to compare with the current one.' })
    const unknownOption = await context.commands.execute(owner, '/diff --bogus same', [], signal)
    expect(unknownOption?.result).toEqual({ kind: 'error', text: 'Usage: /diff [--json] <other-session-id>' })
    expect(() => TrajectoryDiff.apply(context!, { maxPreviewCodePoints: 1 })).toThrow('at least 80')

    expect(current.deriveMessages()).toHaveLength(modelMessagesBefore)
    expect(current.snapshotEvents().filter(event => event.type === 'command/run')).toHaveLength(5)
    expect(JSON.stringify(current.snapshotEvents())).not.toContain('changed-call')
  })
})
