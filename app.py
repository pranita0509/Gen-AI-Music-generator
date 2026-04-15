import os, time, json
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
app.secret_key = os.environ.get("SECRET_KEY", "pitti_guru_shahini_studio_2026")
app.config['SESSION_PERMANENT'] = True
app.config['PERMANENT_SESSION_LIFETIME'] = 86400 * 7
app.config['SESSION_COOKIE_SAMESITE'] = 'None'
app.config['SESSION_COOKIE_SECURE'] = True

UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs('static/generated', exist_ok=True)

init_db()

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

@app.route('/discovery')
@login_required
def discovery():
    return render_template('discovery.html')

@app.route('/profile')
@login_required
def profile():
    return render_template('profile.html',
                           user_name=session.get('user_name'),
                           user_id=session.get('user_id'))

@app.route('/gallery')
@login_required
def gallery():
    return render_template('gallery.html')

@app.route('/api/auth/send-code', methods=['POST'])
def send_code():
    import random
    data       = request.json or {}
    identifier = data.get('identifier', '').strip()
    if not identifier:
        return jsonify({'success': False, 'message': 'Email or phone is required'})
    otp      = str(random.randint(1000, 9999))
    existing = get_user(identifier)
    name     = existing['name'] if existing else 'New Artist'
    upsert_user(identifier, name, otp)
    return jsonify({'success': True, 'dev_otp': otp, 'is_returning': existing is not None})

@app.route('/api/auth/verify', methods=['POST'])
def verify_code():
    data = request.json or {}
    user = verify_otp(data.get('identifier'), data.get('otp'))
    if user:
        session['user_id']   = data.get('identifier')
        session['user_name'] = user['name']
        return jsonify({'success': True})
    return jsonify({'success': False, 'message': 'Invalid or expired code'})

@app.route('/api/auth/logout')
def logout():
    session.clear()
    return redirect(url_for('home'))

@app.route('/api/auth/update-profile', methods=['POST'])
@login_required
def update_profile():
    data = request.json or {}
    name = data.get('name', '').strip()
    if name:
        update_user_name(session['user_id'], name)
        session['user_name'] = name
        return jsonify({'success': True})
    return jsonify({'success': False, 'message': 'Name is required'})

@app.route('/api/auth/delete-account', methods=['POST'])
@login_required
def delete_account():
    delete_user(session['user_id'])
    session.clear()
    return jsonify({'success': True})

@app.route('/api/profile/history')
@login_required
def profile_history():
    try:
        tracks = get_user_tracks(session['user_id'])
        return jsonify({'success': True, 'tracks': tracks})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/profile/stats')
@login_required
def profile_stats():
    try:
        stats = get_user_stats(session['user_id'])
        return jsonify({'success': True, 'stats': stats})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/track/play/<int:track_id>', methods=['POST'])
