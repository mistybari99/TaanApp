import { useGetDashboard, useListCycles } from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Download, FileSpreadsheet, Activity } from "lucide-react"
import { toast } from "sonner"
import { formatDate } from "@/lib/utils"
import { useState } from "react"

export default function ReportsPage() {
  const { data: dashboard } = useGetDashboard()
  const { data: cycles } = useListCycles()
  const [cycleId, setCycleId] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")

  const selectedCycle = cycles?.find((cycle) => String(cycle.id) === cycleId)
  const scopeLabel = selectedCycle
    ? `Cycle #${selectedCycle.cycleNumber} — ${selectedCycle.name}`
    : "Active cycle (default)"
  const dateLabel = startDate || endDate
    ? `${startDate || "any date"} to ${endDate || "any date"}`
    : "all payout dates"
  
  // Custom fetch for blob since Orval doesn't type Blob downloads well by default
  const handleExport = async (type: string) => {
    if (type === "draws" && startDate && endDate && startDate > endDate) {
      toast.error("শুরুর তারিখ শেষ তারিখের পরে হতে পারবে না")
      return
    }
    const params = new URLSearchParams({ type })
    if (type === "draws") {
      if (cycleId) params.set("cycleId", cycleId)
      if (startDate) params.set("startDate", startDate)
      if (endDate) params.set("endDate", endDate)
    }
    const scope = type === "draws" ? `${scopeLabel}, ${dateLabel}` : "current report filters"
    toast.info(`${scope} অনুযায়ী ${type} রিপোর্ট ডাউনলোড হচ্ছে...`)
    try {
      const response = await fetch(`/api/reports/export?${params.toString()}`)
      if (!response.ok) throw new Error("Export failed")
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const suffix = type === "draws" ? `_${cycleId ? `cycle-${cycleId}` : "active-cycle"}${startDate || endDate ? `_${startDate || "start"}-to-${endDate || "end"}` : ""}` : ""
      a.download = `ISLAMIYA_Revolving_Fund_${type}_Report${suffix}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      toast.success("ডাউনলোড সম্পন্ন হয়েছে")
    } catch (e) {
      toast.error("ডাউনলোড ব্যর্থ হয়েছে")
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">রিপোর্ট <span className="text-muted-foreground text-lg font-normal ml-2">Reports</span></h1>
        <p className="text-muted-foreground">তথ্য বিশ্লেষণ এবং ডাউনলোড (Analytics & Export)</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-primary" /> দৈনিক রিপোর্ট
            </CardTitle>
            <CardDescription>আজকের সংগ্রহ ও বকেয়া</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" onClick={() => handleExport("daily")}>
              <Download className="w-4 h-4 mr-2" /> CSV ডাউনলোড
            </Button>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-primary" /> সদস্য বকেয়া
            </CardTitle>
            <CardDescription>বকেয়া থাকা সদস্যদের তালিকা</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" onClick={() => handleExport("due")}>
              <Download className="w-4 h-4 mr-2" /> CSV ডাউনলোড
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" /> অডিট লগ
            </CardTitle>
            <CardDescription>সিস্টেম অ্যাক্টিভিটি রিপোর্ট</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" onClick={() => handleExport("audit")}>
              <Download className="w-4 h-4 mr-2" /> CSV ডাউনলোড
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ডাটা ব্যাকআপ (CSV Backup)</CardTitle>
            <CardDescription>ডাউনলোড করা ফাইল Google Drive-এ manually সংরক্ষণ করতে পারবেন। Draw export-এ active বা নির্বাচিত completed cycle-এর payout history থাকবে।</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div>
              <p className="font-medium">Draw payout ledger scope</p>
              <p className="text-xs text-muted-foreground">চক্র বাছাই না করলে active cycle ব্যবহার হবে। তারিখের সীমা payout date অনুযায়ী inclusive হবে।</p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="draw-export-cycle">Cycle</Label>
                <Select value={cycleId || "active"} onValueChange={(value) => setCycleId(value === "active" ? "" : value)}>
                  <SelectTrigger id="draw-export-cycle">
                    <SelectValue placeholder="Active cycle (default)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active cycle (default)</SelectItem>
                    {cycles?.map((cycle) => (
                      <SelectItem key={cycle.id} value={String(cycle.id)}>
                        Cycle #{cycle.cycleNumber} — {cycle.name} ({cycle.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="draw-export-start">Payout date from</Label>
                <Input id="draw-export-start" type="date" value={startDate} max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="draw-export-end">Payout date to</Label>
                <Input id="draw-export-end" type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Selected scope: {scopeLabel} · {dateLabel}</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            ["members", "সদস্য (Members)"],
            ["payments", "পেমেন্ট (Payments)"],
            ["collectors", "কালেক্টর (Collectors)"],
            ["settlements", "জমা (Settlements)"],
            ["draws", "ড্র ও payout ledger (Draw History)"],
            ["audit", "অডিট লগ (Audit Log)"],
            ["monthly", "মাসিক রিপোর্ট (Monthly Report)"],
          ].map(([type, label]) => (
            <Button key={type} variant="outline" onClick={() => handleExport(type)} className="justify-start">
              <Download className="w-4 h-4 mr-2" /> {label}
            </Button>
          ))}
          </div>
        </CardContent>
          <p className="px-6 pb-6 text-xs text-muted-foreground">Draw export-এ নির্বাচিত scope-এর প্রতিটি draw summary-এর সঙ্গে প্রতিটি payout ledger row থাকবে, reversal-সহ।</p>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>সাম্প্রতিক অডিট লগ (Recent Audit Logs)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>সময় (Time)</TableHead>
                <TableHead>ব্যবহারকারী (User)</TableHead>
                <TableHead>অ্যাকশন (Action)</TableHead>
                <TableHead>বিস্তারিত (Details)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard?.audit?.map(entry => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap">{formatDate(entry.createdAt)}</TableCell>
                  <TableCell className="font-medium">{entry.actor}</TableCell>
                  <TableCell><span className="bg-secondary/20 text-secondary-foreground px-2 py-1 rounded text-xs">{entry.action}</span></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{entry.detail}</TableCell>
                </TableRow>
              ))}
              {!dashboard?.audit?.length && (
                <TableRow><TableCell colSpan={4} className="text-center py-4">No audit logs</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
