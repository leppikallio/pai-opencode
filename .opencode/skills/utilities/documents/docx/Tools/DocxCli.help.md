# DocxCli

Convert Markdown to Word documents using company templates.

## Usage

```bash
bun "~/.config/opencode/skills/documents/docx/Tools/DocxCli.ts" create <input.md> -o <output.docx>
bun "~/.config/opencode/skills/documents/docx/Tools/DocxCli.ts" edit <existing.docx> --append <additions.md>
bun "~/.config/opencode/skills/documents/docx/Tools/DocxCli.ts" read <existing.docx> -o <output.md>
bun "~/.config/opencode/skills/documents/docx/Tools/DocxCli.ts" styles <template.dotx>
```

## Commands

### create

Create a Word document from Markdown input.

```bash
bun "~/.config/opencode/skills/documents/docx/Tools/DocxCli.ts" create report.md -o report.docx \
  --title "Report Title" \
  --author "Author Name" \
  --date "2025-01-15" \
  --doc-version "1.0" \
  --confidentiality "Internal"
```

### edit

Append Markdown to an existing document.

```bash
bun "~/.config/opencode/skills/documents/docx/Tools/DocxCli.ts" edit report.docx \
  --append additions.md \
  -o report-updated.docx
```

### read

Extract markdown-like text from an existing document.

```bash
bun "~/.config/opencode/skills/documents/docx/Tools/DocxCli.ts" read report.docx -o report.md
```

### styles

List available styles in a template.

```bash
bun "~/.config/opencode/skills/documents/docx/Tools/DocxCli.ts" styles ~/doc_template.dotx
```

## Configuration

Set defaults in `~/.config/opencode/settings.json`:

```json
{
  "docxCli": {
    "template": "~/doc_template.dotx",
    "outputDir": "~/Documents/Generated"
  }
}
```

