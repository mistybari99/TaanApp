import * as React from "react"
import { useLocation, Link } from "wouter"
import { getGetCurrentUserQueryKey, useGetCurrentUser, useLogout } from "@workspace/api-client-react"
import {
  Activity,
  ArrowDownToLine,
  ChevronRight,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  RefreshCw,
  Repeat2,
  Settings,
  ShieldCheck,
  Trophy,
  UserRound,
  UserSquare,
  Users,
  Wallet,
  WifiOff,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useSync } from "@/contexts/sync-context"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

interface NavItem {
  href: string
  icon: React.ElementType
  labelBn: string
  labelEn: string
  roles: string[]
  group: "operate" | "finance" | "records" | "admin"
  mobilePriority?: number
}

/*
 * This is the single source of truth for shell visibility. Mobile only changes
 * how these same routes are surfaced.
 */
const navItems: NavItem[] = [
  { href: "/owner", icon: LayoutDashboard, labelBn: "ড্যাশবোর্ড", labelEn: "Dashboard", roles: ["OWNER"], group: "operate", mobilePriority: 1 },
  { href: "/collector", icon: Wallet, labelBn: "সংগ্রহ", labelEn: "Collection", roles: ["COLLECTOR"], group: "operate", mobilePriority: 1 },
  { href: "/members", icon: Users, labelBn: "সদস্য", labelEn: "Members", roles: ["OWNER", "COLLECTOR", "CASH_RECEIVER"], group: "operate", mobilePriority: 2 },
  { href: "/cycles", icon: Repeat2, labelBn: "চক্র", labelEn: "Current Cycle", roles: ["OWNER", "COLLECTOR", "CASH_RECEIVER"], group: "operate", mobilePriority: 3 },
  { href: "/collectors", icon: UserSquare, labelBn: "কর্মী", labelEn: "Staff", roles: ["OWNER"], group: "admin" },
  { href: "/payments", icon: Receipt, labelBn: "লেনদেন", labelEn: "Payments", roles: ["OWNER", "COLLECTOR", "CASH_RECEIVER"], group: "finance", mobilePriority: 4 },
  { href: "/cash-custody", icon: ArrowDownToLine, labelBn: "নগদ custody", labelEn: "Cash custody", roles: ["OWNER", "COLLECTOR", "CASH_RECEIVER"], group: "finance" },
  { href: "/draws", icon: Trophy, labelBn: "শুক্রবার ড্র", labelEn: "Friday Draw", roles: ["OWNER"], group: "operate", mobilePriority: 5 },
  { href: "/draw-history", icon: History, labelBn: "ড্র ইতিহাস", labelEn: "Draw History", roles: ["OWNER", "COLLECTOR", "CASH_RECEIVER"], group: "records" },
  { href: "/share-transfers", icon: Repeat2, labelBn: "শেয়ার transfer", labelEn: "Share Transfers", roles: ["OWNER"], group: "finance" },
  { href: "/member-history", icon: History, labelBn: "সদস্য ইতিহাস", labelEn: "Member History", roles: ["OWNER", "COLLECTOR", "CASH_RECEIVER"], group: "records" },
  { href: "/reports", icon: FileText, labelBn: "রিপোর্ট", labelEn: "Reports", roles: ["OWNER"], group: "records" },
  { href: "/settings", icon: Settings, labelBn: "সেটিংস", labelEn: "Settings", roles: ["OWNER"], group: "admin" },
  { href: "/status", icon: Activity, labelBn: "স্ট্যাটাস", labelEn: "Status", roles: ["OWNER"], group: "admin" },
]

const groupLabels: Record<NavItem["group"], { bn: string; en: string }> = {
  operate: { bn: "আজকের কাজ", en: "Daily work" },
  finance: { bn: "তহবিল", en: "Fund" },
  records: { bn: "রেকর্ড", en: "Records" },
  admin: { bn: "পরিচালনা", en: "Manage" },
}

