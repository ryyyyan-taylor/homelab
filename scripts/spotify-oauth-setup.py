#!/usr/bin/env python3
"""
One-time Spotify Authorization Code OAuth setup for the music bot.

Run this locally (on a machine with a browser), not in the cluster:

    export SPOTIFY_CLIENT_ID=...
    export SPOTIFY_CLIENT_SECRET=...
    python3 scripts/spotify-oauth-setup.py

It opens your browser to Spotify's login/consent page, catches the
redirect on localhost, exchanges the code for tokens, and prints the
refresh token. Paste that refresh token back to Claude — it goes into
the music-bot SOPS secret and is not needed again unless Spotify
revokes it.

Before running, add this exact redirect URI to the app in the Spotify
Developer Dashboard (Edit Settings -> Redirect URIs):

    http://127.0.0.1:8888/callback
"""

import base64
import http.server
import os
import sys
import urllib.parse
import urllib.request
import webbrowser

CLIENT_ID = os.environ.get("SPOTIFY_CLIENT_ID")
CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET")
REDIRECT_URI = "http://127.0.0.1:8888/callback"
SCOPE = "playlist-read-private playlist-read-collaborative"

if not CLIENT_ID or not CLIENT_SECRET:
    print("Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET first.", file=sys.stderr)
    sys.exit(1)

received_code: str | None = None


class CallbackHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        global received_code
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        if "code" in params:
            received_code = params["code"][0]
            self.wfile.write(b"Logged in. You can close this tab and return to the terminal.")
        else:
            self.wfile.write(b"No code received. Check the terminal for details.")

    def log_message(self, *args: object) -> None:
        pass


def main() -> None:
    authorize_url = "https://accounts.spotify.com/authorize?" + urllib.parse.urlencode(
        {
            "client_id": CLIENT_ID,
            "response_type": "code",
            "redirect_uri": REDIRECT_URI,
            "scope": SCOPE,
        }
    )
    print(f"Opening browser to log in:\n{authorize_url}\n")
    webbrowser.open(authorize_url)

    server = http.server.HTTPServer(("127.0.0.1", 8888), CallbackHandler)
    server.handle_request()

    if not received_code:
        print("Did not receive an authorization code.", file=sys.stderr)
        sys.exit(1)

    basic_auth = base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
    body = urllib.parse.urlencode(
        {
            "grant_type": "authorization_code",
            "code": received_code,
            "redirect_uri": REDIRECT_URI,
        }
    ).encode()
    request = urllib.request.Request(
        "https://accounts.spotify.com/api/token",
        data=body,
        headers={
            "Authorization": f"Basic {basic_auth}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        import json

        tokens = json.loads(response.read())

    print("\nSuccess. Refresh token (paste this back to Claude):\n")
    print(tokens["refresh_token"])


if __name__ == "__main__":
    main()
