// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const mocks = vi.hoisted(() => ({
  cycles: [] as Record<string, unknown>[],
  cycleMembers: [] as Record<string, unknown>[],
  members: [] as Record<string, unknown>[],
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  invalidateQueries: vi.fn(),
}))

vi.mock("@workspace/api-client-react", () => ({
  getGetTanQueryKey: (id: number) => ["tan", id],
  getListCycleMembersQueryKey: (id: number) => ["cycle-members", id],
  getListCyclesQueryKey: () => ["cycles"],
  useGetCurrentUser: () => ({ data: { id: 1, name: "Owner", role: "OWNER" } }),
  useCreateCycle: () => ({ mutate: mocks.createMutate, isPending: false }),
  useGetTan: () => ({ data: { tan: null } }),
  useLockTan: () => ({ mutate: vi.fn(), isPending: false }),
  usePauseTan: () => ({ mutate: vi.fn(), isPending: false }),
  useResumeTan: () => ({ mutate: vi.fn(), isPending: false }),
  useListCycleMembers: () => ({ data: mocks.cycleMembers, isLoading: false }),
  useListCycles: () => ({ data: mocks.cycles, isLoading: false }),
  useListMembers: () => ({ data: mocks.members }),
  useUpdateCycle: () => ({ mutate: mocks.updateMutate, isPending: false }),
  useUpsertCycleMember: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}))

import CyclesPage from "./index"

const activeCycle = {
  id: 41,
  cycleNumber: 4,
  name: "Spring",
  startDate: "2026-01-01",
  endDate: null,
  trackingStartDate: "2026-01-01",
  dailyPerShare: 100,
  drawFrequency: "WEEKLY",
  drawDay: "FRIDAY",
  status: "ACTIVE",
  memberCount: 0,
}

const respondWithError = (message: string) => (_variables: unknown, options: { onError?: (error: unknown) => void }) => {
  options.onError?.({ data: { error: message }, message })
}

const respondWithSuccess = (_variables: unknown, options: { onSuccess?: (data: unknown) => void }) => {
  options.onSuccess?.({})
}

