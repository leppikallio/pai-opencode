import type { ReactNode } from "react"

interface ExhibitProps {
  number: number | string
  title: string
  source?: string
  children: ReactNode
}

export function Exhibit({ number, title, source, children }: ExhibitProps) {
  return (
    <div className="exhibit">
      <div className="exhibit-header">
        <div>
          <span className="exhibit-number">Exhibit {number}</span>
          <span className="exhibit-title ml-3">{title}</span>
        </div>
        {source && <span className="exhibit-source">Source: {source}</span>}
      </div>
      <div className="exhibit-content">{children}</div>
    </div>
  )
}
