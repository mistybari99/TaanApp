import * as React from "react"
import { Route, Switch, useLocation } from "wouter"
import { ErrorBoundary } from "@/components/error-boundary"
import { AppShell } from "@/components/shell"
import LoginPage from "@/pages/login"
import OwnerDashboard from "@/pages/owner/dashboard"
import CollectorHome from "@/pages/collector/home"
import MembersPage from "@/pages/members"
import CollectorsPage from "@/pages/collectors"
import PaymentsPage from "@/pages/payments"
import SettlementsPage from "@/pages/settlements"
import ReportsPage from "@/pages/reports"
import SettingsPage from "@/pages/settings"
import StatusPage from "@/pages/status"
import NotFound from "@/pages/not-found"

export function Router() {
  return (
    <Switch>
      <Route path="/" component={LoginPage} />
      {/* Catch-all for authenticated routes wrapped in the app shell */}
      <Route>
        <AppShell>
          <RoutedErrorBoundary>
            <Switch>
              <Route path="/owner" component={OwnerDashboard} />
              <Route path="/collector" component={CollectorHome} />
              <Route path="/members" component={MembersPage} />
              <Route path="/collectors" component={CollectorsPage} />
              <Route path="/payments" component={PaymentsPage} />
              <Route path="/settlements" component={SettlementsPage} />
              <Route path="/reports" component={ReportsPage} />
              <Route path="/settings" component={SettingsPage} />
              <Route path="/status" component={StatusPage} />
              <Route component={NotFound} />
            </Switch>
          </RoutedErrorBoundary>
        </AppShell>
      </Route>
    </Switch>
  )
}

function RoutedErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
