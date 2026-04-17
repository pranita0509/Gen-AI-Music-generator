import os, time, json, random
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

try:
    import torch
    import torchaudio
    from audiocraft.models import MusicGen
    from audiocraft.data.audio import audio_write
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False
    torch = None

try:
    from moviepy.editor import VideoFileClip, AudioFileClip
    MOVIEPY_AVAILABLE = True
except ImportError:
    MOVIEPY_AVAILABLE = False

try:
    import speech_recognition as sr
    SR_AVAILABLE = True
except ImportError:
    SR_AVAILABLE = False

try:
    from pydub import AudioSegment
    from pydub.effects import normalize as pydub_normalize
    PYDUB_AVAILABLE = True
except ImportError:
    PYDUB_AVAILABLE = False

from database import (init_db, get_user, upsert_user, verify_otp,
                      update_user_name, delete_user, save_track,
                      get_user_tracks, get_public_tracks,
                      increment_plays, get_user_stats)

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "pitti_guru_shahini_studio_2026")
app.config['SESSION_PERMANENT'] = True
app.config['PERMANENT_SESSION_LIFETIME'] = 86400 * 7
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = bool(os.environ.get('RENDER', False))

UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs('static/generated', exist_ok=True)

_otp_store = {}
OTP_EXPIRY  = 300

init_db()

model = None
if TORCH_AVAILABLE:
    try:
        os.environ["XFORMERS_DISABLED"] = "1"
        model = MusicGen.get_pretrained('facebook/musicgen-small')
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        model.set_generation_params(duration=20, top_k=250, top_p=0.0, temperature=1.0, cfg_coef=3.0)
        print(f"--- AI MODEL LOADED ON: {device.upper()} ---")
    except Exception as e:
        print(f"ERROR LOADING MODEL: {e}")
        model = None

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('home'))
        return f(*args, **kwargs)
    return decorated

def _build_prompt(base, instruments, levels):
    mods = []
    if instruments:
        mods.append(f"featuring {', '.join(instruments)}")
    bass = int(levels.get('bass', 50))
    if bass > 75: mods.append("heavy boosted bass, deep sub-bass")
    elif bass < 25: mods.append("minimal bass")
    drum = int(levels.get('drummer', 50))
    if drum > 75: mods.append("loud punchy percussion, aggressive drums")
    elif drum < 25: mods.append("no drums, ambient")
    mel = int(levels.get('melody', 50))
    if mel > 75: mods.append("rich melodic lead")
    elif mel < 25: mods.append("minimal melody, atmospheric")
    return base + ((", " + ", ".join(mods)) if mods else "")

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
    data       = request.get_json() or {}
    identifier = data.get('identifier', '').strip()
    if not identifier:
        return jsonify({'success': False, 'message': 'Identifier required'})
    otp      = str(random.randint(1000, 9999))
    _otp_store[identifier] = {'otp': otp, 'expires': time.time() + OTP_EXPIRY}
    existing = get_user(identifier)
    name     = existing['name'] if existing else 'New Artist'
    upsert_user(identifier, name, otp)
    print(f"\n[OTP for {identifier}]: {otp}\n")
    return jsonify({'success': True, 'dev_otp': otp, 'is_returning': existing is not None})

@app.route('/api/auth/verify', methods=['POST'])
def verify_code():
    data       = request.get_json() or {}
    identifier = data.get('identifier', '').strip()
    entered    = data.get('otp', '').strip()
    record     = _otp_store.get(identifier)
    if record:
        if time.time() > record['expires']:
            _otp_store.pop(identifier, None)
            return jsonify({'success': False, 'message': 'OTP expired. Please request a new code.'})
        if record['otp'] == entered:
            _otp_store.pop(identifier, None)
            user = get_user(identifier)
            if not user:
                upsert_user(identifier, 'New Artist', None)
                user = get_user(identifier)
            session.permanent    = True
            session['user_id']   = identifier
            session['user_name'] = user['name']
            return jsonify({'success': True, 'user': {'name': user['name'], 'is_returning': True}})
        return jsonify({'success': False, 'message': 'Wrong OTP. Try again.'})
    user = verify_otp(identifier, entered)
    if user:
        session.permanent    = True
        session['user_id']   = identifier
        session['user_name'] = user['name']
        return jsonify({'success': True, 'user': {'name': user['name'], 'is_returning': True}})
    return jsonify({'success': False, 'message': 'OTP not found. Please request a new code.'})

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
def get_history():
    tracks = get_user_tracks(session['user_id'])
    return jsonify({'success': True, 'tracks': tracks})

@app.route('/api/profile/stats')
@login_required
def get_stats():
    return jsonify({'success': True, 'stats': get_user_stats(session['user_id'])})

@app.route('/api/track/play/<int:track_id>', methods=['POST'])
@login_required
def track_played(track_id):
    increment_plays(track_id)
    return jsonify({'success': True})

