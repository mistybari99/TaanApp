import { Fragment, useEffect, useMemo, useState } from "react"
import {
  getListDrawsQueryKey,
  getListCycleMembersQueryKey,
  getListCyclesQueryKey,
  getListCashCustodyBalancesQueryKey,
  getGetTanQueryKey,
  useCreateDraw,
  useCreateDrawDisbursement,
  useMoveDrawDate,
  useGetCurrentUser,
  useGetTan,
  useListCashCustodyBalances,
  useListCycleMembers,
  useListCycles,
  useListDraws,
  useReverseDrawDisbursement,
  useListMyPermissions,
  getListMyPermissionsQueryKey,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { businessDate, formatCurrency, formatDate } from "@/lib/utils"
import { toast } from "sonner"
import { ArrowDownToLine, ChevronDown, ChevronRight, RotateCcw, Trophy } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const today = businessDate
const formatTimestamp = (value?: string | null) => value
  ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : "—"

export default function DrawsPage() {
  return <DrawSurface readOnly={false} />
}

export function DrawHistoryPage() {
  return <DrawSurface readOnly />
}

function DrawSurface({ readOnly }: { readOnly: boolean }) {
  const queryClient = useQueryClient()
  const { data: user } = useGetCurrentUser()
  const { data: delegatedPermissions } = useListMyPermissions({ query: { queryKey: getListMyPermissionsQueryKey(), refetchInterval: 15000 } })
  const hasDelegatedPermission = (permission: string) => delegatedPermissions?.some((grant) =>
    grant.status === "ACTIVE" && (grant.permission === permission || grant.permission === "FULL_ACCESS")
  ) ?? false
  const canMoveDrawDate = user?.role === "OWNER" || hasDelegatedPermission("DRAW_DATE_CORRECTION")
  const canApprovePayout = user?.role === "OWNER" || hasDelegatedPermission("PAYOUT_APPROVAL")
  const canReversePayout = user?.role === "OWNER" || hasDelegatedPermission("PAYOUT_REVERSAL")
  const { data: cycles, isLoading } = useListCycles({ query: { queryKey: getListCyclesQueryKey() } })
  const [cycleId, setCycleId] = useState<number | null>(null)
  const [form, setForm] = useState({ drawDate: today(), winnerMemberId: "", winningAmount: "", notes: "" })
  const [filters, setFilters] = useState({ cycleId: "", date: "", memberId: "", drawNumber: "" })
  const { data: cycleMembers } = useListCycleMembers((cycleId ?? 0) as number, { query: { enabled: Boolean(cycleId), queryKey: getListCycleMembersQueryKey((cycleId ?? 0) as number) } })
  const drawQuery = useMemo(() => ({
    cycleId: filters.cycleId ? Number(filters.cycleId) : undefined,
    date: filters.date || undefined,
    memberId: filters.memberId ? Number(filters.memberId) : undefined,
    drawNumber: filters.drawNumber ? Number(filters.drawNumber) : undefined,
  }), [filters])
  const { data: draws, isLoading: drawsLoading } = useListDraws(drawQuery, { query: { queryKey: getListDrawsQueryKey(drawQuery) } })
  const createDraw = useCreateDraw()
  const createDisbursement = useCreateDrawDisbursement()
  const reverseDisbursement = useReverseDrawDisbursement()
  const moveDrawDate = useMoveDrawDate()
  const { data: custodyBalances } = useListCashCustodyBalances()
  const selectedCycle = cycles?.find((cycle) => cycle.id === cycleId) ?? cycles?.[0]
  const selectedWinner = cycleMembers?.find((member) => member.memberId === Number(form.winnerMemberId))
  const { data: tanData } = useGetTan((selectedCycle?.id ?? 0) as number, {
    query: { enabled: Boolean(selectedCycle?.id), queryKey: getGetTanQueryKey((selectedCycle?.id ?? 0) as number) },
  })
  const [payoutDraw, setPayoutDraw] = useState<NonNullable<typeof draws>[number] | null>(null)
  const [payoutPayerId, setPayoutPayerId] = useState("")
  const [payoutDate, setPayoutDate] = useState(today())
  const [payoutReference, setPayoutReference] = useState("")
  const [payoutNote, setPayoutNote] = useState("")
  const [expandedDrawId, setExpandedDrawId] = useState<number | null>(null)

  useEffect(() => {
    if (!cycleId && cycles?.[0]) setCycleId(cycles[0].id)
  }, [cycles, cycleId])

  useEffect(() => {
    if (tanData?.tan && tanData.activePeriod) {
      setForm((current) => ({
        ...current,
        drawDate: tanData.activePeriod?.drawDate ?? current.drawDate,
        winningAmount: String(tanData.tan?.perDrawWinnerAmount ?? current.winningAmount),
      }))
    }
  }, [tanData?.tan?.id, tanData?.activePeriod?.id])

  const handleRecord = () => {
    if (!selectedCycle || !form.winnerMemberId || !form.winningAmount) return toast.error("চক্র, বিজয়ী ও জয়ের পরিমাণ নির্বাচন করুন")
    const activePeriod = tanData?.activePeriod
    const data = {
      cycleId: selectedCycle.id,
      drawDate: form.drawDate,
      winnerMemberId: Number(form.winnerMemberId),
      winningAmount: Number(form.winningAmount),
      notes: form.notes || undefined,
      ...(activePeriod && tanData?.tan ? { tanPeriodId: activePeriod.id, drawSlot: activePeriod.recordedDraws + 1 } : {}),
    }
    createDraw.mutate({ data }, {
      onSuccess: () => {
        toast.success("শুক্রবারের ড্র সংরক্ষিত হয়েছে")
        setForm({ drawDate: today(), winnerMemberId: "", winningAmount: "", notes: "" })
        queryClient.invalidateQueries({ queryKey: getListDrawsQueryKey() })
        queryClient.invalidateQueries({ queryKey: getListCycleMembersQueryKey(selectedCycle.id) })
        queryClient.invalidateQueries({ queryKey: getGetTanQueryKey(selectedCycle.id) })
      },
      onError: (error: any) => toast.error(error?.message || "ড্র সংরক্ষণ করা যায়নি"),
    })
    return
  }

  const openPayout = (draw: NonNullable<typeof draws>[number]) => {
    setPayoutDraw(draw)
    const eligible = (custodyBalances ?? []).find((balance) => balance.availableAmount >= draw.winningAmount)
    setPayoutPayerId(String(draw.payoutPayerId ?? eligible?.userId ?? ""))
    setPayoutDate(today())
    setPayoutReference(`DRAW-${draw.drawNumber}-${draw.drawDate}`)
    setPayoutNote("")
  }

  const closePayout = () => {
    setPayoutDraw(null)
    setPayoutPayerId("")
    setPayoutReference("")
    setPayoutNote("")
  }

  const handlePayout = () => {
    if (!payoutDraw || !payoutPayerId || !payoutReference.trim()) return
    createDisbursement.mutate({
      id: payoutDraw.id,
      data: {
        payerUserId: Number(payoutPayerId),
        amount: payoutDraw.winningAmount,
        payoutDate,
        reference: payoutReference.trim(),
        note: payoutNote.trim() || undefined,
        idempotencyKey: crypto.randomUUID(),
      },
    }, {
      onSuccess: () => {
        toast.success("ড্র payout cash custody থেকে বাদ হয়েছে")
        queryClient.invalidateQueries({ queryKey: getListDrawsQueryKey(drawQuery) })
        queryClient.invalidateQueries({ queryKey: getListCashCustodyBalancesQueryKey() })
        queryClient.invalidateQueries({ queryKey: getGetTanQueryKey(selectedCycle?.id ?? 0) })
        closePayout()
      },
      onError: (error: any) => toast.error(error?.message || "Draw payout সংরক্ষণ করা যায়নি"),
    })
  }

  const handleReversePayout = (draw: NonNullable<typeof draws>[number]) => {
    const reason = window.prompt("Payout reversal-এর কারণ লিখুন", "ভুল payer বা cash correction")
    if (!reason?.trim() || !draw.payoutId) return
    reverseDisbursement.mutate({ id: draw.payoutId, data: { reason: reason.trim() } }, {
      onSuccess: () => {
        toast.success("Draw payout reverse হয়েছে; balance আবার খোলা হয়েছে")
        queryClient.invalidateQueries({ queryKey: getListDrawsQueryKey(drawQuery) })
        queryClient.invalidateQueries({ queryKey: getListCashCustodyBalancesQueryKey() })
      },
      onError: (error: any) => toast.error(error?.message || "Payout reverse করা যায়নি"),
    })
  }

  const handleMoveDrawDate = (draw: NonNullable<typeof draws>[number]) => {
    const drawDate = window.prompt("নতুন draw date (YYYY-MM-DD)", draw.drawDate)
    if (!drawDate || drawDate === draw.drawDate) return
    const reason = window.prompt("তারিখ পরিবর্তনের কারণ (optional)", "Owner manual draw-date correction") ?? ""
    moveDrawDate.mutate({ id: draw.id, data: { drawDate, reason } }, {
      onSuccess: () => {
        toast.success(`Draw #${draw.drawNumber}-এর তারিখ ${drawDate} হয়েছে; entitlement অপরিবর্তিত আছে`)
        queryClient.invalidateQueries({ queryKey: getListDrawsQueryKey(drawQuery) })
      },
      onError: (error: any) => toast.error(error?.message || "Draw date পরিবর্তন করা যায়নি"),
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">{readOnly ? "ড্র ইতিহাস" : "শুক্রবার ড্র"} <span className="text-muted-foreground text-lg font-normal ml-2">{readOnly ? "Draw History" : "Friday Draw"}</span></h1>
        <p className="text-muted-foreground">{readOnly ? "সব চক্রের বিজয়ী ও জয়ের পরিমাণ" : "প্রতি শুক্রবারের ড্র স্থায়ীভাবে সংরক্ষণ করুন"}</p>
      </div>

      {!readOnly && user?.role === "OWNER" && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Trophy className="w-5 h-5" /> নতুন ড্র রেকর্ড করুন</CardTitle><CardDescription>শুধু নির্বাচিত চক্রের অংশগ্রহণকারী সদস্য বিজয়ী হতে পারবেন</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 items-end">
            <div className="space-y-2"><Label>চক্র</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={selectedCycle?.id ?? ""} onChange={(event) => { setCycleId(Number(event.target.value)); setForm({ ...form, winnerMemberId: "" }) }}><option value="">চক্র নির্বাচন করুন</option>{cycles?.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}</select></div>
            <div className="space-y-2"><Label>{tanData?.tan ? "Locked Draw-Date (শুক্রবার)" : "ড্র তারিখ"}</Label><Input type="date" value={form.drawDate} readOnly={Boolean(tanData?.tan)} onChange={(event) => setForm({ ...form, drawDate: event.target.value })} /></div>
            <div className="space-y-2"><Label>বিজয়ী সদস্য</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.winnerMemberId} onChange={(event) => setForm({ ...form, winnerMemberId: event.target.value })}><option value="">সদস্য নির্বাচন করুন</option>{cycleMembers?.map((member) => <option key={member.memberId} value={member.memberId} disabled={member.drawEntitlementRemaining === 0}>{member.memberCode} — {member.name} · {member.drawEntitlementRemaining}টি draw বাকি</option>)}</select></div>
            <div className="space-y-2"><Label>{tanData?.tan ? `জয়ের পরিমাণ (fixed)` : "জয়ের পরিমাণ"}</Label><Input type="number" min={1} value={form.winningAmount} readOnly={Boolean(tanData?.tan)} placeholder="৳0" onChange={(event) => setForm({ ...form, winningAmount: event.target.value })} /></div>
            <Button onClick={handleRecord} disabled={createDraw.isPending || !selectedCycle || (Boolean(tanData?.tan) && !tanData?.activePeriod)}>ড্র সংরক্ষণ</Button>
            <div className="sm:col-span-2 lg:col-span-5 space-y-2"><Label>নোট (ঐচ্ছিক)</Label><Input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="ড্র সংক্রান্ত নোট" /></div>
            {selectedWinner && <div className="sm:col-span-2 lg:col-span-5 rounded-md border border-primary/20 bg-primary/5 p-3 text-sm"><span className="font-medium">{selectedWinner.name}</span> · মোট entitlement {selectedWinner.drawEntitlementTotal} · ব্যবহৃত {selectedWinner.drawEntitlementUsed} · <span className="font-semibold text-primary">বাকি {selectedWinner.drawEntitlementRemaining}</span></div>}
            {tanData?.tan && <div className="sm:col-span-2 lg:col-span-5 rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">TAN period {tanData.activePeriod ? `${tanData.activePeriod.sequenceNo}/${tanData.tan.totalDrawDates}` : "open নয়"} · এই Friday-তে winner slot {tanData.activePeriod ? `${tanData.activePeriod.recordedDraws + 1}/${tanData.tan.drawsPerWeek}` : "—"} · প্রতি winner {formatCurrency(tanData.tan.perDrawWinnerAmount)}</div>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>স্থায়ী ড্র ইতিহাস</CardTitle><CardDescription>{draws?.length ?? 0}টি রেকর্ড</CardDescription></CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.cycleId} onChange={(event) => setFilters({ ...filters, cycleId: event.target.value })}><option value="">সব চক্র</option>{cycles?.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}</select>
            <Input type="date" value={filters.date} onChange={(event) => setFilters({ ...filters, date: event.target.value })} aria-label="Draw date filter" />
            <Input type="number" min={1} placeholder="Member ID (database)" value={filters.memberId} onChange={(event) => setFilters({ ...filters, memberId: event.target.value })} />
            <Input type="number" min={1} placeholder="Draw number" value={filters.drawNumber} onChange={(event) => setFilters({ ...filters, drawNumber: event.target.value })} />
          </div>
          <div className="border rounded-lg overflow-x-auto">
             <table className="w-full text-sm">
               <thead className="bg-muted/50"><tr><th className="text-left p-3">তারিখ</th><th className="text-left p-3">চক্র</th><th className="text-left p-3">ড্র নং</th><th className="text-left p-3">বিজয়ী</th><th className="text-right p-3">পরিমাণ</th><th className="text-left p-3">Share draw</th><th className="text-left p-3">ড্র / payout</th><th className="text-left p-3">Action</th></tr></thead>
              <tbody>
                  {isLoading || drawsLoading ? <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">লোড হচ্ছে...</td></tr> : draws?.length === 0 ? <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">এখনো কোনো ড্র রেকর্ড নেই</td></tr> : draws?.map((draw) => {
                    const payoutAttempts = draw.payoutAttempts ?? []
                    const isExpanded = expandedDrawId === draw.id
                    return (
                      <Fragment key={draw.id}>
                        <tr className="border-t">
                          <td className="p-3">{formatDate(draw.drawDate)}</td>
                          <td className="p-3">{draw.cycleName || `Cycle #${draw.cycleNumber}`}</td>
                          <td className="p-3">#{draw.drawNumber}</td>
                          <td className="p-3"><div className="font-medium">{draw.winnerName}</div><div className="text-xs text-muted-foreground">{draw.winnerMemberCode}</div></td>
                          <td className="p-3 text-right font-bold text-primary">{formatCurrency(draw.winningAmount)}</td>
                          <td className="p-3">{draw.entitlementNumber ? `Entitlement #${draw.entitlementNumber}` : "—"}</td>
                          <td className="p-3">
                            <div className="font-medium">{draw.payoutStatus === "PAID" ? "PAID" : draw.payoutStatus === "REVERSED" ? "REVERSED" : "Pending payout"}</div>
                            {draw.payoutPayerName && <div className="text-xs text-muted-foreground">{draw.payoutPayerName} · {formatCurrency(draw.payoutAmount ?? 0)} · {draw.payoutReference}</div>}
                            {payoutAttempts.length > 0 && <Button
                              size="sm"
                              variant="link"
                              className="h-auto px-0 text-xs"
                              onClick={() => setExpandedDrawId(isExpanded ? null : draw.id)}
                              aria-expanded={isExpanded}
                              aria-label={`${isExpanded ? "Hide" : "Show"} payout history for draw ${draw.drawNumber}`}
                            >
                              {isExpanded ? <ChevronDown className="mr-1 h-3 w-3" /> : <ChevronRight className="mr-1 h-3 w-3" />}
                              {payoutAttempts.length}টি payout attempt
                            </Button>}
                          </td>
                          <td className="p-3">{!readOnly && <div className="flex flex-wrap gap-2 justify-end">{canMoveDrawDate && <Button size="sm" variant="ghost" onClick={() => handleMoveDrawDate(draw)} disabled={moveDrawDate.isPending}>তারিখ বদল</Button>}{draw.status === "RECORDED" && draw.payoutStatus !== "PAID" && canApprovePayout ? <Button size="sm" variant="outline" className="gap-1" onClick={() => openPayout(draw)}><ArrowDownToLine className="h-3.5 w-3.5" /> টাকা প্রদান</Button> : draw.payoutStatus === "PAID" && canReversePayout ? <Button size="sm" variant="ghost" className="gap-1 text-destructive" onClick={() => handleReversePayout(draw)} disabled={reverseDisbursement.isPending}><RotateCcw className="h-3.5 w-3.5" /> Reverse</Button> : null}</div>}</td>
                        </tr>
                        {isExpanded && <tr className="border-t bg-muted/20">
                          <td colSpan={8} className="p-4">
                            <div className="mb-3 text-sm font-semibold">Payout ledger · {payoutAttempts.length}টি attempt · পুরনো থেকে নতুন</div>
                            <div className="overflow-x-auto rounded-md border bg-background">
                              <table className="w-full text-xs">
                                <thead className="bg-muted/50">
                                  <tr>
                                    <th className="p-2 text-left">Ledger timestamp</th>
                                    <th className="p-2 text-left">Payout date</th>
                                    <th className="p-2 text-left">Payer</th>
                                    <th className="p-2 text-right">Amount</th>
                                    <th className="p-2 text-left">Reference</th>
                                    <th className="p-2 text-left">Status</th>
                                    <th className="p-2 text-left">Reversal reason / timestamp</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {payoutAttempts.map((attempt) => <tr key={attempt.id} className="border-t align-top">
                                    <td className="p-2 whitespace-nowrap">{formatTimestamp(attempt.createdAt)}</td>
                                    <td className="p-2 whitespace-nowrap">{formatDate(attempt.payoutDate)}</td>
                                    <td className="p-2">{attempt.payerName}</td>
                                    <td className="p-2 text-right font-medium">{formatCurrency(attempt.amount)}</td>
                                    <td className="p-2">{attempt.reference}{attempt.note && <div className="text-muted-foreground">{attempt.note}</div>}</td>
                                    <td className="p-2 font-medium">{attempt.status}</td>
                                    <td className="p-2">{attempt.reversalReason ? <><div>{attempt.reversalReason}</div><div className="text-muted-foreground">{formatTimestamp(attempt.reversedAt)}</div></> : "—"}</td>
                                  </tr>)}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>}
                      </Fragment>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(payoutDraw)} onOpenChange={(open) => !open && closePayout()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Draw winner-কে payout দিন</DialogTitle>
            <DialogDescription>{payoutDraw?.winnerName} · {formatCurrency(payoutDraw?.winningAmount ?? 0)} — যে account বাস্তবে cash দিচ্ছে, সেটি নির্বাচন করুন।</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div className="space-y-2">
              <Label>Cash payer / custodian</Label>
              <select value={payoutPayerId} onChange={(event) => setPayoutPayerId(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                <option value="">Account নির্বাচন করুন</option>
                {(custodyBalances ?? []).map((balance) => <option key={balance.userId} value={balance.userId}>{balance.name} · {balance.role} · available {formatCurrency(balance.availableAmount)}</option>)}
              </select>
              {payoutDraw && custodyBalances?.find((balance) => balance.userId === Number(payoutPayerId))?.availableAmount! < payoutDraw.winningAmount && <p className="text-sm text-destructive">এই account-এ available custody কম; অন্য payer নির্বাচন করুন।</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>পরিমাণ</Label><Input value={formatCurrency(payoutDraw?.winningAmount ?? 0)} readOnly /></div>
              <div className="space-y-2"><Label>Payout date</Label><Input type="date" value={payoutDate} onChange={(event) => setPayoutDate(event.target.value)} /></div>
            </div>
            <div className="space-y-2"><Label>Reference</Label><Input value={payoutReference} onChange={(event) => setPayoutReference(event.target.value)} placeholder="DRAW-PAYOUT-..." /></div>
            <div className="space-y-2"><Label>নোট (optional)</Label><Input value={payoutNote} onChange={(event) => setPayoutNote(event.target.value)} /></div>
          </div>
          <DialogFooter><Button onClick={handlePayout} disabled={createDisbursement.isPending || !payoutDraw || !payoutPayerId || !payoutReference.trim()}>{createDisbursement.isPending ? "সংরক্ষণ হচ্ছে..." : "Payout নিশ্চিত করুন"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}