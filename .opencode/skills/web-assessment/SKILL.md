---
name: web-assessment
description: Web application security assessment. USE WHEN user requests web app pentest, vulnerability scanning, threat modeling, or web security testing. Use `skill_find` with query `web-assessment` for docs.
---

## Customization

**Before executing, check for user customizations at:**
`~/.config/opencode/skills/PAI/USER/SKILLCUSTOMIZATIONS/web-assessment/`

If this directory exists, load and apply any PREFERENCES.md, configurations, or resources found there. These override default behavior. If the directory does not exist, proceed with skill defaults.


## 🚨 MANDATORY: Voice Notification (REQUIRED BEFORE ANY ACTION)

**You MUST send this notification BEFORE doing anything else when this skill is invoked.**

1. **Send voice notification**:
   Use the `voice_notify` tool:

- `message`: "Running the WORKFLOWNAME workflow in the web-assessment skill to ACTION"
1. Corporate Structure (Recon) → Define scope and targets
2. Subdomain Enumeration (recon) → Find all domains
3. Endpoint Discovery (recon) → Extract JS endpoints
4. Understand Application → Build app narrative
5. Create Threat Model → Prioritize attack scenarios
6. Execute Testing → Test against identified threats
7. Report Findings → Document with PoCs
```

## recon Skill Tools

web-assessment uses tools from the recon skill:

```bash
# Corporate structure for scope
bun ~/.config/opencode/skills/recon/Tools/CorporateStructure.ts target.com

# Subdomain enumeration
bun ~/.config/opencode/skills/recon/Tools/SubdomainEnum.ts target.com

# Endpoint discovery from JavaScript
bun ~/.config/opencode/skills/recon/Tools/EndpointDiscovery.ts https://target.com

# Port scanning
bun ~/.config/opencode/skills/recon/Tools/PortScan.ts target.com

# Path discovery
bun ~/.config/opencode/skills/recon/Tools/PathDiscovery.ts https://target.com
```

## UnderstandApplication Output

Produces structured narrative including:
- **Summary**: Purpose, industry, user base, critical functions
- **User Roles**: Access levels and capabilities
- **User Flows**: Step-by-step processes with sensitive data
- **Technology Stack**: Frontend, backend, auth, third-party
- **Attack Surface**: Entry points, inputs, file uploads, websockets

## CreateThreatModel Output

Generates prioritized attack plan:
- **Threats**: OWASP/CWE mapped with risk scores
- **Attack Paths**: Multi-step attack scenarios
- **Test Plan**: Prioritized with tool suggestions
- **Effort Estimates**: Quick/medium/extensive per threat

## Threat Categories

| Category | Triggers On |
|----------|-------------|
| Authentication | Auth mechanisms detected |
| Access Control | Multiple user roles |
| Injection | All web apps |
| Data Exposure | Sensitive data identified |
| File Upload | Upload functionality |
| API Security | API endpoints |
| WebSocket | WebSocket detected |
| Business Logic | All web apps |
| Payment Security | Payment flows |

## 6-Phase Pentest Methodology

**Phase 0**: Scoping & Preparation
**Phase 1**: Reconnaissance (recon skill)
**Phase 2**: Mapping (content discovery)
**Phase 3**: Vulnerability Analysis
**Phase 4**: Exploitation
**Phase 5**: Reporting

## Key Principles

1. **Authorization first** - Never test without explicit permission
2. **Understand before testing** - Build app narrative first
3. **Threat model guides testing** - Don't test blindly
4. **Breadth then depth** - Wide recon, focused exploitation
5. **Document everything** - Notes, screenshots, commands

## Workflow Index

**Core Assessment:**
- `Workflows/UnderstandApplication.md` - Application reconnaissance
- `Workflows/CreateThreatModel.md` - Attack scenario generation

**Penetration Testing:**
- `Workflows/pentest/MasterMethodology.md` - 6-phase methodology
- `Workflows/pentest/ToolInventory.md` - Security tools reference
- `Workflows/pentest/Reconnaissance.md` - Asset discovery
- `Workflows/pentest/Exploitation.md` - Vulnerability testing

**Web Fuzzing:**
- `Workflows/ffuf/FfufGuide.md` - FFUF fuzzing guide
- `Workflows/ffuf/FfufHelper.md` - Automated fuzzing helper

**Bug Bounty:**
- `Workflows/bug-bounty/Programs.md` - Program tracking
- `Workflows/bug-bounty/AutomationTool.md` - Bounty automation

**Web App Testing:**
- `Workflows/webapp/TestingGuide.md` - Playwright testing
- `Workflows/webapp/Examples.md` - Testing patterns

**OSINT:**
- `Workflows/osint/MasterGuide.md` - OSINT methodology
- `Workflows/osint/Reconnaissance.md` - Domain recon
- `Workflows/osint/SocialMediaIntel.md` - SOCMINT
- `Workflows/osint/Automation.md` - SpiderFoot/Maltego
- `Workflows/osint/MetadataAnalysis.md` - ExifTool analysis

**AI-Powered:**
- `Workflows/VulnerabilityAnalysisGemini3.md` - Gemini deep analysis

## Examples

**Example 1: Full assessment workflow**
```
User: "Security assessment on app.example.com"
→ Run UnderstandApplication to build narrative
→ Run CreateThreatModel to prioritize testing
→ Follow MasterMethodology with threat model guidance
→ Report findings with OWASP/CWE references
```

**Example 2: Quick threat model**
```
User: "How would I attack this app?"
→ Run CreateThreatModel on target
→ Get prioritized attack paths
→ Get test plan with tool suggestions
```

**Example 3: Integrate with recon**
```
User: "Assessment on target.com including all subdomains"
→ CorporateStructure (recon) → Find parent/child companies
→ SubdomainEnum (recon) → Find all subdomains
→ EndpointDiscovery (recon) → Extract JS endpoints
→ UnderstandApplication → Build app narrative
→ CreateThreatModel → Generate attack plan
```
