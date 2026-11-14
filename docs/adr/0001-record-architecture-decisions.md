# 0001. Record architecture decisions

Date: 2026-11-14 · Status: accepted

## Context

Amber is a long-running solo project. Decisions made in chat or in a head get lost, and Tolaria showed that a short ADR log keeps a project's reasoning findable.

## Decision

Record every significant decision as a short ADR in `docs/adr/NNNN-title.md` with four parts: context, decision, alternatives, consequences. Number them in order and never reuse a number. A reversed decision gets a new ADR that supersedes the old one.

## Alternatives

- Decisions only in `docs/PLAN.md`: the plan is a living summary and loses history as it is edited.
- Issues or discussions on GitHub: not in the repo, so not versioned with the code.

## Consequences

A few minutes per decision. Agents and contributors read `docs/adr/` before changing the areas they cover.
