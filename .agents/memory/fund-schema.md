---
name: Fund schema migrations
description: Non-obvious constraint for changing the ISLAMIYA fund database safely.
---

The legacy ISLAMIYA fund schema is used directly through PostgreSQL queries in the API and is not represented as a complete Drizzle model set. New financial entities and columns should therefore be additive, preserve existing rows, and include a source SQL migration for repeatability.

**Why:** Replacing or syncing an incomplete ORM schema can accidentally drop or reinterpret existing member, payment, settlement, session, and audit data.

**How to apply:** Inspect the live development schema before changes, use `IF NOT EXISTS`/nullable additions where appropriate, keep cycle relationships explicit, and never delete historical financial records as part of a cycle transition.

Cycle status alone is not enough to decide whether collection is open: a cycle must also have an owner-confirmed digital tracking start date, and financial views should remain zero-gated before that date.

**Why:** A historical cycle start date must not silently create retroactive dues or make collectors believe paper-book balances are digitally payable.

**How to apply:** Gate payment, settlement, due, dashboard, and report calculations by the active cycle's tracking start date while preserving the cycle's configured start date for history.