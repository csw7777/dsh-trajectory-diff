import { canonicalize } from "./diff.js";

//#region src/otel.ts
function parseDocument(input) {
	try {
		return JSON.parse(input);
	} catch (error) {
		throw new Error(`Invalid OTel JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}
/**
* Flatten resource/scope envelopes in wire order. Trace IDs, span IDs and timing
* are deliberately excluded: they are volatile rather than semantic differences.
*/
function parseOTelSpans(input) {
	const document = parseDocument(input);
	if (!Array.isArray(document?.resourceSpans)) throw new Error("OTel JSON requires a resourceSpans array");
	return document.resourceSpans.flatMap((resource) => resource.scopeSpans?.flatMap((scope) => {
		if (!Array.isArray(scope.spans)) throw new Error("Each OTel scopeSpans entry requires a spans array");
		return scope.spans.map((span) => {
			if (typeof span?.name !== "string") throw new Error("Each OTel span requires a string name");
			return span;
		});
	}) ?? []);
}
/** Map one ordinary OTel span to a stable, comparable semantic event. */
function mapOTelSpan(span, seq) {
	if (!Number.isSafeInteger(seq) || seq < 1) throw new Error("OTel event seq must be a positive safe integer");
	const attributes = Object.fromEntries((span.attributes ?? []).map((attribute) => [attribute.key, attribute.value]));
	const payload = {
		name: span.name,
		kind: span.kind ?? 0,
		attributes,
		status: {
			code: span.status?.code ?? 0,
			...span.status?.message === void 0 ? {} : { message: span.status.message }
		}
	};
	return {
		seq,
		type: "otel/span",
		payload,
		canonical: canonicalize(payload)
	};
}
/** Parse and project an OTLP/JSON export without executing model or tool work. */
function projectOTel(input) {
	return parseOTelSpans(input).map((span, index) => mapOTelSpan(span, index + 1));
}

//#endregion
export { mapOTelSpan, parseOTelSpans, projectOTel };
//# sourceMappingURL=otel.js.map