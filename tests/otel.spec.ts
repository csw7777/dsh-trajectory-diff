import { describe, expect, it } from 'vitest'
import { mapOTelSpan, parseOTelSpans, projectOTel } from '../src/otel.ts'

const span = {
  traceId: 'volatile-trace', spanId: 'volatile-span', name: 'execute_tool lookup', kind: 1,
  startTimeUnixNano: '100', endTimeUnixNano: '200',
  attributes: [{ key: 'gen_ai.tool.name', value: { stringValue: 'lookup' } }],
  status: { code: 1 },
}

describe('OpenTelemetry minimal mapping', () => {
  it('flattens resource and scope envelopes in wire order', () => {
    const input = JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [span, { ...span, name: 'second' }] }] }] })
    expect(parseOTelSpans(input).map(item => item.name)).toEqual(['execute_tool lookup', 'second'])
  })

  it('retains semantic fields and excludes volatile identity and timing', () => {
    const event = mapOTelSpan(span, 1)
    expect(event).toMatchObject({ seq: 1, type: 'otel/span' })
    expect(event.payload).toEqual({
      name: 'execute_tool lookup', kind: 1,
      attributes: { 'gen_ai.tool.name': { stringValue: 'lookup' } }, status: { code: 1 },
    })
    expect(event.canonical).not.toMatch(/volatile|TimeUnixNano/)
  })

  it('assigns stable one-based source positions', () => {
    const input = JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [span, span] }] }] })
    expect(projectOTel(input).map(event => event.seq)).toEqual([1, 2])
  })

  it('fails clearly for malformed JSON and missing required arrays', () => {
    expect(() => parseOTelSpans('{')).toThrow('Invalid OTel JSON')
    expect(() => parseOTelSpans('{}')).toThrow('resourceSpans array')
    expect(() => parseOTelSpans('{"resourceSpans":[{"scopeSpans":[{}]}]}')).toThrow('spans array')
  })
})
