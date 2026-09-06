---
name: Member selection modes
description: Product boundary for multi-member selection versus single-member financial actions
---

Batch Previous Due entry is the appropriate multi-member action: one amount and reason may be applied to selected active members only after review and explicit confirmation, and the server must commit the full batch atomically or commit nothing.

**Why:** Payments, draw winners, share transfers, and member history have member-specific financial or audit semantics, so silently turning them into bulk actions would risk incorrect allocations or ownership records.

**How to apply:** Keep those flows single-select. For future batch actions, use operational Member IDs and original names, prevent duplicate IDs, provide search/remove/Select All/Clear All where useful, and preserve Owner-only permissions.