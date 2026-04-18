"""Stateless, HMAC-signed values for the OAuth `state` parameter.

We avoid storing the expected state in a cookie (which is fragile across
browsers / SameSite settings / redirects) by embedding an HMAC signature
right in the value. On callback, we just verify the signature.

Format: "<nonce>.<unix_ts>.<hex_sig>"
"""

import hashlib
import hmac
import secrets
import time

from app.core.config import get_settings

_MAX_AGE_SECONDS = 600  # 10 minutes is plenty to complete the OAuth round trip.


def _sign(message: str, secret: str) -> str:
    return hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()


def issue_state() -> str:
    secret = get_settings().session_secret
    nonce = secrets.token_urlsafe(16)
    ts = str(int(time.time()))
    msg = f"{nonce}.{ts}"
    return f"{msg}.{_sign(msg, secret)}"


def verify_state(state: str) -> bool:
    secret = get_settings().session_secret
    nonce, ts_str, sig = state.rsplit(".", 2)
    expected = _sign(f"{nonce}.{ts_str}", secret)
    if not hmac.compare_digest(sig, expected):
        return False
    return (time.time() - int(ts_str)) <= _MAX_AGE_SECONDS
