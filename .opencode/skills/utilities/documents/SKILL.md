---
name: documents
description: Document processing router for PDF/DOCX/PPTX/XLSX. USE WHEN user asks to create, edit, convert, or analyze documents or mentions Word, PDF, PowerPoint, Excel, or .docx/.pdf/.pptx/.xlsx. Use `skill_find` with query `documents` for docs.
---

## Customization

**Before executing, check for user customizations at:**
`~/.config/opencode/skills/PAI/USER/SKILLCUSTOMIZATIONS/documents/`

If this directory exists, load and apply any PREFERENCES.md, configurations, or resources found there. These override default behavior. If the directory does not exist, proceed with skill defaults.


## 🚨 MANDATORY: Voice Notification (REQUIRED BEFORE ANY ACTION)

**You MUST send this notification BEFORE doing anything else when this skill is invoked.**

1. **Send voice notification**:
   Use the `voice_notify` tool:

- `message`: "Running the WORKFLOWNAME workflow in the documents skill to ACTION"
User: "Create a consulting proposal doc with redlining"
→ Routes to DOCX workflows
→ Creates document with docx-js
→ Enables tracked changes for review workflow
→ Outputs professional .docx with revision marks
```

**Example 2: Fill a PDF form programmatically**
```
User: "Fill out this NDA PDF with my info"
→ Routes to PDF workflows
→ Reads form fields from PDF
→ Fills fields programmatically with pdf-lib
→ Outputs completed, flattened PDF
```

**Example 3: Build financial model spreadsheet**
```
User: "Create a revenue projection spreadsheet"
→ Routes to XLSX workflows
→ Creates workbook with openpyxl
→ Adds formulas (never hardcoded values)
→ Runs recalc.py to update calculations
```

## 🔗 Integration with Other Skills

### Feeds Into:
- **writing** skill - Creating documents for blog posts and newsletters
- **business** skill - Creating consulting proposals and financial models
- **research** skill - Extracting data from research documents

### Uses:
- **media** skill - Creating images for document illustrations
- **development** skill - Building document processing automation
- **system** skill - Command-line tools and scripting

## 🎯 Key Principles

### Document Creation
1. **Quality First** - Professional formatting and structure from the start
2. **Template Reuse** - Leverage existing templates when available
3. **Validation** - Always verify output (visual inspection, error checking)
4. **Automation** - Use scripts for repetitive tasks

### Document Editing
1. **Preserve Intent** - Maintain original formatting and structure
2. **Track Changes** - Use proper workflows for document review
3. **Batch Processing** - Group related operations for efficiency
4. **Error Prevention** - Validate before finalizing

### Document Analysis
1. **Right Tool** - Choose appropriate library/tool for the task
2. **Data Integrity** - Preserve original data when extracting/converting
3. **Format Awareness** - Understand document structure (OOXML, PDF structure, etc.)
4. **Performance** - Use efficient methods for large documents

## 📚 Full Reference Documentation

**Word Documents (DOCX):**
- Main Guide: `~/.config/opencode/skills/utilities/documents/docx/SKILL.md`

**PDF Processing:**
- Main Guide: `~/.config/opencode/skills/utilities/documents/pdf/SKILL.md`
- Forms Guide: `~/.config/opencode/skills/utilities/documents/pdf/forms.md`
- Advanced Reference: `~/.config/opencode/skills/utilities/documents/pdf/reference.md`

**PowerPoint Presentations (PPTX):**
- Main Guide: `~/.config/opencode/skills/utilities/documents/pptx/SKILL.md`
- Creation Reference: `~/.config/opencode/skills/utilities/documents/pptx/html2pptx.md`
- Editing Reference: `~/.config/opencode/skills/utilities/documents/pptx/ooxml.md`

**Excel Spreadsheets (XLSX):**
- Main Guide: `~/.config/opencode/skills/utilities/documents/xlsx/SKILL.md`
- Recalc Script: `~/.config/opencode/skills/utilities/documents/xlsx/recalc.py`

---

## Summary

**The documents skill provides comprehensive document processing:**

- **DOCX** - Create, edit, analyze Word documents with tracked changes support
- **PDF** - Create, manipulate, extract from PDFs with form filling capabilities
- **PPTX** - Create, edit presentations with professional design and templates
- **XLSX** - Create, edit spreadsheets with formulas and financial modeling

**Reference-based organization** - Each document type has complete guides and tooling

**Routing is automatic** - Analyzes user intent and activates appropriate document type workflow

**Professional quality** - Standards and best practices for production-ready documents
