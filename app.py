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
                      update_user_name, delete_user, save_track)

app = Flask(__name__)
app.secret_key = 'secret_key'

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
    return render_template('login.html')

@app.route('/studio')
@login_required
def studio():
    return render_template('index.html')

@app.route('/api/auth/send-code', methods=['POST'])
def send_code():
    import random
    identifier = request.json.get('identifier', '')
    otp = str(random.randint(1000, 9999))
    upsert_user(identifier, 'User', otp)
    return jsonify({'success': True, 'otp': otp})

@app.route('/api/auth/verify', methods=['POST'])
def verify_code():
    data = request.json
    user = verify_otp(data.get('identifier'), data.get('otp'))
    if user:
        session['user_id'] = data.get('identifier')
        session['user_name'] = user['name']
        return jsonify({'success': True})
    return jsonify({'success': False})

@app.route('/api/generate-music', methods=['POST'])
@login_required
def generate_music():
    filename = "sample.wav"
    audio_url = url_for('static', filename=filename)

    track_id = save_track(
        user_id=session['user_id'],
        title="Demo Track",
        artist=session['user_name'],
        filename=filename,
        audio_url=audio_url,
        prompt="demo",
        duration=30
    )

    return jsonify({'success': True, 'audioUrl': audio_url})

@app.route('/api/generate-lyrics', methods=['POST'])
@login_required
def generate_lyrics():
    data = request.json or {}
    description = data.get('description', '')

    lyrics = groq_call(f"Write song lyrics about {description}")

    return jsonify({'success': True, 'lyrics': lyrics})

@app.route('/logout')
def logout():
    session.clear()
    return redirect('/')

if __name__ == '__main__':
    app.run(debug=True)
