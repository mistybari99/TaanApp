---
name: Financial test isolation
description: Environment-safe fixture rules for API regression tests that touch active cycles and ledger rows.
---

Financial regression tests must create a prefixed active cycle when the database has no active cycle, and must remove dependent payments, settlements, dues, and audit rows before deleting cycle memberships or users.

**Why:** Development databases may contain only completed historical cycles, while foreign keys preserve the relationships among ledger rows, memberships, and actors. Assuming seed data or deleting in the wrong order makes the suite fail before it tests money behavior.

**How to apply:** Prefer synthetic fixtures with unique prefixes, reuse an existing active cycle only when necessary, and never delete or reset preserved fund history.