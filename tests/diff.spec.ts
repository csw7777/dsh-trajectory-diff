import { brandString } from '@deepseek-ai/dsh-brand'
import {
  createAssistantMessage,
  createDeveloperMessage,
  createSystemMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm/message'
import type { SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/types'
import { describe, expect, it } from 'vitest'
import {
  canonicalize,
  diffTrajectories,
  projectTrajectory,
  renderDiffReport,
  type TrajectoryDocument,
} from '../src/diff.ts'

function seq(value: number): SessionSeq {
  return brandString<SessionSeq>(value)
}

function turnStart(value: number, turn = 1): SessionEvent<'turn/start'> {
  return { type: 'turn/start', seq: seq(value), time: value, data: { turn } }
}

function stepStart(value: number, turn = 1, step = 1): SessionEvent<'step/start'> {
  return { type: 'step/start', seq: seq(value), time: value, data: { turn, step } }
}

function stepEnd(value: number, turn = 1, step = 1): SessionEvent<'step/end'> {
  return { type: 'step/end', seq: seq(value), time: value, data: { turn, step } }
}

function turnEnd(value: number, turn = 1): SessionEvent<'turn/end'> {
  return { type: 'turn/end', seq: seq(value), time: value, data: { turn, reason: { kind: 'completed' } } }
}

function user(value: number, text: string): SessionEvent<'user/message'> {
  return {
    type: 'user/message',
    seq: seq(value),
    time: value,
    data: createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
    surfaceOp: 'append',
  }
}

function assistant(value: number, text: string, inputTokens = 100): SessionEvent<'assistant/message'> {
  return {
    type: 'assistant/message',
    seq: seq(value),
    time: value,
    data: {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text }],
        source: { provider: 'test', model: 'tiny' },
      }),
      stream: [],
      usage: { inputTokens, outputTokens: 5, cacheReadTokens: 50, cacheWriteTokens: 10 },
    },
    surfaceOp: 'append',
  }
}

function developer(value: number, text: string): SessionEvent<'developer/message'> {
  return {
    type: 'developer/message',
    seq: seq(value),
    time: value,
    data: {
      turn: 1,
      step: 1,
      message: createDeveloperMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'tool-registry' },
      }),
    },
    surfaceOp: 'append',
  }
}

function system(value: number, text: string): SessionEvent<'system/message'> {
  return {
    type: 'system/message',
    seq: seq(value),
    time: value,
    data: { turn: 1, step: 1, message: createSystemMessage(text) },
    surfaceOp: 'append',
  }
}

function requestHeader(value: number, model: string): SessionEvent<'request/header'> {
  return {
    type: 'request/header',
    seq: seq(value),
    time: value,
    data: {
      reason: 'initial',
      startsSeries: true,
      header: { config: { provider: 'test', model } },
    },
  }
}

function toolCall(value: number, callId: string, args: string): SessionEvent<'tool/call'> {
  return {
    type: 'tool/call',
    seq: seq(value),
    time: value,
    data: { turn: 1, step: 1, callId: brandString<ToolCallId>(callId), name: 'bash', arguments: args },
  }
}

function toolResult(value: number, callId: string, text: string): SessionEvent<'tool/result'> {
  return {
    type: 'tool/result',
    seq: seq(value),
    time: value,
    data: {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: brandString<ToolCallId>(callId),
        content: [{ type: 'text', text }],
        isError: false,
      }),
    },
    surfaceOp: 'append',
  }
}

function ignoredAttempt(value: number): SessionEvent<'assistant/attempt'> {
  return { type: 'assistant/attempt', seq: seq(value), time: value, data: { turn: 1, step: 1, stream: [] } }
}

interface FixtureOptions {
  readonly arguments?: string
  readonly result?: string
  readonly assistantText?: string
  readonly inputTokens?: number
  readonly includeAttempt?: boolean
}

function fixture(sessionId: string, options: FixtureOptions = {}): TrajectoryDocument {
  const events: SessionEvent[] = [
    turnStart(1),
    stepStart(2),
    user(3, 'Inspect the workspace'),
    assistant(4, options.assistantText ?? 'I will inspect it.', options.inputTokens),
    toolCall(5, `${sessionId}-call`, options.arguments ?? '{"command":"pwd"}'),
    toolResult(6, `${sessionId}-call`, options.result ?? '/tmp'),
    stepEnd(7),
    turnEnd(8),
  ]
  if (options.includeAttempt === true) events.push(ignoredAttempt(9))
  return { sessionId, events }
}

describe('canonicalize', () => {
  it('sorts object keys without reordering arrays', () => {
    expect(canonicalize({ b: [2, 1], a: 1 })).toBe(canonicalize({ a: 1, b: [2, 1] }))
    expect(canonicalize({ b: [2, 1], a: 1 })).not.toBe(canonicalize({ a: 1, b: [1, 2] }))
  })
})

