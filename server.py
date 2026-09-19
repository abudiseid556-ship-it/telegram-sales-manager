import os
import threading
from flask import Flask, render_template_string, request, redirect, url_for, session
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ApplicationBuilder, ContextTypes, CommandHandler, CallbackQueryHandler

app_flask = Flask(__name__)
app_flask.secret_key = os.environ.get("WEB_SECRET_KEY", "super_secret_key_change_me")

TOKEN = os.environ.get("TOKEN", "YOUR_BOT_TOKEN_HERE")
WEB_PASSWORD = os.environ.get("WEB_PASSWORD", "admin123")
DB_FILE = "database.json"

import json
def load_db():
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            pass
    return {"products": [], "orders": [], "customers": []}

def save_db(db):
    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)

FULL_HTML_CODE = """
<!doctype html>
<html lang="am">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Telegram Sales Manager</title>
<style>
body{font-family:system-ui,sans-serif;background:#f4f7fb;margin:0;padding-bottom:70px;color:#111}
.top{background:#2563eb;color:#fff;padding:15px;display:flex;justify-content:space-between;align-items:center}
.container{padding:15px;max-width:600px;margin:auto}
.card{background:#fff;padding:15px;border-radius:12px;margin-bottom:10px;box-shadow:0 2px 5px rgba(0,0,0,0.05)}
.btn{background:#2563eb;color:#fff;border:0;padding:10px 15px;border-radius:8px;cursor:pointer;font-weight:bold}
.btn.red{background:#dc2626}.btn.green{background:#16a34a}
input,select{width:100%;padding:10px;margin:8px 0;border:1px solid #ddd;border-radius:8px;box-sizing:border-box}
.nav{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #ddd;display:flex;justify-content:space-around;padding:10px 0}
.nav button{background:none;border:0;color:#666;font-size:12px;cursor:pointer}
.nav button.active{color:#2563eb;font-weight:bold}
.hidden{display:none}
</style>
</head>
<body>

<div class="top">
  <div><b>Telegram Sales Manager</b></div>
  <a href="/logout" style="color:#fff;font-size:13px;text-decoration:none;">ውጣ</a>
</div>

<div class="container">
  <div id="tab-home" class="tab">
    <div class="card">
      <h3>እንኳን ደህና መጡ!</h3>
      <p>ምርቶችን እና ሽያጮችን በዚህ ፓነል ያስተዳድሩ።</p>
      <button class="btn" onclick="openProductModal()">+ አዲስ ምርት አክል</button>
    </div>
    <div class="card">
      <h4>ጠቅላላ ምርቶች: <span id="tot-prod">0</span></h4>
      <h4>ጠቅላላ ሽያጮች: <span id="tot-sales">0 ETB</span></h4>
    </div>
  </div>

  <div id="tab-products" class="tab hidden">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h3>ምርቶች</h3>
      <button class="btn" onclick="openProductModal()">+ አክል</button>
    </div>
    <div id="prod-list"></div>
  </div>

  <div id="tab-orders" class="tab hidden">
    <h3>ሽያጮች</h3>
    <div id="order-list"></div>
  </div>
</div>

<div class="nav">
  <button onclick="switchTab('home')" class="active" id="btn-home">🏠 ዋና</button>
  <button onclick="switchTab('products')" id="btn-products">📦 ምርቶች</button>
  <button onclick="switchTab('orders')" id="btn-orders">🛒 ሽያጭ</button>
</div>

<!-- Modal -->
<div id="modal" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);display:none;align-items:center;justify-content:center;padding:20px">
  <div style="background:#fff;width:100%;max-width:400px;padding:20px;border-radius:12px">
    <h3>ምርት ማከያ</h3>
    <input id="p-name" placeholder="የምርት ስም">
    <input id="p-qty" type="number" placeholder="ብዛት (Qty)">
    <input id="p-buy" type="number" placeholder="የመግዣ ዋጋ">
    <input id="p-sell" type="number" placeholder="የመሸጫ ዋጋ">
    <button class="btn" style="width:100%;margin-top:10px" onclick="saveProduct()">አስቀምጥ</button>
    <button class="btn red" style="width:100%;margin-top:5px" onclick="closeModal()">ይቅር</button>
  </div>
</div>

<script>
let db = JSON.parse(localStorage.getItem("tsm_db") || '{"products":[],"orders":[]}');

function saveData() {
    localStorage.setItem("tsm_db", JSON.stringify(db));
    render();
}

function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.add('hidden'));
    document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.remove('hidden');
    document.getElementById('btn-' + tab).classList.add('active');
}

function openProductModal() { document.getElementById('modal').style.display = 'flex'; }
function closeModal() { document.getElementById('modal').style.display = 'none'; }

function saveProduct() {
    let name = document.getElementById('p-name').value;
    let qty = parseInt(document.getElementById('p-qty').value) || 0;
    let buy = parseFloat(document.getElementById('p-buy').value) || 0;
    let sell = parseFloat(document.getElementById('p-sell').value) || 0;
    if(!name) return alert('እባክዎ ስም ያስገቡ');
    
    db.products.push({id: Date.now().toString(), name, qty, buy, sell});
    closeModal();
    saveData();
}

function render() {
    document.getElementById('tot-prod').innerText = db.products.length;
    let totalSales = db.orders.reduce((sum, o) => sum + (o.total || 0), 0);
    document.getElementById('tot-sales').innerText = totalSales + ' ETB';
    
    let pList = document.getElementById('prod-list');
    pList.innerHTML = db.products.length ? db.products.map(p => `
        <div class="card">
            <b>${p.name}</b>ኮምፓክት<br>
            ብዛት: ${p.qty} | መሸጫ: ${p.sell} ETB
        </div>
    `).join('') : '<p>ምንም ምርት የለም</p>';
}
render();
</script>
</body>
</html>
"""

LOGIN_HTML = """
<!doctype html>
<html lang="am">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login</title>
<style>
body{font-family:system-ui,sans-serif;background:#f4f7fb;display:grid;place-items:center;height:100vh;margin:0}
.box{background:#fff;padding:20px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,0.05);width:300px}
input{width:100%;padding:10px;margin:10px 0;border:1px solid #ddd;border-radius:8px;box-sizing:border-box}
button{width:100%;padding:10px;background:#2563eb;color:#fff;border:0;border-radius:8px;cursor:pointer}
</style>
</head>
<body>
<div class="box">
  <h3>ግባ (Login)</h3>
  <form method="POST">
    <input type="password" name="password" placeholder="የይለፍ ቃል" required>
    <button type="submit">ግባ</button>
  </form>
</div>
</body>
</html>
"""

@app_flask.route("/", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        if request.form.get("password") == WEB_PASSWORD:
            session["logged_in"] = True
            return redirect(url_for("dashboard"))
    return render_template_string(LOGIN_HTML)

@app_flask.route("/dashboard")
def dashboard():
    if not session.get("logged_in"):
        return redirect(url_for("login"))
    return render_template_string(FULL_HTML_CODE)

@app_flask.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app_flask.run(host="0.0.0.0", port=port, debug=False)
