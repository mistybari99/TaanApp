---
name: Navigation hierarchy
description: Mobile and desktop navigation organization for the fund operations app
---

Mobile primary navigation is reserved for daily operational routes: Owner Dashboard or Collector Collection, Members, Current Cycle, Payments, and Owner-only Friday Draw. Lower-frequency records and administration belong under grouped More navigation. Logout is an account/security action, never a daily primary tab, and must require explicit confirmation.

**Why:** Collectors need one-handed access to daily collection work, while exposing every administrative route equally makes the mobile shell crowded and increases accidental security actions.

**How to apply:** Preserve the single role-aware route map and permissions. Reorganize presentation only; keep all routes reachable, maintain active-state indication, account for safe areas, and never call the existing logout mutation before confirmation.