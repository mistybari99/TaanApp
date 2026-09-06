import { getHealthCheckQueryKey, useHealthCheck } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Activity, Database, Server, Smartphone, Download } from "lucide-react"
import { usePwaInstall } from "@/hooks/use-pwa"

export default function StatusPage() {
  const { data: health, isLoading } = useHealthCheck({ query: { refetchInterval: 30000, queryKey: getHealthCheckQueryKey() } })
  const { isInstallable, install } = usePwaInstall()

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">স্ট্যাটাস <span className="text-muted-foreground text-lg font-normal ml-2">Status</span></h1>
        <p className="text-muted-foreground">সিস্টেম স্বাস্থ্য ও কানেক্টিভিটি (System Health & Connectivity)</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">এপিআই সার্ভার (API Server)</CardTitle>
            <Server className={`h-4 w-4 ${health?.status === 'ok' ? 'text-green-500' : 'text-red-500'}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">{isLoading ? '...' : health?.status || 'Offline'}</div>
            <p className="text-xs text-muted-foreground mt-1">Time: {health?.serverTime || 'Unknown'}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">ডাটাবেস (Database)</CardTitle>
            <Database className={`h-4 w-4 ${health?.database === 'connected' ? 'text-green-500' : 'text-red-500'}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">{isLoading ? '...' : health?.database || 'Disconnected'}</div>
            <p className="text-xs text-muted-foreground mt-1">PostgreSQL Connection</p>
          </CardContent>
        </Card>

        <Card className="md:col-span-2 bg-primary/5 border-primary/20">
          <CardContent className="pt-6 flex flex-col sm:flex-row items-start gap-4">
            <div className="p-3 bg-primary text-primary-foreground rounded-xl shrink-0">
              <Smartphone className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-lg">PWA অ্যাপ (PWA Install)</h3>
              <p className="text-sm text-muted-foreground mb-4">অফলাইন সুবিধা ও দ্রুত ব্যবহারের জন্য অ্যাপটি হোমস্ক্রিনে যোগ করুন।</p>
              
              {isInstallable ? (
                <button 
                  onClick={install}
                  className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium text-sm hover:opacity-90 active:scale-95 transition-all"
                >
                  <Download className="w-4 h-4" />
                  অ্যাপ ইনস্টল করুন (Install App)
                </button>
              ) : (
                <div className="text-xs font-mono bg-background p-2 rounded border inline-block">
                  Android Chrome: Menu &gt; Install App / Add to Home screen
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}