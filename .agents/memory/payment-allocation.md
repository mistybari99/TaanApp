---
name: Payment allocation
description: How posted payments are split between outstanding due and advance credit.
---

Every posted payment allocates Previous Due first, then no more than the member's outstanding Current Due for that date or TAN period. Any remainder is stored and displayed as Advance Credit instead of silently reducing a later balance.

**Why:** Treating an overpayment as current-period collection makes partial balances disappear and prevents later reconciliation of the member's real credit.

**How to apply:** Keep the three allocation amounts on the payment, use only Current Period Applied when calculating current due, show Advance Credit on member/payment surfaces, and include all three values in the payment audit record.