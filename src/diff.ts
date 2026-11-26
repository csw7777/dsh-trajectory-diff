import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** One semantic event after removing runtime-specific identity and timing noise. */
export interface TrajectoryEvent {
  /** Original one-based session sequence, retained only for source navigation. */
  readonly seq: number
  readonly type: string
  readonly turn?: number
  readonly step?: number
  /** One-based tool-call ordinal shared by a call and its result. */
  readonly call?: number
  readonly payload: unknown
  readonly canonical: string
}

/** Semantic events and the number of events intentionally excluded by type. */
export interface TrajectoryProjection {
  readonly events: readonly TrajectoryEvent[]
  readonly ignored: Readonly<Record<string, number>>
}

/** Model usage and structural counts derived from settled assistant messages. */
export interface TrajectorySummary {
  readonly semanticEvents: number
  readonly turns: number
  readonly steps: number
  readonly toolCalls: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

/** The first semantic difference between two trajectories. */
export interface TrajectoryDivergence {
  /** Zero-based index in the semantic-event streams. */
  readonly index: number
  readonly reason: 'event-type' | 'payload' | 'length'
  readonly location: string
  readonly left?: TrajectoryEvent
  readonly right?: TrajectoryEvent
}

/** Complete deterministic comparison result suitable for text or JSON output. */
export interface TrajectoryDiffReport {
  readonly status: 'identical' | 'different'
  readonly left: TrajectorySummary & { readonly sessionId: string }
  readonly right: TrajectorySummary & { readonly sessionId: string }
  readonly comparedEvents: number
  readonly ignored: {
    readonly left: Readonly<Record<string, number>>
    readonly right: Readonly<Record<string, number>>
  }
  readonly firstDivergence?: TrajectoryDivergence
}

/** Input document independent from the DSH service used to load it. */
export interface TrajectoryDocument {
  readonly sessionId: string
  readonly events: readonly SessionEvent[]
}

/** Projection controls for noise that is useful only in specialized comparisons. */
export interface TrajectoryProjectionOptions {
  /** Include full model and tool-schema request headers. Defaults to false. */
  readonly includeRequestHeaders?: boolean
}

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, member]) => member !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, member]) => [key, normalized(member)]),
    )
  }
  return value
}

