import os
import tempfile

# Isolate tests from your real .env and data before the app is imported.
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="tempo-run-test-")
os.environ["STRAVA_CLIENT_ID"] = "test-id"
os.environ["STRAVA_CLIENT_SECRET"] = "test-secret"
os.environ["SPOTIFY_CLIENT_ID"] = "test-spotify"
