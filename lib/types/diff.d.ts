import type { SessionEvent } from '@deepseek-ai/dsh-session';
/** One semantic event after removing runtime-specific identity and timing noise. */
export interface TrajectoryEvent {
    /** Original one-based session sequence, retained only for source navigation. */
    readonly seq: number;
    readonly type: string;
    readonly turn?: number;
    readonly step?: number;
    /** One-based tool-call ordinal shared by a call and its result. */
    readonly call?: number;
    readonly payload: unknown;
    readonly canonical: string;
}
/** Semantic events and the number of events intentionally excluded by type. */
export interface TrajectoryProjection {
    readonly events: readonly TrajectoryEvent[];
    readonly ignored: Readonly<Record<string, number>>;
}
/** Model usage and structural counts derived from settled assistant messages. */
export interface TrajectorySummary {
    readonly semanticEvents: number;
    readonly turns: number;
    readonly steps: number;
    readonly toolCalls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheWriteTokens: number;
}
/** The first semantic difference between two trajectories. */
export interface TrajectoryDivergence {
    /** Zero-based index in the semantic-event streams. */
    readonly index: number;
    readonly reason: 'event-type' | 'payload' | 'length';
    readonly location: string;
    readonly left?: TrajectoryEvent;
    readonly right?: TrajectoryEvent;
}
/** Complete deterministic comparison result suitable for text or JSON output. */
export interface TrajectoryDiffReport {
    readonly status: 'identical' | 'different';
    readonly left: TrajectorySummary & {
        readonly sessionId: string;
    };
    readonly right: TrajectorySummary & {
        readonly sessionId: string;
    };
    readonly comparedEvents: number;
    readonly ignored: {
        readonly left: Readonly<Record<string, number>>;
        readonly right: Readonly<Record<string, number>>;
    };
    readonly firstDivergence?: TrajectoryDivergence;
}
/** Input document independent from the DSH service used to load it. */
export interface TrajectoryDocument {
    readonly sessionId: string;
    readonly events: readonly SessionEvent[];
}
/** Projection controls for noise that is useful only in specialized comparisons. */
export interface TrajectoryProjectionOptions {
    /** Include full model and tool-schema request headers. Defaults to false. */
    readonly includeRequestHeaders?: boolean;
}
/** Stable JSON encoding with sorted object keys and preserved array order. */
export declare function canonicalize(value: unknown): string;
/** Project raw session logs into comparable semantic events without executing them. */
export declare function projectTrajectory(events: readonly SessionEvent[], options?: TrajectoryProjectionOptions): TrajectoryProjection;
/** Compare two documents and return the first semantic divergence, if any. */
export declare function diffTrajectories(left: TrajectoryDocument, right: TrajectoryDocument, options?: TrajectoryProjectionOptions): TrajectoryDiffReport;
/** Render a bounded human-readable report without changing the JSON result. */
export declare function renderDiffReport(report: TrajectoryDiffReport, maxPreviewCodePoints?: number): string;
//# sourceMappingURL=diff.d.ts.map