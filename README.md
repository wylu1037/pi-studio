# Pi Studio

Pi Studio is a local web workbench for managing Pi agents, models, skills,
packages, MCP configurations, and persistent chat sessions.

## Pi SDK dependencies

Pi Studio follows the same layered Pi SDK architecture used by
[`agegr/pi-web`](https://github.com/agegr/pi-web):

### `@earendil-works/pi-ai`

The provider-independent AI communication layer. Pi Studio uses it directly
for model metadata and calls that do not need a full coding-agent session:

- `getSupportedThinkingLevels()` for model capability discovery.
- `completeSimple()` for real provider/model connection tests.
- Shared model, usage, message, and provider API types.

### `@earendil-works/pi-coding-agent`

The high-level programming-agent runtime and Pi Studio's primary SDK
dependency. Pi Studio uses it for:

- `AgentSession` creation, prompting, aborting, steering, and follow-ups.
- `SessionManager` JSONL session persistence and restoration.
- `ModelRegistry`, `SettingsManager`, and `getAgentDir()`.
- `DefaultPackageManager` and `DefaultResourceLoader` for packages, extensions,
  skills, prompts, and themes.

### `@earendil-works/pi-agent-core`

The lower-level agent loop, state, tool, compaction, prompt, and session
repository layer used internally by `pi-coding-agent`.

Pi Studio currently does **not** import it directly. The application should
prefer the integrated `AgentSession` APIs from `pi-coding-agent`; a direct
dependency is only appropriate if Pi Studio later implements a custom agent
loop, transport, tool runtime, or session repository outside
`pi-coding-agent`.

## Configuration directories

Pi Studio currently uses Pi's standard agent directory returned by
`getAgentDir()` (normally `~/.pi/agent`) for settings, models, packages, skills,
prompts, and extensions. Chat session JSONL files are stored under
`data/pi-sessions`.

