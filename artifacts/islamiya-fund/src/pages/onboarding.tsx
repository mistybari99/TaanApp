import { useState } from "react";
import { useLocation } from "wouter";
import { useInitializeFund } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Wallet } from "lucide-react";

export default function OnboardingPage() {
  const [, setLocation] = useLocation();
  const initMutation = useInitializeFund();

  const [formData, setFormData] = useState({
    organizationName: "",
    ownerName: "",
    username: "",
    password: ""
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    initMutation.mutate({ data: formData }, {
      onSuccess: () => {
        toast.success("সিস্টেম চালু হয়েছে (System Initialized Successfully)");
        setLocation("/");
      },
      onError: (err: any) => {
        toast.error(err?.message || "ব্যর্থ হয়েছে (Initialization Failed)");
      }
    });
  };

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center justify-center space-y-2 text-center">
          <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center text-primary-foreground shadow-lg">
            <Wallet className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-primary mt-4 tracking-tight">ISLAMIYA Revolving Fund</h1>
        </div>

        <Card className="border-t-4 border-t-primary shadow-xl">
          <CardHeader className="space-y-1 pb-4 text-center">
            <CardTitle className="text-xl font-bold">প্রথম সেটআপ (First Setup)</CardTitle>
            <CardDescription>
              মালিকের অ্যাকাউন্ট এবং প্রতিষ্ঠানের নাম সেট করুন
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="organizationName">প্রতিষ্ঠানের নাম (Organization Name)</Label>
                <Input 
                  id="organizationName" 
                  value={formData.organizationName} 
                  onChange={(e) => setFormData({...formData, organizationName: e.target.value})} 
                  required
                  minLength={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ownerName">আপনার নাম (Your Name)</Label>
                <Input 
                  id="ownerName" 
                  value={formData.ownerName} 
                  onChange={(e) => setFormData({...formData, ownerName: e.target.value})} 
                  required
                  minLength={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="username">ইউজারনেম (Username)</Label>
                <Input 
                  id="username" 
                  value={formData.username} 
                  onChange={(e) => setFormData({...formData, username: e.target.value})} 
                  required
                  minLength={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">পাসওয়ার্ড (Password)</Label>
                <Input 
                  id="password" 
                  type="password" 
                  autoComplete="new-password"
                  value={formData.password} 
                  onChange={(e) => setFormData({...formData, password: e.target.value})} 
                  required
                  minLength={8}
                />
              </div>
              <Button 
                type="submit" 
                className="w-full h-12 text-base font-bold" 
                disabled={initMutation.isPending}
              >
                {initMutation.isPending ? "অপেক্ষা করুন..." : "সংরক্ষণ করুন (Complete Setup)"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}