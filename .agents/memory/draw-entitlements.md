---
name: Draw entitlement ledger
description: Rules for tracking per-share draw rights independently from the member's actual share balance.
---

Each share in a locked TAN creates one draw entitlement. Recording a winner consumes one entitlement and must never reduce the member's actual share count; remaining rights are calculated as allocated entitlements minus consumed entitlements.

**Why:** A member with five shares should still own five shares after winning one draw, while the ledger must clearly show four remaining draw rights.

**How to apply:** Keep entitlement consumption and draw history immutable, reject winners with no remaining rights, and move only unconsumed entitlements when shares transfer during an active TAN.