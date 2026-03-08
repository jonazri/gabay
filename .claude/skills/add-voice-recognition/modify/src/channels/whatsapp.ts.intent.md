# whatsapp.ts Overlay Intent

## Changes
Extends WhatsAppChannel to handle voice message transcription and speaker identification. Adds three new call sites in the messages.upsert handler:
1. Detect voice messages via `isVoiceMessage(msg)`
2. Transcribe audio and get audioBuffer via `transcribeAudioMessage(msg, sock)`
3. Identify speaker and optionally auto-update voice profile via `identifySpeaker(audioBuffer)` and `updateVoiceProfile()`

## Key Sections
- Line 30: Import `isVoiceMessage, transcribeAudioMessage` from transcription.js
- Line 31: Import `identifySpeaker, updateVoiceProfile` from voice-recognition.js
- Line 40: VOICE_AUDIO_DIR constant for optional raw audio archival
- Lines 227: Guard in message filter — allow voice messages through even when empty
- Lines 241-320: Voice message handling block (transcription + speaker ID + profile update)
- Lines 249-264: Optional audio save (VOICE_SAVE_AUDIO=true)
- Lines 266-305: Speaker identification with high-confidence auto-profile-update (similarity >= 0.65)
- Lines 307-315: Fallback messaging for transcription errors
- Line 308: Format final content as `[Voice: <transcript>]<speaker_tag>`

## Invariants to Preserve
- Voice message detection happens after `isVoiceMessage(msg)` check (line 243)
- Speaker identification must use OWNER_NAME config (line 277) for auto-update eligibility
- High-confidence similarity threshold is 0.65 (line 279) — lower values skip auto-update
- finalContent formatting must be `[Voice: <transcript>][<speaker_info>]` for consistency
- Transcription errors must not crash message handler (try/catch at line 316)
- audioBuffer passed to identifySpeaker is non-null (guarded by line 268)
- Original message content extraction (conversation, extendedTextMessage, etc.) is unchanged
- Group metadata sync and outgoing queue logic remain untouched
