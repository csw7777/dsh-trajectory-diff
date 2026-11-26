import { type TrajectoryEvent } from './diff.ts';
/** The OTLP/JSON attribute value shape; keys are normalized during projection. */
export interface OTelAttribute {
    readonly key: string;
    readonly value: Readonly<Record<string, unknown>>;
}
/** Minimal span fields accepted by the framework-neutral OTel projection. */
export interface OTelSpan {
    readonly name: string;
    readonly kind?: number;
    readonly attributes?: readonly OTelAttribute[];
    readonly status?: {
        readonly code?: number;
        readonly message?: string;
    };
    readonly [key: string]: unknown;
}
/**
 * Flatten resource/scope envelopes in wire order. Trace IDs, span IDs and timing
 * are deliberately excluded: they are volatile rather than semantic differences.
 */
export declare function parseOTelSpans(input: string): readonly OTelSpan[];
/** Map one ordinary OTel span to a stable, comparable semantic event. */
export declare function mapOTelSpan(span: OTelSpan, seq: number): TrajectoryEvent;
/** Parse and project an OTLP/JSON export without executing model or tool work. */
export declare function projectOTel(input: string): readonly TrajectoryEvent[];
//# sourceMappingURL=otel.d.ts.map