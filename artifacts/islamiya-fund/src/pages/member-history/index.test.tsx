// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  history: null as any,
}))

vi.mock("@workspace/api-client-react", () => ({
  useListMembers: () => ({
    data: [{ id: 12, memberId: "IRF-0012", name: "Rahim", mobile: "01700000000", shares: 2, dailyAmount: 100, status: "active" }],
  }),
  useGetMemberHistory: () => ({ data: mocks.history, isLoading: false }),
  getGetMemberHistoryQueryKey: (id: number) => ["member-history", id],
}))

vi.mock("wouter", () => ({
  useLocation: () => ["/member-history", vi.fn()],
  Link: (props: any) => props.children,
}))

import MemberHistoryPage from "./index"

const member = {
  id: 12,
  memberId: "IRF-0012",
  name: "Rahim",
  mobile: "01700000000",
  shares: 2,
  dailyAmount: 100,
  joiningDate: "2026-01-01",
  status: "active",
  todayPaid: 0,
  todayDue: 100,
}

const baseHistory = {
  member,
  cycles: [],
  payments: [],
  transfers: [],
}

describe("member history payout timeline", () => {
  beforeEach(() => {
    mocks.history = null
  })

  afterEach(cleanup)

  it("keeps an unpaid draw visibly unpaid when its payout-attempt ledger is empty", async () => {
    mocks.history = {
      ...baseHistory,
      draws: [{
        id: 501,
        cycleId: 7,
        cycleNumber: 3,
        drawNumber: 2,
        drawDate: "2026-09-11",
        winningAmount: 200,
        status: "WON",
        payoutStatus: null,
        payoutAttempts: [],
        payoutHistory: [{
          id: 900,
          drawId: 501,
          payerUserId: 1,
          payerName: "Legacy payer",
          amount: 200,
          payoutDate: "2026-09-11",
          reference: "legacy-paid-reference",
          status: "PAID",
          createdAt: "2026-09-11T10:00:00.000Z",
          reversedAt: null,
          reversalReason: null,
        }],
      }],
    }

    render(<MemberHistoryPage />)

    expect(await screen.findByText("Pending payout")).toBeTruthy()
    expect(screen.queryByText("Legacy payer")).toBeNull()
    expect(screen.queryByText("legacy-paid-reference")).toBeNull()
    expect(screen.queryByText("PAID")).toBeNull()
  })

  it("renders payer, reference, status, timestamps, and reversal reason for a reversed attempt", async () => {
    mocks.history = {
      ...baseHistory,
      draws: [{
        id: 502,
        cycleId: 7,
        cycleNumber: 3,
        drawNumber: 3,
        drawDate: "2026-09-11",
        winningAmount: 200,
        status: "WON",
        payoutStatus: "REVERSED",
        payoutAttempts: [{
          id: 901,
          payerUserId: 2,
          payerName: "Amina",
          amount: 200,
          payoutDate: "2026-09-12",
          reference: "payout-ref-901",
          status: "REVERSED",
          createdAt: "2026-09-12T09:15:00.000Z",
          reversedAt: "2026-09-13T11:45:00.000Z",
          reversalReason: "Corrected duplicate payout",
        }],
      }],
    }

    render(<MemberHistoryPage />)

    expect(await screen.findByText("Amina")).toBeTruthy()
    expect(screen.getByText("payout-ref-901")).toBeTruthy()
    expect(screen.getByText("REVERSED")).toBeTruthy()
    expect(screen.getByText("Reason: Corrected duplicate payout")).toBeTruthy()
    expect(screen.getByText(/Payout: 12 Sept 2026/)).toBeTruthy()
    expect(screen.getByText(/Recorded: .*12 Sept 2026/)).toBeTruthy()
    expect(screen.getByText(/Reversed: .*13 Sept 2026/)).toBeTruthy()
  })
})