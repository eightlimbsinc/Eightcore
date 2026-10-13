# Eightcore — ClickUp Migration Plan

Status: Phase 1 plan. The importer is built in Phase 7. **No live ClickUp data has been accessed. No production migration or cutover happens without explicit written approval.** Last updated 2026-10-13.

## 1. Principles

- **Read-only toward ClickUp.** The importer never writes to ClickUp.
- **Staging first.** Every run lands in a dedicated *staging workspace* in Eightcore. The final import is a separate, approved run.
- **Repeatable and idempotent.** Re-running a job updates rather than duplicates, via `external_id_mappings` + `source_hash`.
- **Raw data kept.** Raw API payloads are stored in `import_staging_records`, so transforms can be replayed and debugged without re-fetching.
- **Nothing silently dropped.** Every unsupported or failed item produces a log entry with a reason and shows up in the error report.

## 2. Source access

| Option | What it gives | Cost |
|---|---|---|
| **ClickUp REST API v2** (primary) with a personal API token from an admin account | Hierarchy, tasks, subtasks, comments, custom fields, members, tags, dependencies, checklists, time entries, attachment metadata and URLs | Included in every ClickUp plan. **Rate limit 100 requests/minute per token** on Free Forever, Unlimited, and Business. 1,000/min on Business Plus. 10,000/min on Enterprise |
| ClickUp API v3 (selected endpoints) | Docs and some newer resources | Same plan-based limits. Used only if Docs are in scope (currently they are not) |
| ClickUp CSV/Excel export (UI) | Flat task export. Useful as an **independent count check** during reconciliation | Free. Lossy (no comment threads, attachments by URL only) |

The token is stored encrypted in `integration_connections` (provider `clickup`) or passed via the `CLICKUP_API_TOKEN` env var for local CLI runs. It is never committed or logged.

## 3. What can be migrated (to be confirmed by the inventory step)

| ClickUp data | Endpoint(s) (API v2) | Eightcore target | Expected support |
|---|---|---|---|
| Workspace (Team) | `GET /team` | Workspace (mapping only) | ✅ |
| Members | `GET /team` (members), `GET /team/{id}/user/{id}` | `users` + `workspace_members` via `import_user_mappings` (match by email) | ✅ (role mapping manual) |
| Spaces | `GET /team/{id}/space` | `projects` | ✅ |
| Folders | `GET /space/{id}/folder` | `folders` | ✅ |
| Lists (incl. folderless) | `GET /folder/{id}/list`, `GET /space/{id}/list` | `task_lists` | ✅ |
| Statuses | in space/list payloads | `workflows` + `workflow_statuses` (one workflow per distinct status set, de-duplicated) | ✅ |
| Tasks + subtasks | `GET /list/{id}/task?subtasks=true&include_closed=true&page=N` (100/page), plus archived (`archived=true`) | `tasks` (parent via `parent`) | ✅ |
| Priority | task payload | `priority` (1 urgent, 2 high, 3 normal, 4 low, null none) | ✅ |
| Assignees, watchers | task payload | `task_assignees`, `task_watchers` | ✅ |
| Tags | `GET /space/{id}/tag`, task payload | `tags`, `task_tags` | ✅ |
| Custom fields | `GET /list/{id}/field`, task `custom_fields` | `custom_field_definitions/options/values` | ✅ for common types. ⚠ formula, rollup, relationship, location, progress → logged or converted to text |
| Dependencies, linked tasks | task `dependencies`, `linked_tasks` | `task_relations` (`blocks`, `relates_to`) | ✅ |
| Checklists | task payload | `checklists`, `checklist_items` | ✅ |
| Comments + replies | `GET /task/{id}/comment` (paged), `GET /comment/{id}/reply` | `comments` (threaded). ClickUp rich comment segments → ProseMirror JSON | ✅ |
| Attachments | task `attachments[]` (URL, name, size) | Download → `StorageAdapter` → `attachments` | ⚠ Depends on URL accessibility and auth. Verify in inventory |
| Time estimates, time entries | task payload, `GET /team/{id}/time_entries` | `estimate_minutes`. Time entries P2 | ⚠ Time-entry history may be plan-limited |
| Timestamps | `date_created`, `date_updated`, `date_closed`, `date_done`, `start_date`, `due_date` | Preserved on target rows. Import time recorded separately | ✅ |
| Custom task IDs | `custom_id` | Stored as an external mapping + searchable alias | ✅ if enabled |
| Activity history | Not fully exposed by the public API | A single "Imported from ClickUp" activity event. Source timestamps preserved | ❌ Full history is not migrated |
| ClickUp automations | Not exposed by the API | Recreated manually as Eightcore rules | ❌ |
| Views, dashboards | Partially or not exposed | Recreated manually as saved views and dashboards | ❌ |
| Docs, whiteboards, chat, goals | Out of scope | — | ❌ (by decision) |

**Plan caveat:** the agency's ClickUp plan determines rate limits and possibly feature availability (e.g. custom field usage caps on Free Forever). The inventory step records the plan and adjusts the estimates.

## 4. Field and status mapping

