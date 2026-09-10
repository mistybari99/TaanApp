import * as React from "react"
import { useLocation, Link } from "wouter"
import { getGetCurrentUserQueryKey, useGetCurrentUser, useLogout } from "@workspace/api-client-react"
import {
  ChevronRight,
  LogOut,
  Menu,
  RefreshCw,
  ShieldCheck,
  UserRound,
  WifiOff,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useSync } from "@/contexts/sync-context"
import { getAllowedItems, getMoreItems, getNavItemAccessibleName, getNavItemHelperId } from "@/components/navigation"
import type { NavItem } from "@/components/navigation"
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
  const moreScrollRef = React.useRef<HTMLDivElement>(null)
  const moreScrollTopRef = React.useRef(0)
  const moreScrollUserIdRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    if (!isLoading && !user && location !== "/") {
      setLocation("/")
    }
  }, [user, isLoading, location, setLocation])

  React.useEffect(() => {
    const userId = user?.id ?? null
    if (moreScrollUserIdRef.current !== userId) {
      moreScrollTopRef.current = 0
      moreScrollRef.current?.scrollTo({ top: 0 })
      moreScrollUserIdRef.current = userId
    }
  }, [user?.id])

  React.useEffect(() => {
    if (!moreOpen) return
    const frame = window.requestAnimationFrame(() => {
      moreScrollRef.current?.scrollTo({ top: moreScrollTopRef.current })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [moreOpen])

  if (isLoading) return null
  if (!user) return <>{children}</>

  const homeHref = user.role === "OWNER" ? "/owner" : user.role === "COLLECTOR" ? "/collector" : "/cash-custody"
  const allowedItems = getAllowedItems(user.role)
  const mobileItems = allowedItems
    .filter((item) => item.mobilePriority !== undefined)
    .sort((a, b) => (a.mobilePriority ?? 99) - (b.mobilePriority ?? 99))
  const moreItems = getMoreItems(user.role)

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
    const helperId = getNavItemHelperId(item.href)
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMoreOpen(false)}
        aria-current={active ? "page" : undefined}
        aria-label={compact ? undefined : getNavItemAccessibleName(item)}
        aria-describedby={withChevron ? helperId : undefined}
        data-more-nav-item={withChevron ? item.href : undefined}
        className={cn(
          "group relative flex items-center transition-colors duration-150 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
          compact
            ? "min-h-14 min-w-0 flex-1 flex-col justify-center gap-0.5 px-1 text-center"
            : "min-h-16 w-full gap-3 rounded-xl px-4 py-3",
          active
            ? "bg-primary text-primary-foreground shadow-[0_5px_14px_hsl(var(--primary)/0.12)]"
            : compact
              ? "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
        )}
      >
        <item.icon className={cn(compact ? "h-5 w-5" : "h-[1.15rem] w-[1.15rem]", "shrink-0")} aria-hidden="true" />
        {compact ? (
          <span className="w-full truncate text-[10px] font-semibold leading-tight">{item.labelBn}</span>
        ) : (
          <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
            <span className="break-words text-sm font-semibold">{item.labelBn}</span>
            <span id={withChevron ? helperId : undefined} className="break-words text-[10px] opacity-70">{item.labelEn}</span>
          </span>
        )}
        {withChevron && <ChevronRight data-more-nav-chevron={withChevron ? item.href : undefined} className={cn("ml-auto h-4 w-4 shrink-0", active ? "text-primary-foreground/70" : "text-muted-foreground/60")} aria-hidden="true" />}
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
            "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-center text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
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

      <Sheet
        open={moreOpen}
        onOpenChange={(open) => {
          if (!open && moreScrollRef.current) moreScrollTopRef.current = moreScrollRef.current.scrollTop
          setMoreOpen(open)
        }}
      >
        <SheetContent
          side="right"
          className="more-sheet-content flex h-full max-h-[100dvh] w-[min(92vw,25rem)] flex-col overflow-hidden border-l border-border bg-background px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-5 md:hidden"
        >
          <SheetHeader className="shrink-0 pr-8 text-left">
            <SheetTitle className="text-xl font-extrabold text-primary">আরও <span className="font-semibold text-muted-foreground">· More</span></SheetTitle>
            <SheetDescription>কম ব্যবহৃত কাজ ও আপনার অ্যাকাউন্ট এক জায়গায়।</SheetDescription>
          </SheetHeader>

          <div className="mt-6 flex shrink-0 items-center gap-3 rounded-2xl border border-border/70 bg-card p-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-base font-bold text-accent-foreground">
              {user.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{user.name}</p>
              <p className="text-xs capitalize text-muted-foreground">{user.role.toLowerCase()} account</p>
            </div>
            <ShieldCheck className="h-5 w-5 text-accent-foreground" />
          </div>

          <div
            ref={moreScrollRef}
            data-more-sheet-scroll
            onScroll={(event) => {
              moreScrollTopRef.current = event.currentTarget.scrollTop
            }}
            className="more-sheet-scroll hide-scrollbar mt-5 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3 pt-1"
          >
            {(["operate", "finance", "records", "admin"] as const).map((group) => {
              const items = moreItems.filter((item) => item.group === group)
              if (!items.length) return null
              return (
                <section key={group} className="not-first:mt-8" data-more-nav-group={group} aria-labelledby={`more-group-${group}`}>
                  <div id={`more-group-${group}`} className="more-sheet-group-heading sticky top-0 z-10 px-1">
                    <p className="text-xs font-bold text-foreground">{groupLabels[group].bn}</p>
                    <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{groupLabels[group].en}</p>
                  </div>
                  <div className="divide-y divide-border/60 rounded-2xl border border-border/70 bg-card p-1">
                    {items.map((item) => renderNavItem(item, false, true))}
                  </div>
                </section>
              )
            })}
          </div>

          <div className="mt-3 shrink-0 border-t border-border/70 pt-3">
            <button
              onClick={() => {
                setMoreOpen(false)
                setLogoutOpen(true)
              }}
              aria-label="লগআউট (Sign out of this account)"
              className="flex min-h-14 w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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