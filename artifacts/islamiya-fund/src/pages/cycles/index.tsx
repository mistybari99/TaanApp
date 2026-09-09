import { useEffect, useMemo, useState } from "react"
import {
  getListCycleMembersQueryKey,
  getListCyclesQueryKey,
  useGetCurrentUser,
  useCreateCycle,
  getGetTanQueryKey,
  useGetTan,
  useLockTan,
  usePauseTan,
  useResumeTan,
  useListCycleMembers,
  useListCycles,
  useListMembers,
  useUpdateCycle,
  useUpsertCycleMember,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { businessDate, formatCurrency, formatDate } from "@/lib/utils"
import { toast } from "sonner"
import { CheckCircle2, LockKeyhole, Users } from "lucide-react"

const today = businessDate

export default function CyclesPage() {
  const queryClient = useQueryClient()
  const { data: user } = useGetCurrentUser()
  const { data: cycles, isLoading } = useListCycles({ query: { queryKey: getListCyclesQueryKey() } })
  const { data: members } = useListMembers()
  const [selectedCycleId, setSelectedCycleId] = useState<number | null>(null)
  const [participant, setParticipant] = useState({ memberId: "", shares: 1 })
  const [trackingStartDate, setTrackingStartDate] = useState("")
  const [tanStartDate, setTanStartDate] = useState("")
  const [drawsPerWeek, setDrawsPerWeek] = useState(4)
  const [tanActionReason, setTanActionReason] = useState("")
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newCycle, setNewCycle] = useState({ name: "", startDate: today(), trackingStartDate: "", dailyPerShare: 100 })
  const [shareDrafts, setShareDrafts] = useState<Record<number, number>>({})
  const updateCycle = useUpdateCycle()
  const createCycle = useCreateCycle()
  const upsertMember = useUpsertCycleMember()
  const lockTan = useLockTan()
  const pauseTan = usePauseTan()
  const resumeTan = useResumeTan()
  const selectedCycle = cycles?.find((cycle) => cycle.id === selectedCycleId) ?? cycles?.[0]
  const activeId = selectedCycle?.id ?? null
  const { data: tanData } = useGetTan((activeId ?? 0) as number, {
    query: { enabled: Boolean(activeId), queryKey: getGetTanQueryKey((activeId ?? 0) as number) },
  })
  const { data: cycleMembers, isLoading: membersLoading } = useListCycleMembers((activeId ?? 0) as number, {
    query: { enabled: Boolean(activeId), queryKey: getListCycleMembersQueryKey((activeId ?? 0) as number) },
  })

  useEffect(() => {
    if (!selectedCycleId && cycles?.[0]) setSelectedCycleId(cycles[0].id)
  }, [cycles, selectedCycleId])

  useEffect(() => {
    setTrackingStartDate(selectedCycle?.trackingStartDate ?? "")
  }, [selectedCycle?.id, selectedCycle?.trackingStartDate])

  useEffect(() => {
    if (cycleMembers) setShareDrafts(Object.fromEntries(cycleMembers.map((member) => [member.memberId, member.shares])))
  }, [cycleMembers])

  const availableMembers = useMemo(() => {
    const enrolled = new Set((cycleMembers ?? []).map((member) => member.memberId))
    return (members ?? []).filter((member) => !enrolled.has(member.id) && member.status === "active")
  }, [cycleMembers, members])

  const handleLockTan = () => {
    if (!activeId || !tanStartDate) {
      toast.error("শনিবারের TAN শুরুর তারিখ দিন")
      return
    }
    lockTan.mutate({ id: activeId, data: { tanStartDate, drawsPerWeek } }, {
      onSuccess: () => {
        toast.success("TAN schedule lock হয়েছে")
        queryClient.invalidateQueries({ queryKey: getGetTanQueryKey(activeId) })
        queryClient.invalidateQueries({ queryKey: getListCyclesQueryKey() })
      },
      onError: (error: any) => toast.error(error?.message || "TAN schedule lock করা যায়নি"),
    })
  }

  const refreshTan = () => {
    if (!activeId) return
    queryClient.invalidateQueries({ queryKey: getGetTanQueryKey(activeId) })
    queryClient.invalidateQueries({ queryKey: getListCycleMembersQueryKey(activeId) })
    queryClient.invalidateQueries({ queryKey: getListCyclesQueryKey() })
  }

  const handlePauseTan = () => {
    if (!activeId) return
    pauseTan.mutate({ id: activeId, data: { reason: tanActionReason.trim() || undefined } }, {
      onSuccess: () => {
        toast.success("TAN pause হয়েছে; বর্তমান period-এর payment একই period-এ থাকবে")
        setTanActionReason("")
        refreshTan()
      },
      onError: (error: any) => toast.error(error?.message || "TAN pause করা যায়নি"),
    })
  }

  const handleResumeTan = () => {
    if (!activeId) return
    resumeTan.mutate({ id: activeId, data: { reason: tanActionReason.trim() || undefined } }, {
      onSuccess: (result) => {
        toast.success(`TAN resume হয়েছে; ${result.daysShifted ?? 0} দিনের schedule পিছিয়েছে`)
        setTanActionReason("")
        refreshTan()
      },
      onError: (error: any) => toast.error(error?.message || "TAN resume করা যায়নি"),
    })
  }

  const handleAddParticipant = () => {
    if (!activeId || !participant.memberId || tanData?.tan) return toast.error("TAN lock হওয়ার পরে সরাসরি সদস্য যোগ করা যায় না")
    upsertMember.mutate({ id: activeId, data: { memberId: Number(participant.memberId), shares: Number(participant.shares) } }, {
      onSuccess: () => {
        toast.success("চক্রে সদস্য যোগ হয়েছে")
        setParticipant({ memberId: "", shares: 1 })
        queryClient.invalidateQueries({ queryKey: getListCycleMembersQueryKey(activeId) })
        queryClient.invalidateQueries({ queryKey: getListCyclesQueryKey() })
      },
      onError: (error: any) => toast.error(error?.message || "সদস্য যোগ করা যায়নি"),
    })
    return
  }

  const completeCycle = () => {
    if (!selectedCycle) return
    updateCycle.mutate({ id: selectedCycle.id, data: { status: "COMPLETED", endDate: today() } }, {
      onSuccess: () => {
        toast.success("চক্রটি সম্পন্ন হিসেবে সংরক্ষিত হয়েছে")
        queryClient.invalidateQueries({ queryKey: getListCyclesQueryKey() })
      },
      onError: (error: any) => toast.error(error?.message || "চক্র আপডেট করা যায়নি"),
    })
  }

  const saveTrackingStart = () => {
    if (!selectedCycle || !trackingStartDate) return toast.error("ডিজিটাল tracking শুরুর তারিখ দিন")
    return updateCycle.mutate({ id: selectedCycle.id, data: { trackingStartDate } }, {
      onSuccess: () => {
        toast.success("ডিজিটাল tracking শুরুর তারিখ সংরক্ষণ হয়েছে")
        queryClient.invalidateQueries({ queryKey: getListCyclesQueryKey() })
      },
      onError: (error: any) => toast.error(error?.message || "তারিখ সংরক্ষণ করা যায়নি"),
    })
  }

  const handleCreateCycle = () => {
    if (!newCycle.name.trim() || !newCycle.startDate || !newCycle.trackingStartDate || Number(newCycle.dailyPerShare) <= 0) {
      toast.error("চক্রের নাম, শুরু, tracking date এবং positive daily amount দিন")
      return
    }
    createCycle.mutate({
      data: {
        name: newCycle.name.trim(),
        startDate: newCycle.startDate,
        trackingStartDate: newCycle.trackingStartDate,
        dailyPerShare: Number(newCycle.dailyPerShare),
        status: "ACTIVE",
      },
    }, {
      onSuccess: () => {
        toast.success("নতুন cycle তৈরি হয়েছে")
        setNewCycle({ name: "", startDate: today(), trackingStartDate: "", dailyPerShare: 100 })
        setIsCreateOpen(false)
        queryClient.invalidateQueries({ queryKey: getListCyclesQueryKey() })
      },
      onError: (error: any) => toast.error(error?.message || "Cycle তৈরি করা যায়নি"),
    })
  }

  const saveShares = (memberId: number) => {
    if (!activeId || tanData?.tan) return toast.error("TAN lock হওয়ার পরে সরাসরি share edit করা যায় না")
    const shares = Number(shareDrafts[memberId])
    if (!Number.isInteger(shares) || shares < 1) return toast.error("শেয়ার ১ বা তার বেশি হতে হবে")
    return upsertMember.mutate({ id: activeId, data: { memberId, shares } }, {
      onSuccess: () => {
        toast.success("এই চক্রের শেয়ার আপডেট হয়েছে")
        queryClient.invalidateQueries({ queryKey: getListCycleMembersQueryKey(activeId) })
        queryClient.invalidateQueries({ queryKey: getListCyclesQueryKey() })
      },
      onError: (error: any) => toast.error(error?.message || "শেয়ার আপডেট করা যায়নি"),
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">ফান্ড চক্র <span className="text-muted-foreground text-lg font-normal ml-2">Fund Cycles</span></h1>
        <p className="text-muted-foreground">প্রতিটি চক্রের সদস্য, শেয়ার ও সংগ্রহ আলাদা থাকে</p>
      </div>

      {user?.role === "OWNER" && isCreateOpen && (
        <Card>
          <CardHeader><CardTitle>নতুন Cycle তৈরি করুন</CardTitle><CardDescription>এখানে কোনো member বা TAN auto-create হবে না।</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label>Cycle name</Label><Input value={newCycle.name} onChange={(event) => setNewCycle({ ...newCycle, name: event.target.value })} placeholder="Cycle #01" /></div>
            <div className="space-y-2"><Label>Start date</Label><Input type="date" value={newCycle.startDate} onChange={(event) => setNewCycle({ ...newCycle, startDate: event.target.value })} /></div>
            <div className="space-y-2"><Label>Digital tracking start</Label><Input type="date" value={newCycle.trackingStartDate} onChange={(event) => setNewCycle({ ...newCycle, trackingStartDate: event.target.value })} /></div>
            <div className="space-y-2"><Label>Daily per share</Label><Input type="number" min={0.01} step="0.01" value={newCycle.dailyPerShare} onChange={(event) => setNewCycle({ ...newCycle, dailyPerShare: Number(event.target.value) })} /></div>
            <div className="flex gap-2 sm:col-span-2"><Button onClick={handleCreateCycle} disabled={createCycle.isPending}>Cycle সংরক্ষণ</Button><Button variant="outline" onClick={() => setIsCreateOpen(false)}>বাতিল</Button></div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader><CardTitle>চক্র তালিকা</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? <p className="text-sm text-muted-foreground">লোড হচ্ছে...</p> : cycles?.length === 0 ? <div className="space-y-3"><p className="text-sm text-muted-foreground">এখনো কোনো চক্র নেই। আগে Member CSV import করুন, তারপর Owner প্রথম cycle তৈরি করুন।</p>{user?.role === "OWNER" && <Button className="w-full" onClick={() => setIsCreateOpen(true)}>প্রথম Cycle তৈরি করুন</Button>}</div> : cycles?.map((cycle) => (
              <button key={cycle.id} onClick={() => setSelectedCycleId(cycle.id)} className={`w-full text-left rounded-lg border p-3 transition-colors ${selectedCycle?.id === cycle.id ? "border-primary bg-primary/5" : "hover:bg-muted/60"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{cycle.name}</span>
                  <span className={`text-xs rounded-full px-2 py-1 ${cycle.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>{cycle.status}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{formatDate(cycle.startDate)} · {cycle.memberCount} সদস্য</p>
              </button>
            ))}
          </CardContent>
        </Card>

        {selectedCycle ? (
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <CardTitle>{selectedCycle.name}</CardTitle>
                    <CardDescription>চক্র #{selectedCycle.cycleNumber} · শুরু {formatDate(selectedCycle.startDate)} · ডিজিটাল tracking {selectedCycle.trackingStartDate ? formatDate(selectedCycle.trackingStartDate) : "এখনো খোলা হয়নি"} · শুক্রবার ড্র</CardDescription>
                </div>
                {user?.role === "OWNER" && selectedCycle.status === "ACTIVE" && <Button variant="outline" onClick={completeCycle} disabled={updateCycle.isPending}>চক্র সম্পন্ন করুন</Button>}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {user?.role === "OWNER" && selectedCycle.status === "ACTIVE" && !tanData?.tan && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <LockKeyhole className="mt-0.5 h-5 w-5 text-primary" />
                    <div>
                      <p className="font-semibold">TAN period ও draw-date lock</p>
                      <p className="text-xs text-muted-foreground">শুরু শনিবার হতে হবে। Lock হলে মোট share, draw/week, payout formula ও 27টি sequential Saturday–Friday period আর edit করা যাবে না।</p>
                    </div>
                  </div>
                  {!tanData?.tan ? (
                    <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto] items-end">
                      <div className="space-y-2"><Label>TAN শুরুর শনিবার</Label><Input type="date" value={tanStartDate} onChange={(event) => setTanStartDate(event.target.value)} /></div>
                      <div className="space-y-2"><Label>প্রতি সপ্তাহে draw</Label><Input type="number" min={1} value={drawsPerWeek} onChange={(event) => setDrawsPerWeek(Number(event.target.value))} /></div>
                      <Button onClick={handleLockTan} disabled={lockTan.isPending || !activeId}><LockKeyhole className="mr-2 h-4 w-4" />TAN lock করুন</Button>
                    </div>
                  ) : (
                    <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 text-sm">
                      <div><p className="text-muted-foreground">মোট share</p><p className="font-bold">{tanData.tan.totalShares}</p></div>
                      <div><p className="text-muted-foreground">Draw/week</p><p className="font-bold">{tanData.tan.drawsPerWeek}</p></div>
                      <div><p className="text-muted-foreground">মোট draw-date</p><p className="font-bold">{tanData.tan.totalDrawDates}</p></div>
                      <div><p className="text-muted-foreground">প্রতি winner</p><p className="font-bold text-primary">{formatCurrency(tanData.tan.perDrawWinnerAmount)}</p></div>
                      <div><p className="text-muted-foreground">বর্তমান period</p><p className="font-bold">{tanData.activePeriod ? `${tanData.activePeriod.sequenceNo}/${tanData.tan.totalDrawDates}` : tanData.nextPeriod ? `পরবর্তী ${tanData.nextPeriod.sequenceNo}` : "শেষ"}</p></div>
                      <div><p className="text-muted-foreground">TAN status</p><p className={`font-bold ${tanData.tan.status === "PAUSED" ? "text-amber-700" : "text-green-700"}`}>{tanData.tan.status === "PAUSED" ? "PAUSED" : tanData.tan.status}</p></div>
                    </div>
                    {tanData.activePeriod && (
                      <p className="text-xs text-muted-foreground">
                        Period {tanData.activePeriod.sequenceNo}: {formatDate(tanData.activePeriod.periodStart)} – {formatDate(tanData.activePeriod.periodEnd)}
                        {tanData.tan.status === "PAUSED"
                          ? " · pause অবস্থায় payment বন্ধ থাকবে; resume হলে একই period-এ payment চলবে"
                          : ""}
                      </p>
                    )}
                    {user?.role === "OWNER" && tanData.tan.status !== "COMPLETED" && (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <div className="flex-1 space-y-2">
                          <Label>Pause/resume reason (optional)</Label>
                          <Input value={tanActionReason} onChange={(event) => setTanActionReason(event.target.value)} placeholder="যেমন: ঈদের ছুটি" />
                        </div>
                        {tanData.tan.status === "PAUSED" ? (
                          <Button variant="outline" onClick={handleResumeTan} disabled={resumeTan.isPending || !activeId}>TAN resume করুন</Button>
                        ) : (
                          <Button variant="outline" onClick={handlePauseTan} disabled={pauseTan.isPending || !activeId}>TAN pause করুন</Button>
                        )}
                      </div>
                    )}
                    </>
                  )}
                </div>
              )}
              {user?.role === "OWNER" && selectedCycle.status === "ACTIVE" && (
                <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div className="space-y-2 flex-1">
                       <Label>ডিজিটাল collection শুরুর তারিখ</Label>
                      <Input type="date" value={trackingStartDate} onChange={(event) => setTrackingStartDate(event.target.value)} />
                      <p className="text-xs text-muted-foreground">এই তারিখের আগে কোনো due বা collection হিসাব হবে না।</p>
                    </div>
                    <Button variant="outline" onClick={saveTrackingStart} disabled={updateCycle.isPending || !trackingStartDate}>তারিখ সংরক্ষণ</Button>
                  </div>
                   {!tanData?.tan && <p className="font-semibold">চক্রে সদস্য যোগ করুন</p>}
                   {!tanData?.tan && <div className="grid gap-3 sm:grid-cols-[1fr_130px_auto] items-end">
                    <div className="space-y-2"><Label>সদস্য</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={participant.memberId} onChange={(event) => setParticipant({ ...participant, memberId: event.target.value })}><option value="">সদস্য নির্বাচন করুন</option>{availableMembers.map((member) => <option key={member.id} value={member.id}>{member.memberId} — {member.name}</option>)}</select></div>
                    <div className="space-y-2"><Label>শেয়ার</Label><Input type="number" min={1} value={participant.shares} onChange={(event) => setParticipant({ ...participant, shares: Number(event.target.value) })} /></div>
                    <Button onClick={handleAddParticipant} disabled={upsertMember.isPending}>যোগ করুন</Button>
                   </div>}
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Users className="w-4 h-4" /> {cycleMembers?.length ?? 0} জন অংশগ্রহণকারী</div>
              <div className="border rounded-lg overflow-x-auto">
                 <table className="w-full text-sm">
                    <thead className="bg-muted/50"><tr><th className="text-left p-3">সদস্য</th><th className="text-right p-3">শেয়ার</th><th className="text-right p-3">দৈনিক জমা</th><th className="text-right p-3">মোট সংগ্রহ</th><th className="text-right p-3">আজকের বাকি</th>{user?.role === "OWNER" && selectedCycle.status === "ACTIVE" && !tanData?.tan && <th className="p-3"></th>}</tr></thead>
                  <tbody>
                     {membersLoading ? <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">লোড হচ্ছে...</td></tr> : cycleMembers?.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">এই চক্রে কোনো সদস্য নেই</td></tr> : cycleMembers?.map((member) => (
                        <tr key={member.id} className="border-t"><td className="p-3"><div className="font-medium">{member.name}</div><div className="text-xs text-muted-foreground">{member.memberCode}</div></td><td className="p-3 text-right">{user?.role === "OWNER" && selectedCycle.status === "ACTIVE" && !tanData?.tan ? <Input type="number" min={1} className="ml-auto w-20 text-right" value={shareDrafts[member.memberId] ?? member.shares} onChange={(event) => setShareDrafts({ ...shareDrafts, [member.memberId]: Number(event.target.value) })} /> : member.shares}</td><td className="p-3 text-right">{formatCurrency(member.dailyContribution)}</td><td className="p-3 text-right">{formatCurrency(member.totalCollected)}</td><td className="p-3 text-right font-medium text-destructive">{formatCurrency(member.todayDue)}</td>{user?.role === "OWNER" && selectedCycle.status === "ACTIVE" && !tanData?.tan && <td className="p-3 text-right"><Button size="sm" variant="outline" onClick={() => saveShares(member.memberId)} disabled={upsertMember.isPending}>Save</Button></td>}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {selectedCycle.status === "COMPLETED" && <p className="flex items-center gap-2 text-sm text-green-700"><CheckCircle2 className="w-4 h-4" /> এই চক্রের সব তথ্য সংরক্ষিত আছে; নতুন চক্রে আলাদা balance শুরু হবে।</p>}
            </CardContent>
          </Card>
        ) : (
          <Card><CardContent className="p-8 text-center text-muted-foreground">কোনো চক্র নির্বাচন করা হয়নি</CardContent></Card>
        )}
      </div>
    </div>
  )
}