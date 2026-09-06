import { useEffect, useMemo, useState } from "react"
import {
  getListCycleMembersQueryKey,
  getListCyclesQueryKey,
  useCreateCycle,
  useGetCurrentUser,
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
import { formatCurrency, formatDate } from "@/lib/utils"
import { toast } from "sonner"
import { CheckCircle2, Plus, Users } from "lucide-react"

const today = () => new Date().toISOString().slice(0, 10)

export default function CyclesPage() {
  const queryClient = useQueryClient()
  const { data: user } = useGetCurrentUser()
  const { data: cycles, isLoading } = useListCycles({ query: { queryKey: getListCyclesQueryKey() } })
  const { data: members } = useListMembers()
  const [selectedCycleId, setSelectedCycleId] = useState<number | null>(null)
  const [newCycle, setNewCycle] = useState({ name: "", startDate: today(), dailyPerShare: 100 })
  const [participant, setParticipant] = useState({ memberId: "", shares: 1 })
  const createCycle = useCreateCycle()
  const updateCycle = useUpdateCycle()
  const upsertMember = useUpsertCycleMember()
  const selectedCycle = cycles?.find((cycle) => cycle.id === selectedCycleId) ?? cycles?.[0]
  const activeId = selectedCycle?.id ?? null
  const { data: cycleMembers, isLoading: membersLoading } = useListCycleMembers((activeId ?? 0) as number, {
    query: { enabled: Boolean(activeId), queryKey: getListCycleMembersQueryKey((activeId ?? 0) as number) },
  })

  useEffect(() => {
    if (!selectedCycleId && cycles?.[0]) setSelectedCycleId(cycles[0].id)
  }, [cycles, selectedCycleId])

  const availableMembers = useMemo(() => {
    const enrolled = new Set((cycleMembers ?? []).map((member) => member.memberId))
    return (members ?? []).filter((member) => !enrolled.has(member.id) && member.status === "active")
  }, [cycleMembers, members])

  const handleCreate = () => {
    if (!newCycle.name.trim()) return toast.error("চক্রের নাম দিন")
    createCycle.mutate({ data: newCycle }, {
      onSuccess: (created) => {
        toast.success("নতুন চক্র তৈরি হয়েছে")
        setNewCycle({ name: "", startDate: today(), dailyPerShare: 100 })
        setSelectedCycleId(created.id)
        queryClient.invalidateQueries({ queryKey: getListCyclesQueryKey() })
      },
      onError: (error: any) => toast.error(error?.message || "চক্র তৈরি করা যায়নি"),
    })
    return
  }

  const handleAddParticipant = () => {
    if (!activeId || !participant.memberId) return toast.error("সদস্য নির্বাচন করুন")
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">ফান্ড চক্র <span className="text-muted-foreground text-lg font-normal ml-2">Fund Cycles</span></h1>
        <p className="text-muted-foreground">প্রতিটি চক্রের সদস্য, শেয়ার ও সংগ্রহ আলাদা থাকে</p>
      </div>

      {user?.role === "OWNER" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Plus className="w-5 h-5" /> নতুন চক্র তৈরি করুন</CardTitle>
            <CardDescription>ডিফল্ট নিয়ম: প্রতি শেয়ারে প্রতিদিন ৳100, শুক্রবার সাপ্তাহিক ড্র</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-[1fr_180px_160px_auto] items-end">
            <div className="space-y-2"><Label>চক্রের নাম/নম্বর</Label><Input value={newCycle.name} placeholder="Cycle #01" onChange={(event) => setNewCycle({ ...newCycle, name: event.target.value })} /></div>
            <div className="space-y-2"><Label>শুরুর তারিখ</Label><Input type="date" value={newCycle.startDate} onChange={(event) => setNewCycle({ ...newCycle, startDate: event.target.value })} /></div>
            <div className="space-y-2"><Label>৳/শেয়ার/দিন</Label><Input type="number" min={1} value={newCycle.dailyPerShare} onChange={(event) => setNewCycle({ ...newCycle, dailyPerShare: Number(event.target.value) })} /></div>
            <Button onClick={handleCreate} disabled={createCycle.isPending}>চক্র তৈরি</Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader><CardTitle>চক্র তালিকা</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? <p className="text-sm text-muted-foreground">লোড হচ্ছে...</p> : cycles?.length === 0 ? <p className="text-sm text-muted-foreground">এখনো কোনো চক্র নেই। Owner নতুন চক্র তৈরি করুন।</p> : cycles?.map((cycle) => (
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
                  <CardDescription>চক্র #{selectedCycle.cycleNumber} · শুরু {formatDate(selectedCycle.startDate)} · শুক্রবার ড্র</CardDescription>
                </div>
                {user?.role === "OWNER" && selectedCycle.status === "ACTIVE" && <Button variant="outline" onClick={completeCycle} disabled={updateCycle.isPending}>চক্র সম্পন্ন করুন</Button>}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {user?.role === "OWNER" && selectedCycle.status === "ACTIVE" && (
                <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                  <p className="font-semibold">চক্রে সদস্য যোগ করুন</p>
                  <div className="grid gap-3 sm:grid-cols-[1fr_130px_auto] items-end">
                    <div className="space-y-2"><Label>সদস্য</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={participant.memberId} onChange={(event) => setParticipant({ ...participant, memberId: event.target.value })}><option value="">সদস্য নির্বাচন করুন</option>{availableMembers.map((member) => <option key={member.id} value={member.id}>{member.memberId} — {member.name}</option>)}</select></div>
                    <div className="space-y-2"><Label>শেয়ার</Label><Input type="number" min={1} value={participant.shares} onChange={(event) => setParticipant({ ...participant, shares: Number(event.target.value) })} /></div>
                    <Button onClick={handleAddParticipant} disabled={upsertMember.isPending}>যোগ করুন</Button>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Users className="w-4 h-4" /> {cycleMembers?.length ?? 0} জন অংশগ্রহণকারী</div>
              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50"><tr><th className="text-left p-3">সদস্য</th><th className="text-right p-3">শেয়ার</th><th className="text-right p-3">দৈনিক জমা</th><th className="text-right p-3">মোট সংগ্রহ</th><th className="text-right p-3">আজকের বাকি</th></tr></thead>
                  <tbody>
                    {membersLoading ? <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">লোড হচ্ছে...</td></tr> : cycleMembers?.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">এই চক্রে কোনো সদস্য নেই</td></tr> : cycleMembers?.map((member) => (
                      <tr key={member.id} className="border-t"><td className="p-3"><div className="font-medium">{member.name}</div><div className="text-xs text-muted-foreground">{member.memberCode}</div></td><td className="p-3 text-right">{member.shares}</td><td className="p-3 text-right">{formatCurrency(member.dailyContribution)}</td><td className="p-3 text-right">{formatCurrency(member.totalCollected)}</td><td className="p-3 text-right font-medium text-destructive">{formatCurrency(member.todayDue)}</td></tr>
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