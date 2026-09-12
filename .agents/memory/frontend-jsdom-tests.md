---
name: Frontend jsdom Radix tests
description: Browser-like frontend tests that exercise Radix Select controls in Vitest jsdom.
---

Radix Select interactions in the frontend's Vitest jsdom tests require minimal browser API stubs for pointer capture and `scrollIntoView`.

**Why:** jsdom does not implement these browser methods, so user-event clicks can throw before the Select content is mounted and leave misleading missing-option failures.

**How to apply:** Add local `HTMLElement.prototype` stubs in the test setup for `hasPointerCapture`, `setPointerCapture`, `releasePointerCapture`, and `scrollIntoView` before interacting with Radix Select.