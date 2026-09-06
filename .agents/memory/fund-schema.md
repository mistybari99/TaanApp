---
name: Fund schema migrations
description: Non-obvious constraint for changing the ISLAMIYA fund database safely.
---

The legacy ISLAMIYA fund schema is used directly through PostgreSQL queries in the API and is not represented as a complete Drizzle model set. New financial entities and columns should therefore be additive, preserve existing rows, and include a source SQL migration for repeatability.

**Why:** Replacing or syncing an incomplete ORM schema can accidentally drop or reinterpret existing member, payment, settlement, session, and audit data.

**How to apply:** Inspect the live development schema before changes, use `IF NOT EXISTS`/nullable additions where appropriate, keep cycle relationships explicit, and never delete historical financial records as part of a cycle transition.