from app.config import CHAT_IMAGE_HOST
from app.image_url import validate_blob_image_url


def test_accepts_the_chat_blob_store_host():
    url = f"https://{CHAT_IMAGE_HOST}/chat/some-photo.jpg"
    assert validate_blob_image_url(url) == url


def test_accepts_a_giphy_media_host():
    # GIPHY serves GIFs from several numbered CDN subdomains — a
    # suffix check, not a single exact hostname (see image_url.py).
    url = "https://media1.giphy.com/media/abc123/giphy.gif"
    assert validate_blob_image_url(url) == url


def test_rejects_a_lookalike_host():
    # Must not match a host that merely ends in "giphy.com" without the
    # separating dot GIPHY's own subdomains always have.
    assert validate_blob_image_url("https://evil-giphy.com/tracker.gif") is None


def test_rejects_an_untrusted_host():
    assert validate_blob_image_url("https://evil.example.com/tracker.png") is None


def test_rejects_non_https():
    url = f"http://{CHAT_IMAGE_HOST}/chat/some-photo.jpg"
    assert validate_blob_image_url(url) is None


def test_rejects_non_string_input():
    assert validate_blob_image_url(None) is None
    assert validate_blob_image_url(12345) is None
    assert validate_blob_image_url("") is None
