# ISLAMIYA Revolving Fund — A–Z Production-Readiness Audit

**Audit date:** 2026-09-06  
**Scope:** Technical logic, financial/accounting logic, and real-world Tan operations  
**Data safety:** The real 31-member CSV was not imported. Cycle #02 was not created. No paper-book history was migrated. No genuine records were deleted or rewritten.

## 1. Overall status

# FAIL — release blocked for real-member money

The application has a usable foundation and the tested share-transfer accounting paths behaved correctly, but it is not safe to start real collection yet. The blockers are not build failures; they are data-integrity, transaction-atomicity, validation, and authorization gaps that can create unaudited or cross-cycle financial records under direct SQL, concurrent requests, malformed input, or operational edge cases.

## 2. Release-blocking findings

### Critical

**C1 — Legacy payments and collector settlements are not cycle-enforced at the database layer.**  
`fund_payments.cycle_id` and `fund_settlements.cycle_id` are nullable and have no foreign key to `fund_cycles` (`artifacts/api-server/sql/fund-cycles.sql:5-9`). The current API validates cycle membership, but the database permits null or invalid cycle ownership and does not enforce a member/cycle relationship. A direct SQL path, future maintenance script, or future endpoint could create records that reports cannot safely attribute to one cycle.

**C2 — Payment posting and reversal are not atomic with their audit records.**  
Payment insert and `PAYMENT_POSTED` audit insert are separate pool queries (`artifacts/api-server/src/routes/fund.ts:683-689`). Reversal updates the original row, inserts a reversal row, and writes the audit record in separate operations (`fund.ts:691-703`). A failure between those operations can leave money posted without an audit entry, or a payment marked reversed without its compensating reversal row. Reversal rows also lack a unique constraint on `reversed_payment_id`, so repeated/concurrent reversal calls can create multiple compensating rows.

**C3 — Financial duplicate handling is not a retry-safe atomic protocol.**  
Payment and collector-settlement idempotency indexes exist in the current development database, but the API performs a pre-read and then inserts outside a transaction (`fund.ts:658-689`, `712-723`). A concurrent same-key request can reach the unique-index error path rather than receive the original record. Draw numbering uses `MAX(draw_number)+1` outside a transaction (`fund.ts:632-638`), and draws have no idempotency key. This is not safe enough for mobile retries or double taps involving real money.

### High

**H1 — A Collector can read all share transfers through the direct API.**  
`GET /api/share-transfers` is authenticated but not Owner-gated (`fund.ts:418-427`). The UI hides the route from Collectors, but a Collector session received all transfer records during this audit, including member identities, accumulated values, settlements, and Owner attribution. This violates the stated role boundary and cannot be treated as protected merely because navigation is hidden.

**H2 — Draw date and status are under-validated.**  
The draw API checks date format, tracking start, active cycle, and cycle membership, but does not require the configured Friday draw day, reject future dates, or constrain status (`fund.ts:619-637`). The audit successfully recorded a synthetic draw dated Sunday 2026-09-06. The database has no check for Friday/date validity or allowed statuses (`fund-cycles.sql:36-47`).

**H3 — Draw winner membership and other cycle relationships are mostly API-only.**  
`fund_draws.winner_member_id` references only `fund_members`, not a composite cycle membership relationship. The database does not prevent a draw winner from belonging to another cycle or from being removed from the selected cycle after the API check. The same general weakness applies to legacy payments and settlements because their cycle columns lack foreign keys.

**H4 — Active-cycle share edits can change future due calculations without an explicit effective-date or audit snapshot rule.**  
The Owner can update `fund_cycle_members.shares` at any time while the cycle is active (`fund.ts:350-364`, `cycles/index.tsx:110-121`). Existing payment rows preserve their recorded `shares`, but current due/report queries use the new cycle membership shares. The product rule for a share change after collection has started is not explicit enough for money operations; the application should require an effective date or a controlled correction workflow.

## 3. Medium and lower findings

**M1 — CSV matching can silently choose the first name/mobile match.**  
Rows without a permanent ID are matched by normalized name and optional mobile, ordered by database ID, with no ambiguity error (`fund.ts:217-224`). A duplicate or shared household name can therefore update the wrong permanent member. The preview/commit token and selected-active-cycle safeguards are good, but matching needs an explicit ambiguous-match result.

**M2 — CSV commit confirmation text is hardcoded to Cycle #01.**  
The UI confirmation string says it will commit into Cycle #01 regardless of the selected active cycle (`members/index.tsx:184-188`). The API uses the selected cycle correctly, but the confirmation text can cause an operator to approve the wrong mental model.

