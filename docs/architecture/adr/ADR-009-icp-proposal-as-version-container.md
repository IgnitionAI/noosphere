# ADR-009 — Canonical ICP container and immutable versions

Status: Accepted  
Date: 2026-08-07

## Context

The first ICP publication implementation treated an `icp_proposal` as the
identity of an ICP. That prevents publishing a corrected or expanded snapshot
without creating another research run, and conflicts with F-023's existing
reference to `icp_versions`.

## Decision

`icps` is the canonical workspace-scoped container. Every publication creates
an immutable `icp_versions` row identified by `(icp_id, version)`. The first
publication from a reviewed research proposal creates the ICP and version 1;
the proposal and run are retained only as provenance. Publishing an existing
ICP creates the next version by copying the latest snapshot and does not
create a research run.

Structured criteria are stored in `icp_criterion` per version. Database
constraints and a trigger reject UPDATE and DELETE of versions. The ICP
container is soft-deletable; versions remain retained and cannot be removed.

## Consequences

The application must allocate versions under an ICP-scoped transaction lock,
and all reads and writes must include workspace scope. A proposal can only be
corrected before its first publication. Existing proposal fields remain in
the version snapshot for compatibility, while `run_id` and `proposal_id` are
nullable for versions published from an existing ICP.
