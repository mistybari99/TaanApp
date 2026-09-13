// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const mocks = vi.hoisted(() => ({
  permissions: [] as any[],
  renewMutate: vi.fn(),
  invalidateQueries: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("@workspace/api-client-react", () => ({
  useListCollectors: () => ({ data: [{ id: 7, name: "Amina", username: "amina", role: "COLLECTOR", active: true }], isLoading: false, refetch: vi.fn() }),
  useListCashReceivers: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useListCycles: () => ({ data: [
    { id: 10, name: "Current", cycleNumber: 1 },
    { id: 11, name: "Next", cycleNumber: 2 },
  ] }),
  useCreateCollector: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateCollector: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateCashReceiver: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateCashReceiver: () => ({ mutate: vi.fn(), isPending: false }),
  useListCollectorTargets: () => ({ data: [] }),
  useUpsertCollectorTarget: () => ({ mutate: vi.fn(), isPending: false }),
  useListPermissions: () => ({ data: mocks.permissions }),
  useGrantPermission: () => ({ mutate: vi.fn(), isPending: false }),
  useRenewPermission: () => ({ mutate: mocks.renewMutate, isPending: false }),
  useRevokePermission: () => ({ mutate: vi.fn(), isPending: false }),
  useListPermissionAudit: () => ({ data: [], isLoading: false }),
  getListCollectorTargetsQueryKey: () => ["collector-targets"],
  getListPermissionsQueryKey: () => ["permissions"],
  getListPermissionAuditQueryKey: (id: number) => ["permission-audit", id],
}))

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}))

import CollectorsPage from "./index"

const originalGrant = {
  id: 31,
  userId: 7,
  userName: "Amina",
  role: "COLLECTOR",
  permission: "PAYOUT_APPROVAL",
  cycleId: 10,
  expiresAt: "2026-09-20T12:30:00.000Z",
  createdAt: "2026-09-01T00:00:00.000Z",
  revokedAt: null,
  note: "Initial access",
  status: "ACTIVE",
}

describe("Staff delegated-access renewal", () => {
  beforeEach(() => {
    mocks.permissions = [{ ...originalGrant }]
    mocks.renewMutate.mockReset()
    mocks.invalidateQueries.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.toastError.mockReset()
  })

  afterEach(cleanup)

  it("replaces an active grant and keeps the prior grant visible after refresh", async () => {
    const user = userEvent.setup()
    mocks.renewMutate.mockImplementation((request, options) => {
      mocks.permissions = [
        { ...originalGrant, status: "REVOKED", revokedAt: "2026-09-10T08:00:00.000Z" },
        {
          ...originalGrant,
          id: 32,
          cycleId: 11,
          expiresAt: request.data.expiresAt,
          createdAt: "2026-09-10T08:00:00.000Z",
          note: request.data.note,
        },
      ]
      options.onSuccess()
    })

    const view = render(<CollectorsPage />)
    await user.click(screen.getByRole("button", { name: "Renew / replace" }))

    expect(screen.getByRole("heading", { name: "Renew or replace delegated access" })).toBeTruthy()
    const expiry = screen.getByLabelText("Expiry (optional; blank means permanent)") as HTMLInputElement
    expect(expiry.value).toBe("2026-09-20T12:30")

    await user.selectOptions(screen.getByLabelText("Cycle scope"), "11")
    await user.clear(expiry)
    await user.type(expiry, "2026-10-05T17:45")
    const reason = screen.getByLabelText("কারণ (required)")
    await user.clear(reason)
    await user.type(reason, "Renewed for next cycle")
    const note = screen.getByLabelText("নোট (optional)")
    await user.clear(note)
    await user.type(note, "Renewed for next cycle")
    await user.click(screen.getByRole("button", { name: "Renew / replace access" }))

    expect(mocks.renewMutate).toHaveBeenCalledWith(
      {
        id: 31,
        data: {
          cycleId: 11,
          expiresAt: new Date("2026-10-05T17:45").toISOString(),
          note: "Renewed for next cycle",
          reason: "Renewed for next cycle",
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["permissions"] })

    view.rerender(<CollectorsPage />)
    expect(screen.getAllByText(/Amina · PAYOUT_APPROVAL/)).toHaveLength(2)
    expect(screen.getByText("REVOKED")).toBeTruthy()
    expect(screen.getByText(/Cycle 11 .* Renewed for next cycle/)).toBeTruthy()
  })

  it("cancels renewal without submitting and resets the form", async () => {
    const user = userEvent.setup()
    render(<CollectorsPage />)

    await user.click(screen.getByRole("button", { name: "Renew / replace" }))
    await user.selectOptions(screen.getByLabelText("Cycle scope"), "11")
    await user.click(screen.getByRole("button", { name: "Cancel" }))

    expect(mocks.renewMutate).not.toHaveBeenCalled()
    expect(screen.getByRole("heading", { name: "Delegated permissions" })).toBeTruthy()
    expect((screen.getByLabelText("কর্মী") as HTMLSelectElement).value).toBe("")
    expect((screen.getByLabelText("Cycle scope") as HTMLSelectElement).value).toBe("")
  })

  it("shows a renewal error and preserves the editable renewal state", async () => {
    const user = userEvent.setup()
    mocks.renewMutate.mockImplementation((_request, options) => {
      options.onError(new Error("Revoked permissions cannot be renewed"))
    })
    render(<CollectorsPage />)

    await user.click(screen.getByRole("button", { name: "Renew / replace" }))
    await user.selectOptions(screen.getByLabelText("Cycle scope"), "11")
    await user.type(screen.getByLabelText("কারণ (required)"), "Scope change requested")
    await user.click(screen.getByRole("button", { name: "Renew / replace access" }))

    expect(mocks.toastError).toHaveBeenCalledWith("Revoked permissions cannot be renewed")
    expect(screen.getByRole("heading", { name: "Renew or replace delegated access" })).toBeTruthy()
    expect((screen.getByLabelText("Cycle scope") as HTMLSelectElement).value).toBe("11")
    expect(screen.getAllByText(/Amina · PAYOUT_APPROVAL/)).toHaveLength(1)
  })
})