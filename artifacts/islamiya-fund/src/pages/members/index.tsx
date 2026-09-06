import { useState } from "react"
import { useListMembers, useCreateMember } from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { formatCurrency } from "@/lib/utils"
import { Plus, Search, UserPlus } from "lucide-react"

export default function MembersPage() {
  const [search, setSearch] = useState("")
  const [isAddOpen, setIsAddOpen] = useState(false)
  
  const { data: members, isLoading, refetch } = useListMembers({ search: search || undefined })
  const createMember = useCreateMember()

  const [newMember, setNewMember] = useState({
    memberId: "",
    name: "",
    mobile: "",
    address: "",
    shares: 1,
    dailyAmount: 100
  })

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
        setNewMember({ memberId: "", name: "", mobile: "", address: "", shares: 1, dailyAmount: 100 })
        refetch()
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
          <h1 className="text-2xl font-bold tracking-tight text-primary">সদস্য <span className="text-muted-foreground text-lg font-normal ml-2">Members</span></h1>
          <p className="text-muted-foreground">সদস্য পরিচালনা ও তালিকা (Manage Members)</p>
        </div>
        
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button className="w-full sm:w-auto gap-2">
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
            </div>
            <DialogFooter>
              <Button onClick={handleAdd} disabled={createMember.isPending}>সংরক্ষণ করুন (Save)</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
                  <TableCell>{member.name}</TableCell>
                  <TableCell>{member.mobile}</TableCell>
                  <TableCell className="text-right">{formatCurrency(member.dailyAmount)}</TableCell>
                  <TableCell className="text-right font-bold text-destructive">{formatCurrency(member.todayDue)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${member.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {member.status}
                    </span>
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
