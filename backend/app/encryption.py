"""
Symmetric encryption for the one class of secret this app stores in its
own database rather than only ever reading from an env var — a
connected league's ESPN_S2/SWID cookies (app/queries/
league_espn_connections.py). Fernet (from `cryptography`, already a
dependency for app/notifications/fcm_client.py's RS256 signing) rather
than Postgres pgcrypto: keeps the key and the decrypt logic in
application code, consistent with how every other credential in this
app is handled (env var in, never in SQL), and needs no Postgres
extension enabled on the production Supabase instance.
"""
from cryptography.fernet import Fernet, InvalidToken

from app.config import require_espn_credential_encryption_configured


def encrypt_secret(plaintext: str) -> str:
    key = require_espn_credential_encryption_configured()
    return Fernet(key.encode()).encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    key = require_espn_credential_encryption_configured()
    try:
        return Fernet(key.encode()).decrypt(ciphertext.encode()).decode()
    except InvalidToken as e:
        # Only real cause in practice: ESPN_CREDENTIAL_ENCRYPTION_KEY
        # changed since this row was written (a rotated/mismatched key
        # across environments) — surfaced as a clear 500 rather than a
        # cryptic Fernet stack trace, since the caller (a sync attempt)
        # can't do anything about it except reconnect the league.
        raise ValueError("Stored ESPN credential can't be decrypted — the encryption key may have changed") from e
