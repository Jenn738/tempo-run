import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

SPOTIFY_CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID", "").strip()
STRAVA_CLIENT_ID = os.getenv("STRAVA_CLIENT_ID", "").strip()
STRAVA_CLIENT_SECRET = os.getenv("STRAVA_CLIENT_SECRET", "").strip()
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://127.0.0.1:5173").rstrip("/")
BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000").rstrip("/")

DATA_DIR = BACKEND_DIR / ".data"
DATA_DIR.mkdir(exist_ok=True)
FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"
