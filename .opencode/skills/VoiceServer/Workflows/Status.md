# Check Voice Server Status

Check if the voice server is running and responding.

## Steps

1. **Check process:**
```bash
~/.config/opencode/VoiceServer/status.sh
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
~/.config/opencode/VoiceServer/start.sh
```

**Port conflict:**
```bash
lsof -i :8888
~/.config/opencode/VoiceServer/stop.sh
~/.config/opencode/VoiceServer/start.sh
```

**Check logs:**
```bash
tail -50 ~/.config/opencode/VoiceServer/logs/server.log
```
