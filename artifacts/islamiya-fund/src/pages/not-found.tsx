import { useEffect } from "react"
import { useLocation } from "wouter"

export default function NotFound() {
  const [, setLocation] = useLocation()
  
  useEffect(() => {
    // Just a basic 404, we can offer to go back
  }, [])

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[50vh] space-y-4">
      <h1 className="text-4xl font-bold text-primary">404</h1>
      <p className="text-lg text-muted-foreground">পৃষ্ঠা পাওয়া যায়নি (Page not found)</p>
      <button 
        onClick={() => setLocation("/")}
        className="text-primary hover:underline mt-4"
      >
        ফিরে যান (Go Back)
      </button>
    </div>
  )
}
