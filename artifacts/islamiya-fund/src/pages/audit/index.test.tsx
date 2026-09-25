// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const mocks = vi.hoisted(() => ({
  auditEntries: [] as Record<string, unknown>[],
}))

vi.mock("@workspace/api-client-react", () => ({
  getListAuditQueryKey: () => ["audit"],
  useListAudit: () => ({ data: mocks.auditEntries, isLoading: false, isError: false }),
}))

import AuditPage from "./index"

describe("audit history", () => {
  beforeEach(() => {
    mocks.auditEntries = [
      {
        id: 11,
        actor: "Ayesha Owner",
        action: "FINANCIAL_EXPORT_DOWNLOADED",
        detail: "Downloaded monthly financial export (12 rows)",
        entityType: "report_export",
        entityId: "monthly",
        cycleId: 42,
        createdAt: "2026-09-25T10:00:00.000Z",
        afterValue: {
          reportType: "monthly",
          requestedScope: { cycleId: null, startDate: null, endDate: null },
          effectiveScope: {
            cycleId: 42,
            period: "monthly",
            startDate: "2026-09-01",
            endDate: "2026-09-25",
          },
          rowCount: 12,
        },
      },
      {
        id: 12,
        actor: "Karim Owner",
        action: "DRAW_EXPORT_DOWNLOADED",
        detail: "Downloaded draw payout export (2 rows)",
        entityType: "report_export",
        entityId: "draws",
        cycleId: 41,
        createdAt: "2026-09-25T09:00:00.000Z",
        afterValue: {
          reportType: "draws",
          cycleId: 41,
          startDate: "2026-09-01",
          endDate: "2026-09-07",
          rowCount: 2,
        },
      },
      {
        id: 13,
        actor: "Collector",
        action: "PAYMENT_POSTED",
        detail: "Payment receipt recorded",
        entityType: "payment",
        entityId: "9",
        createdAt: "2026-09-25T08:00:00.000Z",
      },
    ]
  })

  it("filters export downloads while keeping all other audit activity available", async () => {
    const user = userEvent.setup()
    render(<AuditPage />)

    expect(screen.getByRole("columnheader", { name: "Action" })).toBeTruthy()
    expect(screen.getByText("PAYMENT_POSTED")).toBeTruthy()
    expect(screen.getByText("Ayesha Owner")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Export downloads (2)" }))

    expect(screen.getByRole("columnheader", { name: "Owner" })).toBeTruthy()
    expect(screen.getByRole("columnheader", { name: "Report type" })).toBeTruthy()
    expect(screen.getByRole("columnheader", { name: "Recorded scope" })).toBeTruthy()
    expect(screen.getByText("মাসিক রিপোর্ট (Monthly)")).toBeTruthy()
    expect(screen.getByText(/Cycle #42.*2026-09-01.*2026-09-25.*12 rows/)).toBeTruthy()
    expect(screen.getByText("ড্র ও payout ledger (Draws)")).toBeTruthy()
    expect(screen.queryByText("PAYMENT_POSTED")).toBeNull()
    expect(screen.getByText("Karim Owner")).toBeTruthy()
    expect(document.querySelector('time[datetime="2026-09-25T10:00:00.000Z"]')).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "All activity" }))
    expect(screen.getByText("PAYMENT_POSTED")).toBeTruthy()
  })
})