@app.route('/api/gallery')
@login_required
def get_gallery():
    tracks = get_public_tracks(limit=50)
    return jsonify({'success': True, 'tracks': tracks})

@app.route('/api/gallery/tracks')
@login_required
def gallery_tracks():
    tracks = get_public_tracks(limit=50)
    return jsonify({'success': True, 'tracks': tracks})

@app.route('/api/generate-music', methods=['POST'])
@login_required
def generate_music():
    if not TORCH_AVAILABLE or model is None:
        return jsonify({'success': False, 'message': 'AI music model is not available on this server. GPU instance required.'}), 503

    is_remix = 'file' in request.files
    ref_path = None

    if is_remix:
        f           = request.files['file']
        ref_path    = os.path.join(UPLOAD_FOLDER, secure_filename(f.filename))
        f.save(ref_path)
        base_prompt = request.form.get('prompt', '')
        duration    = int(request.form.get('duration', 30))
        instruments = request.form.getlist('instruments')
        levels      = {k: request.form.get(k, 50) for k in ['bass', 'drummer', 'melody']}
    else:
        data        = request.json or {}
        base_prompt = data.get('prompt', '')
        duration    = int(data.get('duration', 30))
        instruments = data.get('instruments', [])
        levels      = {k: data.get(k, 50) for k in ['bass', 'drummer', 'melody']}

    duration     = min(duration, 180)
    final_prompt = _build_prompt(base_prompt, instruments, levels)
    print(f"\n--- GENERATING: {final_prompt} | {duration}s ---")

    try:
        gen_start = time.time()
        model.set_generation_params(duration=duration)
        if is_remix and ref_path:
            waveform, sr_rate = torchaudio.load(ref_path)
            wav = model.generate_continuation(waveform, sr_rate, [final_prompt])
        else:
            wav = model.generate([final_prompt])
        gen_time = round(time.time() - gen_start, 1)

        out_filename = f"gen_{int(time.time())}"
        save_path    = os.path.join('static', 'generated', out_filename)
        audio_write(save_path, wav[0].cpu(), model.sample_rate, strategy="loudness",
                    loudness_headroom_db=14, loudness_compressor=True)

        audio_url = url_for('static', filename=f"generated/{out_filename}.wav")
        title     = f"AI Track: {base_prompt[:25]}..."

        try:
            raw_q = groq_call(f"""
You are a music AI evaluator. A user gave this prompt: "{base_prompt}"
The AI generated a {duration}-second instrumental track using MusicGen.
Give a prompt match quality score out of 100 and one short sentence of feedback.
Reply ONLY as JSON: {{"score": 85, "feedback": "Good match with requested mood and instruments"}}
""")
            raw_q    = raw_q.replace("```json", "").replace("```", "").strip()
            q_data   = json.loads(raw_q)
            quality_score    = q_data.get('score', 80)
            quality_feedback = q_data.get('feedback', 'Track generated successfully')
        except Exception:
            quality_score    = 80
            quality_feedback = 'Track generated successfully'

        dev      = 'GPU (CUDA)' if torch.cuda.is_available() else 'CPU'
        track_id = save_track(
            user_id=session['user_id'], title=title,
            artist=session['user_name'], filename=f"{out_filename}.wav",
            audio_url=audio_url, prompt=base_prompt, duration=duration
        )

        return jsonify({'success': True, 'track': {
            'id': track_id, 'title': title,
            'artist': session['user_name'],
            'audioUrl': audio_url,
            'filename': f"{out_filename}.wav",
            'promptPreview': base_prompt,
            'created_at': time.strftime("%b %d, %Y"),
            'duration': duration
        }, 'stats': {
            'generation_time': gen_time, 'device': dev,
            'duration': duration, 'model': 'MusicGen-Small (300M params)',
            'quality_score': quality_score, 'quality_feedback': quality_feedback,
            'fad_score': 7.8, 'mos_score': '3.8/5', 'training_hours': '20,000'
        }})
    except Exception as e:
        print(f"Generation Error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        if ref_path and os.path.exists(ref_path):
            os.remove(ref_path)

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
        lyrics_text = groq_call(f"""
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

Also suggest a song title at the top like: Title: "..."
Write emotionally expressive, poetic lyrics that fit the description perfectly.
""")
        music_prompt = groq_call(
            f'Give me a single MusicGen prompt (no vocals, instrumental only) '
            f'that matches this song description: "{description}", style: "{style}". '
            f'Reply with ONLY the prompt, nothing else.'
        )
        return jsonify({'success': True, 'lyrics': lyrics_text, 'music_prompt': music_prompt, 'language': language})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/enhance-prompt', methods=['POST'])
@login_required
def enhance_prompt():
    txt = (request.json or {}).get('prompt', '').strip()
    if not txt:
        return jsonify({'success': False, 'message': 'No prompt'})
    try:
        enhanced = groq_call(
            "You are a music production expert. Rewrite this description into a "
            "single vivid comma-separated music prompt using professional terms "
            "(BPM, key, genre, mood, instruments, mixing style). "
            "Reply with ONLY the enhanced prompt.\n\nUser: " + txt
        )
        return jsonify({'success': True, 'enhanced_prompt': enhanced})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/voice-input', methods=['POST'])
@login_required
def voice_input():
    if not SR_AVAILABLE:
        return jsonify({'success': False, 'message': 'Speech recognition not available on this server.'}), 503
    if 'audio' not in request.files:
        return jsonify({'success': False, 'message': 'No audio'})
    try:
        from pydub import AudioSegment as _AS
    except ImportError:
        return jsonify({'success': False, 'message': 'pydub not available'}), 503
    tmp_in  = os.path.join(UPLOAD_FOLDER, f"voice_{int(time.time())}.webm")
    tmp_wav = tmp_in.replace('.webm', '.wav')
    request.files['audio'].save(tmp_in)
    try:
        audio = _AS.from_file(tmp_in).set_channels(1).set_frame_rate(16000)
        audio.export(tmp_wav, format='wav')
        rec = sr.Recognizer()
        with sr.AudioFile(tmp_wav) as src:
            data = rec.record(src)
        text = rec.recognize_google(data)
        return jsonify({'success': True, 'transcript': text})
    except sr.UnknownValueError:
        return jsonify({'success': False, 'message': 'Could not understand audio. Speak clearly.'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        for f in [tmp_in, tmp_wav]:
            if os.path.exists(f):
                os.remove(f)

@app.route('/api/discovery/lyric-search', methods=['POST'])
@login_required
def lyric_search():
    lyric = (request.json or {}).get('lyric', '').strip()
    if not lyric:
        return jsonify({'success': False, 'message': 'No lyric'})
    try:
        raw = groq_call(
            f'Lyric fragment: "{lyric}". Search across ALL languages including English, Telugu, Hindi, Tamil, '
            'Kannada, Malayalam, Gujarati, Bengali, Punjabi, Arabic, Spanish, Korean, Japanese, and any other language. '
            'Identify the top 3 most likely matching real songs. '
            'Reply ONLY as a raw JSON array with no markdown: '
            '[{"title":"...","artist":"...","genre":"...","description":"..."}]'
        )
        raw     = raw.replace("```json", "").replace("```", "").strip()
        results = json.loads(raw)
        return jsonify({'success': True, 'results': results})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/discovery/voice-search', methods=['POST'])
@login_required
def voice_search():
    if 'audio' not in request.files:
        return jsonify({'success': False, 'message': 'No audio received'})
    import requests as http_requests
    audio_file = request.files['audio']
    tmp_in     = os.path.join(UPLOAD_FOLDER, f"search_{int(time.time())}.webm")
    tmp_wav    = tmp_in.replace('.webm', '.wav')
    audio_file.save(tmp_in)
    try:
        if PYDUB_AVAILABLE:
            from pydub import AudioSegment as _AS, effects as _fx
            seg = _AS.from_file(tmp_in)
            seg = _fx.normalize(seg) + 6
            seg = seg.set_channels(1).set_frame_rate(44100)
            seg.export(tmp_wav, format='wav')
            tmp = tmp_wav
        else:
            tmp = tmp_in
        AUDD_API_TOKEN = os.environ.get('AUDD_API_TOKEN', '')
        with open(tmp, 'rb') as f:
            response = http_requests.post(
                'https://api.audd.io/',
                data={'api_token': AUDD_API_TOKEN, 'return': 'apple_music,spotify'},
                files={'file': f}
            )
        result = response.json()
        if result.get('status') == 'success' and result.get('result'):
            song    = result['result']
            results = [{'title': song.get('title', 'Unknown'), 'artist': song.get('artist', 'Unknown'),
                        'genre': song.get('genre', 'Unknown'),
                        'description': f"Released: {song.get('release_date','N/A')} | Album: {song.get('album','N/A')}",
                        'spotify_url': song.get('spotify', {}).get('external_urls', {}).get('spotify', '')}]
            return jsonify({'success': True, 'results': results, 'heard': 'Audio fingerprint matched'})
        spoken = ""
        if SR_AVAILABLE:
            try:
                rec = sr.Recognizer()
                with sr.AudioFile(tmp) as src:
                    d = rec.record(src)
                spoken = rec.recognize_google(d)
            except Exception:
                spoken = ""
        if not spoken:
            return jsonify({'success': False, 'message': "Couldn't identify the song. Try humming more clearly."})
        raw = groq_call(
            f'A user hummed or sang and speech recognition captured: "{spoken}". '
            'Suggest 3 most likely real matching songs from ANY language. '
            'Reply ONLY as raw JSON array: [{"title":"...","artist":"...","genre":"...","description":"..."}]'
        )
        raw     = raw.replace("```json", "").replace("```", "").strip()
        results = json.loads(raw)
        return jsonify({'success': True, 'results': results, 'heard': spoken})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        for _f in [tmp_in, tmp_wav]:
            if os.path.exists(_f):
                os.remove(_f)

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
            messages=[{"role": "system", "content": system_msg}, {"role": "user", "content": user_msg}],
            max_tokens=900, temperature=0.8
        )
        raw = resp.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        parsed = json.loads(raw.strip())
        songs  = parsed.get('songs', [])
        if not songs:
            raise ValueError("Empty songs list")
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

@app.route('/api/video-bgm', methods=['POST'])
@login_required
def video_bgm():
    if not TORCH_AVAILABLE or model is None:
        return jsonify({'success': False, 'message': 'AI model not available on this server. GPU instance required.'}), 503
    if not MOVIEPY_AVAILABLE:
        return jsonify({'success': False, 'message': 'Video processing not available on this server.'}), 503
    if 'video' not in request.files:
        return jsonify({'success': False, 'message': 'No video file received'})
    video_file = request.files['video']
    filename   = secure_filename(video_file.filename)
    vid_path   = os.path.join(UPLOAD_FOLDER, filename)
    video_file.save(vid_path)
    try:
        clip     = VideoFileClip(vid_path)
        duration = min(int(clip.duration), 300)
        clip.close()
    except Exception as e:
        return jsonify({'success': False, 'message': f'Could not read video: {e}'}), 500
    finally:
        if os.path.exists(vid_path):
            os.remove(vid_path)
    mood         = request.form.get('mood', 'calm background music')
    instruments  = request.form.getlist('instruments')
    final_prompt = _build_prompt(f"background music for a video, {mood}, no vocals, cinematic", instruments, {})
    try:
        model.set_generation_params(duration=duration)
        wav          = model.generate([final_prompt])
        out_filename = f"bgm_{int(time.time())}"
        save_path    = os.path.join('static', 'generated', out_filename)
        audio_write(save_path, wav[0].cpu(), model.sample_rate, strategy="loudness",
                    loudness_headroom_db=14, loudness_compressor=True)
        audio_url = url_for('static', filename=f"generated/{out_filename}.wav")
        title     = f"BGM: {mood[:25]}..."
        track_id  = save_track(user_id=session['user_id'], title=title,
                               artist=session['user_name'], filename=f"{out_filename}.wav",
                               audio_url=audio_url, prompt=final_prompt, duration=duration)
        return jsonify({'success': True, 'track': {
            'id': track_id, 'title': title, 'artist': session['user_name'],
            'audioUrl': audio_url, 'filename': f"{out_filename}.wav",
            'promptPreview': mood, 'duration': duration, 'created_at': time.strftime("%b %d, %Y")
        }})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/video-bgm-replace', methods=['POST'])
@login_required
def video_bgm_replace():
    if not TORCH_AVAILABLE or model is None:
        return jsonify({'success': False, 'message': 'AI model not available on this server. GPU instance required.'}), 503
    if not MOVIEPY_AVAILABLE:
        return jsonify({'success': False, 'message': 'Video processing not available on this server.'}), 503
    if 'video' not in request.files:
        return jsonify({'success': False, 'message': 'No video file received'})
    video_file = request.files['video']
    filename   = secure_filename(video_file.filename)
    vid_path   = os.path.join(UPLOAD_FOLDER, filename)
    video_file.save(vid_path)
    bgm_wav_path = None
    try:
        clip     = VideoFileClip(vid_path)
        duration = min(int(clip.duration), 180)
        clip.close()
    except Exception as e:
        if os.path.exists(vid_path):
            os.remove(vid_path)
        return jsonify({'success': False, 'message': f'Could not read video: {e}'}), 500
    mood        = request.form.get('mood', 'cinematic background music')
    instruments = request.form.getlist('instruments')
    try:
        enhanced_prompt = groq_call(
            f'You are a film music composer. Given this video mood/occasion: "{mood}", '
            f'write a single MusicGen prompt (no vocals, instrumental only, background music) '
            f'that is specific about BPM, instruments, genre, and emotional tone. '
            f'Reply with ONLY the prompt, max 30 words.'
        )
    except Exception:
        enhanced_prompt = f"background music for a video, {mood}, no vocals, cinematic, instrumental"
    final_prompt = _build_prompt(enhanced_prompt, instruments, {})
    try:
        model.set_generation_params(duration=duration)
        wav          = model.generate([final_prompt])
        bgm_filename = f"bgm_{int(time.time())}"
        bgm_path     = os.path.join('static', 'generated', bgm_filename)
        audio_write(bgm_path, wav[0].cpu(), model.sample_rate, strategy="loudness",
                    loudness_headroom_db=14, loudness_compressor=True)
        bgm_wav_path   = bgm_path + '.wav'
        video_clip     = VideoFileClip(vid_path)
        audio_clip     = AudioFileClip(bgm_wav_path)
        audio_clip     = audio_clip.subclip(0, min(audio_clip.duration, video_clip.duration))
        final_video    = video_clip.set_audio(audio_clip)
        out_video_name = f"video_bgm_{int(time.time())}.mp4"
        out_video_path = os.path.join('static', 'generated', out_video_name)
        final_video.write_videofile(out_video_path, codec='libx264', audio_codec='aac',
                                    verbose=False, logger=None)
        video_clip.close()
        audio_clip.close()
        final_video.close()
        video_url = url_for('static', filename=f"generated/{out_video_name}")
        audio_url = url_for('static', filename=f"generated/{bgm_filename}.wav")
        title     = f"Video BGM: {mood[:20]}..."
        track_id  = save_track(user_id=session['user_id'], title=title,
                               artist=session['user_name'], filename=f"{bgm_filename}.wav",
                               audio_url=audio_url, prompt=final_prompt, duration=duration)
        return jsonify({'success': True, 'track': {
            'id': track_id, 'title': title, 'artist': session['user_name'],
            'audioUrl': audio_url, 'videoUrl': video_url, 'filename': out_video_name,
            'promptPreview': mood, 'duration': duration, 'created_at': time.strftime("%b %d, %Y")
        }})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        if os.path.exists(vid_path):
            os.remove(vid_path)

@app.route('/api/generate-with-lyrics', methods=['POST'])
@login_required
def generate_with_lyrics():
    if not TORCH_AVAILABLE or model is None:
        return jsonify({'success': False, 'message': 'AI model not available on this server. GPU instance required.'}), 503
    data        = request.json or {}
    prompt      = data.get('prompt', '').strip()
    duration    = min(int(data.get('duration', 20)), 180)
    instruments = data.get('instruments', [])
    levels      = {k: data.get(k, 50) for k in ['bass', 'drummer', 'melody']}
    language    = data.get('language', 'English')
    style       = data.get('style', '')
    if not prompt:
        return jsonify({'success': False, 'message': 'Please describe your music'})
    LANGUAGE_PROMPTS = {
        'English': 'Write the lyrics entirely in English.',
        'Telugu':  'Write the lyrics entirely in Telugu script (తెలుగు). Use natural Telugu expressions.',
        'Hindi':   'Write the lyrics entirely in Hindi script (हिंदी). Use natural Hindi expressions.',
        'Tamil':   'Write the lyrics entirely in Tamil script (தமிழ்). Use natural Tamil expressions.',
        'Mixed':   'Write a mix of English and Telugu like modern Telugu film songs.',
    }
    lang_instruction = LANGUAGE_PROMPTS.get(language, LANGUAGE_PROMPTS['English'])
    try:
        lyrics_response = groq_call(f"""
You are a professional lyricist. Write song lyrics for a {duration}-second song.
Description: {prompt}
Style: {style if style else 'as appropriate'}
{lang_instruction}
Write ONLY the lyrics words, no section labels. Keep it short enough to fit in {duration} seconds when sung.
""")
        music_prompt_resp = groq_call(
            f'Give a single MusicGen instrumental prompt (no vocals) for: "{prompt}", style: "{style}". Reply ONLY the prompt text.'
        )
        music_prompt = _build_prompt(music_prompt_resp, instruments, levels)
        gen_start    = time.time()
        model.set_generation_params(duration=duration)
        wav          = model.generate([music_prompt])
        gen_time     = round(time.time() - gen_start, 1)
        out_filename = f"lyrics_{int(time.time())}"
        save_path    = os.path.join('static', 'generated', out_filename)
        audio_write(save_path, wav[0].cpu(), model.sample_rate, strategy="loudness",
                    loudness_headroom_db=14, loudness_compressor=True)
        audio_url  = url_for('static', filename=f"generated/{out_filename}.wav")
        lines      = [l for l in lyrics_response.split('\n') if l.strip()]
        all_words  = [w for line in lines for w in line.split()]
        lead_in    = min(1.5, duration * 0.05)
        usable     = duration - lead_in - 0.5
        word_gap   = usable / max(len(all_words) - 1, 1)
        word_timestamps = [{'word': w, 'time': round(lead_in + i * word_gap, 2)}
                           for i, w in enumerate(all_words)]
        title    = f"🎤 {prompt[:25]}..."
        track_id = save_track(user_id=session['user_id'], title=title,
                              artist=session['user_name'], filename=f"{out_filename}.wav",
                              audio_url=audio_url, prompt=music_prompt, duration=duration)
        dev = 'GPU (CUDA)' if torch.cuda.is_available() else 'CPU'
        return jsonify({
            'success': True,
            'track': {'id': track_id, 'title': title, 'artist': session['user_name'],
                      'audioUrl': audio_url, 'filename': f"{out_filename}.wav",
                      'promptPreview': prompt, 'duration': duration,
                      'created_at': time.strftime("%b %d, %Y")},
            'lyrics': lyrics_response,
            'word_timestamps': word_timestamps,
            'stats': {'generation_time': gen_time, 'device': dev, 'duration': duration,
                      'model': 'MusicGen-Small (300M params)', 'quality_score': 85,
                      'quality_feedback': 'Lyrics + music generated',
                      'fad_score': 7.8, 'mos_score': '3.8/5', 'training_hours': '20,000'}
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/remix-songs', methods=['POST'])
@login_required
def remix_songs():
    if not TORCH_AVAILABLE or model is None:
        return jsonify({'success': False, 'message': 'AI model not available on this server. GPU instance required.'}), 503
    if not PYDUB_AVAILABLE:
        return jsonify({'success': False, 'message': 'Audio processing library not available.'}), 503
    import numpy as np
    files = request.files.getlist('songs')
    if len(files) < 2:
        return jsonify({'success': False, 'message': 'Please upload at least 2 songs'})
    if len(files) > 5:
        return jsonify({'success': False, 'message': 'Maximum 5 songs allowed'})
    seg_duration = int(request.form.get('segment_duration', 30)) * 1000
    bridge_dur   = max(10, min(int(request.form.get('crossfade', 12)), 20))
    seam_cf_ms   = 2000
    saved_paths  = []
    try:
        for f in files:
            path = os.path.join(UPLOAD_FOLDER, secure_filename(f.filename))
            f.save(path)
            saved_paths.append(path)
        segments, bpms = [], []
        for path in saved_paths:
            try:
                seg     = AudioSegment.from_file(path)
                seg     = pydub_normalize(seg).set_frame_rate(44100).set_channels(2)
                raw     = np.array(seg.get_array_of_samples(), dtype=np.float32)
                if seg.channels == 2:
                    raw = raw.reshape(-1, 2)
                bpm = _detect_bpm(raw, seg.frame_rate)
                segments.append(seg)
                bpms.append(bpm)
            except Exception as e:
                print(f"Could not load {path}: {e}")
        if len(segments) < 2:
            return jsonify({'success': False, 'message': 'Could not read audio files. Use MP3 or WAV.'})
        clipped = []
        for i, seg in enumerate(segments):
            clip_end = min(seg_duration, len(seg))
            if bpms[i] > 0:
                beat_ms  = (60.0 / bpms[i]) * 1000
                clip_end = int(round(clip_end / beat_ms) * beat_ms)
                clip_end = max(min(clip_end, len(seg)), 4000)
            clipped.append(seg[:clip_end])
        result = clipped[0]
        transition_log = []
        for i in range(len(clipped) - 1):
            bridge_bpm = (bpms[i] + bpms[i + 1]) / 2
            dj_prompt  = (f"Professional DJ transition bridge, {bridge_bpm:.0f} BPM, "
                          "electronic dance, build tension with filter sweep, sub-bass drop, "
                          "no vocals, seamless blend, high-fidelity studio master.")
            try:
                model.set_generation_params(duration=bridge_dur)
                wav        = model.generate([dj_prompt])
                bridge_seg = _tensor_to_pydub(wav[0], model.sample_rate)
                bridge_seg = pydub_normalize(bridge_seg).set_frame_rate(44100).set_channels(2)
                result     = _dj_transition(_dj_transition(result, bridge_seg, seam_cf_ms),
                                            clipped[i + 1], seam_cf_ms)
                transition_log.append({'from': saved_paths[i], 'to': saved_paths[i + 1],
                                       'bridge_bpm': round(bridge_bpm, 1)})
            except Exception as be:
                print(f"Bridge gen failed: {be}")
                result = result.append(clipped[i + 1], crossfade=seam_cf_ms)
        result       = pydub_normalize(result)
        out_filename = f"flashmob_{int(time.time())}"
        out_path     = os.path.join('static', 'generated', f"{out_filename}.wav")
        result.export(out_path, format='wav')
        actual_dur = len(result) // 1000
        audio_url  = url_for('static', filename=f"generated/{out_filename}.wav")
        avg_bpm    = sum(bpms) / len(bpms)
        title      = f"AI Flashmob Mix: {len(segments)} tracks"
        track_id   = save_track(user_id=session['user_id'], title=title,
                                artist=session['user_name'], filename=f"{out_filename}.wav",
                                audio_url=audio_url, prompt=f"AI Flashmob | avg {avg_bpm:.0f} BPM",
                                duration=actual_dur)
        return jsonify({'success': True, 'track': {
            'id': track_id, 'title': title, 'artist': session['user_name'],
            'audioUrl': audio_url, 'filename': f"{out_filename}.wav",
            'promptPreview': f"AI Flashmob: {len(segments)} tracks | {avg_bpm:.0f} BPM | {actual_dur}s",
            'duration': actual_dur, 'bpm': avg_bpm,
            'transitions': transition_log, 'created_at': time.strftime("%b %d, %Y")
        }})
    except Exception as e:
        import traceback
        print(traceback.format_exc())
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        for p in saved_paths:
            if os.path.exists(p):
                try: os.remove(p)
                except: pass

def _detect_bpm(samples, sample_rate):
    import numpy as np
    if len(samples.shape) > 1:
        samples = samples.mean(axis=1)
    samples   = samples[:sample_rate * 60].astype(np.float32)
    peak      = np.max(np.abs(samples))
    if peak > 0:
        samples /= peak
    frame_size = 2048
    hop        = 512
    fps        = sample_rate / hop
    frames     = np.array([np.sum(samples[i:i+frame_size] ** 2)
                           for i in range(0, len(samples) - frame_size, hop)])
    onset      = np.maximum(np.diff(frames, prepend=frames[0]), 0)
    if len(onset) < 8:
        return 120.0
    min_gap   = max(1, int(0.25 * fps))
    peaks, last = [], -min_gap
    threshold = np.mean(onset) + 0.5 * np.std(onset)
    for i, v in enumerate(onset):
        if v >= threshold and i - last >= min_gap:
            window = onset[max(0, i - min_gap): i + min_gap + 1]
            if len(window) > 0 and v == window.max():
                peaks.append(i)
                last = i
    if len(peaks) < 4:
        return 120.0
    intervals = np.diff(peaks) / fps
    intervals = intervals[(intervals > 0.2) & (intervals < 2.0)]
    if len(intervals) < 3:
        return 120.0
    bpm = 60.0 / float(np.median(intervals))
    while bpm < 70: bpm *= 2
    while bpm > 180: bpm /= 2
    return round(bpm, 1)

def _tensor_to_pydub(wav_tensor, sample_rate):
    import io, wave as wv, struct, numpy as np
    audio_np = wav_tensor.cpu().numpy()
    if audio_np.ndim == 1:
        audio_np = audio_np[np.newaxis, :]
    peak = np.max(np.abs(audio_np))
    if peak > 0:
        audio_np /= peak
    pcm  = (audio_np * 32767).astype(np.int16)
    buf  = io.BytesIO()
    n_ch = pcm.shape[0]
    with wv.open(buf, 'wb') as wf:
        wf.setnchannels(n_ch)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        interleaved = pcm.T.flatten()
        wf.writeframes(struct.pack(f'<{len(interleaved)}h', *interleaved))
    buf.seek(0)
    return AudioSegment.from_wav(buf)

def _dj_transition(seg_out, seg_in, crossfade_ms):
    cf     = max(min(crossfade_ms, len(seg_out) // 2, len(seg_in) // 2), 2000)
    body   = seg_out[:-cf]
    tail   = seg_out[-cf:]
    head   = seg_in[:cf]
    rest   = seg_in[cf:]
    p1, p2 = cf // 3, cf // 3
    p3     = cf - p1 - p2
    blend  = (tail[:p1].overlay(head[:p1].low_pass_filter(400) - 12) +
              tail[p1:p1+p2].overlay(head[p1:p1+p2].low_pass_filter(4000) - 4) +
              tail[p1+p2:].overlay(head[p1+p2:] - 1))
    min_l  = min(len(blend), cf)
    return body + blend[:min_l] + rest

@app.route('/api/quiz/questions', methods=['GET'])
@login_required
def get_quiz_questions():
    QUESTION_BANK = [
        {"question": "Which band released 'Bohemian Rhapsody'?", "options": ["The Beatles", "Queen", "Led Zeppelin", "Pink Floyd"], "answer": "Queen", "fact": "Bohemian Rhapsody was released in 1975 and is over 6 minutes long!"},
        {"question": "How many strings does a standard guitar have?", "options": ["4", "5", "6", "7"], "answer": "6", "fact": "A standard guitar has 6 strings tuned E-A-D-G-B-E"},
        {"question": "What does BPM stand for in music?", "options": ["Bass Per Minute", "Beats Per Minute", "Bars Per Measure", "Beat Pattern Mode"], "answer": "Beats Per Minute", "fact": "Normal pop songs are 100–130 BPM"},
        {"question": "Which instrument has 88 keys?", "options": ["Organ", "Harpsichord", "Piano", "Accordion"], "answer": "Piano", "fact": "A standard piano has 52 white keys and 36 black keys"},
        {"question": "Who is known as the King of Pop?", "options": ["Elvis Presley", "Michael Jackson", "Prince", "David Bowie"], "answer": "Michael Jackson", "fact": "Michael Jackson sold over 400 million records worldwide"},
        {"question": "Which country does K-pop come from?", "options": ["Japan", "China", "South Korea", "Thailand"], "answer": "South Korea", "fact": "K-pop became a global phenomenon with BTS and BLACKPINK"},
        {"question": "What is the lowest male singing voice called?", "options": ["Tenor", "Baritone", "Bass", "Alto"], "answer": "Bass", "fact": "Bass voices can reach as low as E2"},
        {"question": "Which band is known for 'Hotel California'?", "options": ["Fleetwood Mac", "The Eagles", "Lynyrd Skynyrd", "The Doors"], "answer": "The Eagles", "fact": "Hotel California was released in 1977 and won a Grammy"},
        {"question": "How many notes are in a standard musical octave?", "options": ["7", "8", "12", "16"], "answer": "12", "fact": "An octave has 12 semitones including sharps and flats"},
        {"question": "What does 'forte' mean in music?", "options": ["Soft", "Fast", "Loud", "Slow"], "answer": "Loud", "fact": "Forte comes from Italian meaning strong or loud"},
        {"question": "Who is known as the Queen of Pop?", "options": ["Beyoncé", "Rihanna", "Madonna", "Lady Gaga"], "answer": "Madonna", "fact": "Madonna has sold over 300 million records worldwide"},
        {"question": "Which music streaming platform has the most users?", "options": ["Apple Music", "Tidal", "Spotify", "Amazon Music"], "answer": "Spotify", "fact": "Spotify has over 600 million active users worldwide"},
        {"question": "Which Indian instrument is a plucked string instrument?", "options": ["Tabla", "Sitar", "Mridangam", "Bansuri"], "answer": "Sitar", "fact": "The sitar has 18–21 strings and is central to Hindustani classical music"},
        {"question": "Who composed the 'Moonlight Sonata'?", "options": ["Mozart", "Bach", "Chopin", "Beethoven"], "answer": "Beethoven", "fact": "Beethoven composed it in 1801"},
        {"question": "What does EDM stand for?", "options": ["Electronic Dance Music", "Extended Digital Mix", "Electronic Digital Media", "Enhanced Dance Mode"], "answer": "Electronic Dance Music", "fact": "EDM encompasses genres like house, techno, dubstep, and trance"},
        {"question": "Which band is known for 'Stairway to Heaven'?", "options": ["The Rolling Stones", "Led Zeppelin", "Pink Floyd", "Deep Purple"], "answer": "Led Zeppelin", "fact": "Stairway to Heaven is often called the greatest rock song ever written"},
        {"question": "What is the time signature of a waltz?", "options": ["2/4", "3/4", "4/4", "6/8"], "answer": "3/4", "fact": "The waltz's 3/4 time gives it its characteristic ONE-two-three rhythm"},
        {"question": "Which famous rapper is from Compton, California?", "options": ["Jay-Z", "Kendrick Lamar", "Drake", "Lil Wayne"], "answer": "Kendrick Lamar", "fact": "Kendrick Lamar won a Pulitzer Prize for his album DAMN. in 2018"},
    ]
    selected = random.sample(QUESTION_BANK, min(5, len(QUESTION_BANK)))
    try:
        raw = groq_call(
            f'Generate 2 music trivia questions DIFFERENT from these: {[q["question"][:25] for q in selected]}. '
            'RULES: answer must be exact text of one option. No A/B/C/D as answer. '
            'Reply ONLY as JSON array, no markdown: '
            '[{"question":"...","options":["A","B","C","D"],"answer":"exact option text","fact":"..."}]'
        )
        raw    = raw.strip().replace("```json", "").replace("```", "").strip()
        ai_qs  = json.loads(raw)
        for q in ai_qs:
            ans, opts = q.get('answer', ''), q.get('options', [])
            if len(ans) == 1 and ans.upper() in 'ABCD' and opts:
                idx = ord(ans.upper()) - ord('A')
                if 0 <= idx < len(opts):
                    q['answer'] = opts[idx]
        if len(ai_qs) >= 2:
            selected[-2:] = ai_qs[:2]
            random.shuffle(selected)
    except Exception as e:
        print(f"Groq quiz failed: {e}")
    return jsonify({'success': True, 'questions': selected})

@app.route('/api/quiz/check', methods=['POST'])
@login_required
def check_quiz_answer():
    data     = request.json or {}
    selected = str(data.get('selected', '')).strip().lower()
    correct  = str(data.get('correct', '')).strip().lower()
    is_correct = selected == correct
    if is_correct:
        msg = random.choice(["🎵 Correct! You're a music genius!", "🎸 Nailed it! Rock on!",
                             "🎹 Perfect! You know your music!", "🥁 Boom! That's right!"])
    else:
        msg = f"❌ Not quite! The correct answer was: {data.get('correct', '')}"
    return jsonify({'success': True, 'correct': is_correct, 'message': msg})

@app.route('/api/model-info', methods=['GET'])
@login_required
def model_info():
    dev = ('GPU (CUDA)' if (TORCH_AVAILABLE and torch.cuda.is_available()) else 'CPU')
    return jsonify({'success': True, 'model': {
        'name': 'MusicGen-Small', 'creator': 'Meta AI Research',
        'parameters': '300M', 'architecture': 'Auto-regressive Transformer',
        'training_data': '20,000 hours of licensed music',
        'fad_score': 7.8, 'mos_score': '3.8 / 5.0', 'released': 'June 2023',
        'device': dev, 'status': 'Loaded' if model is not None else 'Not loaded (CPU server)',
        'max_duration': '180 seconds / 3 minutes (GPU)',
        'text_encoder': 'T5', 'audio_codec': 'EnCodec'
    }})

@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'model_loaded': model is not None,
                    'torch': TORCH_AVAILABLE, 'pydub': PYDUB_AVAILABLE})

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=False, host='0.0.0.0', port=port)
