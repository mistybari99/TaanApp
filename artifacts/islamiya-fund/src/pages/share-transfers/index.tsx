import { useMemo, useState } from "react"
import {
  getListCycleMembersQueryKey,
  getListCyclesQueryKey,
  getListShareTransfersQueryKey,
  getPreviewShareTransferQueryKey,
  useCreateShareTransfer,
  useGetCurrentUser,
  useListCycleMembers,
  useListCycles,
  useListMembers,
  useListShareTransfers,
  usePreviewShareTransfer,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { businessDate, formatCurrency, formatDate } from "@/lib/utils"
import { toast } from "sonner"
import { AlertTriangle, ArrowLeftRight, CheckCircle2 } from "lucide-react"

const today = businessDate

export default function ShareTransfersPage() {
  const queryClient = useQueryClient()
  const { data: user } = useGetCurrentUser()
  const { data: cycles } = useListCycles()
  const { data: members } = useListMembers()
  const [cycleId, setCycleId] = useState<number | null>(null)
  const selectedCycle = cycles?.find((cycle) => cycle.id === cycleId) ?? cycles?.find((cycle) => cycle.status === "ACTIVE") ?? cycles?.[0]
  const activeId = selectedCycle?.id ?? 0
  const { data: cycleMembers } = useListCycleMembers(activeId, {
    query: { enabled: Boolean(activeId), queryKey: getListCycleMembersQueryKey(activeId) },
  })
  const { data: transfers, isLoading } = useListShareTransfers(
    { cycleId: activeId || undefined },
    { query: { enabled: Boolean(activeId), queryKey: getListShareTransfersQueryKey({ cycleId: activeId || undefined }) } },
  )

  const [fromMemberId, setFromMemberId] = useState("")
  const [toMemberId, setToMemberId] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [transferDate, setTransferDate] = useState(today())
  const [notes, setNotes] = useState("")
  const [settlementAmount, setSettlementAmount] = useState("")
  const [settlementNotes, setSettlementNotes] = useState("")
  const [overrideWinner, setOverrideWinner] = useState(false)
  const [overrideConfirmation, setOverrideConfirmation] = useState(false)
  const createTransfer = useCreateShareTransfer()

  const previewParams = {
    cycleId: activeId,
    fromMemberId: Number(fromMemberId),
    quantity: Number(quantity),
  }
  const previewReady = Boolean(activeId && fromMemberId && Number(quantity) > 0)
  const { data: preview, isFetching: previewLoading, error: previewError } = usePreviewShareTransfer(previewParams, {
    query: { enabled: previewReady, retry: false, queryKey: getPreviewShareTransferQueryKey(previewParams) },
  })
  const availableReceivers = useMemo(
    () => (members ?? []).filter((member) => member.status === "active" && member.id !== Number(fromMemberId)),
    [members, fromMemberId],
  )

  const resetForm = () => {
    setFromMemberId("")
    setToMemberId("")
    setQuantity("1")
    setTransferDate(today())
    setNotes("")
    setSettlementAmount("")
    setSettlementNotes("")
    setOverrideWinner(false)
    setOverrideConfirmation(false)
  }

  const handleSubmit = (): void => {
    if (user?.role !== "OWNER") { toast.error("শেয়ার transfer শুধু Owner করতে পারবেন"); return }
    if (!selectedCycle || selectedCycle.status !== "ACTIVE") { toast.error("শুধু active cycle-এ transfer করা যায়"); return }
    if (!fromMemberId || !toMemberId || !preview) { toast.error("Source, receiver ও transfer quantity নির্বাচন করুন"); return }
    if (preview.isWinner && !overrideWinner) { toast.error("এই সদস্য draw winner; আগে Owner override নির্বাচন করুন"); return }
    if (preview.isWinner && !overrideConfirmation) { toast.error("Winner override-এর explicit confirmation দিন"); return }
    if (!window.confirm(`এই transfer অনুমোদন করবেন?\n\n${preview.fromMemberName} → ${members?.find((member) => member.id === Number(toMemberId))?.name ?? "Receiver"}\n${preview.requestedShares} shares · অবশিষ্ট ${preview.remainingShares} shares\nAccumulated value: ${formatCurrency(preview.transferredContribution)}${settlementAmount ? `\nSettlement: ${formatCurrency(Number(settlementAmount))}` : ""}`)) return
    createTransfer.mutate({
      data: {
        cycleId: selectedCycle.id,
        fromMemberId: Number(fromMemberId),
        toMemberId: Number(toMemberId),
        quantity: preview.requestedShares,
        transferDate,
        notes,
        overrideWinner,
        overrideConfirmation,
        ...(settlementAmount !== "" ? { settlementAmount: Number(settlementAmount), settlementNotes } : {}),
        idempotencyKey: crypto.randomUUID(),
      },
    }, {
      onSuccess: () => {
        toast.success("Share transfer ও history সংরক্ষণ হয়েছে")
        queryClient.invalidateQueries({ queryKey: getListCycleMembersQueryKey(selectedCycle.id) })
        queryClient.invalidateQueries({ queryKey: getListCyclesQueryKey() })
        queryClient.invalidateQueries({ queryKey: getListShareTransfersQueryKey({ cycleId: selectedCycle.id }) })
        resetForm()
      },
      onError: (error: any) => toast.error(error?.message || "Share transfer সংরক্ষণ করা যায়নি"),
    })
  }

  if (user && user.role !== "OWNER") {
    return <Card><CardContent className="p-8 text-center text-muted-foreground">Share transfer Owner-only workflow।</CardContent></Card>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">শেয়ার transfer <span className="text-muted-foreground text-lg font-normal ml-2">Share Transfers</span></h1>
        <p className="text-muted-foreground">Active cycle-এ যেকোনো পরিমাণ share নিরাপদে স্থানান্তর করুন</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ArrowLeftRight className="w-5 h-5" /> নতুন transfer</CardTitle>
          <CardDescription>Transfer-এর আগে source balance, accumulated contribution ও settlement review করুন।</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {!selectedCycle ? (
            <p className="text-sm text-muted-foreground">কোনো cycle নেই।</p>
          ) : selectedCycle.status !== "ACTIVE" ? (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">Completed cycle locked। নতুন transfer-এর জন্য active cycle নির্বাচন করুন।</p>
          ) : !selectedCycle.trackingStartDate || new Date(`${selectedCycle.trackingStartDate}T00:00:00`).getTime() > new Date(`${today()}T00:00:00`).getTime() ? (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">Owner digital tracking opening date সেট না করা পর্যন্ত share transfer বন্ধ থাকবে।</p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 items-end">
                <div className="space-y-2"><Label>Cycle</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={selectedCycle.id} onChange={(event) => { setCycleId(Number(event.target.value)); resetForm() }}>{cycles?.filter((cycle) => cycle.status === "ACTIVE").map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}</select></div>
                <div className="space-y-2"><Label>From member</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={fromMemberId} onChange={(event) => { setFromMemberId(event.target.value); setToMemberId("") }}><option value="">সদস্য নির্বাচন করুন</option>{cycleMembers?.filter((member) => member.shares > 0).map((member) => <option key={member.memberId} value={member.memberId}>{member.memberCode} — {member.name} ({member.shares} shares)</option>)}</select></div>
                <div className="space-y-2"><Label>Quantity</Label><Input type="number" min={1} step={1} value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div>
                <div className="space-y-2"><Label>To member</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={toMemberId} onChange={(event) => setToMemberId(event.target.value)}><option value="">সদস্য নির্বাচন করুন</option>{availableReceivers.map((member) => <option key={member.id} value={member.id}>{member.memberId} — {member.name}</option>)}</select></div>
                <div className="space-y-2"><Label>Transfer date</Label><Input type="date" value={transferDate} onChange={(event) => setTransferDate(event.target.value)} /></div>
              </div>

              {previewLoading && <p className="text-sm text-muted-foreground">Accumulated value হিসাব হচ্ছে...</p>}
              {previewError && <p className="text-sm text-destructive">{(previewError as any)?.message || "এই transfer preview করা যাচ্ছে না"}</p>}
              {preview && (
                <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-4 text-sm">
                    <div><p className="text-muted-foreground">বর্তমান shares</p><p className="text-xl font-bold">{preview.currentShares}</p></div>
                    <div><p className="text-muted-foreground">Transfer</p><p className="text-xl font-bold text-primary">{preview.requestedShares}</p></div>
                    <div><p className="text-muted-foreground">অবশিষ্ট shares</p><p className="text-xl font-bold">{preview.remainingShares}</p></div>
                    <div><p className="text-muted-foreground">Transferred value</p><p className="text-xl font-bold text-primary">{formatCurrency(preview.transferredContribution)}</p></div>
                  </div>
                  {preview.isWinner && <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>এই member Friday draw winner। Normal transfer blocked; exceptional transfer হলে Owner override ও confirmation আবশ্যক।</span></div>}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Transfer notes</Label><Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="কারণ বা অতিরিক্ত নোট" /></div>
                <div className="space-y-2"><Label>Settlement amount (optional)</Label><Input type="number" min={0} step="0.01" value={settlementAmount} onChange={(event) => setSettlementAmount(event.target.value)} placeholder="৳0" /><p className="text-xs text-muted-foreground">এটি share transfer থেকে আলাদা settlement record হিসেবে সংরক্ষিত হবে।</p></div>
                {settlementAmount !== "" && <div className="space-y-2 sm:col-span-2"><Label>Settlement notes</Label><Input value={settlementNotes} onChange={(event) => setSettlementNotes(event.target.value)} placeholder="Settlement-এর নোট" /></div>}
              </div>

              {preview?.isWinner && (
                <label className="flex items-start gap-2 rounded-md border border-amber-300 p-3 text-sm">
                  <input type="checkbox" checked={overrideWinner} onChange={(event) => { setOverrideWinner(event.target.checked); setOverrideConfirmation(false) }} />
                  <span><strong>Owner special override</strong> — winner-এর shares exceptional case-এ transfer করার অনুমতি দিচ্ছি।</span>
                </label>
              )}
              {overrideWinner && (
                <label className="flex items-start gap-2 rounded-md border border-destructive/30 p-3 text-sm">
                  <input type="checkbox" checked={overrideConfirmation} onChange={(event) => setOverrideConfirmation(event.target.checked)} />
                  <span>আমি বুঝেছি এই override draw winner-এর normal transfer restriction bypass করে এবং audit record তৈরি করবে।</span>
                </label>
              )}
              <Button onClick={handleSubmit} disabled={createTransfer.isPending || !preview || !toMemberId || (preview?.isWinner === true && (!overrideWinner || !overrideConfirmation))} className="gap-2"><CheckCircle2 className="w-4 h-4" /> Review করে save করুন</Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Transfer history</CardTitle><CardDescription>{transfers?.length ?? 0}টি record · Cycle-specific</CardDescription></CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50"><tr><th className="text-left p-3">তারিখ</th><th className="text-left p-3">From</th><th className="text-left p-3">To</th><th className="text-right p-3">Shares</th><th className="text-right p-3">Accumulated value</th><th className="text-right p-3">Settlement</th><th className="text-left p-3">Status</th></tr></thead>
              <tbody>{isLoading ? <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">লোড হচ্ছে...</td></tr> : transfers?.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">এখনো কোনো transfer নেই</td></tr> : transfers?.map((transfer) => <tr key={transfer.id} className="border-t"><td className="p-3">{formatDate(transfer.transferDate)}</td><td className="p-3"><div className="font-medium">{transfer.fromMemberName}</div><div className="text-xs text-muted-foreground">{transfer.fromMemberCode}</div></td><td className="p-3"><div className="font-medium">{transfer.toMemberName}</div><div className="text-xs text-muted-foreground">{transfer.toMemberCode}</div></td><td className="p-3 text-right font-bold">{transfer.shares}</td><td className="p-3 text-right">{formatCurrency(transfer.accumulatedValue)}</td><td className="p-3 text-right">{transfer.settlementAmount == null ? "—" : formatCurrency(transfer.settlementAmount)}</td><td className="p-3">{transfer.overrideWinner ? "OVERRIDE" : transfer.settlementStatus || "Transfer saved"}</td></tr>)}</tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}