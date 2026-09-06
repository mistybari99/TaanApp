import * as React from "react"
import { Route, Switch, useLocation } from "wouter"
import { ErrorBoundary } from "@/components/error-boundary"
import { AppShell } from "@/components/shell"
import { useGetOnboardingStatus, getGetOnboardingStatusQueryKey } from "@workspace/api-client-react"
import { SyncProvider } from "@/contexts/sync-context"

import LoginPage from "@/pages/login"
import OnboardingPage from "@/pages/onboarding"
import OwnerDashboard from "@/pages/owner/dashboard"
import CollectorHome from "@/pages/collector/home"
import MembersPage from "@/pages/members"
import CollectorsPage from "@/pages/collectors"
import PaymentsPage from "@/pages/payments"
import SettlementsPage from "@/pages/settlements"
import ReportsPage from "@/pages/reports"
import SettingsPage from "@/pages/settings"
import StatusPage from "@/pages/status"
import CyclesPage from "@/pages/cycles"
import DrawsPage, { DrawHistoryPage } from "@/pages/draws"
import MemberHistoryPage from "@/pages/member-history"
import NotFound from "@/pages/not-found"

export function Router() {
  const { data: onboarding, isLoading } = useGetOnboardingStatus({ query: { queryKey: getGetOnboardingStatusQueryKey(), retry: false } })
  
  if (isLoading) return <div className="min-h-screen flex items-center justify-center">লোড হচ্ছে (Loading)...</div>

  if (onboarding && !onboarding.initialized) {
    return (
      <Switch>
        <Route path="/onboarding" component={OnboardingPage} />
        <Route>
          <Redirect to="/onboarding" />
        </Route>
      </Switch>
    )
  }

  return (
    <SyncProvider>
      <Switch>
        <Route path="/" component={LoginPage} />
        <Route path="/onboarding">
          <Redirect to="/" />
        </Route>
        {/* Catch-all for authenticated routes wrapped in the app shell */}
        <Route>
          <AppShell>
            <RoutedErrorBoundary>
              <Switch>
                <Route path="/owner" component={OwnerDashboard} />
                <Route path="/collector" component={CollectorHome} />
                <Route path="/members/:id/history" component={MemberHistoryPage} />
                <Route path="/members" component={MembersPage} />
                <Route path="/member-history" component={MemberHistoryPage} />
                <Route path="/cycles" component={CyclesPage} />
                <Route path="/collectors" component={CollectorsPage} />
                <Route path="/payments" component={PaymentsPage} />
                <Route path="/settlements" component={SettlementsPage} />
                <Route path="/draws" component={DrawsPage} />
                <Route path="/draw-history" component={DrawHistoryPage} />
                <Route path="/reports" component={ReportsPage} />
                <Route path="/settings" component={SettingsPage} />
                <Route path="/status" component={StatusPage} />
                <Route component={NotFound} />
              </Switch>
            </RoutedErrorBoundary>
          </AppShell>
        </Route>
      </Switch>
    </SyncProvider>
  )
}

function Redirect({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  React.useEffect(() => { setLocation(to) }, [setLocation, to]);
  return null;
}

function RoutedErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}