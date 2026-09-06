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
import PaymentsPage from "@/pages/payments"
import SettlementsPage from "@/pages/settlements"
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
                <Route path="/members" component={MembersPage} />
                <Route path="/payments" component={PaymentsPage} />
                <Route path="/settlements" component={SettlementsPage} />
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