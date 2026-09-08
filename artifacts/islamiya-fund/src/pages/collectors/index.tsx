import { useState } from "react"
import {
  useListCollectors,
  useCreateCollector,
  useUpdateCollector,
  useListCashReceivers,
  useCreateCashReceiver,
  useUpdateCashReceiver,
} from "@workspace/api-client-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { UserSquare, Plus, KeyRound } from "lucide-react"
import { toast } from "sonner"

export default function CollectorsPage() {
  const { data: collectors, isLoading, refetch } = useListCollectors()
  const { data: cashReceivers, isLoading: cashReceiversLoading, refetch: refetchCashReceivers } = useListCashReceivers()
  const createCollector = useCreateCollector()
  const updateCollector = useUpdateCollector()
  const createCashReceiver = useCreateCashReceiver()
  const updateCashReceiver = useUpdateCashReceiver()

  const [isAddOpen, setIsAddOpen] = useState(false)
  const [formData, setFormData] = useState({ name: "", username: "", password: "" })
  const [formRole, setFormRole] = useState<"COLLECTOR" | "CASH_RECEIVER">("COLLECTOR")

  const [editTarget, setEditTarget] = useState<{ id: number; role: "COLLECTOR" | "CASH_RECEIVER" } | null>(null)
  const [editPassword, setEditPassword] = useState("")

  const refreshStaff = () => {
    refetch()
    refetchCashReceivers()
  }

  const handleCreate = () => {
    const options = {
      onSuccess: () => {
        toast.success(formRole === "COLLECTOR" ? "কালেক্টর যোগ করা হয়েছে" : "Cash Receiver যোগ করা হয়েছে")
        setIsAddOpen(false)
        setFormData({ name: "", username: "", password: "" })
        setFormRole("COLLECTOR")
        refreshStaff()
      },
      onError: (err: any) => toast.error(err.message || "Failed"),
    }
    if (formRole === "COLLECTOR") createCollector.mutate({ data: formData }, options)
    else createCashReceiver.mutate({ data: formData }, options)
  }

  const handleToggleActive = (id: number, role: "COLLECTOR" | "CASH_RECEIVER", currentActive: boolean) => {
    const options = {
      onSuccess: () => {
        toast.success("স্ট্যাটাস আপডেট হয়েছে")
        refreshStaff()
      },
      onError: (err: any) => toast.error(err.message || "Failed"),
    }
    if (role === "COLLECTOR") updateCollector.mutate({ id, data: { active: !currentActive } }, options)
    else updateCashReceiver.mutate({ id, data: { active: !currentActive } }, options)
  }

  const handleUpdatePassword = () => {
    if (!editTarget || !editPassword || editPassword.length < 8) return
    const options = {
      onSuccess: () => {
        toast.success("পাসওয়ার্ড আপডেট হয়েছে")
        setEditTarget(null)
        setEditPassword("")
      },
      onError: (err: any) => toast.error(err.message || "Failed"),
    }
    if (editTarget.role === "COLLECTOR") updateCollector.mutate({ id: editTarget.id, data: { password: editPassword } }, options)
    else updateCashReceiver.mutate({ id: editTarget.id, data: { password: editPassword } }, options)
  }

  const staff = [...(collectors ?? []), ...(cashReceivers ?? [])]
  const busy = isLoading || cashReceiversLoading

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">কর্মী <span className="text-muted-foreground text-lg font-normal ml-2">Staff</span></h1>
          <p className="text-muted-foreground">Collector এবং Cash Receiver account management</p>
        </div>

        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button className="w-full sm:w-auto gap-2">
              <Plus className="w-4 h-4" /> নতুন কর্মী
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>নতুন কর্মী যোগ করুন (Add Staff)</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>অ্যাকাউন্টের ধরন (Account type)</Label>
                <select value={formRole} onChange={e => setFormRole(e.target.value as "COLLECTOR" | "CASH_RECEIVER")} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="COLLECTOR">Collector — member payment collection</option>
                  <option value="CASH_RECEIVER">Cash Receiver — custody and handover</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>নাম (Name)</Label>
                <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Full name" minLength={2} />
              </div>
              <div className="space-y-2">
                <Label>ইউজারনেম (Username)</Label>
                <Input value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} placeholder="Unique username" minLength={3} />
              </div>
              <div className="space-y-2">
                <Label>পাসওয়ার্ড (Password)</Label>
                <Input type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} placeholder="At least 8 chars" minLength={8} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={createCollector.isPending || createCashReceiver.isPending || !formData.name || !formData.username || formData.password.length < 8}>
                সংরক্ষণ করুন (Save)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>নাম (Name)</TableHead>
              <TableHead>ইউজারনেম (Username)</TableHead>
              <TableHead>রোল (Role)</TableHead>
              <TableHead>অ্যাক্টিভ (Active)</TableHead>
              <TableHead className="text-right">অ্যাকশন</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8">লোড হচ্ছে...</TableCell></TableRow>
            ) : staff.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8">কোন কর্মী নেই</TableCell></TableRow>
            ) : (
              staff.map((user) => (
                <TableRow key={user.id} className={!user.active ? "opacity-60" : ""}>
                  <TableCell className="font-medium flex items-center gap-2">
                    <UserSquare className="w-4 h-4 text-primary" /> {user.name}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{user.username}</TableCell>
                  <TableCell>
                    <span className="text-xs bg-muted px-2 py-1 rounded">{user.role === "CASH_RECEIVER" ? "Cash Receiver" : "Collector"}</span>
                  </TableCell>
                  <TableCell>
                    <Switch 
                      checked={user.active} 
                       onCheckedChange={() => handleToggleActive(user.id, user.role as "COLLECTOR" | "CASH_RECEIVER", user.active || false)} 
                       disabled={updateCollector.isPending || updateCashReceiver.isPending}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                       onClick={() => setEditTarget({ id: user.id, role: user.role as "COLLECTOR" | "CASH_RECEIVER" })}
                       disabled={user.role === 'OWNER'}
                      title="Reset Password"
                    >
                      <KeyRound className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Password Reset Dialog */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>পাসওয়ার্ড পরিবর্তন (Reset Password)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
             <div className="space-y-2">
                <Label>নতুন পাসওয়ার্ড (New Password)</Label>
                <Input type="password" value={editPassword} onChange={e => setEditPassword(e.target.value)} placeholder="At least 8 chars" minLength={8} />
              </div>
          </div>
          <DialogFooter>
            <Button onClick={handleUpdatePassword} disabled={updateCollector.isPending || editPassword.length < 8}>
              আপডেট করুন (Update)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}