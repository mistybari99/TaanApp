import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { getGetDashboardQueryKey, getListCycleMembersQueryKey, getListMembersQueryKey, useListMembers, useCreateMember, useCreateDueEntry, useImportMembers, useListCycles, useUpdateMember, useGetCurrentUser } from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { formatCurrency } from "@/lib/utils"
import { Search, UserPlus, Upload, Download, AlertTriangle, WalletCards } from "lucide-react"
import { downloadCsvTemplate, parseCsv } from "@/lib/csv"
import { Link } from "wouter"

export default function MembersPage() {
  const [search, setSearch] = useState("")
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  
  const { data: members, isLoading, refetch } = useListMembers({ search: search || undefined })
  const { data: cycles } = useListCycles()
  const { data: user } = useGetCurrentUser()
  const createMember = useCreateMember()
  const createDueEntry = useCreateDueEntry()
  const importMembers = useImportMembers()
  const updateMember = useUpdateMember()
  const queryClient = useQueryClient()

  const [newMember, setNewMember] = useState({
    memberId: "",
    name: "",
    mobile: "",
    address: "",
    nid: "",
    shares: 1,
    dailyAmount: 100,
    notes: ""
  })

  // Import State
  const [importRows, setImportRows] = useState<any[]>([])
  const [importPreview, setImportPreview] = useState<{valid: number, imported: number, errors: any[], memberCount: number, totalShares: number, expectedDailyCollection: number, previewToken: string} | null>(null)
  const [importCycleId, setImportCycleId] = useState("")
  const importCycle = cycles?.find((cycle) => cycle.id === Number(importCycleId))
  const activeCycles = cycles?.filter((cycle) => cycle.status === "ACTIVE") ?? []
  const [isDueEntryOpen, setIsDueEntryOpen] = useState(false)
  const [isDueConfirmationOpen, setIsDueConfirmationOpen] = useState(false)
  const [dueEntry, setDueEntry] = useState({
    cycleId: "",
    memberId: "",
    amount: "",
    reason: "",
    dueDate: new Date().toISOString().slice(0, 10),
  })
  const selectedDueCycle = activeCycles.find((cycle) => cycle.id === Number(dueEntry.cycleId))
  const selectedDueMember = members?.find((member) => member.id === Number(dueEntry.memberId))

  useEffect(() => {
    if (!importCycleId) {
      const activeCycle = cycles?.find((cycle) => cycle.status === "ACTIVE")
      if (activeCycle) setImportCycleId(String(activeCycle.id))
    }
  }, [cycles, importCycleId])

  const handleAdd = () => {
    createMember.mutate({
      data: {
        ...newMember,
        joiningDate: new Date().toISOString(),
        status: "active"
      }
    }, {
      onSuccess: () => {
        toast.success("সদস্য যোগ করা হয়েছে (Member added)")
        setIsAddOpen(false)
         setNewMember({ memberId: "", name: "", mobile: "", address: "", nid: "", shares: 1, dailyAmount: 100, notes: "" })
        refetch()
      },
      onError: (err: any) => {
        toast.error(err.message || "ব্যর্থ হয়েছে")
      }
    })
  }

  const resetDueEntry = () => {
    const activeCycle = activeCycles[0]
    setDueEntry({
      cycleId: activeCycle ? String(activeCycle.id) : "",
      memberId: "",
      amount: "",
      reason: "",
      dueDate: new Date().toISOString().slice(0, 10),
    })
    setIsDueConfirmationOpen(false)
  }

  const openDueEntry = () => {
    resetDueEntry()
    setIsDueEntryOpen(true)
  }

  const reviewDueEntry = () => {
    const amount = Number(dueEntry.amount)
    if (!dueEntry.cycleId || !dueEntry.memberId) {
      toast.error("সদস্য ও active cycle নির্বাচন করুন (Select member and cycle)")
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("সঠিক positive amount দিন (Enter a positive amount)")
      return
    }
    if (!dueEntry.reason.trim()) {
      toast.error("Reason / Note লিখুন (Reason is required)")
      return
    }
    setIsDueConfirmationOpen(true)
  }

  const saveDueEntry = () => {
    const cycleId = Number(dueEntry.cycleId)
    const memberId = Number(dueEntry.memberId)
    const amount = Number(dueEntry.amount)
    createDueEntry.mutate({
      data: {
        cycleId,
        memberId,
        amount,
        dueDate: dueEntry.dueDate,
        reason: dueEntry.reason.trim(),
        idempotencyKey: crypto.randomUUID(),
      },
    }, {
      onSuccess: () => {
        toast.success("আগের বকেয়া সংরক্ষণ করা হয়েছে (Previous Due saved)")
        queryClient.invalidateQueries({ queryKey: getListMembersQueryKey() })
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() })
        queryClient.invalidateQueries({ queryKey: getListCycleMembersQueryKey(cycleId) })
        setIsDueEntryOpen(false)
        resetDueEntry()
      },
      onError: (error: any) => {
        toast.error(error?.message || "আগের বকেয়া সংরক্ষণ করা যায়নি (Could not save due)")
      },
    })
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!importCycleId) {
      toast.error("আগে একটি active cycle নির্বাচন করুন")
      e.target.value = ""
      return
    }
    try {
      const rows = await parseCsv(file);
      setImportRows(rows);
      // Run dry-run validation
      importMembers.mutate({
        data: { dryRun: true, rows, cycleId: importCycleId ? Number(importCycleId) : undefined }
      }, {
        onSuccess: (data) => {
          setImportPreview(data);
          if (data.errors.length > 0) {
            toast.error(`${data.errors.length} টি লাইনে ভুল আছে`);
          } else {
            toast.success("সব ঠিক আছে, ইম্পোর্ট করতে পারেন");
          }
        },
        onError: (err: any) => toast.error(err.message || "Validation failed")
      });
    } catch (err) {
      toast.error("ফাইল পড়তে সমস্যা হয়েছে (Failed to read CSV)");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">সদস্য <span className="text-muted-foreground text-lg font-normal ml-2">Members</span></h1>
          <p className="text-muted-foreground">সদস্য পরিচালনা ও তালিকা (Manage Members)</p>
        </div>
        
        <div className="flex w-full sm:w-auto gap-2">
          {user?.role === "OWNER" && (
            <Button variant="secondary" className="flex-1 sm:flex-none gap-2" onClick={openDueEntry}>
              <WalletCards className="w-4 h-4" /> Due Entry
            </Button>
          )}
          <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="flex-1 sm:flex-none gap-2">
                <Upload className="w-4 h-4" /> CSV ইম্পোর্ট
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>CSV থেকে সদস্য যোগ করুন</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="flex justify-between items-center bg-muted/50 p-4 rounded-lg">
                  <div>
                    <h4 className="font-semibold text-sm">সঠিক ফরম্যাট ব্যবহার করুন</h4>
                   <p className="text-xs text-muted-foreground">বর্তমান ফরম্যাট: name,shares</p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={downloadCsvTemplate}>
                    <Download className="w-4 h-4 mr-2" /> টেমপ্লেট
                  </Button>
                </div>
                
                <div>
                  <Label>CSV ফাইল নির্বাচন করুন</Label>
                  <Input type="file" accept=".csv" onChange={handleFileChange} className="mt-1" />
                </div>
                <div>
                   <Label>চক্রে যোগ করুন (প্রয়োজনীয়)</Label>
                  <select className="h-10 mt-1 w-full rounded-md border bg-background px-3 text-sm" value={importCycleId} onChange={(event) => setImportCycleId(event.target.value)}>
                     <option value="">active cycle নির্বাচন করুন</option>
                    {cycles?.filter((cycle) => cycle.status === "ACTIVE").map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}
                  </select>
                   <p className="text-xs text-muted-foreground mt-1">Import শুধু নির্বাচিত cycle-এর সদস্য ও cycle-specific shares তৈরি/আপডেট করবে। পুরনো payment বা dues আসবে না।</p>
                </div>

                {importPreview && (
                  <div className="p-4 border rounded-lg bg-card space-y-2">
                    <h4 className="font-semibold text-sm flex items-center gap-2">
                      ভ্যালিডেশন রেজাল্ট 
                      {importPreview.errors.length === 0 ? 
                        <span className="text-green-600 text-xs px-2 bg-green-100 rounded">OK</span> : 
                        <span className="text-red-600 text-xs px-2 bg-red-100 rounded">Errors found</span>}
                    </h4>
                     <div className="grid grid-cols-3 gap-2 text-center">
                       <div className="rounded-md bg-muted/50 p-2"><div className="text-lg font-bold">{importPreview.memberCount}</div><div className="text-xs text-muted-foreground">সদস্য</div></div>
                       <div className="rounded-md bg-muted/50 p-2"><div className="text-lg font-bold">{importPreview.totalShares}</div><div className="text-xs text-muted-foreground">মোট shares</div></div>
                       <div className="rounded-md bg-muted/50 p-2"><div className="text-lg font-bold">{formatCurrency(importPreview.expectedDailyCollection)}</div><div className="text-xs text-muted-foreground">প্রত্যাশিত দৈনিক</div></div>
                     </div>
                     <p className="text-sm">মোট লাইন: {importRows.length}, সঠিক: {importPreview.valid}</p>
                    {importRows.length > 0 && (
                      <div className="max-h-48 overflow-y-auto border rounded-md mt-3">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/50 sticky top-0"><tr><th className="text-left p-2">No.</th><th className="text-left p-2">Member Name</th><th className="text-right p-2">Shares</th><th className="text-right p-2">Daily Contribution</th></tr></thead>
                          <tbody>{importRows.map((row, index) => {
                            const shares = Number(row.shares) || 0
                            const daily = shares * (importCycle?.dailyPerShare ?? 100)
                            return <tr key={`${row.name}-${index}`} className="border-t"><td className="p-2">{index + 1}</td><td className="p-2">{row.name || "—"}</td><td className="p-2 text-right">{shares}</td><td className="p-2 text-right font-medium">{formatCurrency(daily)}</td></tr>
                          })}</tbody>
                        </table>
                      </div>
                    )}
                    {importPreview.errors.length > 0 && (
                      <div className="max-h-32 overflow-y-auto text-xs space-y-1 mt-2">
                        {importPreview.errors.map((err, i) => (
                          <div key={i} className="text-destructive flex items-start gap-1">
                            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                            Row {err.row}: {err.message}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsImportOpen(false)}>বাতিল</Button>
                <Button 
                   onClick={() => {
                     if (!importPreview || importPreview.errors.length > 0) return
                      if (!window.confirm(`এই preview অনুমোদন করে ${importPreview.memberCount} জন সদস্য ও ${importPreview.totalShares} shares “${importCycle?.name ?? "selected cycle"}”-এ commit করবেন?`)) return
                     importMembers.mutate({
                       data: { dryRun: false, rows: importRows, cycleId: Number(importCycleId), confirmImport: true, previewToken: importPreview.previewToken }
                     }, {
                       onSuccess: (data) => {
                         toast.success(`${data.imported} জন সদস্য সফলভাবে যোগ করা হয়েছে`)
                         setIsImportOpen(false)
                         setImportRows([])
                         setImportPreview(null)
                         setImportCycleId("")
                         refetch()
                       },
                       onError: (err: any) => toast.error(err.message || "Import failed")
                     })
                   }} 
                   disabled={importMembers.isPending || !importPreview || importPreview.errors.length > 0 || !importCycleId}
                >
                   Preview অনুমোদন করে Commit
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {user?.role === "OWNER" && (
            <Dialog open={isDueEntryOpen} onOpenChange={(open) => {
              setIsDueEntryOpen(open)
              if (!open) resetDueEntry()
            }}>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>আগের বকেয়া — Previous Due</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="dueCycle">চক্র / সময়কাল (Cycle / Period)</Label>
                    <select
                      id="dueCycle"
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={dueEntry.cycleId}
                      onChange={(event) => setDueEntry({ ...dueEntry, cycleId: event.target.value })}
                    >
                      <option value="">active cycle নির্বাচন করুন</option>
                      {activeCycles.map((cycle) => (
                        <option key={cycle.id} value={cycle.id}>{cycle.name} · Cycle #{cycle.cycleNumber}</option>
                      ))}
                    </select>
                    {activeCycles.length === 0 && <p className="text-xs text-destructive">কোনো active cycle পাওয়া যায়নি।</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dueMember">সদস্য (Member)</Label>
                    <select
                      id="dueMember"
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={dueEntry.memberId}
                      onChange={(event) => setDueEntry({ ...dueEntry, memberId: event.target.value })}
                    >
                      <option value="">সদস্য নির্বাচন করুন</option>
                      {members?.map((member) => (
                        <option key={member.id} value={member.id}>{member.name} · {member.memberId}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dueAmount">Amount (৳)</Label>
                    <Input
                      id="dueAmount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="e.g. 500"
                      value={dueEntry.amount}
                      onChange={(event) => setDueEntry({ ...dueEntry, amount: event.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dueReason">Reason / Note</Label>
                    <textarea
                      id="dueReason"
                      className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                      placeholder="বকেয়ার কারণ লিখুন (Required)"
                      value={dueEntry.reason}
                      onChange={(event) => setDueEntry({ ...dueEntry, reason: event.target.value })}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Entry date: {dueEntry.dueDate}. Owner-এর নাম ও save time audit-এ স্বয়ংক্রিয়ভাবে record হবে।
                  </p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsDueEntryOpen(false)}>Cancel</Button>
                  <Button onClick={reviewDueEntry} disabled={createDueEntry.isPending || activeCycles.length === 0}>
                    Review Due
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          {user?.role === "OWNER" && (
            <Dialog open={isDueConfirmationOpen} onOpenChange={setIsDueConfirmationOpen}>
              <DialogContent className="sm:max-w-[450px]">
                <DialogHeader>
                  <DialogTitle>নিশ্চিত করুন (Confirm Due Entry)</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-4">
                  <div className="rounded-lg bg-muted/50 p-4 space-y-2 text-sm">
                    <div className="flex justify-between gap-4"><span className="text-muted-foreground">Member</span><span className="font-semibold text-right">{selectedDueMember?.name} · {selectedDueMember?.memberId}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-muted-foreground">Cycle / Period</span><span className="font-semibold text-right">{selectedDueCycle?.name}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-muted-foreground">Amount</span><span className="font-semibold text-primary">{formatCurrency(Number(dueEntry.amount))}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-muted-foreground">Date</span><span className="font-semibold">{dueEntry.dueDate}</span></div>
                  </div>
                  <div className="rounded-lg border p-3 text-sm">
                    <p className="text-muted-foreground">Reason / Note</p>
                    <p className="mt-1 font-medium whitespace-pre-wrap">{dueEntry.reason.trim()}</p>
                  </div>
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3">
                    Save করার পর এই Previous Due collector-এর Total Due-তে carry forward হবে।
                  </p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsDueConfirmationOpen(false)}>Cancel</Button>
                  <Button onClick={saveDueEntry} disabled={createDueEntry.isPending}>
                    {createDueEntry.isPending ? "Saving..." : "Save Due"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button className="flex-1 sm:flex-none gap-2">
                <UserPlus className="w-4 h-4" /> নতুন সদস্য
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>নতুন সদস্য যোগ করুন (Add Member)</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="memberId" className="text-right">ID</Label>
                  <Input id="memberId" value={newMember.memberId} onChange={e => setNewMember({...newMember, memberId: e.target.value})} className="col-span-3" />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="name" className="text-right">নাম (Name)</Label>
                  <Input id="name" value={newMember.name} onChange={e => setNewMember({...newMember, name: e.target.value})} className="col-span-3" />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="mobile" className="text-right">মোবাইল (Mobile)</Label>
                  <Input id="mobile" value={newMember.mobile} onChange={e => setNewMember({...newMember, mobile: e.target.value})} className="col-span-3" />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="address" className="text-right">ঠিকানা (Address)</Label>
                  <Input id="address" value={newMember.address} onChange={e => setNewMember({...newMember, address: e.target.value})} className="col-span-3" />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="nid" className="text-right">NID</Label>
                  <Input id="nid" value={newMember.nid} onChange={e => setNewMember({...newMember, nid: e.target.value})} className="col-span-3" />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="shares" className="text-right">প্রোফাইল শেয়ার</Label>
                  <Input id="shares" type="number" value={newMember.shares} onChange={e => setNewMember({...newMember, shares: Number(e.target.value)})} className="col-span-3" />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="dailyAmount" className="text-right">প্রোফাইল দৈনিক জমা</Label>
                  <Input id="dailyAmount" type="number" value={newMember.dailyAmount} onChange={e => setNewMember({...newMember, dailyAmount: Number(e.target.value)})} className="col-span-3" />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="memberNotes" className="text-right">নোট</Label>
                  <Input id="memberNotes" value={newMember.notes} onChange={e => setNewMember({...newMember, notes: e.target.value})} className="col-span-3" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-right">Cycle-এর shares ও daily due আলাদা cycle screen-এ নির্ধারিত হয়।</p>
              <DialogFooter>
                <Button onClick={handleAdd} disabled={createMember.isPending}>সংরক্ষণ করুন (Save)</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex items-center gap-2 max-w-sm">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search members..." 
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">ID</TableHead>
              <TableHead>নাম (Name)</TableHead>
              <TableHead>মোবাইল (Mobile)</TableHead>
              <TableHead className="text-right">দৈনিক জমা (Daily)</TableHead>
              <TableHead className="text-right">আগের বকেয়া (Previous)</TableHead>
              <TableHead className="text-right">মোট বকেয়া (Total)</TableHead>
              <TableHead className="text-right">আজকের বকেয়া (Due)</TableHead>
              <TableHead>স্ট্যাটাস</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">লোড হচ্ছে (Loading...)</TableCell></TableRow>
            ) : members?.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">কোন তথ্য নেই</TableCell></TableRow>
            ) : (
              members?.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">{member.memberId}</TableCell>
                  <TableCell><Link href={`/members/${member.id}/history`} className="font-medium hover:text-primary hover:underline">{member.name}</Link>{member.notes && <div className="text-xs text-muted-foreground">{member.notes}</div>}</TableCell>
                  <TableCell>{member.mobile}</TableCell>
                  <TableCell className="text-right">{formatCurrency(member.dailyAmount)}</TableCell>
                  <TableCell className="text-right font-medium text-amber-900">{formatCurrency(member.previousDue ?? 0)}</TableCell>
                  <TableCell className="text-right font-bold text-destructive">{formatCurrency(member.totalDue ?? member.todayDue)}</TableCell>
                  <TableCell className="text-right font-bold text-destructive">{formatCurrency(member.todayDue)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${member.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {member.status}
                    </span>
                    {user?.role === "OWNER" && <Button variant="ghost" size="sm" className="ml-2 h-7 px-2" onClick={() => updateMember.mutate({ id: member.id, data: { status: member.status === "active" ? "inactive" : "active" } }, { onSuccess: () => { toast.success("সদস্যের স্ট্যাটাস আপডেট হয়েছে"); refetch() }, onError: () => toast.error("স্ট্যাটাস আপডেট করা যায়নি") })}>{member.status === "active" ? "Inactive" : "Active"}</Button>}
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