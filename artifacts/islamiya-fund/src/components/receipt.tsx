import { useRef, forwardRef, useImperativeHandle, useState } from 'react';
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Share2, Copy, Printer, CheckCircle2 } from "lucide-react";
import { toast } from 'sonner';

export interface ReceiptData {
  receiptId: string;
  memberName: string;
  memberId: string | number;
  amount: number;
  date: string;
  collectorName: string;
  status: string;
}

export interface ReceiptRef {
  show: (data: ReceiptData) => void;
}

export const ReceiptDialog = forwardRef<ReceiptRef>((props, ref) => {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<ReceiptData | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    show: (receiptData) => {
      setData(receiptData);
      setIsOpen(true);
    }
  }));

  const handleCopy = () => {
    if (!data) return;
    const text = `রসিদ (Receipt): ${data.receiptId}\nসদস্য (Member): ${data.memberName}\nপরিমাণ (Amount): ${data.amount} BDT\nতারিখ (Date): ${formatDate(data.date)}`;
    navigator.clipboard.writeText(text);
    toast.success("কপি করা হয়েছে (Copied)");
  };

  const handleShare = async () => {
    if (!data) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Payment Receipt',
          text: `রসিদ (Receipt): ${data.receiptId}\nসদস্য (Member): ${data.memberName}\nপরিমাণ (Amount): ${data.amount} BDT`,
        });
      } catch (err) {
        console.error(err);
      }
    } else {
      handleCopy();
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (!data) return null;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md print:shadow-none print:border-none">
        <div ref={printRef} className="space-y-6 p-4 bg-card text-card-foreground print:bg-white print:text-black print:p-0">
          <div className="text-center space-y-2 border-b pb-4">
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-2">
               <CheckCircle2 className="w-6 h-6 text-primary" />
            </div>
            <h2 className="text-2xl font-bold text-primary">ISLAMIYA Revolving Fund</h2>
            <p className="text-xs text-muted-foreground mt-2">পেমেন্ট রসিদ (Payment Receipt)</p>
          </div>
          
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">রসিদ নং (Receipt No)</span>
              <span className="font-mono font-bold">{data.receiptId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">তারিখ (Date)</span>
              <span>{formatDate(data.date)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">সদস্য (Member)</span>
              <span className="font-medium text-right">{data.memberName} <br/><span className="text-xs font-normal">ID: {data.memberId}</span></span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">কর্মী (Collector)</span>
              <span>{data.collectorName}</span>
            </div>
            <div className="flex justify-between border-t pt-3">
              <span className="font-bold">মোট জমা (Total Amount)</span>
              <span className="font-bold text-lg text-primary">{formatCurrency(data.amount)}</span>
            </div>
          </div>
          
          <div className="text-center text-xs text-muted-foreground pt-4 border-t">
            ধন্যবাদ! (Thank You!)
            <br />
            {data.status === 'PENDING' ? 'অফলাইন পেমেন্ট (Offline Payment)' : 'সফল পেমেন্ট (Successful Payment)'}
          </div>
        </div>

        <div className="flex gap-2 justify-center mt-4 print:hidden">
          <Button variant="outline" className="flex-1" onClick={handleShare}>
            <Share2 className="w-4 h-4 mr-2" /> Share
          </Button>
          <Button variant="outline" className="flex-1" onClick={handleCopy}>
            <Copy className="w-4 h-4 mr-2" /> Copy
          </Button>
          <Button variant="outline" className="flex-1" onClick={handlePrint}>
            <Printer className="w-4 h-4 mr-2" /> Print
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});
