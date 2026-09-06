import * as React from "react"
import { useLocation, Link } from "wouter"
import { getGetCurrentUserQueryKey, useGetCurrentUser, useLogout } from "@workspace/api-client-react"
import { 
  LayoutDashboard, Users, UserSquare, Receipt, 
  ArrowDownToLine, FileText, Settings, Activity, 
  LogOut, Wallet, WifiOff, RefreshCw, Repeat2, Trophy, History
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useSync } from "@/contexts/sync-context"

interface NavItem {
  href: string;
  icon: React.ElementType;
  labelBn: string;
  labelEn: string;
  roles: string[];
}

const navItems: NavItem[] = [
  { href: "/owner", icon: LayoutDashboard, labelBn: "ড্যাশবোর্ড", labelEn: "Dashboard", roles: ["OWNER"] },
  { href: "/collector", icon: Wallet, labelBn: "সংগ্রহ", labelEn: "Collect", roles: ["COLLECTOR"] },
  { href: "/members", icon: Users, labelBn: "সদস্য", labelEn: "Members", roles: ["OWNER", "COLLECTOR"] },
  { href: "/cycles", icon: Repeat2, labelBn: "চক্র", labelEn: "Current Cycle", roles: ["OWNER", "COLLECTOR"] },
  { href: "/collectors", icon: UserSquare, labelBn: "কর্মী", labelEn: "Staff", roles: ["OWNER"] },
  { href: "/payments", icon: Receipt, labelBn: "লেনদেন", labelEn: "Payments", roles: ["OWNER", "COLLECTOR"] },
  { href: "/settlements", icon: ArrowDownToLine, labelBn: "জমা", labelEn: "Deposits", roles: ["OWNER", "COLLECTOR"] },
  { href: "/draws", icon: Trophy, labelBn: "শুক্রবার ড্র", labelEn: "Friday Draw", roles: ["OWNER"] },
  { href: "/draw-history", icon: History, labelBn: "ড্র ইতিহাস", labelEn: "Draw History", roles: ["OWNER", "COLLECTOR"] },
  { href: "/share-transfers", icon: Repeat2, labelBn: "শেয়ার transfer", labelEn: "Share Transfers", roles: ["OWNER"] },
  { href: "/member-history", icon: History, labelBn: "সদস্য ইতিহাস", labelEn: "Member History", roles: ["OWNER", "COLLECTOR"] },
  { href: "/reports", icon: FileText, labelBn: "রিপোর্ট", labelEn: "Reports", roles: ["OWNER"] },
  { href: "/settings", icon: Settings, labelBn: "সেটিংস", labelEn: "Settings", roles: ["OWNER"] },
  { href: "/status", icon: Activity, labelBn: "স্ট্যাটাস", labelEn: "Status", roles: ["OWNER"] },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation()
  const { data: user, isLoading } = useGetCurrentUser({ query: { retry: false, queryKey: getGetCurrentUserQueryKey() } })
  const logout = useLogout()
  const { isOnline, pendingCount, syncQueue, isSyncing } = useSync()

  React.useEffect(() => {
    if (!isLoading && !user && location !== "/") {
      setLocation("/")
    }
  }, [user, isLoading, location, setLocation])

  if (isLoading) return null
  if (!user) return <>{children}</>

  const allowedItems = navItems.filter(item => item.roles.includes(user.role))

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        setLocation("/")
      }
    })
  }

  const OfflineBadge = () => {
    if (isOnline && pendingCount === 0) return null;
    return (
      <button 
        onClick={() => syncQueue()}
        disabled={isSyncing || !isOnline}
        className="flex items-center gap-1.5 text-xs bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 px-3 py-1.5 rounded-full font-medium shadow-sm transition-transform active:scale-95 disabled:opacity-50"
      >
        {!isOnline ? <WifiOff className="w-3.5 h-3.5" /> : <RefreshCw className={cn("w-3.5 h-3.5", isSyncing && "animate-spin")} />}
        {pendingCount > 0 ? `${pendingCount} পেন্ডিং` : 'অফলাইন'}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 flex-col bg-card border-r fixed inset-y-0 z-50">
        <div className="h-16 flex items-center px-6 border-b">
          <div className="font-bold text-xl text-primary flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
              IS
            </div>
            <span>ISLAMIYA Revolving Fund</span>
          </div>
        </div>
        
        <div className="p-4 border-b bg-muted/20 flex flex-col gap-2">
          <div>
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-xs text-muted-foreground capitalize">{user.role.toLowerCase()}</p>
          </div>
          <div className="mt-2">
             <OfflineBadge />
          </div>
        </div>

        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {allowedItems.map((item) => {
            const isActive = location === item.href || (location.startsWith(item.href) && item.href !== "/")
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
                  isActive 
                    ? "bg-primary text-primary-foreground" 
                    : "hover:bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                <item.icon className="w-5 h-5" />
                <div className="flex flex-col leading-none">
                  <span className="font-semibold">{item.labelBn}</span>
                  <span className="text-[10px] opacity-80">{item.labelEn}</span>
                </div>
              </Link>
            )
          })}
        </nav>

        <div className="p-4 border-t">
          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 w-full rounded-md hover:bg-destructive/10 text-destructive transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <div className="flex flex-col leading-none items-start">
              <span className="font-semibold">লগআউট</span>
              <span className="text-[10px] opacity-80">Logout</span>
            </div>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 md:ml-64 pb-20 md:pb-0 min-h-[100dvh] flex flex-col">
        {/* Mobile Header */}
        <header className="md:hidden h-14 flex items-center justify-between px-4 bg-card border-b sticky top-0 z-40">
          <div className="font-bold text-lg text-primary flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs">
              IS
            </div>
            <span>ISLAMIYA Revolving Fund</span>
          </div>
          <div className="flex items-center gap-3">
            <OfflineBadge />
            <button 
              onClick={handleLogout}
              className="p-2 text-muted-foreground hover:text-destructive transition-colors"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 p-4 md:p-8">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 h-16 bg-card border-t flex items-center justify-start overflow-x-auto px-2 z-50 pb-safe">
        {allowedItems.map((item) => {
          const isActive = location === item.href || (location.startsWith(item.href) && item.href !== "/")
          return (
            <Link 
              key={item.href} 
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center min-w-[72px] shrink-0 h-full gap-1",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] font-semibold">{item.labelBn}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}