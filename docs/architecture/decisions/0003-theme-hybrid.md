# ADR 0003 — Unified Performance Dark × Athletic Pro

**Status: ACCEPTED (2026-10-19).**

## Context

The owner preferred gym-focused A and analytical C. Two disconnected themes would weaken coherence and complicate implementation.

## Decision

Use one theme: black/graphite surfaces, lime for action/active workout, electric blue for insight/charting, shared typography/spacing/radii and high-contrast save-state colors. The exercise-entry screen takes priority over analytics.

## Consequences

Keep CSS variables centralized and use shared components; no inline random hex palette per screen. Statistic screen can be added later without changing the theme. Image mockups serve as references, not pixel-level specifications.

See `docs/design/design-system.md` and `docs/design/screens.md`.
