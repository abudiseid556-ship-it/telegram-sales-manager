import json
import os
import logging
from flask import Flask, render_template_string, request, redirect, url_for, jsonify, session
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    ApplicationBuilder,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)
import threading

# ከ Render Environment Variables የሚወስድበት ወይም በነባሪ የሚጠቀመው
TOKEN = os.environ.get("TOKEN", "እዚህ_ጋር_የቦትዎን_ቶክን_ያስገቡ")
ADMIN_CHAT_ID = int(os.environ.get("ADMIN_CHAT_ID", "123456789"))
WEB_PASSWORD = os.environ.get("WEB_PASSWORD", "123")

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)

DATA_FILE = "tsm_database.json"

default_db = {
    "products": [
        {"id": "1", "name": "🔊 ዱብል 8-ኢንች ስፒከር", "qty": 10, "buy": 12000, "sell": 15000, "img": ""}
    ],
    "orders": [],
    "customers": []
}

def init_db():
    if not os.path.exists(DATA_FILE):
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(default_db, f, ensure_ascii=False, indent=4)

def load_db():
    init_db()
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_db(db):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=4)

# --- Flask Web Server ---
app_flask = Flask(__name__)
app_flask.secret_key = "super_secret_key_here"

@app_flask.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        if request.form.get('password') == WEB_PASSWORD:
            session['logged_in'] = True
            return redirect(url_for('index'))
        else:
            error = "የገባጉት የይለፍ ቃል ትክክል አይደለም!"
    return render_template_string(LOGIN_TEMPLATE, error=error)

@app_flask.route('/logout')
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('login'))

@app_flask.route('/')
def index():
    if not session.get('logged_in'):
        return redirect(url_for('login'))
    return render_template_string(HTML_TEMPLATE)

@app_flask.route('/api/data', methods=['GET', 'POST'])
def handle_data():
    if not session.get('logged_in'):
        return jsonify({"error": "Unauthorized"}), 401
    db = load_db()
    if request.method == 'POST':
        new_data = request.json
        if new_data:
            save_db(new_data)
            return jsonify({"status": "success", "message": "ዳታው ተቀምጧል!"})
    return jsonify(db)

# --- Templates (Login & Dashboard) ---
LOGIN_TEMPLATE = """<!doctype html>
<html lang="am">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login - Telegram Sales Manager</title>
<style>
body{margin:0;font-family:sans-serif;background:#f4f7fb;display:grid;place-items:center;height:100vh;color:#172033}
.box{background:#fff;padding:24px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.1);width:100%;max-width:360px}
h2{margin-top:0;color:#155eef}
input{width:100%;border:1px solid #dbe2ee;border-radius:11px;padding:12px;margin:12px 0;box-sizing:border-box}
button{width:100%;background:#2563eb;color:#fff;padding:12px;border:0;border-radius:12px;font-weight:700;cursor:pointer}
.err{color:red;font-size:13px;margin-bottom:10px}
</style>
</head>
<body>
<div class="box">
<h2>🔒 መግቢያ (Login)</h2>
{% if error %}<div class="err">{{ error }}</div>{% endif %}
<form method="POST">
<input type="password" name="password" placeholder="የይለፍ ቃል (Password)" required>
<button type="submit">ግባ</button>
</form>
</div>
</body>
</html>
"""

HTML_TEMPLATE = """<!doctype html>
<html lang="am">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Telegram Sales Manager V1</title>
<style>
body{margin:0;font-family:sans-serif;background:#f4f7fb;color:#172033;padding:20px}
.app{max-width:760px;margin:auto;background:#fff;padding:20px;border-radius:20px;box-shadow:0 4px 20px rgba(0,0,0,0.05)}
.top{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #eee;padding-bottom:15px;margin-bottom:20px}
h1{margin:0;font-size:20px;color:#2563eb}
.btn{background:#2563eb;color:#fff;padding:10px 15px;border-radius:10px;text-decoration:none;font-weight:bold;border:0;cursor:pointer}
.btn.red{background:#feecec;color:#c62828}
.form input{width:100%;padding:10px;margin:8px 0 15px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box}
</style>
</head>
<body>
<div class="app">
  <div class="top">
    <h1>📲 Telegram Sales Manager</h1>
    <a href="/logout" class="btn red">🚪 ውጣ</a>
  </div>
  <div>
    <h3>እንኳን ደህና መጡ! </h3>
    <p>ሲስተሙ በ Render ክላውድ ላይ በትክክል እየሰራ ነው።</p>
  </div>
</div>
</body>
</html>
"""

# --- Telegram Bot Code ---
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    db = load_db()
    keyboard = []
    for p in db["products"]:
        if p["qty"] > 0:
            keyboard.append([InlineKeyboardButton(f"{p['name']} — {p['sell']} ETB", callback_data=f"prod_{p['id']}")])
    
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text("እንኳን ደህና መጡ! 🛍 የሚፈልጉትን ምርት ይምረጡ:", reply_markup=reply_markup)

async def button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    db = load_db()
    pid = query.data.split("_")[1]
    p = next((item for item in db["products"] if item["id"] == pid), None)
    if p:
        await query.message.reply_text(f"🛒 **{p['name']}**\n\n💰 ዋጋ: {p['sell']} ETB\n📦 Stock: {p['qty']}")

def run_telegram_bot():
    app = ApplicationBuilder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(button_handler))
    app.run_polling()

if __name__ == "__main__":
    # የቴሌግራም ቦቱን ከጀርባ (Background Thread) ማስጀመር
    bot_thread = threading.Thread(target=run_telegram_bot)
    bot_thread.daemon = True
    bot_thread.start()

    # የ Flask ሰርቨርን በ Render የሚሰጠውን Port ማስኬድ
    port = int(os.environ.get("PORT", 5000))
    app_flask.run(host="0.0.0.0", port=port, debug=False)

