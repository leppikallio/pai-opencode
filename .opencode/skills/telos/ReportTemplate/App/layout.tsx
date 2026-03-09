import type { ReactNode } from "react"
import "./globals.css"

export const metadata = {
  title: "TELOS Strategic Report",
  description: "McKinsey-style consulting report generated from TELOS analysis",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  return (
    <html lang="en">
      <body className="bg-white antialiased">
        {children}
      </body>
    </html>
  )
}
