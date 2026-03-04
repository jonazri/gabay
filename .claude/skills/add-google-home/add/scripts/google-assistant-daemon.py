#!/usr/bin/env python3
"""
Google Assistant Daemon — stdin/stdout JSON daemon for gRPC text queries.

Loads credentials and establishes a gRPC channel at startup, then reads
JSON commands from stdin (one per line) and writes JSON responses to stdout.

Commands:
  {"cmd": "command", "text": "turn on the lights"}
    -> {"status": "ok", "text": "Turning on the lights", "raw_html": "..."}

  {"cmd": "health"}
    -> {"status": "ok"}

  {"cmd": "reset_conversation"}
    -> {"status": "ok"}
"""

# Must be set before importing google.protobuf — google-assistant-grpc ships
# old generated code that is incompatible with protobuf v6's upb/C++ backend.
import os
os.environ["PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION"] = "python"

import sys
import json
import html.parser
import time

# ---------------------------------------------------------------------------
# Resolve paths relative to the project root (parent of scripts/)
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
CREDENTIALS_PATH = os.path.join(
    PROJECT_ROOT, "data", "google-assistant", "credentials.json"
)
DEVICE_CONFIG_PATH = os.path.join(
    PROJECT_ROOT, "data", "google-assistant", "device_config.json"
)

ASSISTANT_API_ENDPOINT = "embeddedassistant.googleapis.com"
REFRESH_BUFFER_S = 5 * 60  # 5 minutes — skip refresh if token has more remaining

# ---------------------------------------------------------------------------
# Lazy imports — fail loudly if dependencies are missing
# ---------------------------------------------------------------------------
try:
    import google.auth.transport.grpc
    import google.auth.transport.requests
    import google.oauth2.credentials
    from google.assistant.embedded.v1alpha2 import (
        embedded_assistant_pb2,
        embedded_assistant_pb2_grpc,
    )
    import grpc
except ImportError as e:
    sys.stderr.write(f"Missing dependency: {e}\n")
    sys.stderr.write(
        "Install with: pip install google-assistant-grpc google-auth google-auth-oauthlib\n"
    )
    sys.exit(1)


# ---------------------------------------------------------------------------
# HTML text extractor — fallback when supplemental_display_text is empty
# ---------------------------------------------------------------------------
class _HTMLTextExtractor(html.parser.HTMLParser):
    """Simple HTML-to-text extractor."""

    def __init__(self):
        super().__init__()
        self._pieces: list[str] = []
        self._skip = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip = True

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self._skip = False
        if tag in ("p", "div", "br", "li", "h1", "h2", "h3", "h4"):
            self._pieces.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self._pieces.append(data)

    def get_text(self) -> str:
        return "".join(self._pieces).strip()


def extract_text_from_html(html_str: str) -> str:
    """Extract readable text from an HTML string."""
    parser = _HTMLTextExtractor()
    parser.feed(html_str)
    return parser.get_text()


# ---------------------------------------------------------------------------
# Credential management
# ---------------------------------------------------------------------------
def load_credentials() -> google.oauth2.credentials.Credentials:
    """Load OAuth credentials from disk, refreshing only if expired or expiring soon."""
    if not os.path.isfile(CREDENTIALS_PATH):
        sys.stderr.write(f"Credentials not found: {CREDENTIALS_PATH}\n")
        sys.stderr.write("Run scripts/google-assistant-setup.py first.\n")
        sys.exit(1)

    with open(CREDENTIALS_PATH) as f:
        cred_data = json.load(f)

    credentials = google.oauth2.credentials.Credentials(
        token=cred_data.get("token"),
        refresh_token=cred_data.get("refresh_token"),
        token_uri=cred_data.get("token_uri"),
        client_id=cred_data.get("client_id"),
        client_secret=cred_data.get("client_secret"),
        scopes=cred_data.get("scopes"),
    )

    # Skip refresh if token is still fresh (>5 min remaining)
    expires_at = cred_data.get("expires_at")
    if expires_at and credentials.token:
        remaining = expires_at / 1000 - time.time()  # expires_at is ms
        if remaining > REFRESH_BUFFER_S:
            sys.stderr.write(
                f"Token still fresh ({remaining:.0f}s remaining), skipping refresh.\n"
            )
            return credentials

    if cred_data.get("refresh_token"):
        sys.stderr.write("Refreshing access token...\n")
        credentials.refresh(google.auth.transport.requests.Request())
        _save_credentials(credentials)
        sys.stderr.write("Access token refreshed.\n")
    elif not credentials.token:
        sys.stderr.write("ERROR: No token and no refresh_token available.\n")
        sys.exit(1)

    return credentials


