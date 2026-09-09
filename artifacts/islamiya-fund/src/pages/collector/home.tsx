import { useState, useMemo, useRef, useEffect } from "react"
import { useListMembers, useGetDashboard, useCreatePayment, useListCycles, useListCycleMembers, getGetCurrentUserQueryKey, getGetDashboardQueryKey, getListPaymentsQueryKey, getListMembersQueryKey, getListCycleMembersQueryKey, getGetTanQueryKey, useGetTan, getListCollectorTargetsQueryKey, useListCollectorTargets } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { toast } from "sonner"
import { formatCurrency } from "@/lib/utils"
import { Search, UserCheck, CheckCircle2, AlertCircle } from "lucide-react"
import { useSync } from "@/contexts/sync-context"
import { ReceiptDialog, ReceiptRef } from "@/components/receipt"

export default function CollectorHome() {
  const [search, setSearch] = useState("")
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null)
  const [amount, setAmount] = useState<string>("")
  const [notes, setNotes] = useState("")
  const [confirmDialog, setConfirmDialog] = useState(false)
  const [isDuplicateConfirm, setIsDuplicateConfirm] = useState(false)
  
  const { data: members, isLoading, refetch } = useListMembers({ search: search.length > 2 ? search : undefined })
  const { data: cycles } = useListCycles()
  const activeCycle = cycles?.find((cycle) => cycle.status === "ACTIVE") ?? cycles?.[0]
  const { data: tanData } = useGetTan((activeCycle?.id ?? 0) as number, {
    query: { enabled: Boolean(activeCycle?.id), queryKey: getGetTanQueryKey((activeCycle?.id ?? 0) as number) },
  })
  const { data: cycleMembers, isLoading: isCycleMembersLoading } = useListCycleMembers((activeCycle?.id ?? 0) as number, { query: { enabled: Boolean(activeCycle?.id), queryKey: getListCycleMembersQueryKey((activeCycle?.id ?? 0) as number) } })
  const { data: dashboard, refetch: refetchDashboard } = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey(), refetchInterval: 15000 } })
  const { data: collectorTargets } = useListCollectorTargets({ query: { queryKey: getListCollectorTargetsQueryKey(), refetchInterval: 15000 } })
  
  const { isOnline, addToQueue } = useSync()
  const createPayment = useCreatePayment()
  const queryClient = useQueryClient()
  const receiptRef = useRef<ReceiptRef>(null)

  // Find selected member
  const cycleMemberOptions = useMemo(() => cycleMembers?.map((member) => ({
    id: member.memberId,
    memberId: member.memberCode,
    name: member.name,
    mobile: member.mobile,
    dailyAmount: member.dailyContribution,
    todayPaid: Math.max(0, member.dailyContribution - member.todayDue),
    currentPeriodDue: member.currentPeriodDue ?? member.todayDue,
    previousDue: member.previousDue ?? 0,
    totalDue: (member.previousDue ?? 0) + (member.currentPeriodDue ?? member.todayDue),
  })), [cycleMembers])
  const memberOptions = activeCycle ? cycleMemberOptions : members
  const visibleMembers = useMemo(() => memberOptions?.filter((member) => {
    if (!search.trim()) return true
    const term = search.toLowerCase()
    return member.name.toLowerCase().includes(term) || member.memberId.toLowerCase().includes(term) || (member.mobile ?? "").toLowerCase().includes(term)
  }), [memberOptions, search])
  const selectedMember = useMemo(() => memberOptions?.find(m => m.id === selectedMemberId), [memberOptions, selectedMemberId])
  const weeklyTarget = collectorTargets?.[0]
  const membersLoading = activeCycle ? isCycleMembersLoading : isLoading

  useEffect(() => {
    const onSynced = (event: Event) => {
      const result = (event as CustomEvent<{ result?: any }>).detail?.result
      if (!result) return
      receiptRef.current?.show({
        receiptId: result.receiptId,
        memberName: result.memberName || selectedMember?.name || "Member",
        memberId: selectedMember?.memberId || String(result.memberId),
        amount: result.amount,
        date: result.createdAt,
        collectorName: result.collectorName || "Collector",
        status: "COMPLETED",
      })
      toast.success(`অফলাইন রসিদ ${result.receiptId} server-এ মিলেছে`)
    }
    window.addEventListener("islamiya:offline-payment-synced", onSynced)
    return () => window.removeEventListener("islamiya:offline-payment-synced", onSynced)
  }, [selectedMember])

  const handleSelect = (id: number) => {
    setSelectedMemberId(id)
    const member = memberOptions?.find(m => m.id === id)
    if (member) {
      const totalDue = member.totalDue ?? ((member.previousDue ?? 0) + (member.currentPeriodDue ?? 0))
      setAmount((totalDue > 0 ? totalDue : member.dailyAmount ?? 0).toString())
      if (member.todayPaid > 0) {
        setIsDuplicateConfirm(true)
      } else {
        setIsDuplicateConfirm(false)
      }
    }
    setNotes("")
    setSearch("")
  }

  const handleCollect = async () => {
    if (!selectedMember) return
    const numAmount = Number(amount)
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.error("সঠিক পরিমাণ দিন (Enter valid amount)")
      return
    }

    const payload = {
      memberId: selectedMember.id,
      cycleId: activeCycle?.id,
      amount: numAmount,
      notes: notes || undefined,
      verificationMethod: "COLLECTOR_CONFIRMATION" as const,
      confirmDuplicate: isDuplicateConfirm,
      idempotencyKey: crypto.randomUUID()
    };

    const userState = queryClient.getQueryData<any>(getGetCurrentUserQueryKey());
    if (!isOnline) {
      addToQueue({ type: 'PAYMENT', payload, id: payload.idempotencyKey });
      toast.success("অফলাইনে নিরাপদে রাখা হয়েছে; সংযোগ ফিরলে সিঙ্ক হবে (Queued safely)");
      receiptRef.current?.show({
        receiptId: `OFF-${payload.idempotencyKey.substring(0,6).toUpperCase()}`,
        memberName: selectedMember.name, memberId: selectedMember.memberId, amount: numAmount,
        date: new Date().toISOString(), collectorName: userState?.name || "Collector", status: 'PENDING'
      });
    } else {
      try {
        const result = await createPayment.mutateAsync({ data: payload });
        toast.success("পেমেন্ট সেভ হয়েছে (Payment Recorded)");
        receiptRef.current?.show({
          receiptId: result.receiptId, memberName: selectedMember.name, memberId: selectedMember.memberId,
          amount: result.amount, date: result.createdAt, collectorName: result.collectorName || userState?.name || "Collector",
          status: 'COMPLETED'
        });
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListMembersQueryKey() });
        if (activeCycle?.id) queryClient.invalidateQueries({ queryKey: getListCycleMembersQueryKey(activeCycle.id) });
      } catch (error: any) {
        toast.error(error?.message || "পেমেন্ট সেভ করা যায়নি (Payment failed)");
        return;
      }
    }
    setConfirmDialog(false);
    setSelectedMemberId(null);
    setAmount("");
    setNotes("");

  }

  return (
    <div className="space-y-4 max-w-md mx-auto">
      <ReceiptDialog ref={receiptRef} />
      {dashboard?.isFridayClosingDay && (
        <Card className="border-2 border-red-500 bg-red-50 text-red-950 shadow-sm" role="alert">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-6 w-6 shrink-0 text-red-600" />
              <div className="space-y-1">
                <p className="text-base font-extrabold tracking-wide text-red-700">🔴 FRIDAY COLLECTION CLOSING</p>
                <p className="font-semibold">আজকের মধ্যে সকল সম্ভব collection complete করুন।</p>
                <p className="text-sm">Friday is the Collection Closing &amp; Draw Day.</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs font-semibold">
              <div className="rounded-md bg-red-100 p-2 text-red-800">
                <div>🔴 Outstanding Members</div>
                <div className="mt-1 text-lg">{dashboard.dueMembers.length}</div>
              </div>
              <div className="rounded-md bg-red-100 p-2 text-red-800">
                <div>🔴 Previous Due</div>
                <div className="mt-1 text-lg">{formatCurrency(dashboard.previousDue)}</div>
              </div>
              <div className="rounded-md bg-red-100 p-2 text-red-800">
                <div>🔴 Total Due</div>
                <div className="mt-1 text-lg">{formatCurrency(dashboard.totalDue)}</div>
              </div>
            </div>
            <p className="mt-3 text-sm font-semibold text-red-800">
              Current Collection Due: {formatCurrency(dashboard.currentCollectionDue)}
            </p>
          </CardContent>
        </Card>
      )}
      {tanData?.tan && (
        <Card className={tanData.activePeriod ? "border-primary/30 bg-primary/5" : "border-amber-300 bg-amber-50"}>
          <CardContent className="p-3">
            <p className="text-sm font-semibold">{tanData.activePeriod ? "TAN collection period open" : tanData.nextPeriod ? "TAN collection period এখনো শুরু হয়নি" : "TAN সম্পূর্ণ হয়েছে"}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {tanData.activePeriod
                ? `Period ${tanData.activePeriod.sequenceNo}/${tanData.tan.totalDrawDates}: ${tanData.activePeriod.periodStart} – ${tanData.activePeriod.periodEnd}; Friday draw ${tanData.activePeriod.recordedDraws}/${tanData.tan.drawsPerWeek}`
                : tanData.nextPeriod
                  ? `পরবর্তী period ${tanData.nextPeriod.sequenceNo} শুরু হবে ${tanData.nextPeriod.periodStart}`
                  : "নতুন TAN lock না হওয়া পর্যন্ত collection বন্ধ"}
            </p>
          </CardContent>
        </Card>
      )}
      {weeklyTarget && (
        <Card className={weeklyTarget.isAchieved ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">সাপ্তাহিক handover target</p>
                <p className="text-xs text-muted-foreground mt-1">{weeklyTarget.periodStart} – {weeklyTarget.periodEnd}</p>
              </div>
              <span className={weeklyTarget.isAchieved ? "text-xs font-bold text-green-700" : "text-xs font-bold text-amber-800"}>
                {weeklyTarget.isAchieved ? "Target achieved" : "In progress"}
              </span>
            </div>
            {weeklyTarget.targetAmount > 0 ? (
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-md bg-background/70 p-2"><div className="font-bold">{formatCurrency(weeklyTarget.targetAmount)}</div><div className="text-muted-foreground">Target</div></div>
                <div className="rounded-md bg-background/70 p-2"><div className="font-bold">{formatCurrency(weeklyTarget.acceptedAmount)}</div><div className="text-muted-foreground">Accepted</div></div>
                <div className="rounded-md bg-background/70 p-2"><div className="font-bold">{formatCurrency(weeklyTarget.remainingAmount)}</div><div className="text-muted-foreground">Remaining</div></div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Owner এখনো এই সপ্তাহের target সেট করেননি।</p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">এটি শুধু cash handover-এর লক্ষ্য; যেকোনো member-এর payment entry আপনি আগের মতোই করতে পারবেন।</p>
          </CardContent>
        </Card>
      )}
      
      {/* Collector Stats Snippet */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Card className="bg-muted border-none">
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <span className="text-xs text-muted-foreground">আজকের লক্ষ্য</span>
            <span className="text-xl font-bold mt-1">{formatCurrency(dashboard?.todayTarget || 0)}</span>
          </CardContent>
        </Card>
        <Card className="bg-primary text-primary-foreground border-none">
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <span className="text-xs opacity-80">আজকের সংগ্রহ</span>
            <span className="text-xl font-bold mt-1">
              {formatCurrency(dashboard?.performances?.[0]?.collected || 0)}
            </span>
          </CardContent>
        </Card>
        <Card className="bg-secondary text-secondary-foreground border-none">
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <span className="text-xs opacity-80">নগদ ব্যালেন্স</span>
            <span className="text-xl font-bold mt-1">
              {formatCurrency(dashboard?.collectorCash || 0)}
            </span>
          </CardContent>
        </Card>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <span className="text-xs text-destructive">Current Collection</span>
            <span className="text-xl font-bold mt-1 text-destructive">{formatCurrency(dashboard?.currentCollectionDue ?? dashboard?.due ?? 0)}</span>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <span className="text-xs text-amber-800">আগের বকেয়া</span>
            <span className="text-xl font-bold mt-1 text-amber-900">{formatCurrency(dashboard?.previousDue || 0)}</span>
          </CardContent>
        </Card>
        <Card className="bg-destructive/5 border-destructive/20">
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <span className="text-xs text-destructive">TOTAL DUE</span>
            <span className="text-xl font-bold mt-1 text-destructive">{formatCurrency(dashboard?.totalDue || 0)}</span>
          </CardContent>
        </Card>
      </div>
      {activeCycle && <div className={`rounded-lg border px-4 py-3 text-sm ${dashboard?.trackingReady ? "border-primary/20 bg-primary/5" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold">{activeCycle.name}</span>
          <span className="text-xs font-semibold text-muted-foreground">Current Draw-Date</span>
        </div>
        <span className="text-muted-foreground"> · ৳{activeCycle.dailyPerShare}/শেয়ার/দিন · শুক্রবার ড্র</span>
        {dashboard?.currentDrawDate && <p className="mt-1 font-medium">Draw-Date: {dashboard.currentPeriodStart} → {dashboard.currentPeriodEnd} · Draw {dashboard.currentDrawDate}</p>}
        {dashboard?.isFridayClosingDay && <p className="mt-1 font-bold text-red-700">আজ শুক্রবার — Collection Closing Day এবং Draw Day।</p>}
        {dashboard?.isSaturdayOpeningDay && <p className="mt-1 font-medium text-primary">নতুন Saturday–Friday Draw-Date automatically OPEN হয়েছে।</p>}
        {!dashboard?.trackingReady && <p className="mt-1 font-medium">Owner এখনো digital collection শুরুর তারিখ নিশ্চিত করেননি; collection বন্ধ আছে।</p>}
      </div>}

      {!selectedMemberId ? (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
            <Input 
              placeholder="নাম বা আইডি দিয়ে খুঁজুন (Search Name/ID)..." 
              className="pl-10 h-12 text-lg rounded-xl"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="space-y-2 mt-4">
            <p className="text-sm font-medium text-muted-foreground px-1">
              {search.length > 0 ? "ফলাফল (Results)" : "সাম্প্রতিক বকেয়া (Recent Due)"}
            </p>
            {membersLoading ? (
              <div className="text-center py-8 text-muted-foreground">অপেক্ষা করুন...</div>
            ) : memberOptions?.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">কোন সদস্য পাওয়া যায়নি</div>
            ) : (
              visibleMembers?.slice(0, 10).map((member) => {
                const previousDue = member.previousDue ?? 0
                const currentPeriodDue = member.currentPeriodDue ?? 0
                const totalDue = member.totalDue ?? previousDue + currentPeriodDue
                return (
                  <Card
                    key={member.id}
                    className={`cursor-pointer transition-colors active:scale-[0.98] ${member.todayPaid > 0 ? 'opacity-70 bg-muted/50' : 'hover:border-primary'}`}
                    onClick={() => handleSelect(member.id)}
                  >
                    <CardContent className="p-4 flex justify-between items-center">
                      <div>
                        <div className="font-bold text-base flex items-center gap-2">
                          {member.name}
                          {member.todayPaid > 0 && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                        </div>
                        <div className="text-sm text-muted-foreground">ID: {member.memberId}{member.mobile ? ` · ${member.mobile}` : ""}</div>
                        <div className="mt-2 flex flex-wrap gap-1 text-[11px] font-semibold">
                          {previousDue > 0 && <span className="rounded bg-red-100 px-2 py-0.5 text-red-700">🔴 Previous Due</span>}
                          {currentPeriodDue > 0 && <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800">Current Due</span>}
                        </div>
                      </div>
                      <div className="text-right">
                         <div className="text-primary font-bold">{formatCurrency(totalDue || member.dailyAmount || 0)}</div>
                         <div className="text-xs text-muted-foreground">Total Due</div>
                         <div className="mt-1 text-[11px] text-muted-foreground">P {formatCurrency(previousDue)} · C {formatCurrency(currentPeriodDue)}</div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
          <Button variant="ghost" className="mb-2" onClick={() => setSelectedMemberId(null)}>
            ← ফিরে যান (Back)
          </Button>
          
          <Card className="border-2 border-primary/20">
            <CardContent className="p-6 space-y-6">
              <div className="text-center space-y-1">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-2 text-primary">
                  <UserCheck className="w-8 h-8" />
                </div>
                <h2 className="text-2xl font-bold">{selectedMember?.name}</h2>
                <p className="text-muted-foreground font-mono">ID: {selectedMember?.memberId}</p>
                {selectedMember?.todayPaid ? (
                  <span className="inline-flex items-center gap-1 bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full mt-2 font-medium">
                    <CheckCircle2 className="w-3 h-3" /> ইতিমধ্যে পেমেন্ট করেছে
                  </span>
                ) : null}
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-3 text-center text-sm">
                  <div><div className="font-semibold">{formatCurrency(selectedMember?.previousDue ?? 0)}</div><div className="text-xs text-muted-foreground">আগের বকেয়া</div></div>
                  <div><div className="font-semibold">{formatCurrency(selectedMember?.currentPeriodDue ?? selectedMember?.dailyAmount ?? 0)}</div><div className="text-xs text-muted-foreground">Current collection</div></div>
                  <div><div className="font-semibold text-destructive">{formatCurrency(selectedMember?.totalDue ?? selectedMember?.dailyAmount ?? 0)}</div><div className="text-xs text-muted-foreground">মোট due</div></div>
                </div>
                <div className="space-y-2">
                  <Label className="text-lg">টাকার পরিমাণ (Amount)</Label>
                  <Input 
                    type="number" 
                    value={amount} 
                    onChange={(e) => setAmount(e.target.value)}
                    className="h-16 text-3xl font-bold text-center tracking-wider"
                  />
                  <div className="flex gap-2 justify-center mt-2">
                    {[50, 100, 200, 500].map(val => (
                      <Button 
                        key={val} 
                        variant="outline" 
                        size="sm" 
                        className="flex-1"
                        onClick={() => setAmount(val.toString())}
                      >
                        +{val}
                      </Button>
                    ))}
                  </div>
                    <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="নোট (ঐচ্ছিক)" className="mt-3" />
                </div>

                <Button 
                  className="w-full h-14 text-lg font-bold shadow-lg" 
                  onClick={() => setConfirmDialog(true)}
                  disabled={!dashboard?.trackingReady}
                >
                  সংগ্রহ করুন (Collect)
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Confirmation Dialog */}
      <Dialog open={confirmDialog} onOpenChange={setConfirmDialog}>
        <DialogContent className="w-[90vw] max-w-md rounded-xl p-6">
          <DialogHeader>
            <DialogTitle className="text-xl text-center">নিশ্চিত করুন (Confirm)</DialogTitle>
          </DialogHeader>
          <div className="py-6 space-y-6 text-center">
            <div>
              <p className="text-sm text-muted-foreground">সদস্যের নাম</p>
              <p className="text-xl font-bold">{selectedMember?.name}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">পরিমাণ</p>
              <p className="text-4xl font-bold text-primary">{formatCurrency(Number(amount))}</p>
            </div>
            
            {isDuplicateConfirm && (
              <div className="bg-destructive/10 p-3 rounded-lg border border-destructive/20 text-destructive text-sm font-medium">
                সতর্কতা: এই সদস্য আজ ইতিমধ্যে পেমেন্ট করেছে!
              </div>
            )}

            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-left">
              এই paymentটি Collector confirmation হিসেবে সংরক্ষিত হবে। PIN verification এখনো সক্রিয় করা হয়নি।
            </div>
          </div>
          <DialogFooter className="flex-row gap-3 sm:justify-between">
            <Button variant="outline" className="flex-1 h-12" onClick={() => setConfirmDialog(false)}>
              বাতিল (Cancel)
            </Button>
            <Button 
              className="flex-1 h-12" 
              onClick={handleCollect}
            >
              নিশ্চিত (Confirm)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}