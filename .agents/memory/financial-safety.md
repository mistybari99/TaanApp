---
name: Financial safety safeguards
description: Durable rules for protecting cycle attribution, retry behavior, and due accounting in the revolving fund.
---

Financial writes must be treated as one atomic unit: validate ownership, serialize the relevant cycle/idempotency key, write the financial row, write its audit record, and commit together. Reversals must be unique per original payment and must reopen any due allocation from the reversed original.

**Why:** The fund handles real-money collection and mobile retries; a successful financial row without an audit row, or a reversal that still reduces outstanding due, creates an unreconcilable ledger.

**How to apply:** Preserve additive raw-SQL migrations, keep legacy data migratable with `NOT VALID` constraints where needed, and count only `POSTED` payments when calculating outstanding due.

Draw winner payouts use a separate immutable disbursement ledger: only one active `PAID` row may exist per draw, while reversal marks that row `REVERSED` and restores the payer's available custody.

**Why:** A draw payout is a real cash outflow but must not rewrite the historical draw record; keeping the disbursement separate makes payer attribution, retries, audit history, and correction safe.

**How to apply:** Lock the draw and payer balance inside one transaction, require the payout amount to equal the draw amount, include active payouts in every custody, settlement, dashboard, and report calculation, and record a failed-save audit marker after rollback when the transaction cannot commit.

Cash handovers reserve the sender's custody at submission time; only accepted handovers create incoming cash, while rejected handovers release the reservation.

**Why:** Concurrent submissions otherwise allow two pending handovers to spend the same physical cash before either recipient accepts it.

**How to apply:** Serialize the sender/cycle balance and subtract both `SUBMITTED` and `ACCEPTED` outgoing handovers when validating available custody; keep accepted incoming/outgoing totals separate for posted accounting.