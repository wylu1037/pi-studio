# Pi Studio Development Guide

This document contains the development and SDK architecture information previously kept in the project README, together with the local setup and repository workflow.

## Overview

Pi Studio is a local web workbench for managing Pi agents, models, skills, packages, MCP configurations, and persistent chat sessions.

## Local development

### Requirements

- Node.js 20.9 or newer
- pnpm
- The Pi CLI available on `PATH`

### Setup

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

The development server is available at `http://localhost:3000` by default.

### Common commands

| Command             | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `pnpm dev`          | Start the Next.js development server with webpack.   |
| `pnpm build`        | Create a production build.                           |
| `pnpm start`        | Start the production server.                         |
| `pnpm lint`         | Run ESLint across the repository.                    |
| `pnpm format`       | Format the repository with Prettier.                 |
| `pnpm format:check` | Check formatting without modifying files.            |
| `pnpm db:generate`  | Generate a Drizzle migration from schema changes.    |
| `pnpm db:migrate`   | Apply pending Drizzle migrations.                    |
| `pnpm api:schema`   | Regenerate `openapi.json`.                           |
| `pnpm api:gen`      | Regenerate the OpenAPI schema and typed API clients. |
| `pnpm pi:version`   | Print the Pi CLI version visible to the project.     |

`pnpm db:seed` currently clears the local Pi Studio database. Do not run it against data you want to keep.

## Repository structure

| Path            | Responsibility                                                                 |
| --------------- | ------------------------------------------------------------------------------ |
| `app/`          | Next.js pages, layout, and API route entry points.                             |
| `components/`   | Client views, shared interface components, chat, and workspace explorer.       |
| `lib/api/`      | Hono OpenAPI application, schemas, generated clients, and query hooks.         |
| `lib/chat/`     | Pi session integration, events, branch handling, media, and workspace access.  |
| `lib/db/`       | SQLite client, Drizzle schema, repository functions, and local data lifecycle. |
| `lib/packages/` | Pi package discovery and installation services.                                |
| `drizzle/`      | Versioned SQLite migrations and metadata.                                      |
| `scripts/`      | Project maintenance and code-generation scripts.                               |

## Pi SDK dependencies

Pi Studio follows the same layered Pi SDK architecture used by [`agegr/pi-web`](https://github.com/agegr/pi-web).

### `@earendil-works/pi-ai`

The provider-independent AI communication layer. Pi Studio uses it directly for model metadata and calls that do not need a full coding-agent session:

- `getSupportedThinkingLevels()` for model capability discovery.
- `completeSimple()` for real provider/model connection tests.
- Shared model, usage, message, and provider API types.

### `@earendil-works/pi-coding-agent`

The high-level programming-agent runtime and Pi Studio's primary SDK dependency. Pi Studio uses it for:

- `AgentSession` creation, prompting, aborting, steering, and follow-ups.
- `SessionManager` JSONL session persistence and restoration.
- `ModelRegistry`, `SettingsManager`, and `getAgentDir()`.
- `DefaultPackageManager` and `DefaultResourceLoader` for packages, extensions, skills, prompts, and themes.

### `@earendil-works/pi-agent-core`

The lower-level agent loop, state, tool, compaction, prompt, and session repository layer used internally by `pi-coding-agent`.

Pi Studio currently does **not** import it directly. The application should prefer the integrated `AgentSession` APIs from `pi-coding-agent`; a direct dependency is only appropriate if Pi Studio later implements a custom agent loop, transport, tool runtime, or session repository outside `pi-coding-agent`.

## Configuration and storage

Pi Studio currently uses Pi's standard agent directory returned by `getAgentDir()`—normally `~/.pi/agent`—for settings, models, packages, skills, prompts, and extensions.

| Data                       | Default location                |
| -------------------------- | ------------------------------- |
| Pi Studio SQLite database  | `data/pi-studio.sqlite`         |
| Pi chat session files      | `data/pi-sessions/*.jsonl`      |
| Pi global agent resources  | `~/.pi/agent`                   |
| Selected environment files | Their original filesystem paths |

Set `DATABASE_URL` to use a different SQLite database path. The database uses WAL mode and enables foreign-key enforcement.

The `data/` directory, `.env` files, build output, and dependency directories are excluded from Git.

## API workflow

The server API is defined in `lib/api/app.ts` with Hono and Zod OpenAPI schemas. The Next.js catch-all route exposes it under `/api`.

When an API route or schema changes:

1. Update the route and schemas in `lib/api/`.
2. Run `pnpm api:gen`.
3. Use the regenerated clients and hooks from `lib/api/generated/`.
4. Run lint and TypeScript checks before committing.

Treat files under `lib/api/generated/` as generated output instead of editing them manually.

## Database workflow

The source schema lives in `lib/db/schema.ts`, and repository-level access lives in `lib/db/repository.ts`.

After a schema change:

```bash
pnpm db:generate
pnpm db:migrate
```

Review generated SQL in `drizzle/` before committing it. Local application data should remain under `data/` and must not be committed.

## Verification

Use the checks appropriate to the change:

```bash
pnpm lint
pnpm format:check
pnpm exec tsc --noEmit
```

Node tests in the repository can be run with:

```bash
node --import tsx --test "**/*.test.ts" "**/*.test.tsx"
```

## Feature design documents

- [Extensions 功能与技术设计](./extensions-design.md) — Extensions Manage/Develop Tabs、Pi Runtime 集成、Web UI Bridge、Reload 和安全边界。
