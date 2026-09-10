---
name: Schema test isolation
description: Database-test concurrency rule for transactional schema migration checks.
---

Schema-changing smoke tests must run in the same serialized test worker as the integration tests that use the affected tables, and their changes must be wrapped in a transaction that rolls back.

**Why:** Node's multi-file test runner can execute database tests in parallel; an `ALTER TABLE` held in one transaction can deadlock with table reads or writes in another worker.

**How to apply:** Keep migration DDL tests with the related integration test file, preserve rollback cleanup, and run the complete database test command after changing test placement.