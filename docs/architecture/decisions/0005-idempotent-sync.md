# ADR 0005 — Sync requires atomic server operation acknowledgment

**Status: PROPOSED (design target; validate during Plan 003 implementation).**

## Problem
After a timeout the client cannot know whether the server committed a write; a replay may create duplicates or overwrite newer versions. Concurrent edits require detection.

## Proposed decision
- Each user intent gets persistent `operationId` (UUID) and stable entity UUID.
- Backend application of `(userId, operationId, payloadHash, baseServerRevision, entity)` must be **atomic**: check operation ledger -> CAS/insert/tombstone -> store ack -> commit. Replay of same operation/payload returns same ack. Different payload with same operation ID is rejected.
- Server owns revisions and soft deletes. Enforce via narrow Postgres RPC/grants/RLS. No unrestricted direct client updates bypassing revision rules.
- On revision conflict show two copies and require user resolution. Send further same-entity local edits in order with rebased server revision or safe coalescing.

## Why not last-write-wins?
Unsynced gym sets are valuable; timestamps can drift, and a delayed update must never silently erase another device's edit.

## Risks and implementation gate
Security-definer RPCs are dangerous if owner checks/search_path/permissions are wrong; prefer invoker, use least privileges and test as anon, user A/B. Exact SQL and retry/ledger retention semantics require code review before migration, not guesses in prototype.
