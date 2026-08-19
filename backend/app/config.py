"""
Central config. Every secret comes from the environment.

Same fail-loudly discipline as Fantasy_Helper's bot/config.py: required
values raise at import time instead of surfacing as a confusing error deep
in a request handler.
"""
import os
from dotenv import load_dotenv

load_dotenv()


def _require(key: str) -> str:
    val = os.getenv(key)
    if not val:
        raise RuntimeError(f"Missing required environment variable: {key}")
    return val


DATABASE_URL = _require("DATABASE_URL")

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
