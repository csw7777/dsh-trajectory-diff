# Agent Trajectory Diff for DeepSeek Harness

A read-only DeepSeek Harness plugin that compares two agent runs and reports the **first semantic divergence** with its exact turn, step, tool call, and source event position.

Use it to debug model upgrades, plugin changes, prompt experiments, and production agent regressions without replaying the model or executing tools.

## Why this exists

Agent observability usually stops at "these two runs produced different text." That is not enough to debug an agent system. You need to know where the trajectories diverged and what changed:

- Did the model choose a different tool?
- Did a tool argument change?
- Did a plugin return a different result?
- Did the model-visible conversation, token usage, or turn structure change?
- Which event should be inspected first?

`dsh-trajectory-diff` answers those questions from two existing Session logs. Random message IDs, tool call IDs, sequence numbers, and timestamps do not create false differences.

## Features

- **First-divergence diagnosis** — reports the first changed event rather than dumping two complete logs.
- **Tool-call alignment** — pairs calls and results by call order, not random provider IDs.
- **Semantic comparison** — compares messages, tool names/arguments/results, errors, turn/step structure, interruption markers, and token usage.
- **Noise control** — ignores volatile identities and records ignored log-only event types separately.
- **Human and machine output** — use a bounded text report locally or a complete JSON report in CI.
- **Zero model and tool execution** — no API cost, no side effects, no Session mutations from the diff engine.
- **Framework-neutral core** — `src/diff.ts` accepts typed trajectory documents independently of the DSH command adapter.

## Install

The plugin targets the DeepSeek Harness plugin ecosystem and the `dsh-plugin` topic.

```bash
dsh plugin --profile web add github:csw7777/dsh-trajectory-diff
```

Restart the selected profile after installation.

## Use

Compare the current Session with another live or persisted Session:

```text
/diff other-session-id
```

Return the full report as JSON:

```text
/diff --json other-session-id
```

An identical result includes structural and token-usage summaries. A different result starts with the first semantic divergence:

```text
Trajectory diff: different
First semantic divergence: semantic event 5 / turn 1 / step 1 / tool call 1 / source seq 5 (payload)
Left: tool/call {"name":"bash","arguments":"{\"command\":\"pwd\"}"}
Right: tool/call {"name":"bash","arguments":"{\"command\":\"ls\"}"}
```

The output above is an illustrative example of the report format.

## Configure

The default preview limit is 600 Unicode code points per event. Override it in `cordis.yml`:

```yaml
- id: trajectory-diff
  name: dsh-trajectory-diff
  config:
    maxPreviewCodePoints: 1000
```

Values below 80 or non-integers fail at plugin load. JSON reports are not truncated.

## What counts as a difference

Included:

- User, developer, system, and assistant message content
- Assistant interruption markers and token usage
- Tool names, raw arguments, result content, and structured errors
- Turn and step boundaries and outcomes
- Request headers only when the core API is called with `includeRequestHeaders: true`

Normalized or excluded by default:

- Message IDs, tool call IDs, event sequence numbers, and timestamps
- Assistant attempt streams and request headers in the default command projection
- Command bookkeeping and other log-only events, counted under `ignored`

The initial implementation uses ordered semantic-event alignment, not fuzzy text similarity or edit-distance alignment. It explains the first changed event; it does not claim that two different outputs are semantically equivalent.

## Security and privacy

Session logs can contain prompts, source code, credentials, tool output, and customer data. The plugin reads and reports those contents without redaction. Use it only in a trusted DSH deployment and review JSON reports before sharing them.

The diff engine never starts model work, executes tools, or writes Session events. DSH's ordinary command lifecycle still records `command/run` and `command/done`; those events are excluded from trajectory comparison.

## Development

Requirements: Node.js 22.18+ and pnpm. Clone this repository, prepare the sibling DSH development checkout, then install and verify the plugin:

```bash
node scripts/setup-dsh.mjs
pnpm install --config.auto-install-peers=false
pnpm run typecheck
pnpm test
pnpm run build
```

The test suite covers:

- Random message IDs and different tool call IDs for identical trajectories
- Tool argument and result changes
- Length and token-usage differences
- Unicode-safe preview truncation
- Real DSH Loader composition with two live Session logs

The DSH integration tests link against a current `deepseek-harness` checkout. Do not replace them with tests that only register a hand-built mock command registry.

## Model Experience

None. The plugin adds no model-facing tool, prompt section, or model request.

### KV cache effect

None. It does not alter model inputs or serving behavior.

## Known limitations

- Ordered event alignment does not yet align independently reordered subtrees or subagent forests.
- Unknown declaration-merged events are counted as ignored rather than semantically interpreted.
- The default command projection excludes full request headers; use the core projection option for provider/tool-schema comparisons.
- Reports contain raw Session content and require an explicit redaction layer before public sharing.
- DSH itself currently encourages ecosystem plugins rather than external core pull requests; this repository follows that distribution model.

## License

MIT
