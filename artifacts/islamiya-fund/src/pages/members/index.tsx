import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { getGetDashboardQueryKey, getListCycleMembersQueryKey, getListMembersQueryKey, useListMembers, useCreateMember, useCreateDueEntries, useImportMembers, useListCycles, useUpdateMember, useGetCurrentUser } from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { businessDate, formatCurrency } from "@/lib/utils"
import { Search, UserPlus, Upload, Download, AlertTriangle, WalletCards, Pencil, Check, X } from "lucide-react"
import { downloadCsvTemplate, parseCsv } from "@/lib/csv"
import { Link } from "wouter"

export default function MembersPage() {
  const [search, setSearch] = useState("")
  const [selectedMemberId, setSelectedMemberId] = useState("")
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  
  const { data: members, isLoading, refetch } = useListMembers({ search: search || undefined })
  const { data: allMembers } = useListMembers({})
  const { data: cycles } = useListCycles()
  const { data: user } = useGetCurrentUser()
  const createMember = useCreateMember()
  const createDueEntries = useCreateDueEntries()
  const importMembers = useImportMembers()
  const updateMember = useUpdateMember()
  const queryClient = useQueryClient()

  const [newMember, setNewMember] = useState({
    name: "",
    mobile: "",
    businessName: "",
    address: "",
    nid: "",
    shares: 1,
    dailyAmount: 100,
    notes: ""
  })

  // Import State
  const [importRows, setImportRows] = useState<any[]>([])
  const [importPreview, setImportPreview] = useState<{valid: number, imported: number, errors: any[], memberCount: number, totalShares: number, expectedDailyCollection: number, previewToken: string, previewRows?: Array<{row: number, name: string, shares: number, mobile: string, mobileStatus: "provided" | "missing", existingMember?: {id: number, memberId: string, name: string} | null}>} | null>(null)
  const [importCycleId, setImportCycleId] = useState("")
  const importCycle = cycles?.find((cycle) => cycle.id === Number(importCycleId))
  const activeCycles = cycles?.filter((cycle) => cycle.status === "ACTIVE") ?? []
  const [editingMember, setEditingMember] = useState<any | null>(null)
  const [editMobile, setEditMobile] = useState("")
  const [isDueEntryOpen, setIsDueEntryOpen] = useState(false)
  const [isDueConfirmationOpen, setIsDueConfirmationOpen] = useState(false)
  const [dueEntry, setDueEntry] = useState({
    cycleId: "",
    memberIds: [] as number[],
    amount: "",
    reason: "",
    dueDate: businessDate(),
  })
  const [dueMemberSearch, setDueMemberSearch] = useState("")
  const selectedDueCycle = activeCycles.find((cycle) => cycle.id === Number(dueEntry.cycleId))
  const selectedDueMembers = useMemo(
    () => (allMembers ?? []).filter((member) => dueEntry.memberIds.includes(member.id)),
    [allMembers, dueEntry.memberIds],
  )
  const filteredDueMembers = useMemo(() => {
    const term = dueMemberSearch.trim().toLowerCase()
    if (!term) return allMembers ?? []
    return (allMembers ?? []).filter((member) =>
      `${member.memberId} ${member.name} ${member.mobile ?? ""}`.toLowerCase().includes(term),
    )
  }, [allMembers, dueMemberSearch])

  useEffect(() => {
    if (!importCycleId) {
      const activeCycle = cycles?.find((cycle) => cycle.status === "ACTIVE")
      if (activeCycle) setImportCycleId(String(activeCycle.id))
    }
  }, [cycles, importCycleId])

  const handleAdd = () => {
    if (!newMember.mobile.trim()) {
      toast.error("নতুন সদস্যের মোবাইল নম্বর আবশ্যক (Mobile is required)")
      return
    }
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
         setNewMember({ name: "", mobile: "", businessName: "", address: "", nid: "", shares: 1, dailyAmount: 100, notes: "" })
        refetch()
      },
      onError: (err: any) => {
        toast.error(err.message || "ব্যর্থ হয়েছে")
      }
    })
  }

  const openMemberEdit = (member: any) => {
    setEditingMember(member)
    setEditMobile(member.mobile ?? "")
  }

  const saveMemberEdit = () => {
    const mobile = editMobile.trim()
    if (!mobile) {
      toast.error("মোবাইল নম্বর দিন (Enter a mobile number)")
      return
    }
    updateMember.mutate({
      id: editingMember.id,
      data: { mobile },
    }, {
      onSuccess: () => {
        toast.success("মোবাইল নম্বর আপডেট হয়েছে (Mobile updated)")
        setEditingMember(null)
        setEditMobile("")
        refetch()
      },
      onError: (error: any) => toast.error(error?.message || "মোবাইল নম্বর আপডেট করা যায়নি"),
    })
  }

  const resetDueEntry = () => {
    const activeCycle = activeCycles[0]
    setDueEntry({
      cycleId: activeCycle ? String(activeCycle.id) : "",
      memberIds: [],
      amount: "",
      reason: "",
      dueDate: businessDate(),
    })
    setDueMemberSearch("")
    setIsDueConfirmationOpen(false)
  }

  const openDueEntry = () => {
    resetDueEntry()
    setIsDueEntryOpen(true)
  }

  const reviewDueEntry = () => {
    const amount = Number(dueEntry.amount)
    if (!dueEntry.cycleId || dueEntry.memberIds.length === 0) {
      toast.error("কমপক্ষে একজন সদস্য ও active cycle নির্বাচন করুন (Select at least one member and cycle)")
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
    const amount = Number(dueEntry.amount)
    createDueEntries.mutate({
      data: {
        cycleId,
        memberIds: dueEntry.memberIds,
        amount,
        dueDate: dueEntry.dueDate,
        reason: dueEntry.reason.trim(),
        idempotencyKey: crypto.randomUUID(),
      },
    }, {
      onSuccess: () => {
        toast.success(`${dueEntry.memberIds.length} জন সদস্যের Previous Due সংরক্ষণ করা হয়েছে`)
        queryClient.invalidateQueries({ queryKey: getListMembersQueryKey() })
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() })
        queryClient.invalidateQueries({ queryKey: getListCycleMembersQueryKey(cycleId) })
        setIsDueEntryOpen(false)
        resetDueEntry()
      },
      onError: (error: any) => {
        toast.error(error?.message || "কোনো Previous Due সংরক্ষণ করা হয়নি (No due entries were saved)")
      },
    })
  }

  const toggleDueMember = (memberId: number) => {
    setDueEntry((current) => ({
      ...current,
      memberIds: current.memberIds.includes(memberId)
        ? current.memberIds.filter((id) => id !== memberId)
        : [...current.memberIds, memberId],
    }))
  }

  const selectAllDueMembers = () => {
    setDueEntry((current) => ({
      ...current,
      memberIds: Array.from(new Set((allMembers ?? []).filter((member) => member.status === "active").map((member) => member.id))),
    }))
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
                    <p className="text-xs text-muted-foreground">ফরম্যাট: name,businessName,mobile,shares · Mobile optional</p>
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
                   <Label>চক্রে যোগ করুন (ঐচ্ছিক)</Label>
                  <select className="h-10 mt-1 w-full rounded-md border bg-background px-3 text-sm" value={importCycleId} onChange={(event) => setImportCycleId(event.target.value)}>
                      <option value="">শুধু member master data</option>
                    {cycles?.filter((cycle) => cycle.status === "ACTIVE").map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}
                  </select>
                    <p className="text-xs text-muted-foreground mt-1">চক্র নির্বাচন করলে সদস্যটি সেই active cycle-এও যোগ হবে। খালি রাখলে শুধু member master data import হবে; পুরনো payment বা dues আসবে না।</p>
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
                          <thead className="bg-muted/50 sticky top-0"><tr><th className="text-left p-2">No.</th><th className="text-left p-2">Member Name</th><th className="text-left p-2">Business Name</th><th className="text-left p-2">Mobile</th><th className="text-left p-2">Match</th><th className="text-right p-2">Shares</th><th className="text-right p-2">Daily Contribution</th></tr></thead>
                          <tbody>{importRows.map((row, index) => {
                            const shares = Number(row.shares) || 0
                            const daily = shares * (importCycle?.dailyPerShare ?? 100)
                           const previewRow = importPreview.previewRows?.find((item) => item.row === index + 2)
                            return <tr key={`${row.name}-${index}`} className="border-t"><td className="p-2">{index + 1}</td><td className="p-2">{row.name || "—"}</td><td className="p-2">{row.businessName || "—"}</td><td className="p-2">{previewRow?.mobileStatus === "missing" || !row.mobile ? "Missing / Not provided" : row.mobile}</td><td className="p-2">{previewRow?.existingMember ? `Existing: ${previewRow.existingMember.memberId}` : "New / no match"}</td><td className="p-2 text-right">{shares}</td><td className="p-2 text-right font-medium">{formatCurrency(daily)}</td></tr>
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
                       if (!window.confirm(`এই preview অনুমোদন করে ${importPreview.memberCount} জন সদস্য ও ${importPreview.totalShares} shares ${importCycle ? `“${importCycle.name}”-এ` : "member master data হিসেবে"} commit করবেন?`)) return
                     importMembers.mutate({
                        data: { dryRun: false, rows: importRows, cycleId: importCycleId ? Number(importCycleId) : undefined, confirmImport: true, previewToken: importPreview.previewToken }
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
                    disabled={importMembers.isPending || !importPreview || importPreview.errors.length > 0}
                >
                   Preview অনুমোদন করে Commit
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={Boolean(editingMember)} onOpenChange={(open) => {
            if (!open) {
              setEditingMember(null)
              setEditMobile("")
            }
          }}>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>মোবাইল যোগ করুন (Add Mobile)</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="rounded-lg bg-muted/50 p-3 text-sm">
                  <div className="font-medium">{editingMember?.name}</div>
                  <div className="text-muted-foreground">{editingMember?.memberId}</div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editMemberMobile">মোবাইল (Mobile)</Label>
                  <Input
                    id="editMemberMobile"
                    value={editMobile}
                    onChange={(event) => setEditMobile(event.target.value)}
                    placeholder="01XXXXXXXXX"
                    autoFocus
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditingMember(null)}>Cancel</Button>
                <Button onClick={saveMemberEdit} disabled={updateMember.isPending}>
                  {updateMember.isPending ? "Saving..." : "Save Mobile"}
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
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="dueMemberSearch">সদস্য (Member)</Label>
                      <span className="text-xs text-muted-foreground">{dueEntry.memberIds.length} selected</span>
                    </div>
                    {selectedDueMembers.length > 0 && (
                      <div className="flex flex-wrap gap-2 rounded-md border bg-muted/30 p-2">
                        {selectedDueMembers.map((member) => (
                          <span key={member.id} className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs">
                            <span className="font-medium">{member.memberId}</span>
                            <span className="max-w-[160px] truncate">{member.name}</span>
                            <button
                              type="button"
                              aria-label={`${member.memberId} remove`}
                              className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                              onClick={() => toggleDueMember(member.id)}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="dueMemberSearch"
                        value={dueMemberSearch}
                        onChange={(event) => setDueMemberSearch(event.target.value)}
                        placeholder="Member ID, নাম বা Mobile দিয়ে খুঁজুন"
                        className="pl-9"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">Bangla name original form-এ থাকবে · Search: ID / Name / Mobile</p>
                      <div className="flex shrink-0 gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={selectAllDueMembers}>Select All</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setDueEntry((current) => ({ ...current, memberIds: [] }))} disabled={dueEntry.memberIds.length === 0}>Clear All</Button>
                      </div>
                    </div>
                    <div className="max-h-48 overflow-y-auto rounded-md border">
                      {filteredDueMembers.filter((member) => member.status === "active").map((member) => {
                        const selected = dueEntry.memberIds.includes(member.id)
                        return (
                          <button
                            type="button"
                            key={member.id}
                            aria-pressed={selected}
                            onClick={() => toggleDueMember(member.id)}
                            className={`flex w-full items-center gap-3 border-b p-2.5 text-left last:border-b-0 ${selected ? "bg-primary/5" : "hover:bg-muted/50"}`}
                          >
                            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                              {selected && <Check className="h-3.5 w-3.5" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{member.name}</span>
                              <span className="block truncate text-xs text-muted-foreground">{member.memberId}{member.mobile ? ` · ${member.mobile}` : ""}</span>
                            </span>
                            {selected && <span className="text-xs font-medium text-primary">Selected</span>}
                          </button>
                        )
                      })}
                      {filteredDueMembers.filter((member) => member.status === "active").length === 0 && (
                        <p className="p-4 text-center text-sm text-muted-foreground">কোনো active member পাওয়া যায়নি</p>
                      )}
                    </div>
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
                  <Button onClick={reviewDueEntry} disabled={createDueEntries.isPending || activeCycles.length === 0}>
                    Review Due
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          {user?.role === "OWNER" && (
            <Dialog open={isDueConfirmationOpen} onOpenChange={setIsDueConfirmationOpen}>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>নিশ্চিত করুন (Confirm Due Entry)</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-4">
                    <div className="rounded-lg bg-muted/50 p-4 space-y-2 text-sm">
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Members</span><span className="font-semibold text-right">{selectedDueMembers.length} selected</span></div>
                    <div className="flex justify-between gap-4"><span className="text-muted-foreground">Cycle / Period</span><span className="font-semibold text-right">{selectedDueCycle?.name}</span></div>
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Amount per member</span><span className="font-semibold text-primary">{formatCurrency(Number(dueEntry.amount))}</span></div>
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Total batch amount</span><span className="font-semibold text-primary">{formatCurrency(Number(dueEntry.amount) * selectedDueMembers.length)}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-muted-foreground">Date</span><span className="font-semibold">{dueEntry.dueDate}</span></div>
                  </div>
                    <div className="max-h-36 overflow-y-auto rounded-lg border p-3 text-sm">
                      <p className="mb-2 text-muted-foreground">Selected members</p>
                      <div className="space-y-1">
                        {selectedDueMembers.map((member) => (
                          <div key={member.id} className="flex items-center justify-between gap-3">
                            <span className="truncate">{member.name}</span>
                            <span className="shrink-0 font-mono text-xs text-muted-foreground">{member.memberId}</span>
                          </div>
                        ))}
                      </div>
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
                  <Button onClick={saveDueEntry} disabled={createDueEntries.isPending}>
                    {createDueEntries.isPending ? "Saving..." : "Confirm & Save Due"}
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
                  <Label className="text-right">ID</Label>
                  <div className="col-span-3 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">সিস্টেম স্বয়ংক্রিয়ভাবে IRF-### ID তৈরি করবে</div>
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
                  <Label htmlFor="businessName" className="text-right">ব্যবসার নাম</Label>
                  <Input id="businessName" value={newMember.businessName} onChange={e => setNewMember({...newMember, businessName: e.target.value})} className="col-span-3" />
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

      <div className="flex flex-col sm:flex-row items-stretch gap-2 max-w-2xl">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="নাম, Member ID বা Mobile দিয়ে খুঁজুন..."
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setSelectedMemberId("")
            }}
          />
        </div>
        <select
          aria-label="সদস্য নির্বাচন করুন"
          className="h-10 min-w-[220px] rounded-md border bg-background px-3 text-sm"
          value={selectedMemberId}
          onChange={(e) => {
            const memberId = e.target.value
            setSelectedMemberId(memberId)
            const selectedMember = allMembers?.find((member) => String(member.id) === memberId)
            setSearch(selectedMember?.memberId ?? "")
          }}
        >
          <option value="">সদস্য নির্বাচন করুন...</option>
          {allMembers?.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name} · {member.memberId}
            </option>
          ))}
        </select>
        {selectedMemberId && (
          <Button
            variant="ghost"
            onClick={() => {
              setSelectedMemberId("")
              setSearch("")
            }}
          >
            সব দেখুন
          </Button>
        )}
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">ID</TableHead>
              <TableHead>নাম (Name)</TableHead>
              <TableHead>ব্যবসা (Business)</TableHead>
              <TableHead>মোবাইল (Mobile)</TableHead>
              <TableHead className="text-right">দৈনিক জমা (Daily)</TableHead>
              <TableHead className="text-right">আগের বকেয়া (Previous)</TableHead>
              <TableHead className="text-right">মোট বকেয়া (Total)</TableHead>
               <TableHead className="text-right">Current Collection</TableHead>
              <TableHead>স্ট্যাটাস</TableHead>
              <TableHead className="text-right">অ্যাকশন</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">লোড হচ্ছে (Loading...)</TableCell></TableRow>
            ) : members?.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">কোন তথ্য নেই</TableCell></TableRow>
            ) : (
              members?.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">{member.memberId}</TableCell>
                  <TableCell><Link href={`/members/${member.id}/history`} className="font-medium hover:text-primary hover:underline">{member.name}</Link>{member.notes && <div className="text-xs text-muted-foreground">{member.notes}</div>}</TableCell>
                  <TableCell>{member.businessName || "—"}</TableCell>
                  <TableCell>{member.mobile || <span className="text-amber-700">Missing / Not provided</span>}</TableCell>
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
                   <TableCell className="text-right">
                     {user?.role === "OWNER" && (
                       <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => openMemberEdit(member)}>
                         <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                       </Button>
                     )}
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