# Voice Recognition
Speaker recognition using PyAnnote voice embeddings. Identifies the user's voice to distinguish direct commands from shared/forwarded audio.

## Prerequisites
- skill/voice-transcription-elevenlabs

## Installation
1. `git fetch origin skill/voice-recognition`
2. `git merge origin/skill/voice-recognition`
3. `npm install`
4. Start the voice recognition service: `python3 scripts/voice-recognition-service.py`
5. Enroll voices: `npx tsx scripts/enroll-voice.ts`

## Verification
- `npm run build && npm test`

## Environment Variables
None (service runs locally)
