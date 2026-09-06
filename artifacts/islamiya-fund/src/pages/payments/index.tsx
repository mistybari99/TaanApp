import { useRef } from "react"
import { useListPayments, useReversePayment } from "@workspace/api-client-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { formatCurrency, formatDate } from "@/lib/utils"
import { toast } from "sonner"
import { FileText, RotateCcw } from "lucide-react"
import { ReceiptDialog, ReceiptRef } from "@/components/receipt"

export default function PaymentsPage() {
  const { data: payments, isLoading, refetch } = useListPayments()
  const reversePayment = useReversePayment()
  const receiptRef = useRef<ReceiptRef>(null)

  const handleReverse = (id: number) => {
    if (confirm("আপনি কি নিশ্চিত এই পেমেন্টটি বাতিল করতে চান? (Are you sure to reverse this payment?)")) {
      reversePayment.mutate({
        id,
        data: { reason: "Manual Reversal" }
      }, {
        onSuccess: () => {
          toast.success("পেমেন্ট বাতিল হয়েছে (Reversed)")
          refetch()
        },
        onError: () => toast.error("ব্যর্থ হয়েছে (Failed)")
      })
    }
  }

  const printReceipt = (payment: any) => {
    receiptRef.current?.show({
      receiptId: payment.receiptId,
      memberName: payment.memberName,
      memberId: payment.memberId,
      amount: payment.amount,
      date: payment.createdAt,
      collectorName: payment.collectorName,
      status: payment.status
    });
  }

  return (
    <div className="space-y-6">
      <ReceiptDialog ref={receiptRef} />
      
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">লেনদেন <span className="text-muted-foreground text-lg font-normal ml-2">Payments</span></h1>
        <p className="text-muted-foreground">পেমেন্ট ইতিহাস এবং রসিদ (Payment History & Receipts)</p>
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>রসিদ (Receipt)</TableHead>
              <TableHead>তারিখ (Date)</TableHead>
              <TableHead>সদস্য (Member)</TableHead>
              <TableHead>কর্মী (Staff)</TableHead>
              <TableHead className="text-right">পরিমাণ (Amount)</TableHead>
              <TableHead>স্ট্যাটাস</TableHead>
              <TableHead className="text-right">অ্যাকশন</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8">লোড হচ্ছে...</TableCell></TableRow>
            ) : payments?.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8">কোন লেনদেন নেই</TableCell></TableRow>
            ) : (
              payments?.map((payment) => (
                <TableRow key={payment.id} className={payment.status === 'REVERSED' ? 'opacity-50' : ''}>
                  <TableCell className="font-mono text-xs">{payment.receiptId}</TableCell>
                  <TableCell>{formatDate(payment.createdAt)}</TableCell>
                  <TableCell className="font-medium">{payment.memberName}</TableCell>
                  <TableCell>{payment.collectorName}</TableCell>
                  <TableCell className="text-right font-bold text-primary">{formatCurrency(payment.amount)}</TableCell>
                  <TableCell>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      payment.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {payment.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="icon" onClick={() => printReceipt(payment)} title="Print Receipt">
                        <FileText className="w-4 h-4" />
                      </Button>
                      {payment.status === 'POSTED' && (
                        <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => handleReverse(payment.id)} title="Reverse">
                          <RotateCcw className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}