function isItemActive(location: string, href: string) {
  return location === href || (location.startsWith(`${href}/`) && href !== "/")
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation()
  const { data: user, isLoading } = useGetCurrentUser({
    query: { retry: false, queryKey: getGetCurrentUserQueryKey() },
  })
  const logout = useLogout()
  const { isOnline, pendingCount, syncQueue, isSyncing } = useSync()
  const [moreOpen, setMoreOpen] = React.useState(false)
  const [logoutOpen, setLogoutOpen] = React.useState(false)

  React.useEffect(() => {
    if (!isLoading && !user && location !== "/") {
      setLocation("/")
    }
  }, [user, isLoading, location, setLocation])

  if (isLoading) return null
  if (!user) return <>{children}</>

  const homeHref = user.role === "OWNER" ? "/owner" : user.role === "COLLECTOR" ? "/collector" : "/cash-custody"
  const allowedItems = navItems.filter((item) => item.roles.includes(user.role))
  const mobileItems = allowedItems
    .filter((item) => item.mobilePriority !== undefined)
    .sort((a, b) => (a.mobilePriority ?? 99) - (b.mobilePriority ?? 99))
  const moreItems = allowedItems.filter((item) => item.mobilePriority === undefined)

  const confirmLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        setLogoutOpen(false)
        setMoreOpen(false)
        setLocation("/")
      },
    })
  }

  const OfflineBadge = () => {
    if (isOnline && pendingCount === 0) return null
    return (
      <button
        onClick={() => syncQueue()}
        disabled={isSyncing || !isOnline}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-secondary/30 bg-secondary/15 px-3 py-1.5 text-xs font-semibold text-foreground transition-transform active:scale-95 disabled:opacity-50"
        aria-label={isOnline ? "Sync pending work" : "Offline status"}
      >
        {!isOnline ? <WifiOff className="h-3.5 w-3.5" /> : <RefreshCw className={cn("h-3.5 w-3.5", isSyncing && "animate-spin")} />}
        {pendingCount > 0 ? `${pendingCount} পেন্ডিং` : "অফলাইন"}
      </button>
    )
  }

  const renderNavItem = (item: NavItem, compact = false, withChevron = false) => {
    const active = isItemActive(location, item.href)
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMoreOpen(false)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex items-center rounded-xl transition-colors duration-150",
          compact
            ? "min-h-14 min-w-0 flex-1 flex-col justify-center gap-0.5 px-1 text-center"
             : "min-h-12 w-full gap-3 px-3",
          active
            ? "bg-primary text-primary-foreground shadow-[0_5px_14px_hsl(var(--primary)/0.12)]"
            : compact
              ? "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
        )}
      >
        {active && !compact && <span className="absolute -left-3 h-6 w-1 rounded-r-full bg-secondary" />}
        <item.icon className={cn(compact ? "h-5 w-5" : "h-[1.15rem] w-[1.15rem]", "shrink-0")} />
        {compact ? (
          <span className="w-full truncate text-[10px] font-semibold leading-tight">{item.labelBn}</span>
        ) : (
          <span className="flex min-w-0 flex-col text-left leading-tight">
            <span className="truncate text-sm font-semibold">{item.labelBn}</span>
            <span className="truncate text-[10px] opacity-70">{item.labelEn}</span>
          </span>
        )}
        {withChevron && <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />}
      </Link>
    )
  }

  return (
    <div className="min-h-[100dvh] bg-background md:flex">
      <aside className="fixed inset-y-0 z-50 hidden w-[17rem] flex-col border-r border-border/80 bg-card/95 md:flex">
        <div className="flex h-[4.5rem] items-center border-b border-border/80 px-5">
          <Link href={homeHref} className="flex items-center gap-3">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-xs font-extrabold tracking-tight text-primary-foreground shadow-sm">
              IS
              <span className="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full border-2 border-card bg-secondary" />
            </div>
            <span className="text-[15px] font-extrabold tracking-[-0.02em] text-primary">ISLAMIYA</span>
          </Link>
        </div>

        <div className="border-b border-border/70 bg-muted/25 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
              {user.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{user.name}</p>
              <p className="text-xs font-medium capitalize text-muted-foreground">{user.role.toLowerCase()}</p>
            </div>
          </div>
          <div className="mt-3">
            <OfflineBadge />
          </div>
        </div>

        <nav className="hide-scrollbar flex-1 space-y-4 overflow-y-auto px-3 py-5" aria-label="Main navigation">
          {(["operate", "finance", "records", "admin"] as const).map((group) => {
            const items = allowedItems.filter((item) => item.group === group)
            if (!items.length) return null
            return (
              <div key={group}>
                <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/75">
                  {groupLabels[group].bn} <span className="font-medium normal-case tracking-normal">· {groupLabels[group].en}</span>
                </p>
                <div className="space-y-0.5">{items.map((item) => renderNavItem(item))}</div>
              </div>
            )
          })}
        </nav>

        <div className="border-t border-border/70 p-3">
          <button
            onClick={() => setLogoutOpen(true)}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-destructive transition-colors hover:bg-destructive/10"
          >
            <LogOut className="h-[1.15rem] w-[1.15rem]" />
            <span className="flex flex-col text-left leading-tight">
              <span className="text-sm font-semibold">লগআউট</span>
              <span className="text-[10px] opacity-70">Sign out safely</span>
            </span>
          </button>
        </div>
      </aside>

      <main className="app-main min-h-[100dvh] flex-1 md:ml-[17rem]">
        <header className="sticky top-0 z-40 flex h-[4.25rem] items-center justify-between border-b border-border/70 bg-background/95 px-4 backdrop-blur-md md:hidden">
          <Link href={homeHref} className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-[0.7rem] bg-primary text-[11px] font-extrabold text-primary-foreground">IS</div>
            <div className="leading-none">
              <p className="text-[15px] font-extrabold tracking-[-0.03em] text-primary">ISLAMIYA</p>
              <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Revolving Fund</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <OfflineBadge />
            <button
              onClick={() => setMoreOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Open account and more navigation"
            >
              <UserRound className="h-[1.1rem] w-[1.1rem]" />
            </button>
          </div>
        </header>

        <div className="p-4 md:p-8">{children}</div>
      </main>

      <nav className="app-bottom-nav fixed inset-x-0 bottom-0 z-50 flex border-t border-border/80 bg-card/95 px-2 shadow-[0_-8px_24px_hsl(var(--foreground)/0.04)] backdrop-blur-md md:hidden" aria-label="Mobile navigation">
        {mobileItems.map((item) => renderNavItem(item, true))}
        <button
          onClick={() => setMoreOpen(true)}
          className={cn(
            "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-center text-muted-foreground transition-colors",
            moreOpen || moreItems.some((item) => isItemActive(location, item.href))
              ? "bg-accent text-accent-foreground"
              : "hover:bg-muted/70 hover:text-foreground",
          )}
          aria-label="Open more navigation"
          aria-expanded={moreOpen}
        >
          <Menu className="h-5 w-5" />
          <span className="w-full truncate text-[10px] font-semibold leading-tight">আরও</span>
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="right" className="w-[min(92vw,25rem)] overflow-y-auto border-l border-border bg-background px-5 pb-7 pt-6 md:hidden">
          <SheetHeader className="pr-8 text-left">
            <SheetTitle className="text-xl font-extrabold text-primary">আরও <span className="font-semibold text-muted-foreground">· More</span></SheetTitle>
            <SheetDescription>কম ব্যবহৃত কাজ ও আপনার অ্যাকাউন্ট এক জায়গায়।</SheetDescription>
          </SheetHeader>

          <div className="mt-6 flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-base font-bold text-accent-foreground">
              {user.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{user.name}</p>
              <p className="text-xs capitalize text-muted-foreground">{user.role.toLowerCase()} account</p>
            </div>
            <ShieldCheck className="h-5 w-5 text-accent-foreground" />
          </div>

          <div className="mt-7 space-y-7">
            {(["operate", "finance", "records", "admin"] as const).map((group) => {
              const items = moreItems.filter((item) => item.group === group)
              if (!items.length) return null
              return (
                <section key={group}>
                  <div className="mb-2 px-1">
                    <p className="text-xs font-bold text-foreground">{groupLabels[group].bn}</p>
                    <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{groupLabels[group].en}</p>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
                    {items.map((item) => (
                      <div key={item.href} className="border-b border-border/60 last:border-b-0">
                        {renderNavItem(item, false, true)}
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>

          <div className="mt-7 border-t border-border/70 pt-5">
            <button
              onClick={() => {
                setMoreOpen(false)
                setLogoutOpen(true)
              }}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-destructive transition-colors hover:bg-destructive/10"
            >
              <LogOut className="h-[1.15rem] w-[1.15rem]" />
              <span className="flex flex-col leading-tight">
                <span className="font-bold">লগআউট</span>
                <span className="text-[10px] opacity-70">Sign out of this account</span>
              </span>
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl border-border bg-card sm:max-w-md">
          <DialogHeader className="text-left">
            <DialogTitle className="text-xl font-extrabold text-primary">লগআউট করবেন?</DialogTitle>
            <DialogDescription className="pt-1">
              আপনার দৈনিক কাজ সিঙ্ক হয়ে থাকলে নিরাপদে অ্যাকাউন্ট থেকে বের হতে পারবেন।
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2 gap-2 sm:gap-2">
            <button
              onClick={() => setLogoutOpen(false)}
              disabled={logout.isPending}
              className="min-h-11 rounded-xl border border-border px-4 font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              থাক
            </button>
            <button
              onClick={confirmLogout}
              disabled={logout.isPending}
              className="min-h-11 rounded-xl bg-destructive px-4 font-bold text-destructive-foreground transition-transform active:scale-[0.98] disabled:opacity-50"
            >
              {logout.isPending ? "অপেক্ষা করুন..." : "লগআউট নিশ্চিত করুন"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}