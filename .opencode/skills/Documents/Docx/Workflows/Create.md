# Create Word Document Workflow

Create a professionally formatted Word document from Markdown content using the docx CLI and company templates.

## Prerequisites

- docx CLI available at `~/.config/opencode/skills/Documents/Docx/Tools/DocxCli.ts`
- Template file at `~/doc_template.dotx` (or specify custom path)
- Bun runtime available

## Workflow Steps

### Step 1: Prepare Content

Ensure markdown content is ready. It can come from:
- A markdown file path
- Generated content (passed via stdin)
- User-provided content in the conversation

### Step 2: Gather Metadata (Optional)

Collect document metadata for the cover page:
- `title` - Document title
- `subtitle` - Optional subtitle
- `author` - Author name
- `date` - Document date (YYYY-MM-DD)
- `version` - Version number (e.g., "1.0")
- `confidentiality` - Classification level (e.g., "Internal", "Confidential")

### Step 3: Execute CLI

**From file:**
```bash
bun "~/.config/opencode/skills/Documents/Docx/Tools/DocxCli.ts" create <input.md> -o <output.docx> \
  --title "Document Title" \
  --author "Author Name" \
  --date "2025-01-15" \
  --doc-version "1.0" \
  --confidentiality "Internal"
```

**From stdin (for generated content):**
```bash
echo "${markdown_content}" | bun "~/.config/opencode/skills/Documents/Docx/Tools/DocxCli.ts" create - -o <output.docx> \
  --title "Document Title" \
  --author "Author Name"
```

**With custom template:**
```bash
bun "~/.config/opencode/skills/Documents/Docx/Tools/DocxCli.ts" create input.md -o output.docx \
  -t /path/to/custom-template.dotx
```

### Step 4: Verify Output

Check that the document was created:
```bash
ls -la <output.docx>
```

### Step 5: Inform User

Report:
- Output file location
- Document includes cover page, TOC, and formatted content
- Note: TOC fields update when opened in Word (Ctrl+A, F9)

## Error Handling

| Error | Solution |
|-------|----------|
| Template not found | Verify template path exists |
| Permission denied | Check write permissions for output directory |
| Invalid markdown | Validate markdown syntax |

## Example Execution

```bash
# Generate a quarterly report
bun "~/.config/opencode/skills/Documents/Docx/Tools/DocxCli.ts" create quarterly-report.md \
  -o "Q4-2024-Report.docx" \
  --title "Q4 2024 Analysis Report" \
  --subtitle "Financial Performance Review" \
  --author "Finance Team" \
  --date "2025-01-15" \
  --doc-version "1.0" \
  --confidentiality "Internal"
```

## Notes

- The CLI automatically generates a Table of Contents from H1-H3 headings
- Images in markdown are embedded and auto-sized to fit page width
- Hyperlinks are preserved as clickable links in the Word document
- Page breaks can be inserted with `---` in markdown
