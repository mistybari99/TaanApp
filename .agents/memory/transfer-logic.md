---
name: Share transfer accounting
description: Durable accounting and safety rules for moving shares between members.
---

Share transfers are financial events, not membership edits: keep transfer settlement records separate from collector cash settlements, and calculate the source member's transferable accumulated value from posted payments plus incoming transfer value minus outgoing transfer value.

**Why:** A member can receive shares after contributing, transfer shares more than once, or transfer only part of a balance; treating a transfer as a simple share-count change loses the contribution value that follows the shares.

**How to apply:** Lock the active cycle and both cycle-membership rows in one transaction, reject transfers before the digital tracking date or after cycle completion, and require an explicit Owner override plus audit record when a draw winner transfers out.