def _save_credentials(credentials: google.oauth2.credentials.Credentials):
    """Persist refreshed credentials back to disk (atomic write)."""
    # Compute expires_at in epoch milliseconds (matches Node convention).
    # Google tokens live 1 hour; credentials.expiry is set after refresh().
    expires_at_ms = None
    if credentials.expiry:
        expires_at_ms = int(credentials.expiry.timestamp() * 1000)
    else:
        # Fallback: assume 1-hour lifetime from now
        expires_at_ms = int((time.time() + 3600) * 1000)

    cred_data = {
        "token": credentials.token,
        "refresh_token": credentials.refresh_token,
        "token_uri": credentials.token_uri,
        "client_id": credentials.client_id,
        "client_secret": credentials.client_secret,
        "scopes": list(credentials.scopes) if credentials.scopes else [],
        "expires_at": expires_at_ms,
    }
    import tempfile
    tmp_fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(CREDENTIALS_PATH))
    with os.fdopen(tmp_fd, "w") as f:
        json.dump(cred_data, f, indent=2)
    os.replace(tmp_path, CREDENTIALS_PATH)


def load_device_config() -> dict:
    """Load device model/instance config from disk."""
    if not os.path.isfile(DEVICE_CONFIG_PATH):
        sys.stderr.write(f"Device config not found: {DEVICE_CONFIG_PATH}\n")
        sys.stderr.write("Run scripts/google-assistant-setup.py first.\n")
        sys.exit(1)

    with open(DEVICE_CONFIG_PATH) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# gRPC channel and assistant
