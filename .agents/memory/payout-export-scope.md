---
name: Payout export scope
description: The default and explicit filtering rules for draw payout CSV reconciliation.
---

Draw payout exports include active and completed cycles when no cycle is supplied. An explicit cycle narrows reconciliation, and optional start/end bounds filter payout ledger dates inclusively while retaining the draw summary and matching ledger rows.

**Why:** A backup intended for payout reconciliation must not silently omit corrected payouts from completed cycles; owners can still narrow the export when investigating one cycle.

**How to apply:** Keep the server as the source of truth for the all-cycle default, validate cycle and date bounds at the API boundary, and make the selected scope visible in the reports download flow and filename.

When payout dates are filtered, apply the same inclusive bounds to both the draw-selection `EXISTS` clause and the joined payout ledger rows.

**Why:** Filtering only the draw selection can still emit out-of-range ledger rows for a draw that has one in-range payout, making reconciliation exports misleading.

**How to apply:** Keep the `LEFT JOIN` date predicates in lockstep with the date predicates used to decide whether a draw belongs in the export.