---
name: Delegated permissions
description: Rules for safely delegating selected financial operations to staff accounts.
---

Delegated access must be an explicit database grant with an optional expiry and optional cycle scope. Account activation is an independent boundary: an inactive staff account cannot use an otherwise valid grant or session. Owner access remains implicit, while user/role management, cycle lifecycle controls, and other administrative controls stay Owner-only.

**Why:** Staff may need operational coverage for payout approval, reversals, due allocation, or draw-date correction, but broad role elevation would weaken financial controls and make accountability unclear.

**How to apply:** Authenticate only active users before checking grants, then require an active, unrevoked grant at the API boundary. For entity routes derive scope from the stored financial record and reject any conflicting request cycle; record grant, renewal, replacement, and revoke actions atomically in the audit trail. Renewal keeps the same grant identity when only the expiry changes; a scope change supersedes the old grant in one transaction.