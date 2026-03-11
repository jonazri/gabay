#!/usr/bin/env python3
"""
Google Assistant Setup — interactive first-time OAuth and device registration.

Usage:
  python3 scripts/google-assistant-setup.py /path/to/client_secret.json

This script:
  1. Runs the OAuth Desktop app flow for Google Assistant SDK
  2. Saves credentials to data/google-assistant/credentials.json
  3. Asks for GCP project ID
  4. Registers a device model and instance
  5. Saves device config to data/google-assistant/device_config.json
"""

import sys
import os
import json
import argparse
import uuid

# ---------------------------------------------------------------------------
# Resolve paths relative to the project root (parent of scripts/)
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data", "google-assistant")
CREDENTIALS_PATH = os.path.join(DATA_DIR, "credentials.json")
DEVICE_CONFIG_PATH = os.path.join(DATA_DIR, "device_config.json")

ASSISTANT_SCOPE = "https://www.googleapis.com/auth/assistant-sdk-prototype"


def ensure_data_dir():
    """Create the data/google-assistant/ directory if it doesn't exist."""
    os.makedirs(DATA_DIR, exist_ok=True)


def run_oauth_flow(client_secret_path: str) -> dict:
    """Run the Desktop app OAuth flow and return serialized credentials."""
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        print("ERROR: google-auth-oauthlib is not installed.")
        print("  pip install google-auth-oauthlib")
        sys.exit(1)

    if not os.path.isfile(client_secret_path):
        print(f"ERROR: Client secret file not found: {client_secret_path}")
        sys.exit(1)

    print(f"\nUsing client secret: {client_secret_path}")

    flow = InstalledAppFlow.from_client_secrets_file(
        client_secret_path,
        scopes=[ASSISTANT_SCOPE],
        redirect_uri="urn:ietf:wg:oauth:2.0:oob",
    )

    # Generate the authorization URL for manual flow (works on headless servers)
    auth_url, _ = flow.authorization_url(prompt="consent")

    print("\nOpen this URL in your browser and authorize:\n")
    print(f"  {auth_url}\n")
    code = input("Paste the authorization code here: ").strip()

    if not code:
        print("ERROR: No authorization code provided.")
        sys.exit(1)

    flow.fetch_token(code=code)
    credentials = flow.credentials

    # Serialize credentials so we can reload them later
    cred_data = {
        "token": credentials.token,
        "refresh_token": credentials.refresh_token,
        "token_uri": credentials.token_uri,
        "client_id": credentials.client_id,
        "client_secret": credentials.client_secret,
        "scopes": list(credentials.scopes) if credentials.scopes else [ASSISTANT_SCOPE],
    }
    return cred_data


def register_device(project_id: str, access_token: str) -> dict:
    """Register device model and instance with Google Assistant API."""
    import requests

    device_model_id = f"{project_id}-nanoclaw-model"
    device_instance_id = f"nanoclaw-instance-{uuid.uuid4().hex[:8]}"
    base_url = "https://embeddedassistant.googleapis.com/v1alpha2"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    # Register device model
    print("\nRegistering device model with Google...")
    model_resp = requests.post(
        f"{base_url}/projects/{project_id}/deviceModels/",
        headers=headers,
        json={
            "device_model_id": device_model_id,
            "project_id": project_id,
            "device_type": "action.devices.types.LIGHT",
            "manifest": {
                "manufacturer": "NanoClaw",
                "product_name": "NanoClaw Assistant",
                "device_description": "Smart home controller",
            },
        },
    )
    if model_resp.status_code == 200:
        print(f"  Device model registered: {device_model_id}")
    elif model_resp.status_code == 409:
        print(f"  Device model already exists: {device_model_id}")
    else:
        print(f"  Warning: model registration returned {model_resp.status_code}: {model_resp.text}")

    # Register device instance
    print("Registering device instance with Google...")
    instance_resp = requests.post(
        f"{base_url}/projects/{project_id}/devices/",
        headers=headers,
        json={
            "id": device_instance_id,
            "model_id": device_model_id,
            "client_type": "SDK_SERVICE",
            "nickname": "NanoClaw",
        },
    )
    if instance_resp.status_code == 200:
        print(f"  Device instance registered: {device_instance_id}")
    else:
        print(f"  Warning: instance registration returned {instance_resp.status_code}: {instance_resp.text}")

    device_config = {
        "project_id": project_id,
        "device_model_id": device_model_id,
        "device_instance_id": device_instance_id,
    }
    return device_config


def main():
    parser = argparse.ArgumentParser(
        description="Set up Google Assistant OAuth and device registration."
    )
    parser.add_argument(
        "client_secret",
        help="Path to the client_secret.json file downloaded from GCP Console.",
    )
    args = parser.parse_args()

    ensure_data_dir()

    # ── Step 1: OAuth ─────────────────────────────────────────────────────
    print("=" * 60)
    print("  Google Assistant Setup for NanoClaw")
    print("=" * 60)

    if os.path.isfile(CREDENTIALS_PATH):
        answer = input(
            f"\nCredentials already exist at {CREDENTIALS_PATH}\n"
            "Overwrite? [y/N]: "
        ).strip().lower()
        if answer != "y":
            print("Keeping existing credentials.")
            cred_data = json.loads(open(CREDENTIALS_PATH).read())
        else:
            cred_data = run_oauth_flow(args.client_secret)
    else:
        cred_data = run_oauth_flow(args.client_secret)

    # Save credentials
    with open(CREDENTIALS_PATH, "w") as f:
        json.dump(cred_data, f, indent=2)
    print(f"\nCredentials saved to {CREDENTIALS_PATH}")

    # ── Step 2: Device registration ──────────────────────────────────────
    print("\n" + "-" * 60)
    print("  Device Registration")
    print("-" * 60)

    if os.path.isfile(DEVICE_CONFIG_PATH):
        answer = input(
            f"\nDevice config already exists at {DEVICE_CONFIG_PATH}\n"
            "Overwrite? [y/N]: "
        ).strip().lower()
        if answer != "y":
            print("Keeping existing device config.")
            print("\nSetup complete!")
            return
        existing = json.loads(open(DEVICE_CONFIG_PATH).read())
        default_project = existing.get("project_id", "")
    else:
        default_project = ""

    prompt = "\nEnter your GCP project ID"
    if default_project:
        prompt += f" [{default_project}]"
    prompt += ": "

    project_id = input(prompt).strip()
    if not project_id and default_project:
        project_id = default_project
    if not project_id:
        print("ERROR: Project ID is required.")
        sys.exit(1)

    device_config = register_device(project_id, cred_data["token"])

    with open(DEVICE_CONFIG_PATH, "w") as f:
        json.dump(device_config, f, indent=2)
    print(f"\nDevice config saved to {DEVICE_CONFIG_PATH}")

    print("\n" + "=" * 60)
    print("  Setup complete!")
    print("=" * 60)
    print(f"\n  Credentials:   {CREDENTIALS_PATH}")
    print(f"  Device config: {DEVICE_CONFIG_PATH}")
    print("\nYou can now start the Google Assistant daemon.")


if __name__ == "__main__":
    main()