/** Stable JSON encoding with sorted object keys and preserved array order. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(normalized(value)) ?? 'null'
}

function semanticEvent(
  event: SessionEvent,
  type: string,
  payload: unknown,
  position: { turn?: number | undefined; step?: number | undefined; call?: number | undefined },
): TrajectoryEvent {
  return {
    seq: event.seq,
    type,
    ...position.turn === undefined ? {} : { turn: position.turn },
    ...position.step === undefined ? {} : { step: position.step },
    ...position.call === undefined ? {} : { call: position.call },
    payload,
    canonical: canonicalize(payload),
  }
}

/** Project raw session logs into comparable semantic events without executing them. */
export function projectTrajectory(
  events: readonly SessionEvent[],
  options: TrajectoryProjectionOptions = {},
): TrajectoryProjection {
  const projected: TrajectoryEvent[] = []
  const ignored = new Map<string, number>()
  const callOrdinals = new Map<string, number>()
  let currentTurn: number | undefined
  let currentStep: number | undefined
  let nextCallOrdinal = 1

  for (const event of events) {
    switch (event.type) {
      case 'turn/start':
        currentTurn = event.data.turn
        currentStep = undefined
        projected.push(semanticEvent(event, event.type, { turn: event.data.turn }, { turn: currentTurn }))
        continue
      case 'turn/end':
        projected.push(semanticEvent(
          event,
          event.type,
          { turn: event.data.turn, reason: event.data.reason },
          { turn: event.data.turn },
        ))
        continue
      case 'step/start':
        currentStep = event.data.step
        projected.push(semanticEvent(
          event,
          event.type,
          { turn: event.data.turn, step: event.data.step },
          { turn: event.data.turn, step: currentStep },
        ))
        continue
      case 'step/end':
        projected.push(semanticEvent(
          event,
          event.type,
          { turn: event.data.turn, step: event.data.step },
          { turn: event.data.turn, step: event.data.step },
        ))
        continue
      case 'user/message':
        projected.push(semanticEvent(
          event,
          event.type,
          { content: event.data.content },
          { turn: currentTurn, step: currentStep },
        ))
        continue
      case 'developer/message':
        projected.push(semanticEvent(
          event,
          event.type,
          { content: event.data.message.content },
          { turn: event.data.turn, step: event.data.step },
        ))
        continue
      case 'system/message':
        projected.push(semanticEvent(
          event,
          event.type,
          { content: event.data.message.content },
          { turn: event.data.turn, step: event.data.step },
        ))
        continue
      case 'assistant/message':
        projected.push(semanticEvent(
          event,
          event.type,
          {
            content: event.data.message.content,
            ...event.data.interrupted === undefined ? {} : { interrupted: event.data.interrupted },
            ...event.data.usage === undefined ? {} : { usage: event.data.usage },
          },
          { turn: event.data.turn, step: event.data.step },
        ))
        continue
      case 'tool/call': {
        const call = nextCallOrdinal++
        callOrdinals.set(event.data.callId, call)
        projected.push(semanticEvent(
          event,
          event.type,
          { name: event.data.name, arguments: event.data.arguments },
          { turn: event.data.turn, step: event.data.step, call },
        ))
        continue
      }
      case 'tool/result': {
        const call = callOrdinals.get(event.data.message.toolCallId)
        projected.push(semanticEvent(
          event,
          event.type,
          {
            content: event.data.message.content,
            ...event.data.message.isError === undefined ? {} : { isError: event.data.message.isError },
            ...event.data.error === undefined ? {} : { error: event.data.error },
          },
          { turn: event.data.turn, step: event.data.step, ...call === undefined ? {} : { call } },
        ))
        continue
      }
      case 'request/header':
        if (options.includeRequestHeaders === true) {
          projected.push(semanticEvent(
            event,
            event.type,
            {
              reason: event.data.reason,
              ...event.data.startsSeries === undefined ? {} : { startsSeries: event.data.startsSeries },
              header: event.data.header,
            },
            { turn: currentTurn, step: currentStep },
          ))
          continue
        }
        break
      default:
        break
    }
    ignored.set(event.type, (ignored.get(event.type) ?? 0) + 1)
  }
  return { events: projected, ignored: Object.fromEntries(ignored) }
}

function summarize(document: TrajectoryDocument, events: readonly TrajectoryEvent[]): TrajectorySummary & { sessionId: string } {
  let turns = 0
  let steps = 0
  let toolCalls = 0
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  for (const event of document.events) {
    if (event.type === 'turn/start') turns += 1
    if (event.type === 'step/start') steps += 1
    if (event.type === 'tool/call') toolCalls += 1
    if (event.type === 'assistant/message' && event.data.usage !== undefined) {
      inputTokens += event.data.usage.inputTokens
      outputTokens += event.data.usage.outputTokens
      cacheReadTokens += event.data.usage.cacheReadTokens ?? 0
      cacheWriteTokens += event.data.usage.cacheWriteTokens ?? 0
    }
  }
  return {
    sessionId: document.sessionId,
    semanticEvents: events.length,
    turns,
    steps,
    toolCalls,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  }
}

function locationOf(event: TrajectoryEvent | undefined, index: number): string {
  if (event === undefined) return `semantic event ${index + 1} (end of one trajectory)`
  const parts = [`semantic event ${index + 1}`]
  if (event.turn !== undefined) parts.push(`turn ${event.turn}`)
  if (event.step !== undefined) parts.push(`step ${event.step}`)
  if (event.call !== undefined) parts.push(`tool call ${event.call}`)
  parts.push(`source seq ${event.seq}`)
  return parts.join(' / ')
}

