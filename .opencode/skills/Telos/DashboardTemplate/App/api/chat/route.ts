import { NextResponse } from "next/server"
import { getTelosContext } from "@/lib/telos-data"

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { message?: unknown }
    const message = body?.message

    if (typeof message !== "string" || !message.trim()) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      )
    }

    // Load all TELOS context
    const telosContext = getTelosContext()

    // Preferred: use OpenCode server as the LLM carrier so this template
    // reuses credentials from `opencode auth login` (no OPENAI_API_KEY).
    const opencodeServerUrl = (process.env.OPENCODE_SERVER_URL || "http://localhost:4096").replace(/\/$/, "")

    const createRes = await fetch(`${opencodeServerUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "[PAI INTERNAL] TelosDashboardChat",
        permission: [{ permission: "*", pattern: "*", action: "deny" }],
      }),
    })

    if (!createRes.ok) {
      const errorText = await createRes.text().catch(() => "")
      console.error("OpenCode server error:", errorText)
      return NextResponse.json(
        { error: "OpenCode server not available (start opencode or opencode serve)" },
        { status: 500 }
      )
    }

    const created = (await createRes.json()) as { id?: unknown }
    const sessionId = typeof created?.id === "string" ? created.id : undefined
    if (typeof sessionId !== "string" || !sessionId) {
      return NextResponse.json(
        { error: "OpenCode server returned invalid session" },
        { status: 500 }
      )
    }

    try {
      const system = `You are a helpful AI assistant with access to the user's complete Personal TELOS (Life Operating System).

${telosContext}

When answering questions:
- Reference specific information from the TELOS files above
- Be conversational and helpful
- If asked about goals, projects, beliefs, wisdom, etc., use the exact information from the relevant sections
- If information isn't in the TELOS data, say so clearly
- Keep responses concise but informative`

      const promptRes = await fetch(`${opencodeServerUrl}/session/${sessionId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: { providerID: "openai", modelID: "gpt-5.2" },
          system,
          parts: [{ type: "text", text: message }],
          tools: {},
        }),
      })

      if (!promptRes.ok) {
        const errorText = await promptRes.text().catch(() => "")
        console.error("OpenCode prompt error:", errorText)
        return NextResponse.json(
          { error: "Failed to get response from OpenCode" },
          { status: 500 }
        )
      }

      const data = (await promptRes.json()) as {
        parts?: Array<{ type?: unknown; text?: unknown }>
      }
      const parts = Array.isArray(data?.parts) ? data.parts : []
      const assistantMessage = parts
        .filter(
          (p): p is { type?: string; text?: string } =>
            p?.type === "text" && typeof p?.text === "string"
        )
        .map((p) => p.text as string)
        .join("")

      if (typeof assistantMessage !== "string" || !assistantMessage.trim()) {
        throw new Error("No response from OpenCode")
      }

      return NextResponse.json({ response: assistantMessage })
    } finally {
      void fetch(`${opencodeServerUrl}/session/${sessionId}`, { method: "DELETE" }).catch(() => {})
    }

  } catch (error) {
    console.error("Error in chat API:", error)
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    )
  }
}
