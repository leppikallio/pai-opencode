# Check Voice Server Status

Check if the voice server is running and responding.

## Steps

1. **Check process:**
```bash
~/.opencode/VoiceServer/status.sh
```

2. **Test endpoint:**
```bash
curl -s http://localhost:8888/health
```

3. **Send test notification:**
```bash
curl -X POST http://localhost:8888/notify \
  -H "Content-Type: application/json" \
  -d '{"message":"Voice server test","voice_id":"{daidentity.voiceId}","title":"Test"}'
```

## Troubleshooting

**Server not running:**
```bash
~/.opencode/VoiceServer/start.sh
```

**Port conflict:**
```bash
lsof -i :8888
~/.opencode/VoiceServer/stop.sh
~/.opencode/VoiceServer/start.sh
```

**Check logs:**
```bash
tail -50 ~/.opencode/VoiceServer/logs/server.log
```
