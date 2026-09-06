import { useState, useEffect } from "react"
import { useGetSettings, useUpdateSettings } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

export default function SettingsPage() {
  const { data: settings, isLoading } = useGetSettings()
  const updateSettings = useUpdateSettings()
  
  const [formData, setFormData] = useState({
    organizationName: "",
    expectedMembers: 0,
    defaultDailyPerShare: 0
  })

  useEffect(() => {
    if (settings) {
      setFormData({
        organizationName: settings.organizationName,
        expectedMembers: settings.expectedMembers,
        defaultDailyPerShare: settings.defaultDailyPerShare
      })
    }
  }, [settings])

  const handleSave = () => {
    updateSettings.mutate({
      data: formData
    }, {
      onSuccess: () => toast.success("সেটিংস সংরক্ষিত হয়েছে (Settings Saved)"),
      onError: () => toast.error("ব্যর্থ হয়েছে (Failed)")
    })
  }

  if (isLoading) return <div>লোড হচ্ছে...</div>

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">সেটিংস <span className="text-muted-foreground text-lg font-normal ml-2">Settings</span></h1>
        <p className="text-muted-foreground">সিস্টেম কনফিগারেশন (System Configuration)</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>সাধারণ সেটিংস (General)</CardTitle>
          <CardDescription>প্রতিষ্ঠানের তথ্য ও নিয়ম</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>প্রতিষ্ঠানের নাম (Organization Name)</Label>
            <Input 
              value={formData.organizationName} 
              onChange={e => setFormData({...formData, organizationName: e.target.value})}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>প্রত্যাশিত সদস্য (Expected Members)</Label>
              <Input 
                type="number" 
                value={formData.expectedMembers} 
                onChange={e => setFormData({...formData, expectedMembers: Number(e.target.value)})}
              />
            </div>
            <div className="space-y-2">
              <Label>ডিফল্ট দৈনিক জমা (Default Daily/Share)</Label>
              <Input 
                type="number" 
                value={formData.defaultDailyPerShare} 
                onChange={e => setFormData({...formData, defaultDailyPerShare: Number(e.target.value)})}
              />
            </div>
          </div>
          
          <Button onClick={handleSave} disabled={updateSettings.isPending} className="mt-4">
            সংরক্ষণ করুন (Save)
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