@login_required
def track_play(track_id):
    try:
        increment_plays(track_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/gallery/tracks')
@login_required
def gallery_tracks():
    try:
        tracks = get_public_tracks(limit=50)
        return jsonify({'success': True, 'tracks': tracks})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/generate-music', methods=['POST'])
@login_required
def generate_music():
    data      = request.json or {}
    prompt    = data.get('prompt', 'AI music').strip()
    duration  = int(data.get('duration', 30))
    filename  = 'sample.wav'
    audio_url = url_for('static', filename=filename)
    track_id  = save_track(
        user_id   = session['user_id'],
        title     = f"AI Track: {prompt[:20]}",
        artist    = session['user_name'],
        filename  = filename,
        audio_url = audio_url,
        prompt    = prompt,
        duration  = duration
    )
    return jsonify({
        'success': True,
        'track': {
            'id':         track_id,
            'title':      f"AI Track: {prompt[:20]}",
            'artist':     session['user_name'],
            'audioUrl':   audio_url,
            'duration':   duration,
            'created_at': time.strftime("%b %d, %Y")
        }
    })

@app.route('/api/generate-lyrics', methods=['POST'])
@login_required
def generate_lyrics():
    data        = request.json or {}
    description = data.get('description', '').strip()
    language    = data.get('language', 'English')
    style       = data.get('style', '')
    if not description:
        return jsonify({'success': False, 'message': 'Please describe your song'})
    LANGUAGE_PROMPTS = {
        'English': 'Write the lyrics entirely in English.',
        'Telugu':  'Write the lyrics entirely in Telugu (తెలుగు లిపి). Use natural Telugu expressions.',
        'Hindi':   'Write the lyrics entirely in Hindi (हिंदी). Use natural Hindi expressions.',
        'Tamil':   'Write the lyrics entirely in Tamil (தமிழ்). Use natural Tamil expressions.',
        'Mixed':   'Write a mix of English and Telugu (code-switching style, like modern Telugu film songs).',
    }
    lang_instruction = LANGUAGE_PROMPTS.get(language, LANGUAGE_PROMPTS['English'])
    try:
        lyrics = groq_call(f"""
You are a professional lyricist. Write complete song lyrics based on this description:

Description: {description}
Style/Mood: {style if style else 'as appropriate'}
Language instruction: {lang_instruction}

Format the lyrics with clearly labeled sections like:
[Verse 1]
[Chorus]
[Verse 2]
[Bridge] (if needed)
[Outro] (if needed)

Only output the lyrics — no explanations or metadata.
""")
        return jsonify({'success': True, 'lyrics': lyrics})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/video-suggest-songs', methods=['POST'])
@login_required
def video_suggest_songs():
    data          = request.get_json() or {}
    occasion      = data.get('occasion', '').strip()
    mood          = data.get('mood', '').strip()
    custom_prompt = data.get('custom_prompt', '').strip()
    context       = ', '.join(filter(None, [occasion, mood, custom_prompt])) or 'general background music'
    system_msg = (
        "You are a music supervisor who recommends popular, real songs for video content. "
        "Always suggest songs that are well-known, available on YouTube and Spotify, "
        "and perfect for the described context. Include a mix of trending, classic, and "
        "Instagram-Reels-friendly tracks. Respond ONLY with valid JSON, no markdown, no extra text."
    )
    user_msg = (
        f"Suggest 6 real, popular songs that would perfectly fit this video context: '{context}'. "
        "Include Instagram Reels / TikTok trending songs where relevant. "
        "Return a JSON object with a 'songs' array. Each song must have: "
        "title (string), artist (string), why (one-sentence reason ≤12 words), "
        "vibe (one word: emotional/energetic/celebratory/romantic/peaceful/upbeat), "
        "youtube_search (the best YouTube search query for this song)."
    )
    try:
        resp = _groq.chat.completions.create(
            model="llama3-8b-8192",
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user",   "content": user_msg}
            ],
            max_tokens=900,
            temperature=0.8
        )
        raw = resp.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        parsed = json.loads(raw.strip())
        songs  = parsed.get('songs', [])
        if not songs:
            raise ValueError("Empty songs list from LLM")
        return jsonify({'success': True, 'songs': songs})
    except Exception as e:
        print(f"Song suggestion error: {e}")
        fallback = [
            {"title": "Blinding Lights",   "artist": "The Weeknd",          "why": "High-energy anthem for exciting montages",       "vibe": "energetic", "youtube_search": "The Weeknd Blinding Lights official video"},
            {"title": "Golden Hour",        "artist": "JVKE",                "why": "Dreamy romantic feel for heartfelt moments",      "vibe": "romantic",  "youtube_search": "JVKE Golden Hour official"},
            {"title": "As It Was",          "artist": "Harry Styles",        "why": "Nostalgic pop perfect for life highlight reels",  "vibe": "upbeat",    "youtube_search": "Harry Styles As It Was official video"},
            {"title": "Calm Down",          "artist": "Rema & Selena Gomez", "why": "Viral Afrobeats hit trending on Instagram Reels", "vibe": "upbeat",    "youtube_search": "Rema Selena Gomez Calm Down official"},
            {"title": "Here Comes The Sun", "artist": "The Beatles",         "why": "Timeless uplifting feel for positive content",    "vibe": "peaceful",  "youtube_search": "The Beatles Here Comes The Sun"},
            {"title": "Sunflower",          "artist": "Post Malone",         "why": "Smooth chill vibe widely loved on social media",  "vibe": "peaceful",  "youtube_search": "Post Malone Swae Lee Sunflower Spider-Man"},
        ]
        return jsonify({'success': True, 'songs': fallback})

@app.route('/health')
def health():
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=False, host='0.0.0.0', port=port)
