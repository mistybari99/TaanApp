---
name: Delegated permissions
description: Rules for safely delegating selected financial operations to staff accounts.
---

Delegated access must be an explicit database grant with an optional expiry and optional cycle scope. Owner access remains implicit, while user/role management, cycle lifecycle controls, and other administrative controls stay Owner-only.

**Why:** Staff may need operational coverage for payout approval, reversals, due allocation, or draw-date correction, but broad role elevation would weaken financial controls and make accountability unclear.

**How to apply:** Check active, unrevoked grants at the API boundary; for entity routes derive scope from the stored financial record and reject any conflicting request cycle; record grant and revoke actions atomically in the audit trail.