/** Compare two documents and return the first semantic divergence, if any. */
export function diffTrajectories(
  left: TrajectoryDocument,
  right: TrajectoryDocument,
  options: TrajectoryProjectionOptions = {},
): TrajectoryDiffReport {
  const leftProjection = projectTrajectory(left.events, options)
  const rightProjection = projectTrajectory(right.events, options)
  const commonLength = Math.min(leftProjection.events.length, rightProjection.events.length)
  let firstDivergence: TrajectoryDivergence | undefined
  let comparedEvents = commonLength

  for (let index = 0; index < commonLength; index += 1) {
    const leftEvent = leftProjection.events[index]!
    const rightEvent = rightProjection.events[index]!
    if (leftEvent.type !== rightEvent.type) {
      firstDivergence = { index, reason: 'event-type', location: locationOf(leftEvent, index), left: leftEvent, right: rightEvent }
      comparedEvents = index
      break
    }
    if (leftEvent.canonical !== rightEvent.canonical) {
      firstDivergence = { index, reason: 'payload', location: locationOf(leftEvent, index), left: leftEvent, right: rightEvent }
      comparedEvents = index
      break
    }
  }

  if (firstDivergence === undefined && leftProjection.events.length !== rightProjection.events.length) {
    const leftEvent = leftProjection.events[commonLength]
    const rightEvent = rightProjection.events[commonLength]
    firstDivergence = {
      index: commonLength,
      reason: 'length',
      location: locationOf(leftEvent ?? rightEvent, commonLength),
      ...leftEvent === undefined ? {} : { left: leftEvent },
      ...rightEvent === undefined ? {} : { right: rightEvent },
    }
    comparedEvents = commonLength
  }

  return {
    status: firstDivergence === undefined ? 'identical' : 'different',
    left: summarize(left, leftProjection.events),
    right: summarize(right, rightProjection.events),
    comparedEvents,
    ignored: { left: leftProjection.ignored, right: rightProjection.ignored },
    ...firstDivergence === undefined ? {} : { firstDivergence },
  }
}

function preview(event: TrajectoryEvent | undefined, maxCodePoints: number): string {
  if (event === undefined) return '<absent>'
  const text = `${event.type} ${event.canonical}`
  const codePoints = Array.from(text)
  return codePoints.length <= maxCodePoints ? text : `${codePoints.slice(0, maxCodePoints).join('')}…`
}

function usageText(summary: TrajectorySummary): string {
  return [
    `input=${summary.inputTokens}`,
    `output=${summary.outputTokens}`,
    `cacheRead=${summary.cacheReadTokens}`,
    `cacheWrite=${summary.cacheWriteTokens}`,
  ].join(' ')
}

/** Render a bounded human-readable report without changing the JSON result. */
export function renderDiffReport(report: TrajectoryDiffReport, maxPreviewCodePoints = 600): string {
  const lines = [
    `Trajectory diff: ${report.status}`,
    `Left: ${report.left.sessionId} — ${usageText(report.left)}`,
    `Right: ${report.right.sessionId} — ${usageText(report.right)}`,
    `Structure: turns ${report.left.turns} vs ${report.right.turns}; steps ${report.left.steps} vs ${report.right.steps}; tool calls ${report.left.toolCalls} vs ${report.right.toolCalls}`,
  ]
  const divergence = report.firstDivergence
  if (divergence !== undefined) {
    lines.push(
      `First semantic divergence: ${divergence.location} (${divergence.reason})`,
      `Left: ${preview(divergence.left, maxPreviewCodePoints)}`,
      `Right: ${preview(divergence.right, maxPreviewCodePoints)}`,
    )
  } else {
    lines.push(`Semantic events compared: ${report.left.semanticEvents}`)
  }
  lines.push(`Semantic events before divergence: ${report.comparedEvents}`)
  return lines.join('\n')
}
