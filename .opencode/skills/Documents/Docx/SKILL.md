---
name: Docx
description: Branded Word document creation, editing, and reading via templates. USE WHEN user wants Word/docx documents, convert markdown to docx, generate reports, edit existing .docx files, or extract content.
---

## Customization

**Before executing, check for user customizations at:**
`~/.config/opencode/skills/CORE/USER/SKILLCUSTOMIZATIONS/Docx/`

If this directory exists, load and apply any PREFERENCES.md, configurations, or resources found there. These override default behavior. If the directory does not exist, proceed with skill defaults.

# Docx

Convert Markdown content to professionally formatted Word documents using company .dotx templates. Supports creating new .docx files, appending content, and extracting readable markdown-like text from existing documents.

## Voice Notification

**When executing a workflow, do BOTH:**

1. **Send voice notification**:
   Use the `voice_notify` tool:

- `message`: "Running the WORKFLOWNAME workflow in the Docx skill"

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **Create** | "create Word document", "convert to docx", "generate report" | `Workflows/Create.md` |
| **Edit** | "append to document", "add content to docx", "edit docx" | `Workflows/Edit.md` |
| **Read** | "read docx", "extract docx", "docx to markdown" | `Workflows/Read.md` |

## CLI Location

The docx CLI is stored at:

`~/.config/opencode/skills/Documents/Docx/Tools/DocxCli.ts`

Run with bun (examples below).

## Configuration

Defaults are read from `~/.config/opencode/settings.json` under `docxCli`:

```json
{
  "docxCli": {
    "template": "~/doc_template.dotx",
    "outputDir": "~/Documents/Generated"
  }
}
```

## Examples

**Example 1: Create a Word document from Markdown**
```
User: "Create a Word document from this report"
→ Invokes Create workflow
→ Converts markdown content to docx using template
→ Generates cover page with metadata and TOC
→ User receives professionally formatted .docx file
```

**Example 2: Generate a document with full metadata**
```
User: "Convert this markdown to a Word doc with title 'Q4 Analysis', author 'Engineering Team'"
→ Invokes Create workflow
→ Passes metadata to CLI (--title, --author, --date)
→ Applies corporate template styling
→ User receives branded document with cover page and TOC
```

**Example 3: Append content to existing document**
```
User: "Add this section to my existing report.docx"
→ Invokes Edit workflow
→ Appends markdown content to document
→ Preserves existing formatting and template styles
→ User receives updated document
```

**Example 4: Read a document into markdown-like text**
```
User: "Extract this report.docx into markdown"
→ Invokes Read workflow
→ Extracts document text and preserves paragraph breaks
→ User receives a .md output for review
```

## Supported Markdown Features

| Markdown | Word Element |
|----------|--------------|
| `# Heading 1` | Heading1 style (from template) |
| `## Heading 2` | Heading2 style |
| `### Heading 3` | Heading3 style |
| `**bold**` | Bold text |
| `*italic*` | Italic text |
| `` `code` `` | Code style (Consolas font) |
| `[link](url)` | Hyperlink |
| `![alt](path)` | Embedded image (auto-sized) |
| `- item` | Bullet list |
| `1. item` | Numbered list |
| `> quote` | Quote style |
| `---` | Page break |
| Tables | Table Grid style |

## Quick Reference

```bash
# Basic conversion
bun "~/.config/opencode/skills/Documents/Docx/Tools/DocxCli.ts" create report.md -o report.docx

# With metadata
bun "~/.config/opencode/skills/Documents/Docx/Tools/DocxCli.ts" create report.md -o report.docx \
  --title "Report Title" \
  --author "Author Name" \
  --date "2025-01-15" \
  --doc-version "1.0"

# From stdin
echo "# Title\n\nContent..." | bun "~/.config/opencode/skills/Documents/Docx/Tools/DocxCli.ts" create - -o output.docx

# Edit existing document
bun "~/.config/opencode/skills/Documents/Docx/Tools/DocxCli.ts" edit existing.docx --append additions.md

# Read document into markdown
bun "~/.config/opencode/skills/Documents/Docx/Tools/DocxCli.ts" read report.docx -o report.md
```
