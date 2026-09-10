---
name: Payout export scope
description: The default and explicit filtering rules for draw payout CSV reconciliation.
---

Draw payout exports default to the active cycle when no cycle is supplied. Completed cycles must be selected explicitly, and optional start/end bounds filter payout ledger dates inclusively while retaining the draw summary and matching ledger rows.

**Why:** Reconciliation must not silently widen an ordinary active-cycle backup to every historical cycle, but owners still need a deliberate path to review closed-cycle payout corrections.

**How to apply:** Keep the server as the source of truth for the default scope, validate date bounds at the API boundary, and make the selected cycle/date range visible in the reports download flow.