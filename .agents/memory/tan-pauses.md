---
name: TAN pause continuity
description: Business rules for pausing and resuming a TAN period without relinking financial history.
---

The current TAN period keeps its ID and sequence while paused. Payments already posted before the pause remain linked to that period; new payments and draws are blocked until resume. Resume extends the paused period and shifts later periods forward by the number of paused Dhaka business dates.

**Why:** TAN period identity is part of the accounting history. Relinking an existing payment after a pause would change which collection obligation it satisfied.

**How to apply:** Treat pause/resume as schedule state changes, not as a new TAN or a new period. Keep the schedule event and audit records atomic with the state change. The database must allow the current period to extend beyond exactly six days, and unique period dates must be shifted in descending sequence order inside the transaction. Use the Dhaka business-date helper in integration fixtures.