# ---------------------------------------------------------------------------
class AssistantClient:
    """Wraps the Google Assistant gRPC Embedded API."""

    def __init__(self):
        self.credentials = load_credentials()
        self.device_config = load_device_config()
        self.conversation_state: bytes | None = None
        self._connect()

    def _connect(self):
        """Establish (or re-establish) the gRPC channel."""
        sys.stderr.write("Connecting to Google Assistant gRPC...\n")

        # Create an authorized gRPC channel
        http_request = google.auth.transport.requests.Request()
        channel = google.auth.transport.grpc.secure_authorized_channel(
            self.credentials, http_request, ASSISTANT_API_ENDPOINT
        )
        self.assistant = embedded_assistant_pb2_grpc.EmbeddedAssistantStub(channel)
        sys.stderr.write("Connected.\n")

    def _ensure_fresh_credentials(self):
        """Refresh credentials if expired or expiring within buffer, reconnect if needed."""
        needs_refresh = self.credentials.expired
        if not needs_refresh:
            # Check persisted expires_at for proactive refresh
            try:
                with open(CREDENTIALS_PATH) as f:
                    cred_data = json.load(f)
                expires_at = cred_data.get("expires_at")
                if expires_at:
                    remaining = expires_at / 1000 - time.time()
                    needs_refresh = remaining <= REFRESH_BUFFER_S
            except (OSError, json.JSONDecodeError):
                pass

        if needs_refresh:
            # Re-check — Node scheduler may have refreshed while we were deciding
            try:
                with open(CREDENTIALS_PATH) as f:
                    fresh_check = json.load(f)
                if fresh_check.get("expires_at", 0) / 1000 - time.time() > REFRESH_BUFFER_S:
                    sys.stderr.write("Token was refreshed externally, reloading from disk\n")
                    self.credentials = load_credentials()
                    self._connect()
                    return
            except (OSError, json.JSONDecodeError):
                pass
            sys.stderr.write("Token expired or expiring soon, refreshing...\n")
            self.credentials.refresh(google.auth.transport.requests.Request())
            _save_credentials(self.credentials)
            self._connect()

    def send_text_query(self, text: str) -> dict:
        """Send a text query and return the response."""
        self._ensure_fresh_credentials()

        device_config = embedded_assistant_pb2.DeviceConfig(
            device_id=self.device_config["device_instance_id"],
            device_model_id=self.device_config["device_model_id"],
        )

        dialog_state_in = embedded_assistant_pb2.DialogStateIn(
            language_code="en-US",
        )
        if self.conversation_state:
            dialog_state_in = embedded_assistant_pb2.DialogStateIn(
                language_code="en-US",
                conversation_state=self.conversation_state,
            )

        assist_config = embedded_assistant_pb2.AssistConfig(
            text_query=text,
            audio_out_config=embedded_assistant_pb2.AudioOutConfig(
                encoding=embedded_assistant_pb2.AudioOutConfig.LINEAR16,
                sample_rate_hertz=16000,
                volume_percentage=0,  # we only want text, not audio
            ),
            dialog_state_in=dialog_state_in,
            device_config=device_config,
            screen_out_config=embedded_assistant_pb2.ScreenOutConfig(
                screen_mode=embedded_assistant_pb2.ScreenOutConfig.PLAYING,
            ),
        )

        request = embedded_assistant_pb2.AssistRequest(config=assist_config)

        response_text = ""
        raw_html = ""

        try:
            for response in self.assistant.Assist(iter([request]), timeout=25):
                # Update conversation state for multi-turn
                if response.dialog_state_out.conversation_state:
                    self.conversation_state = (
                        response.dialog_state_out.conversation_state
                    )

                # Primary: supplemental display text
                if response.dialog_state_out.supplemental_display_text:
                    response_text = (
                        response.dialog_state_out.supplemental_display_text
                    )

                # Fallback: HTML screen output
                if response.screen_out.data:
                    raw_html = response.screen_out.data.decode("utf-8", errors="replace")

        except grpc.RpcError as e:
            sys.stderr.write(f"gRPC error: {e.code().name}: {e.details()}\n")
            if e.code() in (grpc.StatusCode.UNAUTHENTICATED, grpc.StatusCode.DEADLINE_EXCEEDED):
                if e.code() == grpc.StatusCode.UNAUTHENTICATED:
                    sys.stderr.write("Token expired, refreshing and reconnecting...\n")
                    self.credentials.refresh(google.auth.transport.requests.Request())
                    _save_credentials(self.credentials)
                else:
                    sys.stderr.write("Request timed out, reconnecting...\n")
            self._connect()
            return {"error": f"gRPC error: {e.code().name}: {e.details()}"}

        # If no supplemental text, try extracting from HTML
        if not response_text and raw_html:
            response_text = extract_text_from_html(raw_html)

        result = {"status": "ok", "text": response_text}
        if raw_html:
            result["raw_html"] = raw_html
        if not response_text:
            result["warning"] = "no_response_text"
        return result

    def reset_conversation(self):
        """Clear conversation state for a fresh start."""
        self.conversation_state = None


# ---------------------------------------------------------------------------
# Command handler
# ---------------------------------------------------------------------------
def handle_command(client: AssistantClient, cmd: dict) -> dict:
    """Process a single command and return a response dict."""
    command = cmd.get("cmd")
    cmd_id = cmd.get("id")

    if command == "health":
        response = {"status": "ok"}
    elif command == "command":
        text = cmd.get("text")
        if not text:
            response = {"error": "missing text field"}
        else:
            response = client.send_text_query(text)
    elif command == "reset_conversation":
        client.reset_conversation()
        response = {"status": "ok"}
    else:
        response = {"error": f"unknown command: {command}"}

    # Echo back the command ID for response routing
    if cmd_id is not None:
        response["id"] = cmd_id

    return response


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
def main():
    sys.stderr.write("Starting Google Assistant daemon...\n")

    client = AssistantClient()

    sys.stderr.write("Ready for commands.\n")

    # Signal readiness on stdout
    sys.stdout.write(json.dumps({"status": "ready"}) + "\n")
    sys.stdout.flush()

    # Read commands from stdin, one JSON object per line
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            cmd = json.loads(line)
        except json.JSONDecodeError as e:
            response = {"error": f"invalid JSON: {e}"}
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()
            continue

        try:
            response = handle_command(client, cmd)
        except Exception as e:
            sys.stderr.write(f"Unhandled error: {e}\n")
            response = {"error": str(e)}

        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
