import { useGetDashboard, useListCycles } from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Download, FileSpreadsheet, Activity, CheckCircle2, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { formatCurrency, formatDate } from "@/lib/utils"
import { useState } from "react"

type DrawExportScope = {
  cycleId: string
  startDate: string
  endDate: string
}

type DrawExportPreview = {
  scope: DrawExportScope
  drawCount: number
  payoutRowCount: number
  payoutTotal: number
  empty: boolean
}

const scopeKey = (scope: DrawExportScope) => `${scope.cycleId}|${scope.startDate}|${scope.endDate}`

export default function ReportsPage() {
  const { data: dashboard } = useGetDashboard()
  const { data: cycles } = useListCycles()
  const [cycleId, setCycleId] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [drawPreview, setDrawPreview] = useState<DrawExportPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const selectedCycle = cycles?.find((cycle) => String(cycle.id) === cycleId)
  const currentDrawExportScope: DrawExportScope = { cycleId, startDate, endDate }
  const previewMatchesSelection = drawPreview !== null && scopeKey(drawPreview.scope) === scopeKey(currentDrawExportScope)
  const scopeLabel = selectedCycle
    ? `Cycle #${selectedCycle.cycleNumber} — ${selectedCycle.name}`
    : "All cycles (default)"
  const dateLabel = startDate || endDate
    ? `${startDate || "any date"} to ${endDate || "any date"}`
    : "all payout dates"
  
  const buildDrawExportParams = (scope: DrawExportScope) => {
    const params = new URLSearchParams({ type: "draws" })
    if (scope.cycleId) params.set("cycleId", scope.cycleId)
    if (scope.startDate) params.set("startDate", scope.startDate)
    if (scope.endDate) params.set("endDate", scope.endDate)
    return params
  }

  const handlePreview = async () => {
    if (startDate && endDate && startDate > endDate) {
      toast.error("শুরুর তারিখ শেষ তারিখের পরে হতে পারবে না")
      return
    }
    setPreviewLoading(true)
    setDrawPreview(null)
    try {
      const response = await fetch(`/api/reports/export/preview?${buildDrawExportParams(currentDrawExportScope).toString()}`)
      if (!response.ok) throw new Error("Preview failed")
      const body = await response.json() as {
        cycleId: number | null
        startDate: string | null
        endDate: string | null
        drawCount: number
        payoutRowCount: number
        payoutTotal: number
        empty: boolean
      }
      setDrawPreview({
        scope: {
          cycleId: body.cycleId == null ? "" : String(body.cycleId),
          startDate: body.startDate ?? "",
          endDate: body.endDate ?? "",
        },
        drawCount: body.drawCount,
        payoutRowCount: body.payoutRowCount,
        payoutTotal: body.payoutTotal,
        empty: body.empty,
      })
      toast.success("ডাউনলোডের scope preview করা হয়েছে")
    } catch (e) {
      toast.error("Preview ব্যর্থ হয়েছে")
    } finally {
      setPreviewLoading(false)
    }
  }

  // Custom fetch for blob since Orval doesn't type Blob downloads well by default.
  // Draw downloads always use the last previewed scope, and require it to match
  // the current filters so a changed selection cannot download a stale scope.
  const handleExport = async (type: string) => {
    let params = new URLSearchParams({ type })
    if (type === "draws") {
      if (!drawPreview || !previewMatchesSelection) {
        toast.error("ডাউনলোডের আগে বর্তমান scope preview করুন")
        return
      }
      params = buildDrawExportParams(drawPreview.scope)
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
      const suffix = type === "draws" ? `_${cycleId ? `cycle-${cycleId}` : "all-cycles"}${startDate || endDate ? `_${startDate || "start"}-to-${endDate || "end"}` : ""}` : ""
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
            <CardDescription>ডাউনলোড করা ফাইল Google Drive-এ manually সংরক্ষণ করতে পারবেন। Draw export-এ defaultভাবে active ও completed সব cycle-এর payout history থাকবে।</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div>
              <p className="font-medium">Draw payout ledger scope</p>
              <p className="text-xs text-muted-foreground">চক্র বাছাই না করলে active ও completed সব cycle থাকবে। তারিখের সীমা payout date অনুযায়ী inclusive হবে।</p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="draw-export-cycle">Cycle</Label>
                <Select value={cycleId || "all"} onValueChange={(value) => {
                  setCycleId(value === "all" ? "" : value)
                  setDrawPreview(null)
                }}>
                  <SelectTrigger id="draw-export-cycle">
                    <SelectValue placeholder="All cycles (default)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All cycles (default)</SelectItem>
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
                <Input id="draw-export-start" type="date" value={startDate} max={endDate || undefined} onChange={(event) => {
                  setStartDate(event.target.value)
                  setDrawPreview(null)
                }} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="draw-export-end">Payout date to</Label>
                <Input id="draw-export-end" type="date" value={endDate} min={startDate || undefined} onChange={(event) => {
                  setEndDate(event.target.value)
                  setDrawPreview(null)
                }} />
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">Selected scope: {scopeLabel} · {dateLabel}</p>
              <Button type="button" variant="secondary" onClick={handlePreview} disabled={previewLoading}>
                {previewLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                {previewLoading ? "Preview হচ্ছে..." : "Preview scope"}
              </Button>
            </div>
            {drawPreview && previewMatchesSelection && (
              <div className="rounded-md border bg-background p-3 space-y-2">
                <p className="text-sm font-medium">Previewed download scope</p>
                <div className="grid grid-cols-2 gap-3 text-sm md:max-w-lg">
                  <div>
                    <p className="text-xs text-muted-foreground">Selected draws</p>
                    <p className="font-semibold">{drawPreview.drawCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Payout rows</p>
                    <p className="font-semibold">{drawPreview.payoutRowCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total payout amount</p>
                    <p className="font-semibold">{formatCurrency(drawPreview.payoutTotal)}</p>
                  </div>
                </div>
                {drawPreview.empty ? (
                  <p className="text-sm text-amber-700">No matching draws or payout ledger rows were found for this scope.</p>
                ) : drawPreview.payoutRowCount === 0 ? (
                  <p className="text-xs text-muted-foreground">No payout ledger rows are in this scope; selected unpaid draws remain included.</p>
                ) : (
                  <p className="text-xs text-muted-foreground">The CSV download will use exactly this previewed scope.</p>
                )}
              </div>
            )}
            {!previewMatchesSelection && (drawPreview || cycleId || startDate || endDate) && (
              <p className="text-xs text-amber-700">Filters changed. Preview the current scope again before downloading.</p>
            )}
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
            <Button key={type} variant="outline" onClick={() => handleExport(type)} className="justify-start" disabled={type === "draws" && !previewMatchesSelection}>
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
