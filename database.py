"""
database.py  —  All SQLite logic lives here.
app.py imports these functions instead of using the dict.
"""
import sqlite3, os, time

DB_PATH = os.path.join('instances', 'studio.db')
os.makedirs('instances', exist_ok=True)

# ── connect helper ────────────────────────────────────────────
def get_db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row   # lets us access columns by name
    return con

# ── create tables on first run ────────────────────────────────
def init_db():
    with get_db() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id          TEXT PRIMARY KEY,   -- email or phone
            name        TEXT NOT NULL,
            otp         TEXT,
            created_at  TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS tracks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     TEXT NOT NULL,
            title       TEXT,
            artist      TEXT,
            filename    TEXT,
            audio_url   TEXT,
            prompt      TEXT,
            duration    INTEGER,
            plays       INTEGER DEFAULT 0,
            is_public   INTEGER DEFAULT 1,
            created_at  TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        """)
    print("--- DATABASE READY ---")

# ══════════════════════════════════════════════════════════════
#  USER FUNCTIONS
# ══════════════════════════════════════════════════════════════

def get_user(identifier):
    with get_db() as con:
        row = con.execute("SELECT * FROM users WHERE id=?", (identifier,)).fetchone()
        return dict(row) if row else None

def upsert_user(identifier, name, otp):
    """Create user if not exists, otherwise just update OTP."""
    with get_db() as con:
        existing = con.execute("SELECT id FROM users WHERE id=?", (identifier,)).fetchone()
        if existing:
            con.execute("UPDATE users SET otp=? WHERE id=?", (otp, identifier))
        else:
            con.execute("INSERT INTO users (id, name, otp) VALUES (?,?,?)",
                        (identifier, name, otp))

def verify_otp(identifier, otp):
    user = get_user(identifier)
    if user and user.get('otp') == otp:
        with get_db() as con:
            con.execute("UPDATE users SET otp=NULL WHERE id=?", (identifier,))
        return user
    return None

def update_user_name(identifier, new_name):
    with get_db() as con:
        con.execute("UPDATE users SET name=? WHERE id=?", (new_name, identifier))

def delete_user(identifier):
    with get_db() as con:
        con.execute("DELETE FROM tracks WHERE user_id=?", (identifier,))
        con.execute("DELETE FROM users WHERE id=?", (identifier,))

# ══════════════════════════════════════════════════════════════
#  TRACK FUNCTIONS
# ══════════════════════════════════════════════════════════════

def save_track(user_id, title, artist, filename, audio_url, prompt, duration):
    with get_db() as con:
        cur = con.execute("""
            INSERT INTO tracks (user_id, title, artist, filename, audio_url, prompt, duration)
            VALUES (?,?,?,?,?,?,?)
        """, (user_id, title, artist, filename, audio_url, prompt, duration))
        return cur.lastrowid

def get_user_tracks(user_id):
    with get_db() as con:
        rows = con.execute(
            "SELECT * FROM tracks WHERE user_id=? ORDER BY created_at DESC",
            (user_id,)
        ).fetchall()
        return [dict(r) for r in rows]

def get_public_tracks(limit=50):
    """All public tracks for the gallery page."""
    with get_db() as con:
        rows = con.execute("""
            SELECT t.*, u.name as user_name
            FROM tracks t JOIN users u ON t.user_id = u.id
            WHERE t.is_public = 1
            ORDER BY t.created_at DESC
            LIMIT ?
        """, (limit,)).fetchall()
        return [dict(r) for r in rows]

def increment_plays(track_id):
    with get_db() as con:
        con.execute("UPDATE tracks SET plays = plays + 1 WHERE id=?", (track_id,))

def get_user_stats(user_id):
    with get_db() as con:
        songs  = con.execute("SELECT COUNT(*) FROM tracks WHERE user_id=?", (user_id,)).fetchone()[0]
        plays  = con.execute("SELECT SUM(plays) FROM tracks WHERE user_id=?", (user_id,)).fetchone()[0] or 0
        return {'songs_created': songs, 'total_plays': plays, 'downloads': songs * 2, 'followers': 0}