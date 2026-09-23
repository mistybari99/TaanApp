// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  createObjectURL: vi.fn(),
  revokeObjectURL: vi.fn(),
  anchorClick: vi.fn(),
}))

vi.mock("@workspace/api-client-react", () => ({
  useGetDashboard: () => ({ data: { audit: [] } }),
  useListCycles: () => ({
    data: [
      { id: 41, cycleNumber: 4, name: "Spring", status: "COMPLETED" },
      { id: 42, cycleNumber: 5, name: "Summer", status: "ACTIVE" },
    ],
  }),
}))

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: mocks.toastInfo,
  },
}))

import ReportsPage from "./index"

describe("reports draw export scope", () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.toastError.mockReset()
    mocks.toastInfo.mockReset()
    mocks.createObjectURL.mockReset().mockReturnValue("blob:draw-export")
    mocks.revokeObjectURL.mockReset()
    mocks.anchorClick.mockReset()
    vi.stubGlobal("fetch", mocks.fetch)
    window.URL.createObjectURL = mocks.createObjectURL
    window.URL.revokeObjectURL = mocks.revokeObjectURL
    Object.assign(HTMLElement.prototype, {
      hasPointerCapture: () => false,
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
      scrollIntoView: () => {},
    })
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(mocks.anchorClick)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("blocks stale downloads and sends the exact refreshed preview scope", async () => {
    const user = userEvent.setup()
    mocks.fetch.mockImplementation(async (request: RequestInfo | URL) => {
      const url = String(request)
      if (url.includes("/preview")) {
        const query = new URL(url, "http://localhost").searchParams
        return {
          ok: true,
          json: async () => ({
            cycleId: Number(query.get("cycleId")),
            startDate: query.get("startDate"),
            endDate: query.get("endDate"),
            drawCount: 2,
            payoutRowCount: 2,
            payoutTotal: 200,
            empty: false,
          }),
        }
      }
      return {
        ok: true,
        blob: async () => new Blob(["draw export"]),
      }
    })

    render(<ReportsPage />)

    const downloadButton = screen.getByRole("button", { name: /ড্র ও payout ledger/ })
    expect((downloadButton as HTMLButtonElement).disabled).toBe(true)

    await user.click(screen.getByRole("combobox", { name: "Cycle" }))
    await user.click(screen.getByRole("option", { name: /Cycle #4/ }))
    fireEvent.change(screen.getByLabelText("Payout date from"), { target: { value: "2026-09-01" } })
    fireEvent.change(screen.getByLabelText("Payout date to"), { target: { value: "2026-09-07" } })

    await user.click(screen.getByRole("button", { name: "Preview scope" }))
    await waitFor(() => expect(screen.getByText("Previewed download scope")).toBeTruthy())

    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/reports/export/preview?type=draws&cycleId=41&startDate=2026-09-01&endDate=2026-09-07",
    )
    expect((downloadButton as HTMLButtonElement).disabled).toBe(false)

    await user.click(downloadButton)
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2))
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      "/api/reports/export?type=draws&cycleId=41&startDate=2026-09-01&endDate=2026-09-07",
    )

    fireEvent.change(screen.getByLabelText("Payout date to"), { target: { value: "2026-09-08" } })
    expect((downloadButton as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText("Filters changed. Preview the current scope again before downloading.")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Preview scope" }))
    await waitFor(() => expect(screen.getByText("Previewed download scope")).toBeTruthy())
    expect((downloadButton as HTMLButtonElement).disabled).toBe(false)

    await user.click(downloadButton)
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(4))
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      "/api/reports/export?type=draws&cycleId=41&startDate=2026-09-01&endDate=2026-09-08",
    )
  })

  it("keeps draw download disabled after a failed preview until retry succeeds", async () => {
    const user = userEvent.setup()
    let previewAttempts = 0
    mocks.fetch.mockImplementation(async (request: RequestInfo | URL) => {
      const url = String(request)
      if (url.includes("/preview")) {
        previewAttempts += 1
        if (previewAttempts === 1) return { ok: false }
        return {
          ok: true,
          json: async () => ({
            cycleId: null,
            startDate: null,
            endDate: null,
            drawCount: 1,
            payoutRowCount: 1,
            payoutTotal: 100,
            empty: false,
          }),
        }
      }
      return {
        ok: true,
        blob: async () => new Blob(["draw export"]),
      }
    })

    render(<ReportsPage />)

    const downloadButton = screen.getByRole("button", { name: /ড্র ও payout ledger/ }) as HTMLButtonElement
    const previewButton = screen.getByRole("button", { name: "Preview scope" })
    expect(downloadButton.disabled).toBe(true)

    await user.click(previewButton)
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Preview ব্যর্থ হয়েছে"))
    expect(downloadButton.disabled).toBe(true)
    expect(screen.queryByText("Previewed download scope")).toBeNull()

    await user.click(previewButton)
    await waitFor(() => expect(screen.getByText("Previewed download scope")).toBeTruthy())
    expect(downloadButton.disabled).toBe(false)

    await user.click(downloadButton)
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(3))
    expect(mocks.fetch).toHaveBeenLastCalledWith("/api/reports/export?type=draws")
  })
})
