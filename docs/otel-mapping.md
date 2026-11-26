# Minimal OpenTelemetry mapping

Status: W02 development contract. This API is not part of the v0.1.0 release and is not yet connected to the `/diff` command.

`projectOTel(input)` accepts an OTLP/JSON export string and returns `TrajectoryEvent[]`. It flattens `resourceSpans[].scopeSpans[].spans[]` in wire order. Parsing and projection are read-only: they do not execute model or tool work.

```ts
import { projectOTel } from 'dsh-trajectory-diff/otel'

const events = projectOTel(otlpJson)
```

## Field contract

| Source | `TrajectoryEvent` destination | Rule |
|---|---|---|
| One-based flattened span position | `seq` | Preserves source navigation without using trace or span IDs. |
| Constant `otel/span` | `type` | Identifies the minimal span projection. |
| `span.name` | `payload.name` | Required and must be a string. |
| `span.kind` | `payload.kind` | Defaults to `0` (`SPAN_KIND_UNSPECIFIED`) when absent. |
| `span.attributes[]` | `payload.attributes` | Converts the list to an object keyed by `attribute.key`; each OTLP value envelope is preserved unchanged. |
| `span.status.code` | `payload.status.code` | Defaults to `0` (`STATUS_CODE_UNSET`) when absent. |
| `span.status.message` | `payload.status.message` | Included only when present. |
| Projected payload | `canonical` | Stable JSON with sorted object keys and preserved array order. |

The resulting event has no synthetic `turn`, `step`, or tool-call `call` fields. A later adapter may derive those locations from established semantic conventions; the minimal mapper does not invent them.

## Deliberately excluded in this increment

The mapper does not include `traceId`, `spanId`, `parentSpanId`, start/end timestamps, span events, links, flags, dropped-count fields, resource attributes, or scope metadata in the comparable payload. Identity and timing are volatile; the remaining fields need an explicit semantic contract rather than accidental inclusion.

## Validation and current boundaries

The parser rejects malformed JSON, a missing/non-array `resourceSpans`, a scope entry without a `spans` array, and a span without a string `name`. `mapOTelSpan` also requires a positive safe-integer sequence number.

This first increment does **not** provide redaction, input-size limits, telemetry semantic-convention interpretation, or `/diff` command integration. OTLP attributes can contain sensitive data; inspect projected output before sharing it.
