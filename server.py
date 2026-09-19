import os
import json
import threading
import requests
from flask import Flask, render_template_string, request, redirect, url_for, session

app_flask = Flask(__name__)
app_flask.secret_key = os.environ.get("WEB_SECRET_KEY", "super_secret_key_change_me")

WEB_PASSWORD = os.environ.get("WEB_PASSWORD", "admin123")
DB_FILE = "database.json"

def load_db():
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            pass
    return {"products": [], "channels": [], "ads": [], "orders": [], "bot_token": os.environ.get("TOKEN", "")}

def save_db(db):
    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)

def run_bot_background():
    print("🤖 Telegram Bot background worker started...")

FULL_HTML_CODE = """
<!DOCTYPE html>
<html lang="am">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Telegram Bot & Sales Manager</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Noto Sans Ethiopic",sans-serif;background:#f4f7fb;color:#172033}
button,input,select,textarea{font:inherit}
button{border:0;cursor:pointer}
.app{width:100%;max-width:760px;min-height:100vh;margin:auto;background:#f7f9fc;padding-bottom:90px}
.header{background:linear-gradient(135deg,#1477ff,#655cff);color:white;padding:22px 17px 25px;border-radius:0 0 28px 28px}
.header-top{display:flex;align-items:center;justify-content:space-between}
.header h1{font-size:23px;font-weight:900}
.header p{font-size:12px;opacity:.85;margin-top:5px}
.settings-btn{width:42px;height:42px;border-radius:14px;background:rgba(255,255,255,.18);color:white;font-size:20px}
.content{padding:15px}
.page{display:none}
.page.active{display:block}
.card{background:white;border-radius:18px;padding:15px;margin-bottom:12px;border:1px solid #e9edf4;box-shadow:0 5px 20px rgba(20,40,80,.05)}
.card h3{font-size:16px;margin-bottom:12px}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.quick{text-align:left;padding:15px;border-radius:17px;background:white;border:1px solid #e8edf4;box-shadow:0 5px 16px rgba(20,40,80,.05)}
.quick-icon{width:43px;height:43px;display:grid;place-items:center;border-radius:13px;background:#edf4ff;font-size:21px}
.quick b{display:block;margin-top:8px;font-size:13px}
.quick small{color:#7c8798;font-size:10px}
.btn{padding:11px 14px;border-radius:12px;background:#edf4ff;color:#1264e8;font-weight:800}
.btn-primary{background:#1477ff;color:white}
.btn-green{background:#e8fbf2;color:#078b58}
.btn-red{background:#fff0f0;color:#d93636}
label{display:block;font-size:12px;font-weight:800;margin:10px 0 6px}
input,select,textarea{width:100%;padding:12px;border:1px solid #dfe5ee;border-radius:12px;background:white;outline:none}
.order-row{display:flex;justify-content:space-between;gap:10px;padding:11px 0;border-bottom:1px solid #edf0f5}
.channel{display:flex;align-items:center;gap:10px}
.channel-logo{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:#e8f3ff;font-size:21px}
.channel-info b{font-size:13px}
.channel-info small{display:block;color:#7c8798;margin-top:2px}
.empty{text-align:center;padding:30px 15px;color:#8b96a6;font-size:13px}
.bottom-nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:min(760px,100%);height:72px;background:white;border-top:1px solid #e8edf3;display:grid;grid-template-columns:repeat(4,1fr);z-index:20}
.nav-btn{background:none;color:#8490a1;font-size:10px}
.nav-btn span{display:block;font-size:21px;margin-bottom:3px}
.nav-btn.active{color:#1477ff;font-weight:900}
.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:100;align-items:flex-end;justify-content:center}
.modal.show{display:flex}
.sheet{width:min(760px,100%);max-height:92vh;overflow:auto;background:white;border-radius:25px 25px 0 0;padding:18px}
.close-btn{float:right;width:34px;height:34px;border-radius:50%;background:#eef2f6;font-size:20px}
</style>
</head>
<body>
<div class="app">
<header class="header">
    <div class="header-top">
        <div>
            <h1>Telegram Bot Manager</h1>
            <p>ቦት ማቀናበሪያ እና ፖስት ማድረጊያ</p>
        </div>
        <button class="settings-btn" onclick="openModal('settingsModal')">⚙️</button>
    </div>
</header>
<main class="content">
<section id="home" class="page active">
    <div class="card" style="background:linear-gradient(135deg,#eef4ff,#fff);border:1px solid #d0e1ff;">
        <h3>🤖 የቦት ሁኔታ (Bot Status)</h3>
        <p style="font-size:13px;margin-bottom:10px;" id="botStatusText">ቦቱ ከዌብ ፓነል ጋር ተገናኝቷል።</p>
        <button class="btn btn-primary" onclick="openModal('settingsModal')">⚙️ ቦት ቶከን ማስተካከያ</button>
    </div>
    <div class="grid">
        <button class="quick" onclick="openModal('adModal')"><div class="quick-icon">📢</div><b>ማስታወቂያ ላክ</b><small>ወደ ቻናል/ግሩፕ ፖስት</small></button>
        <button class="quick" onclick="openModal('channelModal')"><div class="quick-icon">🔗</div><b>ቻናል አገናኝ</b><small>Channel / Group ጨምር</small></button>
    </div>
    <div class="card">
        <h3>🔗 የተገናኙ ቻናሎች እና ግሩፖች</h3>
        <div id="channelList"></div>
    </div>
</section>

<section id="ads" class="page">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h2 style="font-size:19px;">📢 ፖስቶች እና ማስታወቂያዎች</h2>
        <button class="btn btn-primary" onclick="openModal('adModal')">＋ አዲስ ፖስት</button>
    </div>
    <div class="card">
        <h3>📜 የላካቸው ማስታወቂያዎች ታሪክ</h3>
        <div id="adHistory"></div>
    </div>
</section>

<section id="channels_page" class="page">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h2 style="font-size:19px;">🔗 ቻናሎች</h2>
        <button class="btn btn-primary" onclick="openModal('channelModal')">＋ ቻናል አገናኝ</button>
    </div>
    <div class="card"><div id="channelListFull"></div></div>
</section>

<section id="settings_page" class="page">
    <h2 style="font-size:19px;margin-bottom:12px;">⚙️ ቅንብሮች</h2>
    <div class="card">
        <h3>🔑 የቴሌግራም ቦት ቶከን (Bot Token)</h3>
        <form id="tokenForm">
            <label>Bot Token ከ BotFather</label>
            <input id="botTokenInput" required placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ">
            <br><button class="btn btn-primary" type="submit" style="margin-top:10px;width:100%;">💾 ቶከኑን ቆጥብ (Save)</button>
        </form>
    </div>
</section>
</main>

<nav class="bottom-nav">
    <button class="nav-btn active" onclick="showPage('home',this)"><span>⌂</span>ዋና</button>
    <button class="nav-btn" onclick="showPage('ads',this)"><span>📢</span>ማስታወቂያ</button>
    <button class="nav-btn" onclick="showPage('channels_page',this)"><span>🔗</span>ቻናሎች</button>
    <button class="nav-btn" onclick="showPage('settings_page',this)"><span>⚙️</span>ቅንብር</button>
</nav>
</div>

<!-- MODALS -->
<div class="modal" id="settingsModal">
  <div class="sheet">
    <button class="close-btn" onclick="closeModal('settingsModal')">×</button>
    <h2>⚙️ ቦት ማቀናበሪያ</h2>
    <form id="modalTokenForm">
      <label>Telegram Bot Token</label>
      <input id="modalBotToken" required placeholder="Bot Token አስገባ">
      <br><button class="btn btn-primary" type="submit" style="width:100%;margin-top:10px">💾 ቶከን አስቀምጥ</button>
    </form>
  </div>
</div>

<div class="modal" id="channelModal">
  <div class="sheet">
    <button class="close-btn" onclick="closeModal('channelModal')">×</button>
    <h2>🔗 Channel / Group አገናኝ</h2>
    <form id="channelForm">
      <label>አይነት</label><select id="cType"><option value="Channel">📣 Channel</option><option value="Group">👥 Group</option></select>
      <label>የChannel / Group ስም</label><input id="cName" required placeholder="ምሳሌ፦ የኔ ሱቅ">
      <label>Username / Chat ID</label><input id="cId" required placeholder="@mychannel ወይም -100xxxxxxxxxx">
      <br><button class="btn btn-primary" type="submit" style="width:100%;margin-top:10px">🔗 ቻናል አገናኝ</button>
    </form>
  </div>
</div>

<div class="modal" id="adModal">
  <div class="sheet">
    <button class="close-btn" onclick="closeModal('adModal')">×</button>
    <h2>📢 ወደ ቴሌግራም ፖስት መላኪያ</h2>
    <form id="adForm">
      <label>ርዕስ</label><input id="adTitle" required placeholder="🔥 ልዩ ቅናሽ!">
      <label>መልዕክት</label><textarea id="adText" rows="4" required placeholder="የምርቱ ዝርዝር..."></textarea>
      <label>የሚላክበት Channel / Group ይምረጡ</label><select id="adTarget" style="margin-bottom:10px"></select>
      <button class="btn btn-primary" type="submit" style="width:100%;">📤 በቀጥታ ወደ ቴሌግራም ፖስት አድርግ</button>
    </form>
  </div>
</div>

<script>
let data = {"products": [], "channels": [], "ads": [], "orders": [], "bot_token": ""};

function loadData() {
    fetch('/api/load').then(r => r.json()).then(d => { 
        if(d) { 
            data = d; 
            if(data.bot_token) {
                document.getElementById("botTokenInput").value = data.bot_token;
                document.getElementById("modalBotToken").value = data.bot_token;
                document.getElementById("botStatusText").innerText = "✅ ቦቱ በሰኬት ተገናኝቷል (Token ገብቷል)";
            } else {
                document.getElementById("botStatusText").innerText = "⚠️ እባክዎ ከታች ወይም በቅንብር ገጽ የቦት ቶከን ያስገቡ!";
            }
            renderAll(); 
        } 
    });
}

function saveData() {
    fetch('/api/save', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    }).then(() => { loadData(); });
}

function openModal(id){ document.getElementById(id).classList.add("show"); }
function closeModal(id){ document.getElementById(id).classList.remove("show"); }
function showPage(id, btn){
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    document.getElementById(id).classList.add("active");
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    if(btn) btn.classList.add("active");
    renderAll();
}
function escapeHTML(s){ return String(s?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

document.getElementById("tokenForm").addEventListener("submit", function(e){
    e.preventDefault();
    data.bot_token = document.getElementById("botTokenInput").value.trim();
    saveData();
    alert("✅ የቦት ቶከን ተቀምጧል!");
});

document.getElementById("modalTokenForm").addEventListener("submit", function(e){
    e.preventDefault();
    data.bot_token = document.getElementById("modalBotToken").value.trim();
    saveData();
    closeModal('settingsModal');
    alert("✅ የቦት ቶከን ተቀምጧል!");
});

document.getElementById("channelForm").addEventListener("submit", function(e){
    e.preventDefault();
    data.channels.push({
        id: "C-" + Date.now(),
        type: document.getElementById("cType").value,
        name: document.getElementById("cName").value.trim(),
        chatId: document.getElementById("cId").value.trim()
    });
    saveData();
    closeModal("channelModal");
    this.reset();
    alert("✅ ቻናሉ ተመዝግቧል።");
});

document.getElementById("adForm").addEventListener("submit", function(e){
    e.preventDefault();
    let title = document.getElementById("adTitle").value.trim();
    let text = document.getElementById("adText").value.trim();
    let chatId = document.getElementById("adTarget").value;

    if(!chatId){ alert("እባክዎ መጀመሪያ ቻናል ይምረጡ!"); return; }

    let fullText = `<b>${title}</b>\\n\\n${text}`;

    fetch('/api/telegram-post', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({chat_id: chatId, text: fullText})
    }).then(res => res.json()).then(resp => {
        if(resp.success){
            alert("✅ ማስታወቂያው በቀጥታ ወደ ቴሌግራም ተልኳል!");
            data.ads.unshift({id:"AD-"+Date.now(), title, text, chatId, date: new Date().toLocaleString()});
            saveData();
            closeModal("adModal");
            this.reset();
        } else {
            alert("❌ መላክ አልተቻለም: " + (resp.error || "ስህተት አጋጥሟል"));
        }
    });
});

function renderChannels(){
    let html = "";
    let target = document.getElementById("adTarget");
    if(!data.channels.length){
        html = '<div class="empty">ምንም ቻናል አልተገናኘም።</div>';
        target.innerHTML = '<option value="">ቻናል የለም</option>';
    } else {
        html = data.channels.map((ch, idx) => `
          <div class="order-row"><div class="channel"><div class="channel-logo">📣</div>
          <div class="channel-info"><b>${escapeHTML(ch.name)}</b><small>${escapeHTML(ch.chatId)}</small></div></div>
          <button class="btn btn-red" onclick="data.channels.splice(${idx},1);saveData();">×</button></div>`).join("");
        
        target.innerHTML = data.channels.map(ch => `<option value="${escapeHTML(ch.chatId)}">${escapeHTML(ch.name)} (${escapeHTML(ch.chatId)})</option>`).join("");
    }
    document.getElementById("channelList").innerHTML = html;
    if(document.getElementById("channelListFull")) {
        document.getElementById("channelListFull").innerHTML = html;
    }
}

function renderAds(){
    let hist = document.getElementById("adHistory");
    if(!data.ads || !data.ads.length){
        hist.innerHTML = '<div class="empty">የተላከ ማስታወቂያ የለም።</div>';
        return;
    }
    hist.innerHTML = data.ads.map(ad => `
        <div class="order-row">
            <div><b>${escapeHTML(ad.title)}</b><small>${escapeHTML(ad.date || '')}</small></div>
            <span style="color:green;font-size:11px;font-weight:bold;">ተልኳል</span>
        </div>
    `).join("");
}

function renderAll(){
    renderChannels();
    renderAds();
}

loadData();
</script>
</body>
</html>
"""

