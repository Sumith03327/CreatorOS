"use client"

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Cell } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"

const data = [
  { time: "0:00", value: 95 },
  { time: "1:00", value: 88 },
  { time: "2:00", value: 82 },
  { time: "2:30", value: 94, peak: true },
  { time: "3:00", value: 78 },
  { time: "4:00", value: 72 },
  { time: "5:00", value: 65 },
  { time: "6:00", value: 58 },
]

export function RetentionChart() {
  return (
    <div className="h-[200px] w-full mt-6">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
          <XAxis 
            dataKey="time" 
            axisLine={false} 
            tickLine={false} 
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          />
          <YAxis hide />
          <Bar 
            dataKey="value" 
            radius={[4, 4, 0, 0]} 
            barSize={32}
          >
            {data.map((entry, index) => (
              <Cell 
                key={`cell-${index}`} 
                fill={entry.peak ? 'hsl(var(--primary))' : 'hsl(var(--primary) / 0.15)'} 
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex justify-center mt-2">
        <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded uppercase tracking-wider">Peak Engagement @ 2:30</span>
      </div>
    </div>
  )
}