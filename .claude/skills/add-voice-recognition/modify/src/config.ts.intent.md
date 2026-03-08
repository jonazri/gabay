# config.ts Overlay Intent

## Changes
This overlay is a **full copy** of the upstream config.ts file with no modifications. It exists as a placeholder to ensure the voice-recognition skill properly manages its dependencies on configuration exports.

## Key Sections
- Lines 9-20: Environment variable exports (ASSISTANT_NAME, ASSISTANT_HAS_OWN_NUMBER, OWNER_NAME)
- Lines 21-60: Container and polling intervals
- Lines 66-74: TRIGGER_PATTERN regex with ASSISTANT_NAME
- Lines 73-75: Timezone configuration

## Invariants to Preserve
- All config exports remain unchanged
- Environment variable loading via `readEnvFile()` is preserved
- OWNER_NAME is required by voice-recognition.ts for profile updates
- TRIGGER_PATTERN uses ASSISTANT_NAME and must be importable
- No new exports are added (all additions are via separate voice-recognition.ts file)
