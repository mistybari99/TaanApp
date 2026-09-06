import { useGetDashboard, useExportReport } from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Download, FileSpreadsheet, Activity } from "lucide-react"
import { toast } from "sonner"
import { formatDate } from "@/lib/utils"

export default function ReportsPage() {
  const { data: dashboard } = useGetDashboard()
  
  // Custom fetch for blob since Orval doesn't type Blob downloads well by default
  const handleExport = async (type: string) => {
    toast.info(`${type} রিপোর্ট ডাউনলোড হচ্ছে...`)
    try {
      const response = await fetch(`/api/reports/export?type=${type}`)
      if (!response.ok) throw new Error("Export failed")
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ISLAMIYA_Revolving_Fund_${type}_Report.csv`
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
          <CardDescription>ডাউনলোড করা ফাইল Google Drive-এ manually সংরক্ষণ করতে পারবেন।</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            ["members", "সদস্য (Members)"],
            ["payments", "পেমেন্ট (Payments)"],
            ["collectors", "কালেক্টর (Collectors)"],
            ["settlements", "জমা (Settlements)"],
            ["audit", "অডিট লগ (Audit Log)"],
            ["monthly", "মাসিক রিপোর্ট (Monthly Report)"],
          ].map(([type, label]) => (
            <Button key={type} variant="outline" onClick={() => handleExport(type)} className="justify-start">
              <Download className="w-4 h-4 mr-2" /> {label}
            </Button>
          ))}
        </CardContent>
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
