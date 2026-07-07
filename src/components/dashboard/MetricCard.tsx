import { LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

interface MetricCardProps {
  title: string
  value: string
  icon: LucideIcon
}

export function MetricCard({ title, value, icon: Icon }: MetricCardProps) {
  return (
    <Card className="border-none shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="mb-4">
          <div className="h-10 w-10 bg-secondary rounded-lg flex items-center justify-center">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-3xl font-bold tracking-tight">{value}</p>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
        </div>
      </CardContent>
    </Card>
  )
}