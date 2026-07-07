"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, useEffect } from "react"
import { 
  BarChart3, 
  Zap, 
  Users2, 
  Users, 
  Settings, 
  HelpCircle, 
  LogOut,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Video,
  TrendingUp,
  Bookmark,
  FileVideo,
  GitCompareArrows
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

const navItems = [
  { name: "Channel Analyzer", icon: BarChart3, href: "/" },
  { name: "Video Performance", icon: FileVideo, href: "/analyzer" },
  { name: "Compare Channels", icon: GitCompareArrows, href: "/compare" },
  { name: "Script with Max", icon: Sparkles, href: "/max-analyzer" },
]

const bottomNavItems = [
  { name: "Action Plan", icon: Zap, href: "/plan" },
  { name: "My Agents", icon: Users2, href: "/agents" },
  { name: "Team", icon: Users, href: "/team" },
  { name: "Settings", icon: Settings, href: "/settings" },
]

export function SidebarNav() {
  const pathname = usePathname()
  const [watchlistCount, setWatchlistCount] = useState(0)
  const isInsightsActive = pathname.startsWith('/insights')
  const [isInsightsOpen, setIsInsightsOpen] = useState(isInsightsActive)

  useEffect(() => {
    const saved = localStorage.getItem('creator-hub-watchlist')
    if (saved) {
      setWatchlistCount(JSON.parse(saved).length)
    }
    
    const handleStorage = () => {
      const saved = localStorage.getItem('creator-hub-watchlist')
      if (saved) setWatchlistCount(JSON.parse(saved).length)
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [])

  useEffect(() => {
    if (isInsightsActive) setIsInsightsOpen(true)
  }, [isInsightsActive])

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground w-64 border-r border-sidebar-border shrink-0">
      <div className="p-6">
        <div className="flex items-center gap-2 mb-8">
          <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center">
            <Zap className="h-5 w-5 text-white fill-white" />
          </div>
          <span className="font-headline font-bold text-xl tracking-tight text-white">Creator Hub</span>
          <Badge variant="secondary" className="bg-primary/20 text-primary border-none text-[10px] py-0 px-1.5 ml-1">PRO</Badge>
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link key={item.name} href={item.href} className={cn("flex items-center gap-3 px-3 py-2 rounded-md transition-all group", isActive ? "bg-sidebar-accent text-white" : "text-sidebar-foreground/70 hover:text-white hover:bg-sidebar-accent/50")}>
                <item.icon className={cn("h-4 w-4 shrink-0 transition-colors", isActive ? "text-primary" : "group-hover:text-primary")} />
                <span className="text-sm font-medium">{item.name}</span>
                {isActive && <div className="ml-auto w-1 h-4 bg-primary rounded-full" />}
              </Link>
            )
          })}

          <Collapsible open={isInsightsOpen} onOpenChange={setIsInsightsOpen} className="w-full">
            <CollapsibleTrigger asChild>
              <button className={cn("flex items-center gap-3 px-3 py-2 rounded-md transition-all group w-full text-left", isInsightsActive && !isInsightsOpen ? "bg-sidebar-accent text-white" : "text-sidebar-foreground/70 hover:text-white hover:bg-sidebar-accent/50")}>
                <Zap className={cn("h-4 w-4 shrink-0 text-amber-400", (isInsightsActive || isInsightsOpen) && "fill-amber-400")} />
                <span className="text-sm font-medium">Research</span>
                {watchlistCount > 0 && <Badge className="ml-auto bg-[#7B5CF0] text-[8px] h-4 border-none text-white">{watchlistCount}</Badge>}
                <ChevronRight className={cn("ml-2 h-4 w-4 transition-transform", isInsightsOpen && "rotate-90")} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1 mt-1">
              <Link href="/insights" className={cn("flex items-center gap-3 pl-10 pr-3 py-2 rounded-md transition-all group", pathname === "/insights" ? "bg-sidebar-accent text-white" : "text-sidebar-foreground/60 hover:text-white hover:bg-sidebar-accent/30")}>
                <Video className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">Content</span>
              </Link>
              <Link href="/insights/channels" className={cn("flex items-center gap-3 pl-10 pr-3 py-2 rounded-md transition-all group", pathname === "/insights/channels" ? "bg-sidebar-accent text-white" : "text-sidebar-foreground/60 hover:text-white hover:bg-sidebar-accent/30")}>
                <TrendingUp className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">Channels</span>
              </Link>
            </CollapsibleContent>
          </Collapsible>

          {bottomNavItems.map((item) => (
            <Link key={item.name} href={item.href} className={cn("flex items-center gap-3 px-3 py-2 rounded-md transition-all group", pathname === item.href ? "bg-sidebar-accent text-white" : "text-sidebar-foreground/70 hover:text-white hover:bg-sidebar-accent/50")}>
              <item.icon className="h-4 w-4" />
              <span className="text-sm font-medium">{item.name}</span>
            </Link>
          ))}
        </nav>
      </div>

      <div className="mt-auto p-6 space-y-4">
        <div className="space-y-1">
          <Link href="/help" className="flex items-center gap-3 px-3 py-2 text-sidebar-foreground/70 hover:text-white transition-colors text-sm">
            <HelpCircle className="h-4 w-4" />
            <span>Help</span>
          </Link>
          <button className="flex items-center gap-3 px-3 py-2 text-sidebar-foreground/70 hover:text-destructive transition-colors text-sm w-full">
            <LogOut className="h-4 w-4" />
            <span>Exit</span>
          </button>
        </div>
      </div>
    </div>
  )
}
