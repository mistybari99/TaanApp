import { useState } from "react"
import {
  useListCollectors,
  useCreateCollector,
  useUpdateCollector,
  useListCashReceivers,
  useListCycles,
  useCreateCashReceiver,
  useUpdateCashReceiver,
  getListCollectorTargetsQueryKey,
  useListCollectorTargets,
  useUpsertCollectorTarget,
  getListPermissionsQueryKey,
  useListPermissions,
  useGrantPermission,
  useRevokePermission,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { UserSquare, Plus, KeyRound } from "lucide-react"
import { toast } from "sonner"
import { formatCurrency } from "@/lib/utils"

export default function CollectorsPage() {
  const { data: collectors, isLoading, refetch } = useListCollectors()
  const { data: cashReceivers, isLoading: cashReceiversLoading, refetch: refetchCashReceivers } = useListCashReceivers()
  const { data: cycles } = useListCycles()
  const createCollector = useCreateCollector()
  const updateCollector = useUpdateCollector()
  const createCashReceiver = useCreateCashReceiver()
  const updateCashReceiver = useUpdateCashReceiver()
  const { data: collectorTargets } = useListCollectorTargets()
  const upsertCollectorTarget = useUpsertCollectorTarget()
  const { data: permissions } = useListPermissions()
  const grantPermission = useGrantPermission()
  const revokePermission = useRevokePermission()
  const queryClient = useQueryClient()

  const [isAddOpen, setIsAddOpen] = useState(false)
  const [formData, setFormData] = useState({ name: "", username: "", password: "" })
  const [formRole, setFormRole] = useState<"COLLECTOR" | "CASH_RECEIVER">("COLLECTOR")

  const [editTarget, setEditTarget] = useState<{ id: number; role: "COLLECTOR" | "CASH_RECEIVER" } | null>(null)
  const [editPassword, setEditPassword] = useState("")
  const [targetInputs, setTargetInputs] = useState<Record<number, string>>({})
  const [permissionForm, setPermissionForm] = useState({
    userId: "",
    permission: "PAYOUT_APPROVAL",
    cycleId: "",
    expiresAt: "",
    note: "",
  })

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

  const handleSaveTarget = (collectorId: number) => {
    const value = targetInputs[collectorId]
    if (value == null || value.trim() === "" || Number(value) < 0) return
    upsertCollectorTarget.mutate(
      { data: { collectorId, targetAmount: Number(value) } },
      {
        onSuccess: () => {
          toast.success("সাপ্তাহিক target সংরক্ষণ হয়েছে")
          queryClient.invalidateQueries({ queryKey: getListCollectorTargetsQueryKey() })
        },
        onError: (err: any) => toast.error(err.message || "Target সংরক্ষণ করা যায়নি"),
      },
    )
  }

  const handleGrantPermission = () => {
    if (!permissionForm.userId) return
    grantPermission.mutate(
      {
        data: {
          userId: Number(permissionForm.userId),
          permission: permissionForm.permission as any,
          cycleId: permissionForm.cycleId ? Number(permissionForm.cycleId) : undefined,
          expiresAt: permissionForm.expiresAt ? new Date(permissionForm.expiresAt).toISOString() : undefined,
          note: permissionForm.note.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success("Delegated permission দেওয়া হয়েছে")
          setPermissionForm({ userId: "", permission: "PAYOUT_APPROVAL", cycleId: "", expiresAt: "", note: "" })
          queryClient.invalidateQueries({ queryKey: getListPermissionsQueryKey() })
        },
        onError: (err: any) => toast.error(err.message || "Permission দেওয়া যায়নি"),
      },
    )
  }

  const handleRevokePermission = (permissionId: number) => {
    const reason = window.prompt("Permission revoke করার কারণ", "Owner revoked delegated access")
    if (!reason?.trim()) return
    revokePermission.mutate(
      { id: permissionId, data: { reason: reason.trim() } },
      {
        onSuccess: () => {
          toast.success("Delegated permission revoke হয়েছে")
          queryClient.invalidateQueries({ queryKey: getListPermissionsQueryKey() })
        },
        onError: (err: any) => toast.error(err.message || "Permission revoke করা যায়নি"),
      },
    )
  }

  const staff = [...(collectors ?? []), ...(cashReceivers ?? [])]
  const targetsByCollector = new Map((collectorTargets ?? []).map((target) => [target.collectorId, target]))
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
              <TableHead>সাপ্তাহিক target</TableHead>
              <TableHead>অ্যাক্টিভ (Active)</TableHead>
              <TableHead className="text-right">অ্যাকশন</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8">লোড হচ্ছে...</TableCell></TableRow>
            ) : staff.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8">কোন কর্মী নেই</TableCell></TableRow>
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
                    {user.role === "COLLECTOR" ? (
                      <div className="min-w-[220px] space-y-1">
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            className="h-8 w-28"
                            value={targetInputs[user.id] ?? String(targetsByCollector.get(user.id)?.targetAmount ?? "")}
                            onChange={(event) => setTargetInputs((current) => ({ ...current, [user.id]: event.target.value }))}
                            placeholder="৳ 0"
                          />
                          <Button size="sm" variant="outline" onClick={() => handleSaveTarget(user.id)} disabled={upsertCollectorTarget.isPending}>Save</Button>
                        </div>
                        {targetsByCollector.get(user.id) && (
                          <p className="text-[11px] text-muted-foreground">
                            জমা {formatCurrency(targetsByCollector.get(user.id)!.acceptedAmount)} · বাকি {formatCurrency(targetsByCollector.get(user.id)!.remainingAmount)}
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
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

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div>
            <h2 className="font-semibold">Delegated permissions</h2>
            <p className="text-sm text-muted-foreground">Owner-only controls আলাদা রেখে নির্দিষ্ট operational access দিন।</p>
          </div>
          <div className="space-y-2">
            <Label>কর্মী</Label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={permissionForm.userId} onChange={(event) => setPermissionForm({ ...permissionForm, userId: event.target.value })}>
              <option value="">কর্মী নির্বাচন করুন</option>
              {staff.filter((user) => user.active).map((user) => <option key={user.id} value={user.id}>{user.name} · {user.role}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Permission</Label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={permissionForm.permission} onChange={(event) => setPermissionForm({ ...permissionForm, permission: event.target.value })}>
              <option value="PAYOUT_APPROVAL">Payout approval</option>
              <option value="PAYOUT_REVERSAL">Payout reversal</option>
              <option value="PAYMENT_REVERSAL">Payment reversal</option>
              <option value="ADVANCE_ALLOCATION">Advance / due allocation</option>
              <option value="FINANCIAL_CORRECTION">Financial correction</option>
              <option value="DRAW_DATE_CORRECTION">Draw-date correction</option>
              <option value="FULL_ACCESS">Full delegated access</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>Cycle scope</Label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={permissionForm.cycleId} onChange={(event) => setPermissionForm({ ...permissionForm, cycleId: event.target.value })}>
              <option value="">All cycles</option>
              {(cycles ?? []).map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name} · Cycle {cycle.cycleNumber}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Expiry (optional; blank means permanent)</Label>
            <Input type="datetime-local" value={permissionForm.expiresAt} onChange={(event) => setPermissionForm({ ...permissionForm, expiresAt: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>কারণ / নোট</Label>
            <Input value={permissionForm.note} onChange={(event) => setPermissionForm({ ...permissionForm, note: event.target.value })} placeholder="Why this access is needed" />
          </div>
          <Button onClick={handleGrantPermission} disabled={!permissionForm.userId || grantPermission.isPending}>Permission দিন</Button>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Current and past delegation</h2>
          <div className="mt-4 space-y-2">
            {(permissions ?? []).length === 0 ? <p className="text-sm text-muted-foreground">এখনো কোনো delegated permission নেই</p> : permissions?.map((permission) => (
              <div key={permission.id} className={`rounded-lg border p-3 ${permission.revokedAt ? "opacity-60" : ""}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{permission.userName} · {permission.permission}</p>
                    <p className="text-xs text-muted-foreground">{permission.role} · {permission.expiresAt ? `expires ${new Date(permission.expiresAt).toLocaleString()}` : "permanent"}{permission.note ? ` · ${permission.note}` : ""}</p>
                  </div>
                  {permission.revokedAt ? <span className="text-xs text-destructive">Revoked</span> : <Button size="sm" variant="outline" onClick={() => handleRevokePermission(permission.id)} disabled={revokePermission.isPending}>Revoke</Button>}
                </div>
              </div>
            ))}
          </div>
        </div>
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