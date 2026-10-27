import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings


def ensure_fernet_key(raw: str) -> bytes:
    """Accept a Fernet key or derive a stable key from any secret string."""
    try:
        key = raw.encode("utf-8")
        Fernet(key)
        return key
    except Exception:
        digest = hashlib.sha256(raw.encode("utf-8")).digest()
        return base64.urlsafe_b64encode(digest)


def _fernet() -> Fernet:
    settings = get_settings()
    return Fernet(ensure_fernet_key(settings.app_secret_key))


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_secret(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("Unable to decrypt connection secret; check APP_SECRET_KEY") from exc
