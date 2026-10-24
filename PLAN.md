# Fork plan: gbtagliari/bitbucket-mcp

This fork fixes the defects that the Entrega Digital agents hit in `bitbucket-mcp` 5.0.6.
Upstream (`MatanYemini/bitbucket-mcp`) is slow: the last commit on `master` is `d3594e2`
(2026-04-25), and npm still serves 5.0.6.

## Rules

- Tool names stay stable. The skills call them by name.
- Each fix is test-first (jest, `__tests__/`).
- Each phase ends with a tag `v5.0.7-edm.<phase>`. The install pins that tag.
- Fork-only. After the fork is stable, offer upstream PRs for items 4 and 17 only.

## Install (target)

The local server stays a local build. The clone at `~/.claude/mcp-servers/bitbucket-mcp`
points at this fork:

```bash
git fetch fork --tags && git checkout v5.0.7-edm.<phase>
npm ci && npm run build
```

`docs/agents/mcp.md` in `edm-webservices` records the fork URL and the tag.

## Already solved (no work)

- Item 15 (body-less POST → 400): fixed on `master` (`3adcc91`, pass `{}`). The running build
  (2026-08-04) has it, and no approve or resolve 400 occurs after that date. Upstream PR #118
  removes the header instead, so it is not taken.
- Old branch `fix/pagination`: merged upstream as PR #60. Delete it.
- Upstream tag `v6.0.0` (branch `bugfix/matan/fix-resolving-pr`): superseded by #70 and #105
  on `master`. Not taken.

## Phase 1: silent failures and the PR-list overflow

| # | Change | Source |
|---|---|---|
| 1 | `publishPendingComments` raises an error when no comment publishes. Docs say Bitbucket Cloud has no publish endpoint. | cherry-pick #132 |
| 2 | `getPullRequestComments` returns one page by default plus `next`. `all: true` stays opt-in. | adapt #132 (drop `all ?? true`) |
| 3 | `getPullRequestComments` drops deleted comments and their threads. | cherry-pick #132 (`src/comments.ts`) |
| 4 | Every error carries the HTTP status and Bitbucket's error body (`error.message`, `error.fields`). One shared helper replaces the 51 `catch` blocks' message builder. | new |
| 5 | `getPullRequests` takes `q` (BBQL), `sort` and `fields`, and returns `next`. | new |
| 16 | `getPullRequestDiffStat` and `getPipelineStepLogs` 404: reproduce first. Axios already follows redirects by default, so #85 alone may not fix it. Check whether the redirect drops the `Authorization` header. | diagnose, then #85 or new |

Exit: tag `v5.0.7-edm.1`, install it, then close the `edm-ticket` cluster (see Consumers).

## Phase 2: missing write capabilities

| # | Change | Source |
|---|---|---|
| 6 | `updatePullRequest` takes `reviewers` (uuid list). | new |
| 7 | `requestChanges` and `removeChangeRequest`. `removeChangeRequest` sends DELETE, so check it against the "no DELETE" rule; gate it behind `BITBUCKET_ENABLE_DANGEROUS` if needed. | cherry-pick #131 (skip its `prepare` commit) |
| 8 | `createPullRequest` and `updatePullRequest` take `close_source_branch`. | new |

Exit: tag `v5.0.7-edm.2`.

## Phase 3: slim payloads

Each tool below gets a default projection and a `fields` parameter. `fields` uses Bitbucket's
partial-response syntax and overrides the default.

| # | Tool | Default keeps |
|---|---|---|
| 5 | `getPullRequests` | `id`, `title`, `state`, `author`, `reviewers`, `source.branch.name`, `destination.branch.name`, `source.commit.hash`, `created_on`, `updated_on`, `links.html.href` |
| 11 | `getPullRequest` | the list set, plus `description`, `participants[].{user,role,approved,state}`, `close_source_branch` |
| 10 | `getPullRequestComments` | `id`, `parent.id`, `inline.{path,from,to}`, `resolution`, `deleted`, `pending`, `user`, `content.raw`, `created_on`, `links.html.href` |
| 12 | `getPullRequestActivity` | `comment.{id,user,created_on}`, `approval.{user,date}`, `changes_requested.{user,date}`, `update.{state,date,author}` |
| 9 | `getPullRequestCommits` | `hash`, `date`, `message`, `author.user` |
| 13 | `listPipelineRuns` | `uuid`, `build_number`, `state.name`, `state.result.name`, `target.ref_name`, `target.commit.hash`, `created_on`, `completed_on`; plus `q` |
| 14 | `createPullRequest`, `updatePullRequest` | the `getPullRequest` set (echo) |

A user object (`author`, `user`, `reviewers[]`, `participants[].user`) keeps `display_name`,
`uuid` and `account_id` only.

| # | Change |
|---|---|
| 17 | `pagelen` description states the per-endpoint cap (50 on the PR list). |

`getPullRequests` gets its projection in Phase 1 (item 5). Phase 3 extends the pattern to the
other tools. Exit: tag `v5.0.7-edm.3`.

Source of the field sets: a sweep of every skill and doc that calls these tools
(`edm-webservices/.claude/skills/**`, `docs/agents/`). No script parses a response; the
consumers are LLM prose, so a dropped field fails silently. Review each set against that sweep
before tagging.

## Consumers (edm-webservices)

After each tag, update in this order:

1. `docs/agents/mcp.md`: fork URL and tag.
2. `edm-ticket` step 1: list PRs with `q` (`source.branch.name ~ "<KEY>-"`), not by hand.
3. `edm-pr-triage` step 2: filter by `author.uuid` and `reviewers.uuid` through `q`.
4. `edm-bitbucket`: reviewers through `updatePullRequest`, request changes, the publish-pending
   limit, `close_source_branch`.
5. `edm-sync-desenv-team`: `listPipelineRuns` with `q` on `target.ref_name`.
6. `/retro-evolve edm-ticket` revisão 01: plan the cluster as "upstream/external: bitbucket-mcp
   fork", then mark `2026-10-22-triage-parser-and-router-order#3` and
   `2026-10-23-pr-listing-overflows-context#1` RESOLVED.

## Progress

- [x] Phase 1 (local commits on `plan`; tag and install pending)
- [ ] Phase 2
- [ ] Phase 3
- [ ] Consumers
