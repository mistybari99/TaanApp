import { useEffect, useMemo, useState } from "react"
import { useLocation, Link } from "wouter"
import { getGetMemberHistoryQueryKey, useGetMemberHistory, useListMembers } from "@workspace/api-client-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatCurrency, formatDate } from "@/lib/utils"
import { History, UserRound } from "lucide-react"

export default function MemberHistoryPage() {
  const [location] = useLocation()
  const pathId = Number(location.match(/\/members\/(\d+)\/history/)?.[1] ?? 0)
  const { data: members } = useListMembers()
  const [selectedId, setSelectedId] = useState<number>(pathId)
  const [search, setSearch] = useState("")
  const selectedMember = members?.find((member) => member.id === selectedId)
  const filteredMembers = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return members ?? []
    return (members ?? []).filter((member) => `${member.name} ${member.memberId} ${member.mobile}`.toLowerCase().includes(term))
  }, [members, search])
  const { data: history, isLoading } = useGetMemberHistory(selectedId || 0, { query: { enabled: Boolean(selectedId), queryKey: getGetMemberHistoryQueryKey(selectedId || 0) } })

  useEffect(() => {
    if (!selectedId && members?.[0]) setSelectedId(members[0].id)
  }, [members, selectedId])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">সদস্য ইতিহাস <span className="text-muted-foreground text-lg font-normal ml-2">Member History</span></h1>
        <p className="text-muted-foreground">একজন সদস্যের বর্তমান চক্র, পুরনো চক্র, পেমেন্ট ও ড্র একসঙ্গে দেখুন</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader><CardTitle>সদস্য নির্বাচন</CardTitle><CardDescription>নাম বা Member ID দিয়ে খুঁজুন</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="সদস্য খুঁজুন..." />
            <div className="max-h-[520px] overflow-y-auto space-y-2">
              {filteredMembers.map((member) => <button key={member.id} onClick={() => setSelectedId(member.id)} className={`w-full text-left rounded-lg border p-3 ${selectedId === member.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}><div className="font-medium">{member.name}</div><div className="text-xs text-muted-foreground">{member.memberId} · {member.status}</div></button>)}
              {filteredMembers.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">কোনো সদস্য নেই</p>}
            </div>
          </CardContent>
        </Card>
        <div className="space-y-4">
          {!selectedId ? <Card><CardContent className="p-8 text-center text-muted-foreground">একজন সদস্য নির্বাচন করুন</CardContent></Card> : isLoading || !history ? <Card><CardContent className="p-8 text-center text-muted-foreground">ইতিহাস লোড হচ্ছে...</CardContent></Card> : (
            <>
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><UserRound className="w-5 h-5" /> {history.member.name}</CardTitle><CardDescription>{history.member.memberId} · {history.member.status} · যোগদান {formatDate(history.member.joiningDate)}</CardDescription></CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-4">
                  <div><Label>বর্তমান শেয়ার</Label><p className="text-xl font-bold">{selectedMember?.shares ?? history.member.shares}</p></div>
                  <div><Label>দৈনিক জমা</Label><p className="text-xl font-bold">{formatCurrency(selectedMember?.dailyAmount ?? history.member.dailyAmount)}</p></div>
                  <div><Label>মোট পেমেন্ট</Label><p className="text-xl font-bold text-primary">{formatCurrency(history.payments.filter((payment) => payment.status === "POSTED").reduce((sum, payment) => sum + payment.amount, 0))}</p></div>
                  <div><Label>ড্র জয়</Label><p className="text-xl font-bold">{history.draws.length} বার</p></div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>চক্র ইতিহাস</CardTitle></CardHeader>
                 <CardContent><div className="border rounded-lg overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/50"><tr><th className="text-left p-3">চক্র</th><th className="text-left p-3">সময়কাল</th><th className="text-right p-3">শেয়ার</th><th className="text-right p-3">মোট draw</th><th className="text-right p-3">ব্যবহৃত</th><th className="text-right p-3">বাকি draw</th><th className="text-right p-3">দৈনিক</th><th className="text-right p-3">মোট সংগ্রহ</th></tr></thead><tbody>{history.cycles.length === 0 ? <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">কোনো চক্র ইতিহাস নেই</td></tr> : history.cycles.map((cycle) => <tr key={cycle.cycleId} className="border-t"><td className="p-3">{cycle.name}<div className="text-xs text-muted-foreground">{cycle.status}</div></td><td className="p-3">{formatDate(cycle.startDate)}{cycle.endDate ? ` — ${formatDate(cycle.endDate)}` : ""}</td><td className="p-3 text-right">{cycle.shares}</td><td className="p-3 text-right">{cycle.drawEntitlementTotal ?? cycle.shares}</td><td className="p-3 text-right">{cycle.drawEntitlementUsed ?? 0}</td><td className="p-3 text-right font-semibold text-primary">{cycle.drawEntitlementRemaining ?? Math.max(0, cycle.shares - (cycle.drawEntitlementUsed ?? 0))}</td><td className="p-3 text-right">{formatCurrency(cycle.dailyContribution)}</td><td className="p-3 text-right font-medium">{formatCurrency(cycle.totalCollected)}</td></tr>)}</tbody></table></div></CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>পেমেন্ট ইতিহাস</CardTitle></CardHeader>
                <CardContent><div className="border rounded-lg overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/50"><tr><th className="text-left p-3">তারিখ</th><th className="text-left p-3">রসিদ</th><th className="text-right p-3">পরিমাণ</th><th className="text-left p-3">গ্রহণকারী</th><th className="text-left p-3">স্ট্যাটাস</th></tr></thead><tbody>{history.payments.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">কোনো পেমেন্ট নেই</td></tr> : history.payments.map((payment) => <tr key={payment.id} className="border-t"><td className="p-3">{formatDate(payment.createdAt)}</td><td className="p-3 font-mono text-xs">{payment.receiptId}</td><td className="p-3 text-right font-medium">{formatCurrency(payment.amount)}</td><td className="p-3">{payment.collectorName ?? payment.receiverName ?? "Direct receiver"}</td><td className="p-3">{payment.status}</td></tr>)}</tbody></table></div></CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>শেয়ার transfer ইতিহাস</CardTitle><CardDescription>Incoming ও outgoing share movement</CardDescription></CardHeader>
                <CardContent><div className="border rounded-lg overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/50"><tr><th className="text-left p-3">তারিখ</th><th className="text-left p-3">ধরন</th><th className="text-left p-3">অন্য সদস্য</th><th className="text-right p-3">শেয়ার</th><th className="text-right p-3">Accumulated value</th><th className="text-right p-3">Settlement</th></tr></thead><tbody>{history.transfers.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">কোনো share transfer নেই</td></tr> : history.transfers.map((transfer) => { const outgoing = transfer.fromMemberId === history.member.id; return <tr key={transfer.id} className="border-t"><td className="p-3">{formatDate(transfer.transferDate)}</td><td className="p-3">{outgoing ? "Outgoing" : "Incoming"}{transfer.overrideWinner ? " · Override" : ""}</td><td className="p-3">{outgoing ? transfer.toMemberName : transfer.fromMemberName}</td><td className="p-3 text-right font-bold">{transfer.shares}</td><td className="p-3 text-right">{formatCurrency(transfer.accumulatedValue)}</td><td className="p-3 text-right">{transfer.settlementAmount == null ? "—" : formatCurrency(transfer.settlementAmount)}</td></tr> })}</tbody></table></div></CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><History className="w-5 h-5" /> শুক্রবার ড্র জয়</CardTitle></CardHeader>
                 <CardContent>{history.draws.length === 0 ? <p className="text-sm text-muted-foreground">এই সদস্য এখনো কোনো ড্র জেতেনি</p> : <div className="space-y-2">{history.draws.map((draw) => <div key={draw.id} className="flex items-center justify-between rounded-lg border p-3"><div><p className="font-medium">Cycle #{draw.cycleNumber} · Draw #{draw.drawNumber}</p><p className="text-xs text-muted-foreground">{formatDate(draw.drawDate)}{draw.entitlementNumber ? ` · Share draw #${draw.entitlementNumber}` : ""}</p></div><p className="font-bold text-primary">{formatCurrency(draw.winningAmount)}</p></div>)}</div>}</CardContent>
              </Card>
              {selectedMember && <Link href={`/members/${selectedMember.id}/history`} className="text-sm text-primary hover:underline">এই সদস্যের সরাসরি history link</Link>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}