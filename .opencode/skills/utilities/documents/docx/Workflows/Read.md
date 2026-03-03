# Read Word Document Workflow

Extract markdown-like text from an existing Word document using the docx CLI.

## Prerequisites

- docx CLI available at `~/.config/opencode/skills/documents/docx/Tools/DocxCli.ts`
- Existing .docx file to read
- Bun runtime available

## Workflow Steps

### Step 1: Verify Document Exists

```bash
ls -la <existing.docx>
```

### Step 2: Execute CLI

**Write to file:**
```bash
bun "~/.config/opencode/skills/documents/docx/Tools/DocxCli.ts" read <existing.docx> -o <output.md>
```

**Print to stdout:**
```bash
bun "~/.config/opencode/skills/documents/docx/Tools/DocxCli.ts" read <existing.docx>
```

### Step 3: Verify Output

```bash
ls -la <output.md>
```

### Step 4: Inform User

Report:
- Output markdown file location
- Paragraph breaks preserved for readability

## Error Handling

| Error | Solution |
|-------|----------|
| Document not found | Verify input path exists |
| Permission denied | Check read/write permissions |

## Example Execution

```bash
bun "~/.config/opencode/skills/documents/docx/Tools/DocxCli.ts" read report.docx -o report.md
```

## Notes

- Output is markdown-like text (paragraphs separated by blank lines)
- Formatting such as tables or images is not preserved

