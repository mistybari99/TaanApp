import { getGetDashboardQueryKey, useGetDashboard } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency } from "@/lib/utils"
import { Users, TrendingUp, AlertCircle, ArrowDownToLine, Wallet } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export default function OwnerDashboard() {
  const { data: dashboard, isLoading } = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey(), refetchInterval: 15000 } })

  if (isLoading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-8 bg-muted rounded w-1/4"></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1,2,3,4].map(i => <div key={i} className="h-24 bg-muted rounded-xl"></div>)}
      </div>
      <div className="h-64 bg-muted rounded-xl"></div>
    </div>
  }

  if (!dashboard) return <div>Failed to load dashboard.</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">ড্যাশবোর্ড <span className="text-muted-foreground text-lg font-normal ml-2">Dashboard</span></h1>
        <p className="text-muted-foreground">আজকের সামগ্রিক অবস্থা (Today's Overview)</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">আজকের সংগ্রহ</CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(dashboard.collected)}</div>
            <p className="text-xs text-muted-foreground">Collected Today</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">বকেয়া</CardTitle>
            <AlertCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{formatCurrency(dashboard.due)}</div>
            <p className="text-xs text-muted-foreground">Due Amount</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">অফিসে জমা</CardTitle>
            <ArrowDownToLine className="h-4 w-4 text-secondary-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(dashboard.officeDeposits)}</div>
            <p className="text-xs text-muted-foreground">Deposited to Office</p>
          </CardContent>
        </Card>

        <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">কর্মীদের কাছে নগদ</CardTitle>
            <Wallet className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{formatCurrency(dashboard.collectorCash)}</div>
            <p className="text-xs text-muted-foreground">Cash with Staff</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">কর্মী পারফরম্যান্স <span className="text-muted-foreground text-sm font-normal ml-2">Staff Performance</span></CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>নাম (Name)</TableHead>
                  <TableHead className="text-right">সংগ্রহ (Collected)</TableHead>
                  <TableHead className="text-right">নগদ (Cash)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.performances.map((perf, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{perf.name}</TableCell>
                    <TableCell className="text-right">{formatCurrency(perf.collected)}</TableCell>
                    <TableCell className="text-right text-primary font-medium">{formatCurrency(perf.cash)}</TableCell>
                  </TableRow>
                ))}
                {dashboard.performances.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-4">No data today</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">সাম্প্রতিক লেনদেন <span className="text-muted-foreground text-sm font-normal ml-2">Recent Payments</span></CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>সদস্য (Member)</TableHead>
                  <TableHead>কর্মী (Staff)</TableHead>
                  <TableHead className="text-right">পরিমান (Amount)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.recentPayments.slice(0, 5).map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell className="font-medium">{payment.memberName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{payment.collectorName}</TableCell>
                    <TableCell className="text-right text-primary font-medium">{formatCurrency(payment.amount)}</TableCell>
                  </TableRow>
                ))}
                {dashboard.recentPayments.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-4">No payments yet</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
