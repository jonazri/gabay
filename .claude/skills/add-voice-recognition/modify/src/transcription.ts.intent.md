# transcription.ts Overlay Intent

## Changes
New file that adds voice message transcription via ElevenLabs API. Exports utilities for detecting voice messages and transcribing audio with optional metadata (confidence, sentiment, speaking pace).

## Key Sections
- Lines 1-12: Imports and TranscriptionConfig interface
- Lines 14-29: AudioEvent and TranscriptionMetadata interfaces (optional enrichment)
- Lines 31-36: DEFAULT_CONFIG with ElevenLabs model (scribe_v2)
- Lines 38-105: Helper functions for sentiment analysis, speaking pace calculation, metadata formatting
- Lines 107-193: `transcribeWithElevenLabs()` — calls ElevenLabs API, extracts metadata if enabled
- Lines 195-239: Public exports — `TranscriptionResult`, `transcribeAudioMessage()`, `isVoiceMessage()`

## Invariants to Preserve
- `transcribeAudioMessage(msg, sock)` signature must match imports in whatsapp.ts
- `isVoiceMessage(msg)` predicate must detect `msg.message?.audioMessage?.ptt === true`
- ELEVENLABS_API_KEY loaded via `readEnvFile()` (not process.env to avoid leaking to child processes)
- Fallback message: '[Voice Message - transcription unavailable]'
- audioBuffer returned in TranscriptionResult (needed for voice-recognition.ts speaker identification)
- No imports from voice-recognition.ts (avoid circular dependency)
