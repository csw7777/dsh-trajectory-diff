//#region src/diff.ts
function normalized(value) {
	if (Array.isArray(value)) return value.map(normalized);
	if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, member]) => member !== void 0).sort(([left], [right]) => left.localeCompare(right)).map(([key, member]) => [key, normalized(member)]));
	return value;
}
/** Stable JSON encoding with sorted object keys and preserved array order. */
function canonicalize(value) {
	return JSON.stringify(normalized(value)) ?? "null";
}
function semanticEvent(event, type, payload, position) {
	return {
		seq: event.seq,
		type,
		...position.turn === void 0 ? {} : { turn: position.turn },
		...position.step === void 0 ? {} : { step: position.step },
		...position.call === void 0 ? {} : { call: position.call },
		payload,
		canonical: canonicalize(payload)
	};
}
/** Project raw session logs into comparable semantic events without executing them. */
function projectTrajectory(events, options = {}) {
	const projected = [];
	const ignored = /* @__PURE__ */ new Map();
	const callOrdinals = /* @__PURE__ */ new Map();
	let currentTurn;
	let currentStep;
	let nextCallOrdinal = 1;
	for (const event of events) {
		switch (event.type) {
			case "turn/start":
				currentTurn = event.data.turn;
				currentStep = void 0;
				projected.push(semanticEvent(event, event.type, { turn: event.data.turn }, { turn: currentTurn }));
				continue;
			case "turn/end":
				projected.push(semanticEvent(event, event.type, {
					turn: event.data.turn,
					reason: event.data.reason
				}, { turn: event.data.turn }));
				continue;
			case "step/start":
				currentStep = event.data.step;
				projected.push(semanticEvent(event, event.type, {
					turn: event.data.turn,
					step: event.data.step
				}, {
					turn: event.data.turn,
					step: currentStep
				}));
				continue;
			case "step/end":
				projected.push(semanticEvent(event, event.type, {
					turn: event.data.turn,
					step: event.data.step
				}, {
					turn: event.data.turn,
					step: event.data.step
				}));
				continue;
			case "user/message":
				projected.push(semanticEvent(event, event.type, { content: event.data.content }, {
					turn: currentTurn,
					step: currentStep
				}));
				continue;
			case "developer/message":
				projected.push(semanticEvent(event, event.type, { content: event.data.message.content }, {
					turn: event.data.turn,
					step: event.data.step
				}));
				continue;
			case "system/message":
				projected.push(semanticEvent(event, event.type, { content: event.data.message.content }, {
					turn: event.data.turn,
					step: event.data.step
				}));
				continue;
			case "assistant/message":
				projected.push(semanticEvent(event, event.type, {
					content: event.data.message.content,
					...event.data.interrupted === void 0 ? {} : { interrupted: event.data.interrupted },
					...event.data.usage === void 0 ? {} : { usage: event.data.usage }
				}, {
					turn: event.data.turn,
					step: event.data.step
				}));
				continue;
			case "tool/call": {
				const call = nextCallOrdinal++;
				callOrdinals.set(event.data.callId, call);
				projected.push(semanticEvent(event, event.type, {
					name: event.data.name,
					arguments: event.data.arguments
				}, {
					turn: event.data.turn,
					step: event.data.step,
					call
				}));
				continue;
			}
			case "tool/result": {
				const call = callOrdinals.get(event.data.message.toolCallId);
				projected.push(semanticEvent(event, event.type, {
					content: event.data.message.content,
					...event.data.message.isError === void 0 ? {} : { isError: event.data.message.isError },
					...event.data.error === void 0 ? {} : { error: event.data.error }
				}, {
					turn: event.data.turn,
					step: event.data.step,
					...call === void 0 ? {} : { call }
				}));
				continue;
			}
			case "request/header":
				if (options.includeRequestHeaders === true) {
					projected.push(semanticEvent(event, event.type, {
						reason: event.data.reason,
						...event.data.startsSeries === void 0 ? {} : { startsSeries: event.data.startsSeries },
						header: event.data.header
					}, {
						turn: currentTurn,
						step: currentStep
					}));
					continue;
				}
				break;
			default: break;
		}
		ignored.set(event.type, (ignored.get(event.type) ?? 0) + 1);
	}
	return {
		events: projected,
		ignored: Object.fromEntries(ignored)
	};
}
function summarize(document, events) {
	let turns = 0;
	let steps = 0;
	let toolCalls = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let cacheWriteTokens = 0;
	for (const event of document.events) {
		if (event.type === "turn/start") turns += 1;
		if (event.type === "step/start") steps += 1;
		if (event.type === "tool/call") toolCalls += 1;
		if (event.type === "assistant/message" && event.data.usage !== void 0) {
			inputTokens += event.data.usage.inputTokens;
			outputTokens += event.data.usage.outputTokens;
			cacheReadTokens += event.data.usage.cacheReadTokens ?? 0;
			cacheWriteTokens += event.data.usage.cacheWriteTokens ?? 0;
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
		cacheWriteTokens
	};
}
function locationOf(event, index) {
	if (event === void 0) return `semantic event ${index + 1} (end of one trajectory)`;
	const parts = [`semantic event ${index + 1}`];
	if (event.turn !== void 0) parts.push(`turn ${event.turn}`);
	if (event.step !== void 0) parts.push(`step ${event.step}`);
	if (event.call !== void 0) parts.push(`tool call ${event.call}`);
	parts.push(`source seq ${event.seq}`);
	return parts.join(" / ");
}
/** Compare two documents and return the first semantic divergence, if any. */
function diffTrajectories(left, right, options = {}) {
	const leftProjection = projectTrajectory(left.events, options);
	const rightProjection = projectTrajectory(right.events, options);
	const commonLength = Math.min(leftProjection.events.length, rightProjection.events.length);
	let firstDivergence;
	let comparedEvents = commonLength;
	for (let index = 0; index < commonLength; index += 1) {
		const leftEvent = leftProjection.events[index];
		const rightEvent = rightProjection.events[index];
		if (leftEvent.type !== rightEvent.type) {
			firstDivergence = {
				index,
				reason: "event-type",
				location: locationOf(leftEvent, index),
				left: leftEvent,
				right: rightEvent
			};
			comparedEvents = index;
			break;
		}
		if (leftEvent.canonical !== rightEvent.canonical) {
			firstDivergence = {
				index,
				reason: "payload",
				location: locationOf(leftEvent, index),
				left: leftEvent,
				right: rightEvent
			};
			comparedEvents = index;
			break;
		}
	}
	if (firstDivergence === void 0 && leftProjection.events.length !== rightProjection.events.length) {
		const leftEvent = leftProjection.events[commonLength];
		const rightEvent = rightProjection.events[commonLength];
		firstDivergence = {
			index: commonLength,
			reason: "length",
			location: locationOf(leftEvent ?? rightEvent, commonLength),
			...leftEvent === void 0 ? {} : { left: leftEvent },
			...rightEvent === void 0 ? {} : { right: rightEvent }
		};
		comparedEvents = commonLength;
	}
	return {
		status: firstDivergence === void 0 ? "identical" : "different",
		left: summarize(left, leftProjection.events),
		right: summarize(right, rightProjection.events),
		comparedEvents,
		ignored: {
			left: leftProjection.ignored,
			right: rightProjection.ignored
		},
		...firstDivergence === void 0 ? {} : { firstDivergence }
	};
}
function preview(event, maxCodePoints) {
	if (event === void 0) return "<absent>";
	const text = `${event.type} ${event.canonical}`;
	const codePoints = Array.from(text);
	return codePoints.length <= maxCodePoints ? text : `${codePoints.slice(0, maxCodePoints).join("")}…`;
}
function usageText(summary) {
	return [
		`input=${summary.inputTokens}`,
		`output=${summary.outputTokens}`,
		`cacheRead=${summary.cacheReadTokens}`,
		`cacheWrite=${summary.cacheWriteTokens}`
	].join(" ");
}
/** Render a bounded human-readable report without changing the JSON result. */
function renderDiffReport(report, maxPreviewCodePoints = 600) {
	const lines = [
		`Trajectory diff: ${report.status}`,
		`Left: ${report.left.sessionId} — ${usageText(report.left)}`,
		`Right: ${report.right.sessionId} — ${usageText(report.right)}`,
		`Structure: turns ${report.left.turns} vs ${report.right.turns}; steps ${report.left.steps} vs ${report.right.steps}; tool calls ${report.left.toolCalls} vs ${report.right.toolCalls}`
	];
	const divergence = report.firstDivergence;
	if (divergence !== void 0) lines.push(`First semantic divergence: ${divergence.location} (${divergence.reason})`, `Left: ${preview(divergence.left, maxPreviewCodePoints)}`, `Right: ${preview(divergence.right, maxPreviewCodePoints)}`);
	else lines.push(`Semantic events compared: ${report.left.semanticEvents}`);
	lines.push(`Semantic events before divergence: ${report.comparedEvents}`);
	return lines.join("\n");
}

//#endregion
export { canonicalize, diffTrajectories, projectTrajectory, renderDiffReport };
//# sourceMappingURL=diff.js.map