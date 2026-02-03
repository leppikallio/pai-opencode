import { NextResponse } from "next/server"
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PAI_DIR = process.env.PAI_DIR || path.join(os.homedir(), '.config', 'opencode')
const TELOS_DIR = path.join(PAI_DIR, 'skills', 'PAI', 'USER', 'TELOS')

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { filename?: unknown; content?: unknown }
    const filename = body?.filename
    const content = body?.content

    if (typeof filename !== 'string' || content === undefined) {
      return NextResponse.json(
        { error: "Filename and content are required" },
        { status: 400 }
      )
    }

    // Determine file path
    const normalizedFilename = filename.replace(/^\//, '')
    const isCSV = normalizedFilename.endsWith('.csv')
    let filePath: string

    if (isCSV) {
      const csvDir = path.join(TELOS_DIR, 'data')
      // Accept both "foo.csv" and "data/foo.csv".
      filePath = path.join(csvDir, path.basename(normalizedFilename))
    } else {
      filePath = path.join(TELOS_DIR, path.basename(normalizedFilename))
    }

    // Verify file exists before overwriting
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: `File ${filename} does not exist` },
        { status: 404 }
      )
    }

    // Save file
    fs.writeFileSync(filePath, String(content), 'utf-8')

    // Log the edit
    const timestamp = new Date().toISOString()
    const logMessage = `\n## ${timestamp}\n\n- **Action:** File edited via dashboard\n- **File:** ${normalizedFilename}\n`

    const updatesPath = path.join(TELOS_DIR, 'UPDATES.md')
    if (fs.existsSync(updatesPath)) {
      fs.appendFileSync(updatesPath, logMessage)
    }

    return NextResponse.json({
      success: true,
      message: `${filename} saved successfully`,
    })
  } catch (error) {
    console.error("Error saving file:", error)
    return NextResponse.json(
      { error: "Failed to save file" },
      { status: 500 }
    )
  }
}
