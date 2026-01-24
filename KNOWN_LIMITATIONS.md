# Known Limitations (v1.0)

This document lists features that are planned but not yet implemented in v1.0.

---

## Deferred to v1.1

### Voice Server Integration
- Skill workflows contain voice notification calls (`curl localhost:8888/notify`)
- Voice server not included in v1.0
- Calls fail gracefully if server not running
- **Planned:** v1.1 - VoiceServer skill + ElevenLabs integration

### Observability Dashboard
- Event logging to `/tmp/pai-opencode-debug.log` works
- No visualization dashboard yet
- **Planned:** v1.1 - Web dashboard for session history

### Multi-Channel Notifications
- Voice notifications prepared in skills
- ntfy/Discord integration optional
- **Planned:** v1.1 - Notification routing config

---

## Optional Features (Not Required)

### Skill Customizations
- System exists at `.opencode/skills/CORE/USER/SKILLCUSTOMIZATIONS/`
- Not populated by default
- Skills work without customizations
- **Setup:** Create customization files as needed

### Memory Capture
- MEMORY structure exists and is ready
- Automatic capture depends on plugin configuration
- **Setup:** Configure memory settings in plugin

---

## Working in v1.0

- [x] Core plugin system (auto-discovery, no config needed)
- [x] All 33 skills functional
- [x] TELOS/USER context loading
- [x] Security validation on tool execution
- [x] Memory structure (capture ready)
- [x] Skill routing and execution
- [x] Algorithm format and ISC tracking
- [x] 8 AI providers supported (Anthropic, OpenAI, Google, Groq, AWS Bedrock, Azure, ZEN, Ollama)

---

## Troubleshooting

### Plugin not loading?
```bash
# Check plugin log
tail -f /tmp/pai-opencode-debug.log

# Verify plugin exists
ls -la .opencode/plugins/pai-unified.ts
```

### Context not injected?
```bash
# Check context files exist
ls -la .opencode/skills/CORE/USER/TELOS/
ls -la .opencode/skills/CORE/USER/DAIDENTITY.md
```

### Security validation blocking commands?
The security validator blocks dangerous commands by design. If a legitimate command is blocked, review the security rules in the plugin.

---

*Last updated: 2026-01-24*
*Version: 1.0*
