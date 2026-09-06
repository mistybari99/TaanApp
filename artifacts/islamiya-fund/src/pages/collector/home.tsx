import { useState, useMemo } from "react"
import { useListMembers, useCreatePayment, useGetDashboard } from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { toast } from "sonner"
import { formatCurrency } from "@/lib/utils"
import { Search, UserCheck, CheckCircle2, History } from "lucide-react"

export default function CollectorHome() {
  const [search, setSearch] = useState("")
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null)
  const [amount, setAmount] = useState<string>("")
  const [pin, setPin] = useState("")
  const [confirmDialog, setConfirmDialog] = useState(false)
  const [isDuplicateConfirm, setIsDuplicateConfirm] = useState(false)
  
  const { data: members, isLoading, refetch } = useListMembers({ search: search.length > 2 ? search : undefined })
  const { data: dashboard, refetch: refetchDashboard } = useGetDashboard()
  const createPayment = useCreatePayment()

  // Find selected member
  const selectedMember = useMemo(() => members?.find(m => m.id === selectedMemberId), [members, selectedMemberId])

  const handleSelect = (id: number) => {
    setSelectedMemberId(id)
    const member = members?.find(m => m.id === id)
    if (member) {
      setAmount(member.dailyAmount.toString())
      // Check if already paid today
      if (member.todayPaid > 0) {
        setIsDuplicateConfirm(true)
      } else {
        setIsDuplicateConfirm(false)
      }
    }
    setPin("")
    setSearch("")
  }

  const handleCollect = () => {
    if (!selectedMember) return
    const numAmount = Number(amount)
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.error("সঠিক পরিমাণ দিন (Enter valid amount)")
      return
    }

    createPayment.mutate({
      data: {
        memberId: selectedMember.id,
        amount: numAmount,
        verificationMethod: pin ? "PIN" : "COLLECTOR_CONFIRMATION",
        verificationCode: pin || undefined,
        confirmDuplicate: isDuplicateConfirm
      }
    }, {
      onSuccess: () => {
        toast.success("পেমেন্ট সফল হয়েছে (Payment Successful)")
        setConfirmDialog(false)
        setSelectedMemberId(null)
        setAmount("")
        setPin("")
        refetch()
        refetchDashboard()
      },
      onError: (err: any) => {
        toast.error(err?.message || "পেমেন্ট ব্যর্থ হয়েছে (Payment Failed)")
      }
    })
  }

  return (
    <div className="space-y-4 max-w-md mx-auto">
      {/* Collector Stats Snippet */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Card className="bg-primary text-primary-foreground border-none">
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <span className="text-xs opacity-80">আজকের সংগ্রহ</span>
            <span className="text-xl font-bold mt-1">
              {formatCurrency(dashboard?.performances?.[0]?.collected || 0)}
            </span>
          </CardContent>
        </Card>
        <Card className="bg-secondary text-secondary-foreground border-none">
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <span className="text-xs opacity-80">নগদ ব্যালেন্স</span>
            <span className="text-xl font-bold mt-1">
              {formatCurrency(dashboard?.collectorCash || 0)}
            </span>
          </CardContent>
        </Card>
      </div>

      {!selectedMemberId ? (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
            <Input 
              placeholder="নাম বা আইডি দিয়ে খুঁজুন (Search Name/ID)..." 
              className="pl-10 h-12 text-lg rounded-xl"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="space-y-2 mt-4">
            <p className="text-sm font-medium text-muted-foreground px-1">
              {search.length > 0 ? "ফলাফল (Results)" : "সাম্প্রতিক বকেয়া (Recent Due)"}
            </p>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">অপেক্ষা করুন...</div>
            ) : members?.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">কোন সদস্য পাওয়া যায়নি</div>
            ) : (
              members?.slice(0, 10).map((member) => (
                <Card 
                  key={member.id} 
                  className={`cursor-pointer transition-colors active:scale-[0.98] ${member.todayPaid > 0 ? 'opacity-70 bg-muted/50' : 'hover:border-primary'}`}
                  onClick={() => handleSelect(member.id)}
                >
                  <CardContent className="p-4 flex justify-between items-center">
                    <div>
                      <div className="font-bold text-base flex items-center gap-2">
                        {member.name} 
                        {member.todayPaid > 0 && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                      </div>
                      <div className="text-sm text-muted-foreground">ID: {member.memberId}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-primary font-bold">{formatCurrency(member.dailyAmount)}</div>
                      <div className="text-xs text-muted-foreground">Daily</div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
          <Button variant="ghost" className="mb-2" onClick={() => setSelectedMemberId(null)}>
            ← ফিরে যান (Back)
          </Button>
          
          <Card className="border-2 border-primary/20">
            <CardContent className="p-6 space-y-6">
              <div className="text-center space-y-1">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-2 text-primary">
                  <UserCheck className="w-8 h-8" />
                </div>
                <h2 className="text-2xl font-bold">{selectedMember?.name}</h2>
                <p className="text-muted-foreground font-mono">ID: {selectedMember?.memberId}</p>
                {selectedMember?.todayPaid ? (
                  <span className="inline-flex items-center gap-1 bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full mt-2 font-medium">
                    <CheckCircle2 className="w-3 h-3" /> ইতিমধ্যে পেমেন্ট করেছে
                  </span>
                ) : null}
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-lg">টাকার পরিমাণ (Amount)</Label>
                  <Input 
                    type="number" 
                    value={amount} 
                    onChange={(e) => setAmount(e.target.value)}
                    className="h-16 text-3xl font-bold text-center tracking-wider"
                  />
                  <div className="flex gap-2 justify-center mt-2">
                    {[50, 100, 200, 500].map(val => (
                      <Button 
                        key={val} 
                        variant="outline" 
                        size="sm" 
                        className="flex-1"
                        onClick={() => setAmount(val.toString())}
                      >
                        +{val}
                      </Button>
                    ))}
                  </div>
                </div>

                <Button 
                  className="w-full h-14 text-lg font-bold shadow-lg" 
                  onClick={() => setConfirmDialog(true)}
                >
                  সংগ্রহ করুন (Collect)
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Confirmation Dialog */}
      <Dialog open={confirmDialog} onOpenChange={setConfirmDialog}>
        <DialogContent className="w-[90vw] max-w-md rounded-xl p-6">
          <DialogHeader>
            <DialogTitle className="text-xl text-center">নিশ্চিত করুন (Confirm)</DialogTitle>
          </DialogHeader>
          <div className="py-6 space-y-6 text-center">
            <div>
              <p className="text-sm text-muted-foreground">সদস্যের নাম</p>
              <p className="text-xl font-bold">{selectedMember?.name}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">পরিমাণ</p>
              <p className="text-4xl font-bold text-primary">{formatCurrency(Number(amount))}</p>
            </div>
            
            {isDuplicateConfirm && (
              <div className="bg-destructive/10 p-3 rounded-lg border border-destructive/20 text-destructive text-sm font-medium">
                সতর্কতা: এই সদস্য আজ ইতিমধ্যে পেমেন্ট করেছে!
              </div>
            )}

            <div className="space-y-2 pt-2">
              <Label className="text-sm text-left block">PIN কোড (যদি থাকে)</Label>
              <Input 
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={pin}
                onChange={e => setPin(e.target.value)}
                placeholder="****"
                className="h-12 text-center text-xl tracking-[0.5em] font-mono"
              />
              <p className="text-xs text-muted-foreground text-left">পিন না দিলে কালেক্টর কনফার্মেশন ধরা হবে।</p>
            </div>
          </div>
          <DialogFooter className="flex-row gap-3 sm:justify-between">
            <Button variant="outline" className="flex-1 h-12" onClick={() => setConfirmDialog(false)}>
              বাতিল (Cancel)
            </Button>
            <Button 
              className="flex-1 h-12" 
              onClick={handleCollect}
              disabled={createPayment.isPending}
            >
              {createPayment.isPending ? "অপেক্ষা..." : "নিশ্চিত (Confirm)"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
