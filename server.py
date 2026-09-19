import os
import json
import threading
import requests
from flask import Flask, render_template_string, request, redirect, url_for, session

app_flask = Flask(__name__)
app_flask.secret_key = os.environ.get("WEB_SECRET_KEY", "super_secret_key_change_me")

TOKEN = os.environ.get("TOKEN", "YOUR_BOT_TOKEN_HERE")
WEB_PASSWORD = os.environ.get("WEB_PASSWORD", "admin123")
DB_FILE = "database.json"

def load_db():
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            pass
    return {"products": [], "channels": [], "ads": [], "orders": []}

def save_db(db):
    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)

# የቴሌግራም ቦቱን ከበስተጀርባ (Background) የሚያስኬድ ሰርቨር ሉፕ
def run_bot_background():
    # ቦቱ ከቴሌግራም ሰርቨር ጋር ያለውን ግንኙነት እንዲጠብቅ የሚያስችል ኮድ እዚህ ይካተታል
    print("🤖 Telegram Bot background worker started...")

FULL_HTML_CODE = """
<!DOCTYPE html>
<html lang="am">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Telegram Sales Manager</title>
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
.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:18px}
.stat{padding:13px;border-radius:16px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.20)}
.stat b{display:block;font-size:19px;font-weight:900}
.stat span{font-size:10px;opacity:.85}
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
.form-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.product{display:flex;align-items:center;gap:12px}
.product-photo{width:60px;height:60px;border-radius:15px;background:#eef2f7;display:grid;place-items:center;font-size:24px;overflow:hidden}
.product-photo img{width:100%;height:100%;object-fit:cover}
.product-info{flex:1;min-width:0}
.product-info b{font-size:14px}
.price{color:#1264e8;font-weight:900;margin-top:3px}
.badge{display:inline-block;padding:5px 9px;border-radius:20px;font-size:10px;font-weight:900;background:#edf4ff;color:#1264e8}
.badge-green{background:#e8fbf2;color:#078b58}
.order-row{display:flex;justify-content:space-between;gap:10px;padding:11px 0;border-bottom:1px solid #edf0f5}
.order-left{flex:1}
.order-left b{font-size:13px}
.order-left small{display:block;color:#7c8798;margin-top:3px}
.order-right{text-align:right}
.order-right strong{font-size:13px}
.notice{padding:13px;border-radius:16px;background:linear-gradient(135deg,#fff7df,#fff);border:1px solid #ffe3a3;font-size:12px;margin-bottom:12px}
.tabs{display:flex;gap:7px;overflow-x:auto;margin-bottom:12px}
.tab{white-space:nowrap;padding:9px 12px;border-radius:20px;background:#e9eef5;color:#596579;font-size:11px}
.tab.active{background:#1477ff;color:white}
.channel{display:flex;align-items:center;gap:10px}
.channel-logo{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:#e8f3ff;font-size:21px}
.channel-info{flex:1}
.channel-info b{font-size:13px}
.channel-info small{display:block;color:#7c8798;margin-top:2px}
.empty{text-align:center;padding:30px 15px;color:#8b96a6;font-size:13px}
.bottom-nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:min(760px,100%);height:72px;background:white;border-top:1px solid #e8edf3;display:grid;grid-template-columns:repeat(5,1fr);z-index:20}
.nav-btn{background:none;color:#8490a1;font-size:10px}
.nav-btn span{display:block;font-size:21px;margin-bottom:3px}
.nav-btn.active{color:#1477ff;font-weight:900}
.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:100;align-items:flex-end;justify-content:center}
.modal.show{display:flex}
.sheet{width:min(760px,100%);max-height:92vh;overflow:auto;background:white;border-radius:25px 25px 0 0;padding:18px}
.close-btn{float:right;width:34px;height:34px;border-radius:50%;background:#eef2f6;font-size:20px}
.payment-row{display:flex;justify-content:space-between;padding:7px 0;font-size:12px}
</style>
</head>
<body>
<div class="app">
<header class="header">
    <div class="header-top">
        <div>
            <h1>Telegram Sales Manager</h1>
            <p>ሽያጭ • ትዕዛዝ • ክፍያ • አውቶማቲክ ፖስት</p>
        </div>
        <button class="settings-btn" onclick="openModal('settingsModal')">⚙️</button>
    </div>
    <div class="stats">
        <div class="stat"><b id="statSales">0 ETB</b><span>የዛሬ ሽያጭ</span></div>
        <div class="stat"><b id="statProfit">0 ETB</b><span>ትርፍ</span></div>
        <div class="stat"><b id="statOrders">0</b><span>አዲስ Orders</span></div>
        <div class="stat"><b id="statStock">0</b><span>የቀረ Stock</span></div>
    </div>
</header>
<main class="content">
<section id="home" class="page active">
    <div class="notice">📢 <b>ማስታወቂያ Center</b><br>ምርት ከጨመርክ በኋላ በቀጥታ ለቻናሎችዎ እና ግሩፖችዎ መላክ ይችላሉ።</div>
    <div class="grid">
        <button class="quick" onclick="openModal('productModal')"><div class="quick-icon">📦</div><b>አዲስ ምርት</b><small>ፎቶ፣ ዋጋ፣ Stock</small></button>
        <button class="quick" onclick="showPage('orders')"><div class="quick-icon">🛒</div><b>Orders</b><small>Confirm / Reject</small></button>
        <button class="quick" onclick="showPage('ads')"><div class="quick-icon">📢</div><b>ማስታወቂያ</b><small>Channels & Groups</small></button>
        <button class="quick" onclick="showPage('payments')"><div class="quick-icon">💳</div><b>ክፍያ</b><small>ቅድሚያ / ቀብድ</small></button>
    </div>
    <div class="card"><h3>📦 የቅርብ ምርቶች</h3><div id="homeProducts"></div></div>
    <div class="card"><h3>🛒 የቅርብ Orders</h3><div id="homeOrders"></div></div>
</section>

<section id="products" class="page">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <h2 style="font-size:19px;">📦 Products</h2>
        <button class="btn btn-primary" onclick="openModal('productModal')">＋ አዲስ</button>
    </div>
    <div id="productList"></div>
</section>

<section id="orders" class="page">
    <h2 style="font-size:19px;">🛒 Orders</h2>
    <div id="orderList"></div>
</section>

<section id="ads" class="page">
    <div style="display:flex;justify-content:space-between;align-items:center;">
        <h2 style="font-size:19px;">📢 Advertising Center</h2>
        <button class="btn btn-primary" onclick="openModal('adModal')">＋ ማስታወቂያ</button>
    </div>
    <div class="card">
        <h3>🔗 Channels & Groups</h3>
        <div id="channelList"></div>
        <hr style="margin:10px 0;border:0;border-top:1px solid #eee">
        <button class="btn" onclick="openModal('channelModal')">＋ Channel / Group አገናኝ</button>
    </div>
    <div class="card">
        <h3>📜 Advertising History</h3>
        <div id="adHistory"></div>
    </div>
</section>

<section id="payments" class="page">
    <h2 style="font-size:19px;">💳 Payments</h2>
    <div id="paymentList"></div>
</section>
</main>

<nav class="bottom-nav">
    <button class="nav-btn active" onclick="showPage('home',this)"><span>⌂</span>ዋና</button>
    <button class="nav-btn" onclick="showPage('products',this)"><span>📦</span>Products</button>
    <button class="nav-btn" onclick="showPage('orders',this)"><span>🛒</span>Orders</button>
    <button class="nav-btn" onclick="showPage('ads',this)"><span>📢</span>Ads</button>
    <button class="nav-btn" onclick="showPage('reports',this)"><span>📊</span>Reports</button>
</nav>
</div>

<!-- MODALS -->
<div class="modal" id="productModal">
  <div class="sheet">
    <button class="close-btn" onclick="closeModal('productModal')">×</button>
    <h2>📦 አዲስ ምርት</h2>
    <form id="productForm">
      <label>የምርት ስም</label><input id="pName" required placeholder="ምሳሌ፦ Smart Watch">
      <div class="form-grid">
        <div><label>የግዢ ዋጋ</label><input id="pBuy" type="number" min="0" required placeholder="500"></div>
        <div><label>የሽያጭ ዋጋ</label><input id="pSell" type="number" min="0" required placeholder="800"></div>
      </div>
      <label>Stock / የተገዛ ብዛት</label><input id="pStock" type="number" min="0" required placeholder="50">
      <label>የምርት ፎቶ URL</label><input id="pPhoto" placeholder="https://...">
      <br><button class="btn btn-primary" type="submit" style="width:100%;margin-top:10px">💾 Save Product</button>
    </form>
  </div>
</div>

<div class="modal" id="channelModal">
  <div class="sheet">
    <button class="close-btn" onclick="closeModal('channelModal')">×</button>
    <h2>🔗 Channel / Group አገናኝ</h2>
    <form id="channelForm">
      <label>አይነት</label><select id="cType"><option value="Channel">📣 Channel</option><option value="Group">👥 Group</option></select>
      <label>የChannel / Group ስም</label><input id="cName" required placeholder="ምሳሌ፦ My Shop">
      <label>Username / Chat ID</label><input id="cId" required placeholder="@mychannel">
      <br><button class="btn btn-primary" type="submit" style="width:100%;margin-top:10px">🔗 Save Connection</button>
    </form>
  </div>
</div>

<div class="modal" id="adModal">
  <div class="sheet">
    <button class="close-btn" onclick="closeModal('adModal')">×</button>
    <h2>📢 አዲስ ማስታወቂያ (ወደ ቴሌግራም መላኪያ)</h2>
    <form id="adForm">
      <label>የማስታወቂያ አይነት</label>
      <select id="adType"><option>🔥 Hot Deal</option><option>🆕 New Product</option><option>💰 Discount</option></select>
      <label>ርዕስ</label><input id="adTitle" required placeholder="🔥 ልዩ ቅናሽ!">
      <label>መልዕክት</label><textarea id="adText" rows="4" required placeholder="የማስታወቂያ ዝርዝር..."></textarea>
      <label>የሚላክበት Channel / Group ይምረጡ</label><select id="adTarget" style="margin-bottom:10px"></select>
      <button class="btn btn-primary" type="submit" style="width:100%;">📤 በቀጥታ ወደ ቴሌግራም ፖስት አድርግ</button>
    </form>
  </div>
</div>

<script>
let data = {"products": [], "channels": [], "ads": [], "orders": []};

function loadData() {
    fetch('/api/load').then(r => r.json()).then(d => { if(d) { data = d; renderAll(); } });
}

function saveData() {
    fetch('/api/save', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    }).then(() => renderAll());
}

function money(v){ return Number(v||0).toLocaleString("en-US") + " ETB"; }
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

document.getElementById("productForm").addEventListener("submit", function(e){
    e.preventDefault();
    data.products.push({
        id: "P-" + Date.now(),
        name: document.getElementById("pName").value.trim(),
        buy: Number(document.getElementById("pBuy").value||0),
        sell: Number(document.getElementById("pSell").value||0),
        stock: Number(document.getElementById("pStock").value||0),
        photo: document.getElementById("pPhoto").value.trim()
    });
    saveData();
    closeModal("productModal");
    this.reset();
    alert("✅ ምርቱ ተጨምሯል።");
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
    alert("✅ Channel ተመዝግቧል።");
});

document.getElementById("adForm").addEventListener("submit", function(e){
    e.preventDefault();
    let title = document.getElementById("adTitle").value.trim();
    let text = document.getElementById("adText").value.trim();
    let type = document.getElementById("adType").value;
    let chatId = document.getElementById("adTarget").value;

    if(!chatId){ alert("እባክዎ መጀመሪያ Channel ያስገቡ!"); return; }

    let fullText = `${type}\\n\\n<b>${title}</b>\\n\\n${text}`;

    fetch('/api/telegram-post', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({chat_id: chatId, text: fullText})
    }).then(res => res.json()).then(resp => {
        if(resp.success){
            alert("✅ ማስታወቂያው በቀጥታ ወደ ቴሌግራም ተልኳል!");
            data.ads.push({id:"AD-"+Date.now(), title, text, status:"SENT"});
            saveData();
            closeModal("adModal");
            this.reset();
        } else {
            alert("❌ መላክ አልተቻለም: " + (resp.error || "ስህተት አጋጥሟል"));
        }
    });
});

function renderChannels(){
    let c = document.getElementById("channelList");
    let target = document.getElementById("adTarget");
    if(!data.channels.length){
        c.innerHTML = '<div class="empty">Channel አልተገናኘም።</div>';
        target.innerHTML = '<option value="">ቻናል የለም</option>';
        return;
    }
    c.innerHTML = data.channels.map((ch, idx) => `
      <div class="order-row"><div class="channel"><div class="channel-logo">📣</div>
      <div class="channel-info"><b>${escapeHTML(ch.name)}</b><small>${escapeHTML(ch.chatId)}</small></div></div>
      <button class="btn btn-red" onclick="data.channels.splice(${idx},1);saveData();">×</button></div>`).join("");
    
    target.innerHTML = data.channels.map(ch => `<option value="${escapeHTML(ch.chatId)}">${escapeHTML(ch.name)} (${escapeHTML(ch.chatId)})</option>`).join("");
}

function renderAll(){
    document.getElementById("productList").innerHTML = data.products.map(p => `<div class="card"><div class="product"><div class="product-photo">${p.photo?`<img src="${escapeHTML(p.photo)}">`:'📦'}</div><div class="product-info"><b>${escapeHTML(p.name)}</b><div class="price">${money(p.sell)}</div></div></div></div>`).join("") || '<div class="empty">ምርት የለም።</div>';
    renderChannels();
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

@app_flask.route("/api/save", methods=["POST"])
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
    
    req_data = request.json
    chat_id = req_data.get("chat_id")
    text = req_data.get("text")
    
    url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
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
    # ቦቱን ከበስተጀርባ ማስኬጃ ስሬድ (Thread) መጀመር
    t = threading.Thread(target=run_bot_background, daemon=True)
    t.start()
    
    port = int(os.environ.get("PORT", 5000))
    app_flask.run(host="0.0.0.0", port=port, debug=False)
