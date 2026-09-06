---
name: Member identity migration
description: Durable public member ID and legacy identity rules for the revolving fund
---

Public member IDs use the `IRF-###` sequence and are generated server-side under a transaction advisory lock. Existing `fund_members.member_id` values remain untouched as legacy values; the additive public ID is the user-facing identity.

**Why:** Existing genuine member records already have financial references and random database-style IDs. Rewriting those values would risk breaking historical traceability, while users still need stable human-friendly IDs.

**How to apply:** New manual and imported members must receive a generated public ID. Search and all user-facing member, payment, transfer, draw, audit, history, and export responses should prefer the public ID, falling back to the legacy value only for records created outside the migration.