---
name: Fund business date
description: Timezone rule for collection deadlines, current-day totals, and Saturday–Friday draw periods.
---

Fund operational dates are evaluated in the Asia/Dhaka timezone. Friday closing and Saturday opening must use the same business date for period lookup, due display, and current-day collection totals.

**Why:** UTC date boundaries can disagree with the fund's Bangladesh operating day near midnight, causing a Friday closing alert or Saturday rollover to appear one day late.

**How to apply:** Keep server-owned collection period metadata and SQL current-day comparisons aligned to the Dhaka business date; do not derive deadline state only from the browser's local clock.