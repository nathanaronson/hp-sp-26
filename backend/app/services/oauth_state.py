"""Stateless, HMAC-signed values for the OAuth `state` parameter.

We avoid storing the expected state in a cookie (which is fragile across
browsers / SameSite settings / redirects) by embedding an HMAC signature
right in the value. On callback, we just verify the signature.

Format: "<nonce>.<unix_ts>[.<cli_port>].<hex_sig>"

`cli_port` is optional. When set, the OAuth callback redirects the user to
http://127.0.0.1:<cli_port>/callback?token=<session_token> instead of the
web frontend.
"""

import hashlib
import hmac
import secrets
import time
from dataclasses import dataclass

from app.core.config import get_settings

_MAX_AGE_SECONDS = 600  # 10 minutes is plenty to complete the OAuth round trip.


@dataclass
class StateInfo:
    valid: bool
    cli_port: int | None = None


def _sign(message: str, secret: str) -> str:
    return hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()


def issue_state(cli_port: int | None = None) -> str:
    secret = get_settings().session_secret
    nonce = secrets.token_urlsafe(16)
    ts = str(int(time.time()))
    parts = [nonce, ts]
    if cli_port is not None:
        parts.append(str(cli_port))
    msg = ".".join(parts)
    return f"{msg}.{_sign(msg, secret)}"


def parse_state(state: str) -> StateInfo:
    secret = get_settings().session_secret
    parts = state.split(".")
    if len(parts) < 3:
        return StateInfo(valid=False)
    sig = parts[-1]
    msg = ".".join(parts[:-1])
    expected = _sign(msg, secret)
    if not hmac.compare_digest(sig, expected):
        return StateInfo(valid=False)
    if (time.time() - int(parts[1])) > _MAX_AGE_SECONDS:
        return StateInfo(valid=False)
    cli_port = int(parts[2]) if len(parts) >= 4 else None
    return StateInfo(valid=True, cli_port=cli_port)
