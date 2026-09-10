import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { getMoreItems, getNavItemAccessibleName, getNavItemHelperId } from "./navigation"

const ownerMoreHrefs = [
  "/collectors",
  "/cash-custody",
  "/draw-history",
  "/share-transfers",
  "/member-history",
  "/reports",
  "/settings",
  "/status",
]

const collectorMoreHrefs = ["/cash-custody", "/draw-history", "/member-history"]
const cashReceiverMoreHrefs = ["/cash-custody", "/draw-history", "/member-history"]
const shellSource = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8")

test("Owner More navigation exposes only Owner destinations", () => {
  assert.deepEqual(getMoreItems("OWNER").map((item) => item.href), ownerMoreHrefs)
})

test("Collector More navigation exposes only Collector destinations", () => {
  assert.deepEqual(getMoreItems("COLLECTOR").map((item) => item.href), collectorMoreHrefs)
})

test("Cash Receiver More navigation exposes only Cash Receiver destinations", () => {
  assert.deepEqual(getMoreItems("CASH_RECEIVER").map((item) => item.href), cashReceiverMoreHrefs)
})

test("More destinations have an accessible name, helper id, and unique route", () => {
  for (const role of ["OWNER", "COLLECTOR", "CASH_RECEIVER"] as const) {
    const items = getMoreItems(role)
    assert.equal(new Set(items.map((item) => item.href)).size, items.length)

    for (const item of items) {
      assert.match(getNavItemAccessibleName(item), /\(.+\)$/)
      assert.match(getNavItemHelperId(item.href), /^more-nav-helper-[a-z0-9-]+$/)
      assert.ok(item.labelEn.trim(), `${item.href} needs visible helper text`)
    }
  }
})

test("More rows keep their keyboard and narrow-screen contracts", () => {
  assert.match(shellSource, /aria-describedby=\{withChevron \? helperId : undefined\}/)
  assert.match(shellSource, /data-more-nav-item=\{withChevron \? item\.href : undefined\}/)
  assert.match(shellSource, /data-more-nav-chevron=\{withChevron \? item\.href : undefined\}/)
  assert.match(shellSource, /focus-visible:ring-2/)
  assert.match(shellSource, /w-\[min\(92vw,25rem\)\]/)
  assert.match(shellSource, /overflow-y-auto/)
})

test("More sheet remains usable on short screens", () => {
  assert.match(shellSource, /data-more-sheet-scroll/)
  assert.match(shellSource, /max-h-\[100dvh\]/)
  assert.match(shellSource, /overscroll-contain/)
  assert.match(shellSource, /env\(safe-area-inset-top\)/)
  assert.match(shellSource, /env\(safe-area-inset-bottom\)/)
})

test("More sheet keeps group context and restores the previous scroll position", () => {
  assert.match(shellSource, /data-more-nav-group=\{group\}/)
  assert.match(shellSource, /sticky top-0 z-10/)
  assert.match(shellSource, /moreScrollTopRef/)
  assert.match(shellSource, /moreScrollUserIdRef/)
  assert.match(shellSource, /moreScrollTopRef\.current = 0/)
  assert.match(shellSource, /moreScrollRef\.current\?\.scrollTo/)
  assert.match(shellSource, /onScroll=\{\(event\) =>/)
})