import { useEffect, useMemo, useState } from "react"
import {
  getListDrawsQueryKey,
  getListCycleMembersQueryKey,
  getListCyclesQueryKey,
  useCreateDraw,
  useGetCurrentUser,
  useListCycleMembers,
  useListCycles,
  useListDraws,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatCurrency, formatDate } from "@/lib/utils"
import { toast } from "sonner"
import { Trophy } from "lucide-react"

const today = () => new Date().toISOString().slice(0, 10)

export default function DrawsPage() {
  return <DrawSurface readOnly={false} />
}

export function DrawHistoryPage() {
  return <DrawSurface readOnly />
}

function DrawSurface({ readOnly }: { readOnly: boolean }) {
  const queryClient = useQueryClient()
  const { data: user } = useGetCurrentUser()
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
  const selectedCycle = cycles?.find((cycle) => cycle.id === cycleId) ?? cycles?.[0]

  useEffect(() => {
    if (!cycleId && cycles?.[0]) setCycleId(cycles[0].id)
  }, [cycles, cycleId])

  const handleRecord = () => {
    if (!selectedCycle || !form.winnerMemberId || !form.winningAmount) return toast.error("চক্র, বিজয়ী ও জয়ের পরিমাণ নির্বাচন করুন")
    createDraw.mutate({ data: { cycleId: selectedCycle.id, drawDate: form.drawDate, winnerMemberId: Number(form.winnerMemberId), winningAmount: Number(form.winningAmount), notes: form.notes || undefined } }, {
      onSuccess: () => {
        toast.success("শুক্রবারের ড্র সংরক্ষিত হয়েছে")
        setForm({ drawDate: today(), winnerMemberId: "", winningAmount: "", notes: "" })
        queryClient.invalidateQueries({ queryKey: getListDrawsQueryKey() })
        queryClient.invalidateQueries({ queryKey: getListCycleMembersQueryKey(selectedCycle.id) })
      },
      onError: (error: any) => toast.error(error?.message || "ড্র সংরক্ষণ করা যায়নি"),
    })
    return
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
            <div className="space-y-2"><Label>ড্র তারিখ</Label><Input type="date" value={form.drawDate} onChange={(event) => setForm({ ...form, drawDate: event.target.value })} /></div>
            <div className="space-y-2"><Label>বিজয়ী সদস্য</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.winnerMemberId} onChange={(event) => setForm({ ...form, winnerMemberId: event.target.value })}><option value="">সদস্য নির্বাচন করুন</option>{cycleMembers?.map((member) => <option key={member.memberId} value={member.memberId}>{member.memberCode} — {member.name}</option>)}</select></div>
            <div className="space-y-2"><Label>জয়ের পরিমাণ</Label><Input type="number" min={1} value={form.winningAmount} placeholder="৳0" onChange={(event) => setForm({ ...form, winningAmount: event.target.value })} /></div>
            <Button onClick={handleRecord} disabled={createDraw.isPending || !selectedCycle}>ড্র সংরক্ষণ</Button>
            <div className="sm:col-span-2 lg:col-span-5 space-y-2"><Label>নোট (ঐচ্ছিক)</Label><Input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="ড্র সংক্রান্ত নোট" /></div>
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
              <thead className="bg-muted/50"><tr><th className="text-left p-3">তারিখ</th><th className="text-left p-3">চক্র</th><th className="text-left p-3">ড্র নং</th><th className="text-left p-3">বিজয়ী</th><th className="text-right p-3">পরিমাণ</th><th className="text-left p-3">স্ট্যাটাস</th></tr></thead>
              <tbody>
                {isLoading || drawsLoading ? <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">লোড হচ্ছে...</td></tr> : draws?.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">এখনো কোনো ড্র রেকর্ড নেই</td></tr> : draws?.map((draw) => <tr key={draw.id} className="border-t"><td className="p-3">{formatDate(draw.drawDate)}</td><td className="p-3">{draw.cycleName || `Cycle #${draw.cycleNumber}`}</td><td className="p-3">#{draw.drawNumber}</td><td className="p-3"><div className="font-medium">{draw.winnerName}</div><div className="text-xs text-muted-foreground">{draw.winnerMemberCode}</div></td><td className="p-3 text-right font-bold text-primary">{formatCurrency(draw.winningAmount)}</td><td className="p-3">{draw.status}</td></tr>)}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}