**M3 — Member master fields and cycle fields can diverge in the UI.**  
`fund_members` retains global `shares` and `daily_amount` while `fund_cycle_members` stores cycle-specific values. The member list and member-history header show global values, while cycle pages show cycle values (`fund.ts:264-282`, `members/index.tsx:287-298`, `member-history/index.tsx:49-54`). This is historically useful but must be labeled clearly as current master versus selected-cycle data before operators use it for collection decisions.

**M4 — Dashboard cross-check passed for tested current-cycle totals, but transfer and draw totals are not part of the dashboard response.**  
For the synthetic scenario, raw/API values matched: 4 active participants, target ৳900, posted collected ৳650, and due ৳250. However, `/api/dashboard` returns no transfer-total or draw-total fields (`fund.ts:748-789`), despite those being explicit audit requirements. Those totals are available in separate pages/endpoints, not in one reconciled dashboard view.

**M5 — Collector settlement route accepts unvalidated amount input at the API boundary.**  
`POST /api/settlements` passes `b.amount` directly to the database (`fund.ts:712-723`). The current database has an amount check, but invalid or non-numeric input can become a server/database error rather than a controlled 400 response. The operation is also not transactionally coupled to its audit row.

**M6 — Audit records identify actor/action/time/entity, but generally do not capture before/after values.**  
Share changes, cycle updates, settings changes, and reversals have audit actions, but details are mostly free-text summaries. The audit brief requires before/after values where appropriate; this is not consistently represented.

**M7 — Offline support is intentionally incomplete and needs explicit operational labeling.**  
`sync-context.tsx` queues only `PAYMENT` and `SETTLEMENT` (`sync-context.tsx:6-16,102-109`). Transfers, reversals, draws, cycle/member changes, and CSV import are online-only. Offline payment receipts use an `OFF-*` pending number and there is no visible reconciliation step that replaces it with the server receipt after sync (`collector/home.tsx:88-113`).

**M8 — UI terminology is hybrid but inconsistent in important screens.**  
The login and collection screens visibly provide Bangla/English labels, and the final browser preview loaded without console errors. However, some operational labels remain unclear or overly technical, including “Member ID (database)” in draw history and English-only action/status text in payments and transfers. This is a usability warning, not a translation blocker.

**M9 — There are no automated test files in the repository.**  
The audit found no `*.test.*` or `*.spec.*` files outside dependencies. Existing verification was manual/synthetic and useful, but concurrency, regression, permission, and accounting invariants are not protected by repeatable automated tests.

**M10 — Full build requires the mockup sandbox’s documented environment inputs.**  
`pnpm run build` initially failed because `PORT` and then `BASE_PATH` were absent from the ad-hoc shell environment. The configured workflows supply these values. With `PORT=5000 BASE_PATH=/mockup-sandbox`, the full workspace build passed; this is an operator/CI invocation note, not a production-money blocker.

## 4. Business and financial logic findings

### Passed in the isolated synthetic scenario

- Flexible payment amount: a single ৳600 payment was recorded for a six-share member.
- Duplicate payment retry with the same idempotency key returned the original payment (HTTP 200) rather than creating a second row.
- Same-day duplicate payment without confirmation returned HTTP 409; explicit confirmation allowed a second partial payment.
- Owner reversal created a compensating reversal row and retained the original row as `REVERSED`.
- Transfer quantities were checked against current available shares; an excessive request returned HTTP 400.
- New receiver enrollment worked automatically for a member not previously enrolled in Cycle #01.
- Existing receiver, repeated transfers, partial transfers, and complete source depletion worked.
- Tested accumulated values followed shares: ৳100, ৳200, ৳300, ৳62.50, and ৳72.50 for the chosen scenarios.
- Transfer settlement remained separate from accumulated value: an accumulated value of ৳200 was settled at an explicit ৳175, and another value of ৳300 was settled at ৳310.
- Winner transfer was blocked without override, rejected without explicit confirmation, and allowed with a confirmed Owner override.
- Collector identity, payment date, amount, cycle, receipt, and verification method were preserved.
- Dashboard/API/raw database totals agreed for the synthetic active-cycle scenario.

### Not safe to release yet

- Payment/reversal/settlement transactions can split from their audit records.
- Reversal duplication and concurrent retry behavior are not constrained atomically.
- A draw can be recorded on a non-Friday date.
- Share changes after collection starts lack a precise effective-date/correction rule.
- Current-cycle and permanent-master money fields can be confused in the UI.
- Draw payout is a history record only; there is no separate payout/settlement/accounting workflow.

