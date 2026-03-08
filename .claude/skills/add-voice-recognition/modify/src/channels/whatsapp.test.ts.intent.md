# whatsapp.test.ts Overlay Intent

## Changes
Comprehensive test suite for WhatsAppChannel voice recognition integration. Adds mocks for transcription and voice-recognition modules, plus new test cases covering:
- Voice message detection and transcription
- Speaker identification and auto-profile updates
- Fallback handling when transcription fails
- Metadata formatting and speaker tags

## Key Sections
- Lines 35-41: Mock transcription module (`isVoiceMessage`, `transcribeAudioMessage`)
- Lines 44-55: Mock voice-recognition module (`identifySpeaker`, `updateVoiceProfile`)
- Lines 571-601: Test "transcribes voice messages" — basic happy path
- Lines 603-637: Tests for transcription fallback (null, error)
- Lines 674-706: Test "auto-updates voice profile when owner is identified with high similarity"
- Lines 708-740: Test "skips auto-update when similarity is below threshold"
- Lines 242-253: Test "sets up LID to phone mapping" (comment-only placeholder)

## Invariants to Preserve
- Mock `transcribeAudioMessage` returns `{ transcript: string, audioBuffer: Buffer | null }`
- Mock `identifySpeaker` returns `{ speaker, similarity, confidence, embedding }`
- Voice message detection via `audioMessage?.ptt === true` (line 36, 586)
- Speaker tag format: `[Direct from <name>, <pct>% match]` or `[Possibly <name>, <pct>% match]` (line 273)
- Unknown speaker tag: `[Unknown speaker]` (line 297)
- High-confidence auto-update triggered at similarity >= 0.65 (line 679)
- Low-similarity case (0.5) skips auto-update (lines 708-740)
- Transcription error fallback: `[Voice Message - transcription failed]` (line 669)
- Null transcript fallback: `[Voice Message - transcription unavailable]` (line 634)
- Test isolation: all mocks reset via `beforeEach` and `afterEach` (lines 182-189)
