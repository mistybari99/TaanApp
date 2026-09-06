import { useState, useEffect } from "react"
import { useLocation } from "wouter"
import { useLogin } from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { toast } from "sonner"
import { Wallet } from "lucide-react"

export default function LoginPage() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [, setLocation] = useLocation()
  
  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data) => {
        toast.success(`স্বাগতম (Welcome), ${data.name}!`)
        if (data.role === "OWNER") {
          setLocation("/owner")
        } else {
          setLocation("/collector")
        }
      },
      onError: (error) => {
        toast.error("লগইন ব্যর্থ হয়েছে (Login failed)")
      }
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    loginMutation.mutate({
      data: { username, password }
    })
  }

  const fillDemo = (role: "owner" | "collector") => {
    if (role === "owner") {
      setUsername("owner")
      setPassword("owner123")
    } else {
      setUsername("collector")
      setPassword("collect123")
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center justify-center space-y-2 text-center">
          <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center text-primary-foreground shadow-lg">
            <Wallet className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-primary mt-4 tracking-tight">ISLAMIYA</h1>
          <p className="text-muted-foreground text-sm font-medium tracking-widest uppercase">Revolving Fund</p>
        </div>

        <Card className="border-t-4 border-t-primary shadow-xl">
          <CardHeader className="space-y-1 pb-4 text-center">
            <CardTitle className="text-xl font-bold">লগইন (Login)</CardTitle>
            <CardDescription>
              এগিয়ে যেতে আপনার তথ্য দিন
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">ইউজারনেম (Username)</Label>
                <Input 
                  id="username" 
                  value={username} 
                  onChange={(e) => setUsername(e.target.value)} 
                  placeholder="Enter username" 
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">পাসওয়ার্ড (Password)</Label>
                <Input 
                  id="password" 
                  type="password" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  placeholder="Enter password" 
                  required
                />
              </div>
              <Button 
                type="submit" 
                className="w-full h-12 text-base font-bold" 
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? "অপেক্ষা করুন..." : "প্রবেশ করুন (Sign In)"}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="flex flex-col space-y-4 pt-0">
            <div className="relative w-full">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground font-medium">Demo Access</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 w-full">
              <Button variant="outline" size="sm" onClick={() => fillDemo("owner")} type="button">
                Owner Demo
              </Button>
              <Button variant="outline" size="sm" onClick={() => fillDemo("collector")} type="button">
                Collector Demo
              </Button>
            </div>
            <p className="text-center text-[10px] text-muted-foreground mt-4">
              Browser fingerprint access is optional and raw fingerprints are never stored.
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