## 5. Share transfer findings

The transfer implementation is the strongest tested financial area. It uses row locking for the cycle and memberships, prevents negative shares through API checks plus positive-share constraints, supports new receivers, records accumulated value, and records separate settlement rows. Transfer history appears in member history with incoming/outgoing records.

Remaining risks:

1. Transfer GET access is too broad for Collectors.
2. Transfer settlement creation is exposed by API but the frontend transfer page does not provide a later “settle this transfer” workflow; settlement is only conveniently available during creation.
3. There is no transfer cancellation/reversal workflow.
4. Transfer offline queueing is unsupported and must remain explicitly online-only until designed.
5. Idempotency lookup and unique enforcement are not handled as a single retry-safe response path.

## 6. Cycle isolation and current-cycle state

### Verified

- Cycle #01 remained the only active cycle.
- Cycle #02 was not created.
- Cycle #01 retained its required name, number, start date, ৳100/share/day rate, weekly Friday configuration, and ACTIVE status.
- Tracking start was temporarily set only for labeled synthetic testing, then restored to NULL.
- Completed-cycle route locking exists.
- Cycle membership has a unique `(cycle_id, member_id)` constraint.
- One-active-cycle partial unique index exists.
- Synthetic records were removed after testing.

### Database final invariant

| Invariant | Final value |
|---|---:|
| Cycle #01 ACTIVE | 1 |
| Cycle #02 rows | 0 |
| Permanent members | 0 |
| Cycle memberships | 0 |
| Payments | 0 |
| Posted payments | 0 |
| Collector settlements | 0 |
| Draws | 0 |
| Share transfers | 0 |
| Transfer settlements | 0 |
| Cycle #01 tracking start | NULL |
| Labeled synthetic members | 0 |
| Audit rows containing `AUDIT-SYNTH` | 0 |

Existing Owner/Collector accounts and their pre-existing audit/session rows were not deleted.

## 7. CSV import

### Passed

- Active cycle is required by the API.
- Dry-run preview returns valid count, errors, member count, total shares, expected daily collection, and a preview token.
- Commit requires explicit confirmation and matching preview token.
- Malformed rows are rejected without commit.
- Import is transactional and scopes cycle membership to the selected cycle.
- No old payments or dues are imported.

### Warning

- Name/mobile matching can be ambiguous but currently selects the first match.
- Existing member IDs update selected-cycle shares after confirmation; this needs stronger operator visibility and perhaps a per-row “matched existing member” status.
- UI confirmation text hardcodes Cycle #01.

## 8. Security and permissions

### Verified

- Unauthenticated protected API request returned HTTP 401.
- Collector attempts to update a cycle, access collectors, export reports, record draws, or import members returned HTTP 403.
- Owner-only mutation routes are guarded server-side.
- Sessions use hashed tokens, expiry, HttpOnly cookies, and production Secure flag.
- Passwords use salted scrypt hashes.

### Finding

- Collector `GET /api/share-transfers` returned all transfer data with HTTP 200. Server-side authorization must be added; frontend navigation hiding is insufficient.
- Audit records are not transactionally guaranteed for all financial mutations.

## 9. Offline and idempotency

- Payment offline queue exists and persists in browser localStorage.
- Collector settlement offline queue exists.
- Queue de-duplicates by client task ID and retries failed tasks.
- Server payment and settlement idempotency indexes exist, and the tested payment retry replayed correctly.
- Transfer, reversal, draw, member, cycle, and CSV mutations are not offline-capable.
- Offline receipt reconciliation is incomplete.
- Concurrent idempotency races are not covered by automated tests and can return an error instead of a deterministic replay.

## 10. Verification record

- API typecheck: **PASS**
- Frontend typecheck: **PASS**
- API-spec code generation and library typecheck: **PASS**
- Full workspace typecheck: **PASS**
- Full workspace build with required workflow inputs: **PASS**
- Database reachability: **PASS**
- Schema/constraint inspection: **PASS with findings** — expected tables and key constraints exist, but legacy cycle FKs/nullability and composite ownership constraints are incomplete.
- API/business scenarios: **PASS with findings** — tested flows worked; uncovered blockers are documented above.
- Permission checks: **PASS with one finding** — Collector transfer read endpoint is too broad.
- Workflow logs: **PASS** — web/API/mockup workflows remained running; no browser console errors were observed.
- Browser preview: **PASS for unauthenticated login surface** — Bangla/English login UI rendered at desktop viewport.
- Automated regression suite: **NOT PRESENT**

## 11. Synthetic data created and removed

