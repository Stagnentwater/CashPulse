"""Password hashing and cookie sessions for CashPulse.

Passwords: hashlib.scrypt, stored as "scrypt$<n>$<r>$<p>$<salt_hex>$<hash_hex>".
Sessions: a random token goes to the browser in an httponly cookie; only its sha256 is stored.
"""

import hashlib
import hmac
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, Response

from db import get_db

SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 64
SALT_BYTES = 16

SESSION_COOKIE = "cp_session"
SESSION_DAYS = 7


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int, dklen: int) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=dklen)


def hash_password(password: str) -> str:
    """Returns 'scrypt$16384$8$1$<salt_hex>$<hash_hex>' with a fresh random salt."""
    salt = os.urandom(SALT_BYTES)
    digest = _scrypt(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P, SCRYPT_DKLEN)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """True when password matches the stored hash. Returns False for any malformed stored value."""
    try:
        parts = stored.split("$")
        if len(parts) != 6 or parts[0] != "scrypt":
            return False
        n = int(parts[1])
        r = int(parts[2])
        p = int(parts[3])
        salt = bytes.fromhex(parts[4])
        expected = bytes.fromhex(parts[5])
        if not salt or not expected:
            return False
        actual = _scrypt(password, salt, n, r, p, len(expected))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def create_session(conn: sqlite3.Connection, user_id: str) -> str:
    """Creates a session row and returns the raw token (only the hash is stored)."""
    raw_token = secrets.token_urlsafe(32)
    expires_at = (_now() + timedelta(days=SESSION_DAYS)).isoformat(timespec="seconds")
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        (_hash_token(raw_token), user_id, expires_at),
    )
    conn.commit()
    return raw_token


def lookup_session(conn: sqlite3.Connection, raw_token: str | None) -> str | None:
    """Returns the user_id for a valid, unexpired token. Deletes the row if it has expired."""
    if not raw_token:
        return None
    token_hash = _hash_token(raw_token)
    row = conn.execute(
        "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?", (token_hash,)
    ).fetchone()
    if row is None:
        return None
    # Both timestamps are written with the same UTC isoformat(timespec="seconds"), so string compare is safe.
    now = _now().isoformat(timespec="seconds")
    if row["expires_at"] > now:
        return row["user_id"]
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
    conn.commit()
    return None


def delete_session(conn: sqlite3.Connection, raw_token: str | None) -> None:
    """Removes the session row for this token, if any."""
    if not raw_token:
        return
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_hash_token(raw_token),))
    conn.commit()


def get_current_user(request: Request, conn: sqlite3.Connection = Depends(get_db)) -> dict:
    """FastAPI dependency: returns the signed-in user's public fields or raises 401."""
    raw_token = request.cookies.get(SESSION_COOKIE)
    user_id = lookup_session(conn, raw_token)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Not signed in.")
    row = conn.execute(
        "SELECT id, name, clinic_name, email, upi_id, bank_balance FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="Not signed in.")
    return dict(row)


def set_session_cookie(response: Response, token: str) -> None:
    """Sets the session cookie. secure=True should be set when served over HTTPS in production."""
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        httponly=True,
        samesite="lax",
        path="/",
        max_age=SESSION_DAYS * 86400,
        # secure=True  # enable behind HTTPS in production
    )


def clear_session_cookie(response: Response) -> None:
    """Deletes the session cookie in the browser."""
    response.delete_cookie(
        key=SESSION_COOKIE,
        path="/",
        httponly=True,
        samesite="lax",
        # secure=True  # match set_session_cookie in production
    )
