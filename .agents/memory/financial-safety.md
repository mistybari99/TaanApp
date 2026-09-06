---
name: Financial safety safeguards
description: Durable rules for protecting cycle attribution, retry behavior, and due accounting in the revolving fund.
---

Financial writes must be treated as one atomic unit: validate ownership, serialize the relevant cycle/idempotency key, write the financial row, write its audit record, and commit together. Reversals must be unique per original payment and must reopen any due allocation from the reversed original.

**Why:** The fund handles real-money collection and mobile retries; a successful financial row without an audit row, or a reversal that still reduces outstanding due, creates an unreconcilable ledger.

**How to apply:** Preserve additive raw-SQL migrations, keep legacy data migratable with `NOT VALID` constraints where needed, and count only `POSTED` payments when calculating outstanding due.