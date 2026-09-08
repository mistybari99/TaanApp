import { useMemo, useState } from "react"
import {
  getGetCurrentUserQueryKey,
  getGetDashboardQueryKey,
  getListCashCustodyBalancesQueryKey,
  getListCashHandoverRecipientsQueryKey,
  getListCashHandoversQueryKey,
  getListCycleMembersQueryKey,
  getListPaymentsQueryKey,
  useAcceptCashHandover,
  useCreateCashHandover,
  useCreatePayment,
  useGetCurrentUser,
  useGetDashboard,
  useListCashHandoverRecipients,
  useListCashCustodyBalances,
  useListCashHandovers,
  useListCycleMembers,
  useListCycles,
  useRejectCashHandover,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowDownToLine, CheckCircle2, HandCoins, ReceiptText, ShieldCheck, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatCurrency, formatDate } from "@/lib/utils"

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date())

export default function SettlementsPage() {
  const queryClient = useQueryClient()
  const { data: user } = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey() } })
  const { data: cycles } = useListCycles()
  const activeCycle = cycles?.find((cycle) => cycle.status === "ACTIVE") ?? cycles?.[0]
  const { data: members } = useListCycleMembers(activeCycle?.id ?? 0, {
    query: { enabled: Boolean(activeCycle?.id), queryKey: getListCycleMembersQueryKey(activeCycle?.id ?? 0) },
  })
  const { data: dashboard } = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey(), refetchInterval: 15000 } })
  const { data: handovers, isLoading } = useListCashHandovers({ query: { queryKey: getListCashHandoversQueryKey(), refetchOnMount: "always" } })
  const { data: balances } = useListCashCustodyBalances({ query: { queryKey: getListCashCustodyBalancesQueryKey(), refetchOnMount: "always" } })
  const { data: recipients } = useListCashHandoverRecipients()
  const createPayment = useCreatePayment()
  const createHandover = useCreateCashHandover()
  const acceptHandover = useAcceptCashHandover()
  const rejectHandover = useRejectCashHandover()

  const [directOpen, setDirectOpen] = useState(false)
  const [handoverOpen, setHandoverOpen] = useState(false)
  const [directMemberId, setDirectMemberId] = useState("")
  const [directAmount, setDirectAmount] = useState("")
  const [directNote, setDirectNote] = useState("")
  const [toUserId, setToUserId] = useState("")
  const [handoverAmount, setHandoverAmount] = useState("")
  const [collectionDate, setCollectionDate] = useState(today())
  const [receiptStart, setReceiptStart] = useState("")
  const [receiptEnd, setReceiptEnd] = useState("")
  const [receiptCount, setReceiptCount] = useState("")
  const [reference, setReference] = useState("")
  const [handoverNote, setHandoverNote] = useState("")

  const role = user?.role
  const canDirectReceive = role === "OWNER" || role === "CASH_RECEIVER"
  const canSubmitHandover = role === "COLLECTOR" || role === "CASH_RECEIVER"
  const canDecide = role === "OWNER" || role === "CASH_RECEIVER"
  const availableRecipients = useMemo(
    () => (recipients ?? []).filter((recipient) => recipient.id !== user?.id),
    [recipients, user?.id],
  )
  const selectedMember = members?.find((member) => member.memberId === Number(directMemberId))
  const myBalance = balances?.find((balance) => balance.userId === user?.id)

  const refreshCustody = () => {
    queryClient.invalidateQueries({ queryKey: getListCashHandoversQueryKey() })
    queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() })
  }

  const resetDirect = () => {
    setDirectOpen(false)
    setDirectMemberId("")
    setDirectAmount("")
    setDirectNote("")
  }

  const handleDirectPayment = () => {
    if (!user || !activeCycle?.id || !directMemberId || Number(directAmount) <= 0) return
    const verificationMethod = user.role === "OWNER" ? "OWNER_CONFIRMATION" : "CASH_RECEIVER_CONFIRMATION"
    createPayment.mutate(
      {
        data: {
          memberId: Number(directMemberId),
          cycleId: activeCycle.id,
          amount: Number(directAmount),
          notes: directNote || undefined,
          verificationMethod,
          confirmDuplicate: true,
          idempotencyKey: crypto.randomUUID(),
        },
      },
      {
        onSuccess: (result) => {
          toast.success(`সরাসরি receipt ${result.receiptId} তৈরি হয়েছে`)
          queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() })
          queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() })
          queryClient.invalidateQueries({ queryKey: getListCycleMembersQueryKey(activeCycle.id) })
          resetDirect()
        },
        onError: (error: any) => toast.error(error?.message || "Direct payment save করা যায়নি"),
      },
    )
  }

  const handleCreateHandover = () => {
    if (!toUserId || Number(handoverAmount) <= 0 || !reference.trim()) return
    createHandover.mutate(
      {
        data: {
          toUserId: Number(toUserId),
          amount: Number(handoverAmount),
          collectionDate,
          receiptStart: receiptStart || undefined,
          receiptEnd: receiptEnd || undefined,
          receiptCount: receiptCount ? Number(receiptCount) : undefined,
          reference: reference.trim(),
          note: handoverNote || undefined,
          idempotencyKey: crypto.randomUUID(),
        },
      },
      {
        onSuccess: () => {
          toast.success("Cash handover জমা হয়েছে; receiver count করে গ্রহণ করবেন")
          refreshCustody()
          setHandoverOpen(false)
          setToUserId("")
          setHandoverAmount("")
          setReceiptStart("")
          setReceiptEnd("")
          setReceiptCount("")
          setReference("")
          setHandoverNote("")
        },
        onError: (error: any) => toast.error(error?.message || "Handover save করা যায়নি"),
      },
    )
  }

  const handleAccept = (id: number) => {
    const raw = window.prompt("গোনা cash amount লিখুন (সঠিক হলে খালি রেখে OK দিন)", "")
    if (raw === null) return
    acceptHandover.mutate(
      { id, data: raw.trim() ? { countedAmount: Number(raw) } : {} },
      {
        onSuccess: () => {
          toast.success("Cash handover গ্রহণ করা হয়েছে")
          refreshCustody()
        },
        onError: (error: any) => toast.error(error?.message || "Cash count মেলেনি; handover reject করুন"),
      },
    )
  }

  const handleReject = (id: number) => {
    const reason = window.prompt("Reject করার কারণ লিখুন", "Cash count বা receipt mismatch")
    if (!reason?.trim()) return
    rejectHandover.mutate(
      { id, data: { reason: reason.trim() } },
      {
        onSuccess: () => {
          toast.success("Handover reject করা হয়েছে")
          refreshCustody()
        },
        onError: (error: any) => toast.error(error?.message || "Reject করা যায়নি"),
      },
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">নগদ custody <span className="text-muted-foreground text-lg font-normal ml-2">Cash custody</span></h1>
          <p className="text-muted-foreground">কে টাকা নিলেন, কে গুনে গ্রহণ করলেন, এবং টাকা এখন কার কাছে—এক জায়গায় দেখুন।</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          {canDirectReceive && (
            <Button className="gap-2" onClick={() => setDirectOpen(true)}>
              <ReceiptText className="h-4 w-4" /> সরাসরি receipt
            </Button>
          )}
          {canSubmitHandover && (
            <Button variant="outline" className="gap-2" onClick={() => setHandoverOpen(true)}>
              <ArrowDownToLine className="h-4 w-4" /> cash handover
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">আমার custody balance</p><p className="mt-1 text-2xl font-bold text-primary">{formatCurrency(myBalance?.availableAmount ?? 0)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">অপেক্ষমান handover</p><p className="mt-1 text-2xl font-bold">{(handovers ?? []).filter((handover) => handover.status === "SUBMITTED").length}</p></CardContent></Card>
        <Card className="border-primary/20 bg-primary/5"><CardContent className="p-4"><p className="text-sm text-muted-foreground">এই cycle</p><p className="mt-1 font-bold">{activeCycle?.name ?? "Active cycle নেই"}</p><p className="text-xs text-muted-foreground">{user?.name} · {role === "CASH_RECEIVER" ? "Cash Receiver" : role}</p></CardContent></Card>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-border/70 p-4">
          <h2 className="font-bold">Custody balances</h2>
          <p className="text-sm text-muted-foreground">Posted receipt + accepted incoming − accepted outgoing</p>
        </div>
        <div className="divide-y divide-border/70">
          {!balances?.length ? <div className="p-6 text-center text-sm text-muted-foreground">কোনো active custody balance নেই</div> : balances.map((balance) => (
            <div key={balance.userId} className={`flex items-center justify-between gap-3 p-4 ${balance.userId === user?.id ? "bg-primary/5" : ""}`}>
              <div>
                <p className="font-semibold">{balance.name}{balance.userId === user?.id ? " · আপনি" : ""}</p>
                <p className="text-xs text-muted-foreground">{balance.role === "CASH_RECEIVER" ? "Cash Receiver" : balance.role}</p>
              </div>
              <div className="text-right">
                <p className="font-extrabold text-primary">{formatCurrency(balance.availableAmount)}</p>
                <p className="text-xs text-muted-foreground">in {formatCurrency(balance.acceptedIncoming)} · out {formatCurrency(balance.acceptedOutgoing)} · draw payout {formatCurrency(balance.drawPayouts)}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="border-secondary/30 bg-secondary/10">
        <CardContent className="flex items-start gap-3 p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="text-sm">
            <p className="font-bold">সঠিক নিয়ম</p>
            <p className="text-muted-foreground">বাস্তবে যে টাকা নিচ্ছেন, তার নিজের account-এই receipt হবে। Handover শুধু cash হাতে বদলানোর সময় হবে—Owner direct receive করলে artificial Treasurer handover লাগবে না।</p>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-border/70 p-4">
          <h2 className="font-bold">Cash handover history</h2>
          <p className="text-sm text-muted-foreground">Collector → Cash Receiver/Owner এবং Cash Receiver → Owner</p>
        </div>
        <div className="divide-y divide-border/70">
          {isLoading ? <div className="p-8 text-center text-muted-foreground">লোড হচ্ছে...</div> : !handovers?.length ? (
            <div className="p-8 text-center text-muted-foreground">এখনো কোনো cash handover নেই</div>
          ) : handovers.map((handover) => {
            const waitingForMe = handover.status === "SUBMITTED" && handover.toUserId === user?.id
            return (
              <div key={handover.id} className="space-y-3 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-bold">{handover.fromUserName} → {handover.toUserName}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(handover.createdAt)} · {handover.reference}</p>
                    <p className="mt-1 text-sm">{handover.receiptCount || 0} receipt · collection date {formatDate(handover.collectionDate)}</p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-lg font-extrabold text-primary">{formatCurrency(handover.amount)}</p>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${handover.status === "ACCEPTED" ? "bg-green-100 text-green-700" : handover.status === "REJECTED" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>
                      {handover.status === "ACCEPTED" ? <CheckCircle2 className="h-3.5 w-3.5" /> : handover.status === "REJECTED" ? <XCircle className="h-3.5 w-3.5" /> : <HandCoins className="h-3.5 w-3.5" />}
                      {handover.status}
                    </span>
                  </div>
                </div>
                {handover.rejectionReason && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">Reject reason: {handover.rejectionReason}</p>}
                {waitingForMe && (
                  <div className="flex flex-col gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm font-semibold">Cash গুনে তারপর গ্রহণ বা reject করুন।</p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleAccept(handover.id)} disabled={acceptHandover.isPending}>গুনে গ্রহণ</Button>
                      <Button size="sm" variant="outline" className="text-destructive" onClick={() => handleReject(handover.id)} disabled={rejectHandover.isPending}>Reject</Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      <Dialog open={directOpen} onOpenChange={setDirectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>সরাসরি member payment</DialogTitle>
            <DialogDescription>{user?.name}-এর account-এই actual receiver হিসেবে receipt হবে।</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div className="space-y-2">
              <Label>সদস্য</Label>
              <select value={directMemberId} onChange={(event) => { setDirectMemberId(event.target.value); const member = members?.find((item) => item.memberId === Number(event.target.value)); setDirectAmount(member?.totalDue ? String(member.totalDue) : "") }} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
                <option value="">সদস্য নির্বাচন করুন</option>
                {(members ?? []).map((member) => <option key={member.memberId} value={member.memberId}>{member.name} · {member.memberCode} · due {formatCurrency(member.totalDue ?? 0)}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>পরিমাণ</Label>
              <Input type="number" min="0.01" value={directAmount} onChange={(event) => setDirectAmount(event.target.value)} placeholder="0.00" />
              {selectedMember && <p className="text-xs text-muted-foreground">বর্তমান মোট due: {formatCurrency(selectedMember.totalDue ?? 0)}</p>}
            </div>
            <div className="space-y-2"><Label>নোট (optional)</Label><Input value={directNote} onChange={(event) => setDirectNote(event.target.value)} placeholder="Cash desk note" /></div>
          </div>
          <DialogFooter><Button onClick={handleDirectPayment} disabled={createPayment.isPending || !directMemberId || Number(directAmount) <= 0}>{createPayment.isPending ? "সংরক্ষণ হচ্ছে..." : "Receipt তৈরি করুন"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={handoverOpen} onOpenChange={setHandoverOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cash handover submit</DialogTitle>
            <DialogDescription>Cash হাতে যিনি নেবেন, তাকে নির্বাচন করুন। Receiver পরে cash গুনে accept করবেন।</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label>Receiver</Label><select value={toUserId} onChange={(event) => setToUserId(event.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"><option value="">Receiver নির্বাচন করুন</option>{availableRecipients.map((recipient) => <option key={recipient.id} value={recipient.id}>{recipient.name} · {recipient.role === "CASH_RECEIVER" ? "Cash Receiver" : "Owner"}</option>)}</select></div>
            <div className="space-y-2"><Label>পরিমাণ</Label><Input type="number" min="0.01" value={handoverAmount} onChange={(event) => setHandoverAmount(event.target.value)} /></div>
            <div className="space-y-2"><Label>Collection date</Label><Input type="date" value={collectionDate} onChange={(event) => setCollectionDate(event.target.value)} /></div>
            <div className="space-y-2"><Label>Receipt শুরু</Label><Input value={receiptStart} onChange={(event) => setReceiptStart(event.target.value)} placeholder="IRF-..." /></div>
            <div className="space-y-2"><Label>Receipt শেষ</Label><Input value={receiptEnd} onChange={(event) => setReceiptEnd(event.target.value)} placeholder="IRF-..." /></div>
            <div className="space-y-2"><Label>Receipt count</Label><Input type="number" min="0" step="1" value={receiptCount} onChange={(event) => setReceiptCount(event.target.value)} /></div>
            <div className="space-y-2"><Label>Reference</Label><Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="HAND-2026-..." /></div>
            <div className="space-y-2 sm:col-span-2"><Label>নোট (optional)</Label><Input value={handoverNote} onChange={(event) => setHandoverNote(event.target.value)} /></div>
          </div>
          <DialogFooter><Button onClick={handleCreateHandover} disabled={createHandover.isPending || !toUserId || Number(handoverAmount) <= 0 || !reference.trim()}>{createHandover.isPending ? "জমা হচ্ছে..." : "Handover submit করুন"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}