- **Statuses → workflows:** collect the distinct ordered status sets across lists. Each distinct set becomes one workflow. ClickUp status `type` (`open`, `custom`, `done`, `closed`) maps to category: `open` → unstarted, `custom` → active, `done` → done, `closed` → done/cancelled (manual choice). Admins can then map imported workflows onto the **Agency Delivery** template through a mapping table, reviewed before the staging load.
- **Users:** auto-match by email. Unmatched users are either invited (a placeholder account, not active until accepted) or mapped to a "Former member" placeholder. Decisions are recorded in `import_user_mappings` and **require human review**.
- **Rich text:** ClickUp markdown or `text_content` → sanitized ProseMirror JSON. Original raw text kept in staging records.
- **Mentions** in comments are re-pointed to mapped users.

## 5. Pipeline

```
  1 INVENTORY ─▶ 2 EXTRACT ─▶ 3 MAP (human review) ─▶ 4 LOAD (staging ws) ─▶ 5 RECONCILE ─▶ 6 REVIEW
       ▲                                                                                       │
       └──────────────────────── iterate (idempotent re-runs) ◀───────────────────────────────┘
                                                                                               │ written approval
                                                                       7 FREEZE + FINAL DELTA ─▶ 8 CUTOVER
```

1. **Inventory (read-only, minimal calls).** Counts per space, folder, and list: tasks (open, closed, archived), subtasks, comments (sampled), attachments (count and total size), custom field types in use, members, plan tier. Output: `docs/migration/INVENTORY_<date>.md` plus an estimated request count and duration. *No data copied beyond counts and schema metadata.*
2. **Extract.** Fetch every in-scope entity into `import_staging_records` (raw JSON + content hash). Checkpointed per list and page in `import_jobs.cursor`, so a crash resumes where it stopped.
3. **Map.** Generate user, status, and custom-field mapping proposals. An admin reviews and edits them in the Import UI (or a YAML file for CLI runs).
4. **Load.** Transform and upsert into the **staging workspace**, in dependency order: users → projects → folders → lists → workflows → field definitions → tasks (parents first, ordered by depth) → assignees, tags, field values → relations → checklists → comments → attachments. Each entity is written in its own transaction and its mapping recorded. Re-runs skip rows whose `source_hash` is unchanged.
5. **Reconcile.** Per entity type: source count vs imported count vs skipped (with reasons). Field-level spot checks on a random 2% sample (title, status, assignees, due date, custom field values). Orphan checks (subtasks without parents, relations to unmapped tasks). Results go to `reconciliation_reports`, plus a Markdown/CSV export.
6. **Review.** Ops leads click through staging and file issues. The mapping is fixed and the run repeated.
7. **Freeze + final delta** (*approval required*). Announce a ClickUp freeze window. Run a final incremental extract (tasks with `date_updated_gt` since the last run) and load into the **production workspace** with `mode = final`, which requires `approved_by`.
8. **Cutover** (*approval required*). Reconcile again, sign off, and switch the team over. ClickUp is kept read-only for a 30-day fallback period, then exported to an archive.

## 6. Reliability mechanics

| Concern | Mechanism |
|---|---|
| Pagination | Tasks: `page` until `last_page` is true. Comments: `start` + `start_id` cursor. Each page is checkpointed |
| Rate limits | A token bucket set below the plan limit (default 90/min for 100/min plans). Honour `X-RateLimit-Remaining` / `X-RateLimit-Reset`. On 429, sleep until reset |
| Retries | Exponential backoff with jitter on 429, 5xx, and network errors. Max 6 attempts, then the item is logged as failed and the job continues |
| Idempotency | Unique `(workspace_id, provider, external_type, external_id)`. Upsert by mapping. Attachments are de-duplicated by `sha256` |
| Partial failure | Item-level errors never abort the job. Job status `completed_with_errors` + error report |
| Resumability | pg-boss job holds `import_job_id`. On restart, it continues from `cursor` |
| Observability | `import_log_entries` (info/warn/error), live progress in the Import UI, downloadable error CSV |
| Safety | Staging and final runs target different workspaces. `final` requires a recorded approver. Dry-run mode performs transforms without writes and reports what *would* change |

### Rough time estimate (100 req/min plan)

For example, 5,000 tasks across 60 lists: about 60 list-page calls + 5,000 comment calls + replies + about 200 metadata calls ≈ 5,500 requests ≈ **about 1 hour** at 90 req/min. Attachments are downloaded from file URLs, which are typically not counted against the API limit (verify in inventory). The inventory step produces the real estimate.

## 7. Testing the importer

- Transform functions are pure and unit-tested against **recorded, anonymised fixtures** in `tests/fixtures/clickup/`.
- A fake ClickUp HTTP server (local, in tests) simulates pagination, 429s, 5xx, and malformed records.
- Idempotency test: run the import twice. The second run makes zero changes.
- Resume test: kill the job mid-run, restart it, and expect identical results.
- **CI never calls the real ClickUp API.**

## 8. Approval gates

| Gate | Needs |
|---|---|
| Run the inventory against the real ClickUp workspace | Approval to use an admin API token (read-only use) |
| Staging extract + load | Approval after the inventory report |
| Final import into the production workspace | **Written approval from the workspace Owner**, recorded in `import_jobs.approved_by` |
| Cutover / ClickUp freeze | **Written approval**, with the date agreed with the team |
