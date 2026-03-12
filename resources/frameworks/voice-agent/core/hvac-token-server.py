#!/usr/bin/env python3
"""
HVAC LiveKit Token Server
Runs on port 8096 (token server on 8095)

Deploy alongside hvac_agent.py
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import hmac
import hashlib
import base64
import time
import os

# HVAC LiveKit credentials — read from environment variables.
# Create a new project at https://cloud.livekit.io and set these:
#   export LIVEKIT_API_KEY="your-api-key"
#   export LIVEKIT_API_SECRET="your-api-secret"
#   export LIVEKIT_URL="wss://your-project.livekit.cloud"
API_KEY = os.environ.get('LIVEKIT_API_KEY', '')
API_SECRET = os.environ.get('LIVEKIT_API_SECRET', '')
LIVEKIT_URL = os.environ.get('LIVEKIT_URL', 'ws://localhost:7880')

if not API_KEY or not API_SECRET:
    raise RuntimeError(
        "LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set as environment variables. "
        "Create a project at https://cloud.livekit.io to obtain credentials."
    )

def base64url_encode(data):
    """Base64URL encode without padding"""
    if isinstance(data, str):
        data = data.encode('utf-8')
    elif isinstance(data, dict):
        data = json.dumps(data, separators=(',', ':')).encode('utf-8')
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')

def generate_token(identity, room):
    """Generate a LiveKit JWT token"""
    header = {'alg': 'HS256', 'typ': 'JWT'}
    now = int(time.time())

    payload = {
        'iss': API_KEY,
        'sub': identity,
        'iat': now,
        'exp': now + 3600,  # 1 hour expiry
        'nbf': now,
        'jti': f'{identity}-{now}',
        'video': {
            'room': room,
            'roomJoin': True,
            'canPublish': True,
            'canSubscribe': True,
            'canPublishData': True
        }
    }

    header_encoded = base64url_encode(header)
    payload_encoded = base64url_encode(payload)
    signature_input = f'{header_encoded}.{payload_encoded}'
    signature = hmac.new(
        API_SECRET.encode(),
        signature_input.encode(),
        hashlib.sha256
    ).digest()
    signature_encoded = base64.urlsafe_b64encode(signature).rstrip(b'=').decode('utf-8')

    return f'{signature_input}.{signature_encoded}'

class TokenHandler(BaseHTTPRequestHandler):
    """HTTP handler for token requests"""

    def _cors(self):
        """Add CORS headers"""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        """Handle CORS preflight"""
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        """Handle token generation requests"""
        if self.path != '/token':
            self.send_response(404)
            self.end_headers()
            return

        # Parse request body
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        data = json.loads(body) if body else {}

        # HVAC-specific room naming
        timestamp = int(time.time())
        identity = data.get('identity', f'caller-{timestamp}')
        room = data.get('room', f'hvac-ticket-{timestamp}')

        # Generate token
        token = generate_token(identity, room)

        response = {
            'token': token,
            'url': LIVEKIT_URL,
            'room': room,
            'identity': identity
        }

        # Send response
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self._cors()
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())

    def do_GET(self):
        """Health check endpoint"""
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._cors()
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'ok', 'service': 'hvac-token-server'}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        """Custom logging"""
        print(f"[HVAC Token] {args[0]}")

if __name__ == '__main__':
    PORT = 8096  # Token server port
    server = HTTPServer(('0.0.0.0', PORT), TokenHandler)
    print(f"HVAC LiveKit Token Server running on port {PORT}")
    print(f"LiveKit URL: {LIVEKIT_URL}")
    print(f"API Key: {API_KEY[:10]}..." if len(API_KEY) > 10 else f"API Key: {API_KEY}")
    server.serve_forever()
