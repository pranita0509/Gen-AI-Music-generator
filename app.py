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
                      increment_plays)

app = Flask(__name__)
app.secret_key = 'pitti_guru_shahini_studio_2026'

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

@app.route('/api/generate-lyrics', methods=['POST'])
@login_required
def generate_lyrics():
    data = request.json or {}
    description = data.get('description', '')
    style = data.get('style', '')
    language = data.get('language', 'English')
    try:
        lyrics = groq_call(f"""
Write song lyrics.
Description: {description}
Style: {style}
Language: {language}
""")
        return jsonify({'success': True, 'lyrics': lyrics})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

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
    identifier = request.json.get('identifier', '')
    otp = str(random.randint(1000, 9999))
    existing = get_user(identifier)
    name = existing['name'] if existing else 'New Artist'
    upsert_user(identifier, name, otp)
    return jsonify({'success': True, 'dev_otp': otp})

@app.route('/api/auth/verify', methods=['POST'])
def verify_code():
    data = request.json
    user = verify_otp(data.get('identifier'), data.get('otp'))
    if user:
        session['user_id'] = data.get('identifier')
        session['user_name'] = user['name']
        return jsonify({'success': True})
    return jsonify({'success': False})

@app.route('/api/auth/logout')
def logout():
    session.clear()
    return redirect(url_for('home'))

@app.route('/api/auth/update-profile', methods=['POST'])
@login_required
def update_profile():
    name = request.json.get('name')
    if name:
        update_user_name(session['user_id'], name)
        session['user_name'] = name
    return jsonify({'success': True})

@app.route('/api/auth/delete-account', methods=['POST'])
@login_required
def delete_account():
    delete_user(session['user_id'])
    session.clear()
    return jsonify({'success': True})

if __name__ == '__main__':
    app.run(debug=True)
