import { useState } from "react"
import { useListSettlements, useCreateSettlement, useListCollectors, useGetDashboard } from "@workspace/api-client-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { formatCurrency, formatDate } from "@/lib/utils"
import { toast } from "sonner"
import { ArrowDownToLine, Wallet } from "lucide-react"

export default function SettlementsPage() {
  const { data: settlements, isLoading, refetch } = useListSettlements()
  const { data: dashboard, refetch: refetchDashboard } = useGetDashboard()
  const createSettlement = useCreateSettlement()
  
  const [isOpen, setIsOpen] = useState(false)
  const [amount, setAmount] = useState("")
  const [reference, setReference] = useState("")

  const handleDeposit = () => {
    createSettlement.mutate({
      data: {
        amount: Number(amount),
        reference,
        note: "Daily Deposit"
      }
    }, {
      onSuccess: () => {
        toast.success("জমা সফল হয়েছে (Deposit Successful)")
        setIsOpen(false)
        setAmount("")
        setReference("")
        refetch()
        refetchDashboard()
      },
      onError: (err: any) => {
        toast.error(err.message || "ব্যর্থ হয়েছে")
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">জমা <span className="text-muted-foreground text-lg font-normal ml-2">Deposits</span></h1>
          <p className="text-muted-foreground">কালেক্টর থেকে অফিসে নগদ জমা (Cash Deposits to Office)</p>
        </div>
        
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="w-full sm:w-auto gap-2">
              <ArrowDownToLine className="w-4 h-4" /> নতুন জমা
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>অফিসে জমা দিন (Deposit to Office)</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="bg-muted p-4 rounded-lg flex items-center justify-between">
                <span className="text-sm font-medium">বর্তমান নগদ ব্যালেন্স</span>
                <span className="text-lg font-bold text-primary">{formatCurrency(dashboard?.collectorCash || 0)}</span>
              </div>
              <div className="space-y-2">
                <Label>পরিমাণ (Amount)</Label>
                <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <Label>রেফারেন্স / রসিদ নং (Reference)</Label>
                <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="DEP-1234" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleDeposit} disabled={createSettlement.isPending || !amount}>
                জমা দিন (Submit)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="border rounded-xl p-4 bg-card flex flex-col justify-center">
          <p className="text-sm text-muted-foreground">মোট জমা (Total Deposits)</p>
          <p className="text-2xl font-bold mt-1">{formatCurrency(dashboard?.officeDeposits || 0)}</p>
        </div>
        <div className="border rounded-xl p-4 bg-primary text-primary-foreground flex flex-col justify-center">
          <p className="text-sm opacity-90">অমীমাংসিত নগদ (Unsettled Cash)</p>
          <p className="text-2xl font-bold mt-1">{formatCurrency(dashboard?.unsettledCash || 0)}</p>
        </div>
      </div>

      <div className="border rounded-xl bg-card overflow-hidden mt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>তারিখ (Date)</TableHead>
              <TableHead>কালেক্টর (Collector)</TableHead>
              <TableHead>রেফারেন্স (Ref)</TableHead>
              <TableHead className="text-right">পরিমাণ (Amount)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={4} className="text-center py-8">লোড হচ্ছে...</TableCell></TableRow>
            ) : settlements?.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center py-8">কোন জমা নেই</TableCell></TableRow>
            ) : (
              settlements?.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{formatDate(s.createdAt)}</TableCell>
                  <TableCell>{s.collectorName}</TableCell>
                  <TableCell className="font-mono text-sm">{s.reference}</TableCell>
                  <TableCell className="text-right font-bold text-primary">{formatCurrency(s.amount)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
