import { getListAuditQueryKey, useListAudit } from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useState } from "react"

type AuditFilter = "all" | "exports"

type AuditRecord = {
  id: number
  actor: string
  action: string
  detail: string
  entityType?: string | null
  entityId?: string | null
  cycleId?: number | null
  afterValue?: Record<string, unknown> | null
  createdAt: string
}

const reportTypeLabels: Record<string, string> = {
  daily: "দৈনিক রিপোর্ট (Daily)",
  due: "সদস্য বকেয়া (Due)",
  members: "সদস্য (Members)",
  payments: "পেমেন্ট (Payments)",
  collectors: "কালেক্টর (Collectors)",
  collector: "কালেক্টর সংগ্রহ (Collector totals)",
  settlements: "জমা (Settlements)",
  settlement: "জমা (Settlement)",
  draws: "ড্র ও payout ledger (Draws)",
  monthly: "মাসিক রিপোর্ট (Monthly)",
  weekly: "সাপ্তাহিক রিপোর্ট (Weekly)",
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

const stringValue = (value: unknown) => typeof value === "string" && value.length > 0 ? value : null
const numberValue = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null

const isExportDownload = (entry: AuditRecord) =>
  entry.entityType === "report_export" && entry.action.endsWith("_EXPORT_DOWNLOADED")

const formatTimestamp = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dhaka",
  }).format(date)
}

const formatDateRange = (startDate: string | null, endDate: string | null) => {
  if (startDate && endDate) return startDate === endDate ? startDate : `${startDate} – ${endDate}`
  if (startDate) return `From ${startDate}`
  if (endDate) return `Through ${endDate}`
  return null
}

const formatRecordedScope = (entry: AuditRecord) => {
  const afterValue = asRecord(entry.afterValue)
  const recordedEffectiveScope = asRecord(afterValue.effectiveScope)
  const effectiveScope = Object.keys(recordedEffectiveScope).length > 0 ? recordedEffectiveScope : afterValue
  const reportType = stringValue(afterValue.reportType) ?? entry.entityId ?? "unknown"
  const parts: string[] = []
  const cycleId = "cycleId" in effectiveScope
    ? numberValue(effectiveScope.cycleId)
    : numberValue(entry.cycleId)
  const startDate = stringValue(effectiveScope.startDate)
  const endDate = stringValue(effectiveScope.endDate)

  if (effectiveScope.scope === "all_members") {
    parts.push("All members")
  } else if (cycleId !== null) {
    parts.push(`Cycle #${cycleId}`)
  } else if (reportType === "draws") {
    parts.push("All cycles")
  } else if ("cycleId" in effectiveScope) {
    parts.push("No active cycle")
  }

  const period = stringValue(effectiveScope.period)
  if (period === "payments") parts.push("All payment dates")
  const dateRange = formatDateRange(startDate, endDate)
  if (dateRange) parts.push(dateRange)
  else if (reportType === "draws") parts.push("All payout dates")

  const asOfDate = stringValue(effectiveScope.asOfDate)
  if (asOfDate) parts.push(`As of ${asOfDate}`)

  const rowCount = numberValue(afterValue.rowCount)
  if (rowCount !== null) parts.push(`${rowCount} rows`)

  const requestedScope = asRecord(afterValue.requestedScope)
  const requestedCycleId = numberValue(requestedScope.cycleId)
  const requestedDateRange = formatDateRange(
    stringValue(requestedScope.startDate),
    stringValue(requestedScope.endDate),
  )
  const requestedParts = [
    requestedCycleId !== null ? `cycle #${requestedCycleId}` : null,
    requestedDateRange,
  ].filter((part): part is string => part !== null)
  if (requestedParts.length > 0) parts.push(`Requested: ${requestedParts.join(" · ")}`)

  return parts.join(" · ") || "Scope not recorded"
}

export default function AuditPage() {
  const { data, isLoading, isError } = useListAudit({
    query: { queryKey: getListAuditQueryKey(), retry: false },
  })
  const [filter, setFilter] = useState<AuditFilter>("all")
  const auditEntries = (data ?? []) as AuditRecord[]
  const exportEntries = auditEntries.filter(isExportDownload)
  const visibleEntries = filter === "exports" ? exportEntries : auditEntries

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">
          অডিট ইতিহাস <span className="ml-2 text-lg font-normal text-muted-foreground">Audit History</span>
        </h1>
        <p className="text-muted-foreground">সিস্টেমের কার্যকলাপ এবং রিপোর্ট ডাউনলোডের রেকর্ড দেখুন।</p>
      </div>

      <Card>
        <CardHeader className="gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>Audit history</CardTitle>
            <CardDescription>
              {isLoading ? "Loading audit records…" : `Showing the latest ${auditEntries.length} audit records.`}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Audit history filter">
            <Button
              type="button"
              size="sm"
              variant={filter === "all" ? "default" : "outline"}
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All activity
            </Button>
            <Button
              type="button"
              size="sm"
              variant={filter === "exports" ? "default" : "outline"}
              aria-pressed={filter === "exports"}
              onClick={() => setFilter("exports")}
            >
              Export downloads{!isLoading && ` (${exportEntries.length})`}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading audit history…</p>
          ) : isError ? (
            <p className="py-8 text-center text-sm text-destructive" role="alert">
              Audit history could not be loaded. Owner access is required.
            </p>
          ) : visibleEntries.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {filter === "exports" ? "No export downloads were found in the audit history." : "No audit history is available."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                {filter === "exports" ? (
                  <>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Timestamp</TableHead>
                        <TableHead>Owner</TableHead>
                        <TableHead>Report type</TableHead>
                        <TableHead>Recorded scope</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleEntries.map((entry) => {
                        const afterValue = asRecord(entry.afterValue)
                        const reportType = stringValue(afterValue.reportType) ?? entry.entityId ?? "unknown"
                        return (
                          <TableRow key={entry.id}>
                            <TableCell className="whitespace-nowrap">
                              <time dateTime={entry.createdAt}>{formatTimestamp(entry.createdAt)}</time>
                            </TableCell>
                            <TableCell className="whitespace-nowrap font-medium">{entry.actor}</TableCell>
                            <TableCell className="min-w-40">{reportTypeLabels[reportType] ?? reportType}</TableCell>
                            <TableCell className="min-w-64 text-sm text-muted-foreground">
                              {formatRecordedScope(entry)}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </>
                ) : (
                  <>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleEntries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="whitespace-nowrap">
                            <time dateTime={entry.createdAt}>{formatTimestamp(entry.createdAt)}</time>
                          </TableCell>
                          <TableCell className="whitespace-nowrap font-medium">{entry.actor}</TableCell>
                          <TableCell>
                            <span className="rounded bg-secondary/20 px-2 py-1 text-xs text-secondary-foreground">
                              {entry.action}
                            </span>
                          </TableCell>
                          <TableCell className="min-w-64 text-sm text-muted-foreground">{entry.detail}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </>
                )}
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}