describe("cycle date validation errors", () => {
  beforeEach(() => {
    mocks.cycles = []
    mocks.cycleMembers = []
    mocks.members = []
    mocks.createMutate.mockReset()
    mocks.updateMutate.mockReset()
    mocks.toastError.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.invalidateQueries.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("still closes and resets the cycle form after a successful create", async () => {
    const user = userEvent.setup()
    mocks.createMutate.mockImplementationOnce(respondWithSuccess)
    render(<CyclesPage />)

    await user.click(screen.getByRole("button", { name: "প্রথম Cycle তৈরি করুন" }))
    fireEvent.change(screen.getByPlaceholderText("Cycle #01"), { target: { value: "Spring cycle" } })
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-01-01" } })
    fireEvent.change(screen.getByLabelText("Digital tracking start"), { target: { value: "2026-01-02" } })
    await user.click(screen.getByRole("button", { name: "Cycle সংরক্ষণ" }))

    await waitFor(() => expect(screen.queryByLabelText("Start date")).toBeNull())
    expect(mocks.toastSuccess).toHaveBeenCalledWith("নতুন cycle তৈরি হয়েছে")
    expect(mocks.invalidateQueries).toHaveBeenCalled()
  })

  it("still saves a tracking-start edit and refreshes cycles after success", async () => {
    const user = userEvent.setup()
    mocks.cycles = [activeCycle]
    mocks.updateMutate.mockImplementationOnce(respondWithSuccess)
    render(<CyclesPage />)

    const trackingStartDate = screen.getByLabelText("ডিজিটাল collection শুরুর তারিখ") as HTMLInputElement
    fireEvent.change(trackingStartDate, { target: { value: "2026-01-02" } })
    await user.click(screen.getByRole("button", { name: "তারিখ সংরক্ষণ" }))

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("ডিজিটাল tracking শুরুর তারিখ সংরক্ষণ হয়েছে"))
    expect(mocks.updateMutate.mock.calls[0][0]).toEqual({
      id: activeCycle.id,
      data: { trackingStartDate: "2026-01-02" },
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["cycles"] })
  })

  it("shows a create start-date error beside the field and keeps the draft", async () => {
    const user = userEvent.setup()
    mocks.createMutate.mockImplementationOnce(respondWithError("Cycle name and valid calendar start date are required"))
    render(<CyclesPage />)

    await user.click(screen.getByRole("button", { name: "প্রথম Cycle তৈরি করুন" }))
    fireEvent.change(screen.getByPlaceholderText("Cycle #01"), { target: { value: "Spring cycle" } })
    const startDate = screen.getByLabelText("Start date") as HTMLInputElement
    const trackingStartDate = screen.getByLabelText("Digital tracking start") as HTMLInputElement
    fireEvent.change(startDate, { target: { value: "2026-01-01" } })
    fireEvent.change(trackingStartDate, { target: { value: "2026-01-02" } })
    await user.click(screen.getByRole("button", { name: "Cycle সংরক্ষণ" }))

    expect(await screen.findByText("Cycle name and valid calendar start date are required")).toBeTruthy()
    expect(startDate.value).toBe("2026-01-01")
    expect(trackingStartDate.value).toBe("2026-01-02")
    expect(startDate.getAttribute("aria-invalid")).toBe("true")
    expect(startDate.getAttribute("aria-describedby")).toBe("new-cycle-start-date-error")
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it("shows a create tracking-start error beside that field and keeps the draft", async () => {
    const user = userEvent.setup()
    mocks.createMutate.mockImplementationOnce(respondWithError("Tracking start date must be a valid calendar date"))
    render(<CyclesPage />)

    await user.click(screen.getByRole("button", { name: "প্রথম Cycle তৈরি করুন" }))
    fireEvent.change(screen.getByPlaceholderText("Cycle #01"), { target: { value: "Spring cycle" } })
    const startDate = screen.getByLabelText("Start date") as HTMLInputElement
    const trackingStartDate = screen.getByLabelText("Digital tracking start") as HTMLInputElement
    fireEvent.change(startDate, { target: { value: "2026-01-01" } })
    fireEvent.change(trackingStartDate, { target: { value: "2026-01-02" } })
    await user.click(screen.getByRole("button", { name: "Cycle সংরক্ষণ" }))

    expect(await screen.findByText("Tracking start date must be a valid calendar date")).toBeTruthy()
    expect(startDate.value).toBe("2026-01-01")
    expect(trackingStartDate.value).toBe("2026-01-02")
    expect(trackingStartDate.getAttribute("aria-invalid")).toBe("true")
    expect(trackingStartDate.getAttribute("aria-describedby")).toBe("new-cycle-tracking-start-date-error")
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it("shows a tracking-start edit error beside the field without clearing the selected date", async () => {
    const user = userEvent.setup()
    mocks.cycles = [activeCycle]
    mocks.updateMutate.mockImplementationOnce(respondWithError("Digital tracking cannot start before the cycle start date"))
    render(<CyclesPage />)

    const trackingStartDate = screen.getByLabelText("ডিজিটাল collection শুরুর তারিখ") as HTMLInputElement
    fireEvent.change(trackingStartDate, { target: { value: "2025-12-31" } })
    await user.click(screen.getByRole("button", { name: "তারিখ সংরক্ষণ" }))

    expect(await screen.findByText("Digital tracking cannot start before the cycle start date")).toBeTruthy()
    expect(trackingStartDate.value).toBe("2025-12-31")
    expect(trackingStartDate.getAttribute("aria-invalid")).toBe("true")
    expect(trackingStartDate.getAttribute("aria-describedby")).toBe("cycle-tracking-start-date-error")
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it("shows an end-date error beside the completion control and keeps the end date automatic", async () => {
    const user = userEvent.setup()
    mocks.cycles = [activeCycle]
    mocks.updateMutate.mockImplementationOnce(respondWithError("Cycle end date cannot be before its start date"))
    render(<CyclesPage />)

    const completeButton = screen.getByRole("button", { name: "চক্র সম্পন্ন করুন" })
    await user.click(completeButton)

    const error = await screen.findByText("Cycle end date cannot be before its start date")
    expect(completeButton.getAttribute("aria-describedby")).toBe("cycle-end-date-error")
    expect(completeButton.parentElement?.contains(error)).toBe(true)
    expect(mocks.updateMutate.mock.calls[0][0]).toEqual({
      id: activeCycle.id,
      data: {
        status: "COMPLETED",
        endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      },
    })
    expect(mocks.toastError).not.toHaveBeenCalled()
  })
})