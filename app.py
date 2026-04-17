import torch, os, time
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from functools import wraps
from audiocraft.models import MusicGen
from werkzeug.utils import secure_filename
from audiocraft.data.audio import audio_write
import torchaudio
from moviepy.editor import VideoFileClip
import speech_recognition as sr
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

os.environ["XFORMERS_DISABLED"] = "1"

_otp_store = {}
OTP_EXPIRY  = 300

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'pitti_guru_shahini_studio_2026')
app.config['SESSION_PERMANENT'] = True
app.config['PERMANENT_SESSION_LIFETIME'] = 86400 * 7
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = bool(os.environ.get('RENDER', False))

UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs('static/generated', exist_ok=True)

init_db()

try:
    model  = MusicGen.get_pretrained('facebook/musicgen-small')
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model.set_generation_params(
        duration=20,
        top_k=250,
        top_p=0.0,
        temperature=1.0,
        cfg_coef=3.0,
    )
except Exception:
    model = None

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('home'))
        return f(*args, **kwargs)
    return decorated

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

@app.route('/api/auth/send-code', methods=['POST'])
def send_code():
    import random
    identifier = (request.get_json() or {}).get('identifier','').strip()
    if not identifier:
        return jsonify({'success': False})
    otp = str(random.randint(1000, 9999))
    _otp_store[identifier] = {'otp': otp, 'expires': time.time() + OTP_EXPIRY}
    existing = get_user(identifier)
    name = existing['name'] if existing else 'New Artist'
    upsert_user(identifier, name, otp)
    return jsonify({'success': True, 'dev_otp': otp})

@app.route('/api/auth/verify', methods=['POST'])
def verify_code():
    data       = request.get_json() or {}
    identifier = data.get('identifier','').strip()
    entered    = data.get('otp','').strip()

    record = _otp_store.get(identifier)
    if record:
        if time.time() > record['expires']:
            _otp_store.pop(identifier, None)
            return jsonify({'success': False})
        if record['otp'] == entered:
            _otp_store.pop(identifier, None)
            user = get_user(identifier)
            if not user:
                upsert_user(identifier, 'New Artist', None)
                user = get_user(identifier)
            session['user_id']   = identifier
            session['user_name'] = user['name']
            return jsonify({'success': True})
        return jsonify({'success': False})

    user = verify_otp(identifier, entered)
    if user:
        session['user_id']   = identifier
        session['user_name'] = user['name']
        return jsonify({'success': True})
    return jsonify({'success': False})

@app.route('/api/auth/logout')
def logout():
    session.clear()
    return redirect(url_for('home'))

@app.route('/api/generate-music', methods=['POST'])
@login_required
def generate_music():
    if model is None:
        return jsonify({'success': False}), 500

    data = request.json or {}
    prompt = data.get('prompt', '')
    duration = int(data.get('duration', 30))

    model.set_generation_params(duration=duration)
    wav = model.generate([prompt])

    out_filename = f"gen_{int(time.time())}"
    save_path = os.path.join('static', 'generated', out_filename)
    audio_write(save_path, wav[0].cpu(), model.sample_rate)

    audio_url = url_for('static', filename=f"generated/{out_filename}.wav")

    track_id = save_track(
        user_id=session['user_id'],
        title=f"AI Track",
        artist=session['user_name'],
        filename=f"{out_filename}.wav",
        audio_url=audio_url,
        prompt=prompt,
        duration=duration
    )

    return jsonify({'success': True, 'audioUrl': audio_url, 'track_id': track_id})

@app.route('/api/generate-lyrics', methods=['POST'])
@login_required
def generate_lyrics():
    data        = request.json or {}
    description = data.get('description', '')
    style       = data.get('style', '')
    language    = data.get('language', 'English')

    lyrics = groq_call(f"""
Write lyrics
Description: {description}
Style: {style}
Language: {language}
""")

    return jsonify({'success': True, 'lyrics': lyrics})

if __name__ == '__main__':
    app.run(debug=True)
