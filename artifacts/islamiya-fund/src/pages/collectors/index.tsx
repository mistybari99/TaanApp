import { useListCollectors } from "@workspace/api-client-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { UserSquare } from "lucide-react"

export default function CollectorsPage() {
  const { data: collectors, isLoading } = useListCollectors()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">কর্মী <span className="text-muted-foreground text-lg font-normal ml-2">Staff</span></h1>
        <p className="text-muted-foreground">কালেক্টর তালিকা (Collector List)</p>
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>নাম (Name)</TableHead>
              <TableHead>ইউজারনেম (Username)</TableHead>
              <TableHead>রোল (Role)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={3} className="text-center py-8">লোড হচ্ছে...</TableCell></TableRow>
            ) : collectors?.length === 0 ? (
              <TableRow><TableCell colSpan={3} className="text-center py-8">কোন কর্মী নেই</TableCell></TableRow>
            ) : (
              collectors?.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium flex items-center gap-2">
                    <UserSquare className="w-4 h-4 text-primary" /> {user.name}
                  </TableCell>
                  <TableCell>{user.username}</TableCell>
                  <TableCell>
                    <span className="text-xs bg-muted px-2 py-1 rounded capitalize">{user.role.toLowerCase()}</span>
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
