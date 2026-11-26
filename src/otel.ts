import { canonicalize, type TrajectoryEvent } from './diff.ts'

/** The OTLP/JSON attribute value shape; keys are normalized during projection. */
export interface OTelAttribute {
  readonly key: string
  readonly value: Readonly<Record<string, unknown>>
}

/** Minimal span fields accepted by the framework-neutral OTel projection. */
export interface OTelSpan {
  readonly name: string
  readonly kind?: number
  readonly attributes?: readonly OTelAttribute[]
  readonly status?: { readonly code?: number, readonly message?: string }
  readonly [key: string]: unknown
}

interface OTelScopeSpans { readonly spans?: readonly OTelSpan[] }
interface OTelResourceSpans { readonly scopeSpans?: readonly OTelScopeSpans[] }

function parseDocument(input: string): unknown {
  try {
    return JSON.parse(input)
  } catch (error) {
    throw new Error(`Invalid OTel JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Flatten resource/scope envelopes in wire order. Trace IDs, span IDs and timing
 * are deliberately excluded: they are volatile rather than semantic differences.
 */
export function parseOTelSpans(input: string): readonly OTelSpan[] {
  const document = parseDocument(input) as { resourceSpans?: readonly OTelResourceSpans[] }
  if (!Array.isArray(document?.resourceSpans)) throw new Error('OTel JSON requires a resourceSpans array')
  return document.resourceSpans.flatMap((resource: OTelResourceSpans) => resource.scopeSpans?.flatMap((scope: OTelScopeSpans) => {
    if (!Array.isArray(scope.spans)) throw new Error('Each OTel scopeSpans entry requires a spans array')
    return scope.spans.map((span: OTelSpan) => {
      if (typeof span?.name !== 'string') throw new Error('Each OTel span requires a string name')
      return span
    })
  }) ?? [])
}

/** Map one ordinary OTel span to a stable, comparable semantic event. */
export function mapOTelSpan(span: OTelSpan, seq: number): TrajectoryEvent {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error('OTel event seq must be a positive safe integer')
  const attributes = Object.fromEntries((span.attributes ?? []).map(attribute => [attribute.key, attribute.value]))
  const payload = {
    name: span.name,
    kind: span.kind ?? 0,
    attributes,
    status: { code: span.status?.code ?? 0, ...span.status?.message === undefined ? {} : { message: span.status.message } },
  }
  return { seq, type: 'otel/span', payload, canonical: canonicalize(payload) }
}

/** Parse and project an OTLP/JSON export without executing model or tool work. */
export function projectOTel(input: string): readonly TrajectoryEvent[] {
  return parseOTelSpans(input).map((span, index) => mapOTelSpan(span, index + 1))
}
