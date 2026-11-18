# ADR 004 — Persistence, migrations, and job recovery

Accepted.

## Context

Inspections involve multiple network requests and can fail while running. History needs a consistent final record with linked hops and findings. Existing rows need to survive schema changes.

## Decision

Create an inspection before putting work in a bounded in-process queue. Use conditional state transitions and save the final inspection, hops, and findings in one transaction. Keep raw request content in memory during processing and persist redacted previews and origin-only tag references.

At startup and once per minute, mark queued or running inspections older than 15 minutes as `JOB_EXPIRED`. Store explanations separately, validate before writing, and upsert one saved explanation per inspection.

Evolve `max_severity` in ordered migrations. Create it nullable, backfill historical rows from findings, then apply non-null and allowed-value constraints. Each intermediate state accommodates existing data before enforcing the final constraint.

## Consequences

Readers see an atomic final result, and unfinished work eventually has a visible failure state. Migrations preserve historical inspections. Queues and rate limits are local to each process, and restarts cannot reconstruct lost request payloads. Higher availability requires a durable queue and worker coordination. Backfills can scan or lock tables, so deployment scheduling matters as datasets grow.
