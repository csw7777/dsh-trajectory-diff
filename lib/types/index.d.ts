/**
 * Human-facing `/diff` command for deterministic comparisons of two Session
 * trajectories. The command only reads logs; it never starts model or tool work.
 * @module dsh-trajectory-diff
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export type * from './diff.ts';
export declare const name = "trajectory-diff";
export declare const inject: string[];
/** Validated plugin configuration supplied through cordis.yml. */
export interface TrajectoryDiffConfig {
    /** Maximum Unicode code points printed for each side of one event. */
    maxPreviewCodePoints: number;
}
/** Schemastery validation for {@link TrajectoryDiffConfig}. */
export declare const Config: z<TrajectoryDiffConfig>;
/** Register the command and its disposal through the composed command registry. */
export declare function apply(ctx: Context, config: TrajectoryDiffConfig): void;
//# sourceMappingURL=index.d.ts.map