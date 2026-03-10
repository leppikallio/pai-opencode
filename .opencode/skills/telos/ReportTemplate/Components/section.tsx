import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

interface SectionProps {
  title: string
  children: ReactNode
  className?: string
}

export function Section({ title, children, className }: SectionProps) {
  return (
    <section className={cn("report-section", className)}>
      <h2>{title}</h2>
      {children}
    </section>
  )
}