Only clearly labeled records were created:

- Temporary users: `audit_synth_owner_20260906`, `audit_synth_collector_20260906`
- Temporary members: `AUDIT-SYNTH-A-20260906` through `AUDIT-SYNTH-D-20260906`
- Temporary Cycle #01 memberships
- Temporary payments, reversal, draw, share transfers, transfer settlements, session rows, and audit rows attributable to those fixtures
- Temporary Cycle #01 tracking date

Cleanup used one database transaction. It removed only the labeled synthetic members, their dependent financial records, their synthetic user sessions/users, and audit rows attributed to the synthetic users, then restored Cycle #01 tracking start to NULL. Final queries confirmed zero labeled synthetic rows and the clean-state invariant above. No real CSV data was read or imported.

## 12. Exact changes made

- Added this audit report: `audit/production-readiness-report-2026-09-06.md`.
- Saved the final unauthenticated login preview: `audit/login-final.jpg`.
- No application source code, API contract, schema migration, real member, real financial, real user, or genuine audit record was changed as part of this audit.
- No Cycle #02 was created.

## 13. Required remediation before real CSV preview or live collection

1. Add database-enforced cycle foreign keys/nullability and composite ownership safeguards for all financial records, with a safe migration/backfill policy.
2. Make payment posting, reversal, collector settlement, transfer settlement, and draw recording atomic with their audit records.
3. Add retry-safe idempotency handling using transactional conflict/replay behavior; add a unique reversal link and draw idempotency key.
4. Restrict transfer reads to the intended roles and audit every sensitive read/write policy.
5. Enforce Friday draw dates, non-future dates, allowed statuses, and a controlled winner/payout lifecycle.
6. Define and implement the effective-date rule for share changes after tracking/collection begins.
7. Make CSV matching reject ambiguity and show existing-member matches explicitly before commit.
8. Add automated API/database regression tests for concurrency, cycle isolation, reversals, permissions, transfer accounting, and cleanup invariants.
9. Decide whether transfer settlement, offline transfer/reversal, and receipt reconciliation are required for launch; if they are, implement them before collection. If not, make the online-only limitations explicit in the operating procedure and UI.

**Launch recommendation:** Do not import the real 31-member CSV or open digital tracking until the critical/high findings have been remediated and the automated regression suite passes against a fresh synthetic database.

## 14. Remediation update — Task #16

The release-blocking safeguards were implemented without importing the real member CSV, creating Cycle #02, migrating paper-book history, or changing genuine financial records.

### Addressed

- Added additive database safeguards for cycle/member ownership, draw and settlement statuses, nonnegative shares, due entries, reversal uniqueness, and financial idempotency keys. Legacy rows remain preservable through `NOT VALID` constraints.
- Made payment posting, reversal, collector settlement, transfer settlement, share transfer, and draw writes transactional with their audit records.
- Added transaction advisory locks and deterministic idempotency replay for retryable financial writes; draw numbering is serialized per cycle.
- Restricted Collector transfer responses to operational member/share information and removed Owner-only settlement, override, creator, notes, and audit details.
- Enforced Friday, non-future draw dates, allowed draw statuses, and cycle membership checks.
- Added effective-date and reason requirements plus share-history records for cycle share changes.
- Rejected ambiguous CSV name/mobile matches and made the import confirmation show the selected cycle name.
- Added stored previous-due/current-period allocation fields, Owner-only due-entry recording, dashboard reconciliation totals, member due breakdowns, and offline receipt reconciliation.
- Added a rollback-safe database regression test covering composite ownership, status checks, and duplicate reversal protection.

### Remaining before live collection

- Expand automated coverage to concurrent API requests, full route authorization, settlement replay, draw replay, transfer accounting, and end-to-end cleanup invariants.
- Decide and document whether transfer settlement and other non-payment mutations must support offline operation; currently those operations remain online-only.
- Standardize structured before/after audit values and finish terminology/accessibility review across all operational screens.

### Final verification

- Full workspace typecheck: **PASS**
- API build: **PASS**
- Frontend build with workflow inputs: **PASS**
- Fund safety regression test: **PASS**
- API health/database reachability: **PASS**
- Managed API and web workflows: **RUNNING with clean startup logs**
- Final development financial invariant: **1 active Cycle #01; 0 members, cycle memberships, payments, settlements, draws, transfers, transfer settlements, and due entries; tracking start remains NULL**

The fund is now materially safer for controlled setup and synthetic verification, but real-member import and live collection remain intentionally blocked until the remaining test and operating-policy follow-ups are completed.