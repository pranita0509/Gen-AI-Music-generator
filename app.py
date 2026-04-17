import os, time
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from functools import wraps
from werkzeug.utils import secure_filename
from groq import Groq as _GroqClient

_groq = _GroqClient(api_key=os.environ.get("GROQ_API_KEY", ""))

def groq_call(prompt):
    resp = _groq.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1024,
        temperature=0.7
    )
    return resp.choices[0].message.content.strip()

from database import (init_db, get_user, upsert_user, verify_otp,
                      update_user_name, delete_user, save_track,
                      get_user_tracks, get_public_tracks,
                      increment_plays, get_user_stats)

app = Flask(__name__)

# ── CRITICAL: Session config for Render (HTTPS) ───────────────
app.secret_key = os.environ.get("SECRET_KEY", "fallback-dev-key-change-this")
app.config['SESSION_PERMANENT'] = True
app.config['PERMANENT_SESSION_LIFETIME'] = 86400 * 7   # 7 days
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'          # 'None' breaks on some browsers without proper HTTPS setup
app.config['SESSION_COOKIE_SECURE'] = os.environ.get('RENDER', False)  # True only on Render
app.config['SESSION_COOKIE_HTTPONLY'] = True

UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs('static/generated', exist_ok=True)

init_db()

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            # Return JSON error for API routes, redirect for page routes
            if request.path.startswith('/api/'):
                return jsonify({'success': False, 'message': 'Not logged in'}), 401
            return redirect(url_for('home'))
        return f(*args, **kwargs)
    return decorated

# ── PAGES ─────────────────────────────────────────────────────
@app.route('/')
def home():
    return redirect(url_for('studio')) if 'user_id' in session else render_template('login.html')

@app.route('/studio')
@login_required
def studio():
    return render_template('index.html')

@app.route('/profile')
@login_required
def profile():
    return render_template('profile.html',
                           user_name=session.get('user_name'),
                           user_id=session.get('user_id'))

# ── AUTH ──────────────────────────────────────────────────────
@app.route('/api/auth/send-code', methods=['POST'])
def send_code():
    import random
    data = request.get_json() or {}
    identifier = data.get('identifier', '').strip()

    if not identifier:
        return jsonify({'success': False, 'message': 'Email or phone required'})

    otp = str(random.randint(1000, 9999))
    existing = get_user(identifier)
    name = existing['name'] if existing else 'New Artist'
    upsert_user(identifier, name, otp)

    print(f"[OTP] {identifier} → {otp}")  # visible in Render logs
    return jsonify({'success': True, 'dev_otp': otp})  # remove dev_otp in production!

@app.route('/api/auth/verify', methods=['POST'])
def verify_code():
    data = request.get_json() or {}
    identifier = data.get('identifier', '').strip()
    otp = data.get('otp', '').strip()

    if not identifier or not otp:
        return jsonify({'success': False, 'message': 'Missing identifier or OTP'})

    user = verify_otp(identifier, otp)
    if user:
        session.permanent = True
        session['user_id'] = identifier
        session['user_name'] = user['name']
        return jsonify({'success': True, 'name': user['name']})

    return jsonify({'success': False, 'message': 'Invalid OTP. Check Render logs for the code.'})

@app.route('/api/auth/logout')
def logout():
    session.clear()
    return redirect(url_for('home'))

@app.route('/api/auth/status')
def auth_status():
    """Frontend can call this to check if session is still alive."""
    if 'user_id' in session:
        return jsonify({'logged_in': True, 'user_id': session['user_id'], 'name': session['user_name']})
    return jsonify({'logged_in': False})

# ── MUSIC GENERATION (stub — no MusicGen on free Render) ──────
@app.route('/api/generate-music', methods=['POST'])
@login_required
def generate_music():
    data = request.json or {}
    prompt = data.get('prompt', 'AI music')
    duration = int(data.get('duration', 30))
    filename = "sample.wav"
    audio_url = url_for('static', filename=filename)

    track_id = save_track(
        user_id=session['user_id'],
        title=f"AI Track: {prompt[:20]}",
        artist=session['user_name'],
        filename=filename,
        audio_url=audio_url,
        prompt=prompt,
        duration=duration
    )
    return jsonify({
        'success': True,
        'track': {
            'id': track_id,
            'title': f"AI Track: {prompt[:20]}",
            'artist': session['user_name'],
            'audioUrl': audio_url,
            'duration': duration,
            'created_at': time.strftime("%b %d, %Y")
        }
    })

# ── LYRICS ────────────────────────────────────────────────────
@app.route('/api/generate-lyrics', methods=['POST'])
@login_required
def generate_lyrics():
    data = request.get_json() or {}
    description = data.get('description', '').strip()
    style = data.get('style', '')
    language = data.get('language', 'English')

    if not description:
        return jsonify({'success': False, 'message': 'Description is required'})

    try:
        lyrics = groq_call(f"""Write song lyrics.
Description: {description}
Style: {style}
Language: {language}
Format with [Verse 1], [Chorus], [Verse 2] sections.""")
        return jsonify({'success': True, 'lyrics': lyrics})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

# ── USER API ──────────────────────────────────────────────────
@app.route('/api/user/tracks')
@login_required
def user_tracks():
    tracks = get_user_tracks(session['user_id'])
    return jsonify({'success': True, 'tracks': tracks})

@app.route('/api/user/stats')
@login_required
def user_stats():
    stats = get_user_stats(session['user_id'])
    return jsonify({'success': True, 'stats': stats})

@app.route('/api/gallery')
def gallery():
    tracks = get_public_tracks()
    return jsonify({'success': True, 'tracks': tracks})

@app.route('/api/track/<int:track_id>/play', methods=['POST'])
def play_track(track_id):
    increment_plays(track_id)
    return jsonify({'success': True})

if __name__ == '__main__':
    app.run(debug=True)