describe('projectTrajectory', () => {
  it('normalizes call ids and retains their call/result relationship', () => {
    const projection = projectTrajectory(fixture('left').events)
    const call = projection.events.find(event => event.type === 'tool/call')
    const result = projection.events.find(event => event.type === 'tool/result')
    expect(call?.call).toBe(1)
    expect(result?.call).toBe(1)
    expect(call?.canonical).not.toContain('left-call')
    expect(result?.canonical).not.toContain('left-call')
  })

  it('counts ignored attempts without treating them as semantic differences', () => {
    const projection = projectTrajectory(fixture('left', { includeAttempt: true }).events)
    expect(projection.ignored).toEqual({ 'assistant/attempt': 1 })
    expect(projection.events).toHaveLength(8)
  })

  it('compares developer and system message content', () => {
    const report = diffTrajectories(
      { sessionId: 'left', events: [developer(1, 'same'), system(2, 'instructions')] },
      { sessionId: 'right', events: [developer(1, 'same'), system(2, 'changed')] },
    )
    expect(report.firstDivergence).toMatchObject({ index: 1, reason: 'payload' })
    expect(report.firstDivergence?.left?.type).toBe('system/message')
    expect(report.firstDivergence?.right?.canonical).toContain('changed')
  })

  it('ignores request headers by default but compares them on request', () => {
    const left = { sessionId: 'left', events: [requestHeader(1, 'model-a')] }
    const right = { sessionId: 'right', events: [requestHeader(1, 'model-b')] }
    const ignored = diffTrajectories(left, right)
    expect(ignored.status).toBe('identical')
    expect(ignored.ignored.left).toEqual({ 'request/header': 1 })
    const included = diffTrajectories(left, right, { includeRequestHeaders: true })
    expect(included.firstDivergence).toMatchObject({ index: 0, reason: 'payload' })
    expect(included.firstDivergence?.left?.type).toBe('request/header')
  })
})

describe('diffTrajectories', () => {
  it('reports identical trajectories despite random message ids and different call ids', () => {
    const left = fixture('left', { includeAttempt: true })
    const right = fixture('right')
    const report = diffTrajectories(left, right)
    expect(report.status).toBe('identical')
    expect(report.firstDivergence).toBeUndefined()
    expect(report.left.inputTokens).toBe(100)
    expect(report.right.outputTokens).toBe(5)
    expect(report.left.cacheReadTokens).toBe(50)
    expect(report.ignored.left).toEqual({ 'assistant/attempt': 1 })
  })

  it('locates the first changed tool argument at its turn, step, and call', () => {
    const report = diffTrajectories(
      fixture('left'),
      fixture('right', { arguments: '{"command":"ls"}' }),
    )
    expect(report.status).toBe('different')
    expect(report.comparedEvents).toBe(4)
    expect(report.firstDivergence).toMatchObject({
      index: 4,
      reason: 'payload',
      left: { type: 'tool/call', call: 1 },
      right: { type: 'tool/call', call: 1 },
    })
    expect(report.firstDivergence?.location).toContain('turn 1 / step 1 / tool call 1')
    expect(renderDiffReport(report)).toContain('\\"command\\":\\"ls\\"')
  })

  it('detects a changed tool result rather than hiding it with call-id normalization', () => {
    const report = diffTrajectories(fixture('left'), fixture('right', { result: '/workspace' }))
    expect(report.firstDivergence).toMatchObject({ index: 5, reason: 'payload' })
    expect(report.firstDivergence?.right?.canonical).toContain('/workspace')
  })

  it('reports an event-type mismatch before comparing payloads', () => {
    const right = fixture('right')
    right.events[4] = assistant(5, 'The model chose no tool')
    const report = diffTrajectories(fixture('left'), right)
    expect(report.firstDivergence).toMatchObject({ index: 4, reason: 'event-type' })
    expect(renderDiffReport(report)).toContain('assistant/message')
  })

  it('reports an extra semantic event as a length divergence', () => {
    const right = fixture('right')
    const report = diffTrajectories(fixture('left'), {
      ...right,
      events: [...right.events, stepEnd(9)],
    })
    expect(report.firstDivergence).toMatchObject({ index: 8, reason: 'length' })
    expect(report.status).toBe('different')
  })

  it('includes token usage changes in the semantic comparison', () => {
    const report = diffTrajectories(fixture('left', { inputTokens: 100 }), fixture('right', { inputTokens: 200 }))
    expect(report.firstDivergence?.index).toBe(3)
    expect(report.left.inputTokens).toBe(100)
    expect(report.right.inputTokens).toBe(200)
  })

  it('bounds text previews without splitting a Unicode surrogate pair', () => {
    const report = diffTrajectories(fixture('left'), fixture('right', { assistantText: '🙂'.repeat(200) }))
    const text = renderDiffReport(report, 80)
    expect(text).not.toContain('�')
    expect(text).toContain('…')
  })
})
