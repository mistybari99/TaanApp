import {
  Activity,
  ArrowDownToLine,
  FileText,
  History,
  LayoutDashboard,
  Receipt,
  Repeat2,
  Settings,
  Trophy,
  UserSquare,
  Users,
  Wallet,
} from "lucide-react"
import type { ElementType } from "react"

export type NavigationGroup = "operate" | "finance" | "records" | "admin"
export type NavigationRole = "OWNER" | "COLLECTOR" | "CASH_RECEIVER"

export interface NavItem {
  href: string
  icon: ElementType
  labelBn: string
  labelEn: string
  roles: NavigationRole[]
  group: NavigationGroup
  mobilePriority?: number
}

/*
 * This is the single source of truth for shell visibility. Mobile only changes
 * how these same routes are surfaced.
 */
export const navItems: NavItem[] = [
  { href: "/owner", icon: LayoutDashboard, labelBn: "ড্যাশবোর্ড", labelEn: "Dashboard", roles: ["OWNER"], group: "operate", mobilePriority: 1 },
  { href: "/collector", icon: Wallet, labelBn: "সংগ্রহ", labelEn: "Collection", roles: ["COLLECTOR"], group: "operate", mobilePriority: 1 },
  { href: "/members", icon: Users, labelBn: "সদস্য", labelEn: "Members", roles: ["OWNER", "COLLECTOR", "CASH_RECEIVER"], group: "operate", mobilePriority: 2 },
  { href: "/cycles", icon: Repeat2, labelBn: "চক্র", labelEn: "Current Cycle", roles: ["OWNER", "COLLECTOR", "CASH_RECEIVER"], group: "operate", mobilePriority: 3 },
  { href: "/collectors", icon: UserSquare, labelBn: "কর্মী", labelEn: "Staff", roles: ["OWNER"], group: "admin" },
  { href: "/payments", icon: Receipt, labelBn: "লেনদেন", labelEn: "Payments", roles: ["OWNER", "COLLECTOR", "CASH_RECEIVER"], group: "finance", mobilePriority: 4 },
  { href: "/cash-custody", icon: ArrowDownToLine, labelBn: "নগদ custody", labelEn: "Cash custody", roles: ["OWNER", "COLLECTOR", "CASH_RECEIVER"], group: "finance" },
  { href: "/draws", icon: Trophy, labelBn: "শুক্রবার ড্র", labelEn: "Friday Draw", roles: ["OWNER", "COLLECTOR", "CASH_RECEIVER"], group: "operate", mobilePriority: 5 },
  { href: "/draw-history", icon: History, labelBn: "ড্র ইতিহাস", labelEn: "Draw History", roles: ["OWNER", "COLLECTOR", "CASH_RECEIVER"], group: "records" },
  { href: "/share-transfers", icon: Repeat2, labelBn: "শেয়ার transfer", labelEn: "Share Transfers", roles: ["OWNER"], group: "finance" },
  { href: "/member-history", icon: History, labelBn: "সদস্য ইতিহাস", labelEn: "Member History", roles: ["OWNER", "COLLECTOR", "CASH_RECEIVER"], group: "records" },
  { href: "/reports", icon: FileText, labelBn: "রিপোর্ট", labelEn: "Reports", roles: ["OWNER"], group: "records" },
  { href: "/settings", icon: Settings, labelBn: "সেটিংস", labelEn: "Settings", roles: ["OWNER"], group: "admin" },
  { href: "/status", icon: Activity, labelBn: "স্ট্যাটাস", labelEn: "Status", roles: ["OWNER"], group: "admin" },
]

export function getAllowedItems(role: string) {
  return navItems.filter((item) => item.roles.includes(role as NavigationRole))
}

export function getMoreItems(role: string) {
  return getAllowedItems(role).filter((item) => item.mobilePriority === undefined)
}

export function getNavItemAccessibleName(item: NavItem) {
  return `${item.labelBn} (${item.labelEn})`
}

export function getNavItemHelperId(href: string) {
  return `more-nav-helper-${href.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-")}`
}