LOGIN_HTML = """
<!doctype html>
<html lang="am">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f7fb;display:grid;place-items:center;height:100vh;margin:0}.box{background:#fff;padding:22px;border-radius:16px;box-shadow:0 4px 15px rgba(0,0,0,0.05);width:320px}input{width:100%;padding:11px;margin:10px 0;border:1px solid #ddd;border-radius:10px;box-sizing:border-box}button{width:100%;padding:11px;background:#2563eb;color:#fff;border:0;border-radius:10px;font-weight:bold;cursor:pointer}</style>
</head>
<body><div class="box"><h3>🔐 ዌብ ፓነል መግቢያ</h3><form method="POST"><input type="password" name="password" placeholder="የይለፍ ቃል" required><button type="submit">ግባ</button></form></div></body>
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

@app_flask.route("/api/load")
def api_load():
    return json.dumps(load_db())

@app.route("/api/save", methods=["POST"])
def api_save():
    if not session.get("logged_in"):
        return {"success": False}, 403
    data = request.json
    if data:
        save_db(data)
        return {"success": True}
    return {"success": False}

@app_flask.route("/api/telegram-post", methods=["POST"])
def api_telegram_post():
    if not session.get("logged_in"):
        return {"success": False, "error": "Unauthorized"}, 403
    
    db = load_db()
    token = db.get("bot_token")
    if not token:
        return {"success": False, "error": "የቦት ቶከን አልገባም (Bot Token is missing)"}

    req_data = request.json
    chat_id = req_data.get("chat_id")
    text = req_data.get("text")
    
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {"chat_id": chat_id, "text": text.replace("\\n", "\n"), "parse_mode": "HTML"}
    
    try:
        response = requests.post(url, json=payload, timeout=10)
        res_json = response.json()
        if res_json.get("ok"):
            return {"success": True}
        else:
            return {"success": False, "error": res_json.get("description", "Unknown error")}
    except Exception as e:
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    t = threading.Thread(target=run_bot_background, daemon=True)
    t.start()
    
    port = int(os.environ.get("PORT", 5000))
    app_flask.run(host="0.0.0.0", port=port, debug=False)
