import { diffTrajectories, renderDiffReport } from "./diff.js";
import { brandString } from "@deepseek-ai/dsh-brand";
import z from "@deepseek-ai/schemastery";

//#region src/index.ts
const name = "trajectory-diff";
const inject = ["commands", "sessionQuery"];
const USAGE = "Usage: /diff [--json] <other-session-id>";
/** Schemastery validation for {@link TrajectoryDiffConfig}. */
const Config = z.object({ maxPreviewCodePoints: z.number().default(600) });
function usageError() {
	return {
		kind: "error",
		text: USAGE
	};
}
/** Load and compare the receiving Session with one other live or persisted Session. */
async function executeDiff(ctx, config, invocation) {
	const parts = invocation.rawInput.trim().split(/\s+/u).filter(Boolean);
	const json = parts.includes("--json");
	const targets = parts.filter((part) => part !== "--json");
	if (targets.length !== 1 || targets.some((part) => part.startsWith("--"))) return usageError();
	const targetId = targets[0];
	const currentId = invocation.agent.session.id;
	if (targetId === currentId) return {
		kind: "error",
		text: "Choose a different Session to compare with the current one."
	};
	const [left, right] = await Promise.all([ctx.sessionQuery.readSession(currentId), ctx.sessionQuery.readSession(brandString(targetId))]);
	const report = diffTrajectories({
		sessionId: left.session.id,
		events: left.events
	}, {
		sessionId: right.session.id,
		events: right.events
	});
	return {
		kind: "success",
		text: json ? JSON.stringify(report, null, 2) : renderDiffReport(report, config.maxPreviewCodePoints)
	};
}
/** Register the command and its disposal through the composed command registry. */
function apply(ctx, config) {
	if (!Number.isSafeInteger(config.maxPreviewCodePoints) || config.maxPreviewCodePoints < 80) throw new Error("trajectory-diff requires maxPreviewCodePoints to be an integer of at least 80");
	ctx.commands.register({
		definitionId: brandString("dsh-trajectory-diff"),
		name: "diff",
		description: "Compare this session with another agent trajectory",
		input: { hint: "[--json] <other-session-id>" },
		recordInput: false,
		handler: (invocation) => executeDiff(ctx, config, invocation)
	});
}

//#endregion
export { Config, apply, inject, name };
//# sourceMappingURL=index.js.map