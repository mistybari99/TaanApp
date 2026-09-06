import { useEffect, useState } from "react"
import { useListMembers, useCreateMember, useImportMembers, useListCycles, useUpdateMember, useGetCurrentUser } from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { formatCurrency } from "@/lib/utils"
import { Search, UserPlus, Upload, Download, AlertTriangle } from "lucide-react"
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
  const importMembers = useImportMembers()
  const updateMember = useUpdateMember()

  const [newMember, setNewMember] = useState({
    memberId: "",
    name: "",
    mobile: "",
    address: "",
    shares: 1,
    dailyAmount: 100,
    notes: ""
  })

  // Import State
  const [importRows, setImportRows] = useState<any[]>([])
  const [importPreview, setImportPreview] = useState<{valid: number, imported: number, errors: any[]} | null>(null)
  const [importCycleId, setImportCycleId] = useState("")
  const importCycle = cycles?.find((cycle) => cycle.id === Number(importCycleId))

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
        setNewMember({ memberId: "", name: "", mobile: "", address: "", shares: 1, dailyAmount: 100, notes: "" })
        refetch()
      },
      onError: (err: any) => {
        toast.error(err.message || "ব্যর্থ হয়েছে")
      }
    })
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

  const handleCommitImport = () => {
    importMembers.mutate({
      data: { dryRun: false, rows: importRows, cycleId: importCycleId ? Number(importCycleId) : undefined }
    }, {
      onSuccess: (data) => {
        toast.success(`${data.imported} জন সদস্য সফলভাবে যোগ করা হয়েছে`);
        setIsImportOpen(false);
        setImportRows([]);
        setImportPreview(null);
        setImportCycleId("");
        refetch();
      },
      onError: (err: any) => toast.error(err.message || "Import failed")
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">সদস্য <span className="text-muted-foreground text-lg font-normal ml-2">Members</span></h1>
          <p className="text-muted-foreground">সদস্য পরিচালনা ও তালিকা (Manage Members)</p>
        </div>
        
        <div className="flex w-full sm:w-auto gap-2">
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
                    <p className="text-xs text-muted-foreground">টেমপ্লেট ডাউনলোড করে পূরণ করুন</p>
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
                    <option value="">শুধু permanent members তৈরি করুন</option>
                    {cycles?.filter((cycle) => cycle.status === "ACTIVE").map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">Cycle নির্বাচন করলে shares ওই cycle-এ প্রযোজ্য হবে।</p>
                </div>

                {importPreview && (
                  <div className="p-4 border rounded-lg bg-card space-y-2">
                    <h4 className="font-semibold text-sm flex items-center gap-2">
                      ভ্যালিডেশন রেজাল্ট 
                      {importPreview.errors.length === 0 ? 
                        <span className="text-green-600 text-xs px-2 bg-green-100 rounded">OK</span> : 
                        <span className="text-red-600 text-xs px-2 bg-red-100 rounded">Errors found</span>}
                    </h4>
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
                  onClick={handleCommitImport} 
                  disabled={importMembers.isPending || !importPreview || importPreview.errors.length > 0}
                >
                  ইম্পোর্ট নিশ্চিত করুন (Commit)
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

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
                  <Label htmlFor="shares" className="text-right">শেয়ার (Shares)</Label>
                  <Input id="shares" type="number" value={newMember.shares} onChange={e => setNewMember({...newMember, shares: Number(e.target.value)})} className="col-span-3" />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="dailyAmount" className="text-right">দৈনিক জমা</Label>
                  <Input id="dailyAmount" type="number" value={newMember.dailyAmount} onChange={e => setNewMember({...newMember, dailyAmount: Number(e.target.value)})} className="col-span-3" />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="memberNotes" className="text-right">নোট</Label>
                  <Input id="memberNotes" value={newMember.notes} onChange={e => setNewMember({...newMember, notes: e.target.value})} className="col-span-3" />
                </div>
              </div>
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
              <TableHead className="text-right">আজকের বকেয়া (Due)</TableHead>
              <TableHead>স্ট্যাটাস</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">লোড হচ্ছে (Loading...)</TableCell></TableRow>
            ) : members?.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">কোন তথ্য নেই</TableCell></TableRow>
            ) : (
              members?.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">{member.memberId}</TableCell>
                  <TableCell><Link href={`/members/${member.id}/history`} className="font-medium hover:text-primary hover:underline">{member.name}</Link>{member.notes && <div className="text-xs text-muted-foreground">{member.notes}</div>}</TableCell>
                  <TableCell>{member.mobile}</TableCell>
                  <TableCell className="text-right">{formatCurrency(member.dailyAmount)}</TableCell>
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