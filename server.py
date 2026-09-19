import os
import json
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
    return {"products": [], "orders": [], "customers": []}

def save_db(db):
    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)

FULL_HTML_CODE = """
<!doctype html>
<html lang="am">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#2563eb">
<title>Telegram Sales Manager V2</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Noto Sans Ethiopic",sans-serif;background:#f4f7fb;color:#172033;padding-bottom:82px}
button,input,select,textarea{font:inherit}button{border:0;cursor:pointer}.app{max-width:760px;margin:auto}.top{background:linear-gradient(135deg,#155eef,#6d5dfc);color:white;padding:22px 18px 26px;border-radius:0 0 28px 28px}.top h1{margin:0;font-size:23px}.top p{margin:5px 0 0;opacity:.85;font-size:13px}
.page{padding:16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.card{background:#fff;border-radius:18px;padding:16px;box-shadow:0 7px 25px #16325c12;margin-bottom:12px}.metric{min-height:112px}.metric small{color:#718096}.metric strong{display:block;font-size:23px;margin-top:9px}.section{display:flex;justify-content:space-between;align-items:center;margin:20px 2px 10px}.section h2{font-size:17px;margin:0}.btn{background:#2563eb;color:#fff;padding:11px 15px;border-radius:12px;font-weight:700}.btn.alt{background:#eef4ff;color:#1855c7}.btn.red{background:#feecec;color:#c62828}.btn.green{background:#eafaf0;color:#16823b}.btn.dark{background:#172033}.row{display:flex;gap:8px;align-items:center}.grow{flex:1}.muted{color:#718096;font-size:13px}.price{font-weight:800;color:#166534}.profit{font-weight:800;color:#0f766e}.form label{display:block;font-size:13px;font-weight:700;margin:10px 0 5px}.form input,.form select,.form textarea{width:100%;border:1px solid #dbe2ee;border-radius:11px;padding:11px;background:#fff;outline:none}.form textarea{min-height:120px;resize:vertical}.form input:focus,.form select:focus,.form textarea:focus{border-color:#4f7cff}.product{display:flex;gap:12px;align-items:center}.pic{width:68px;height:68px;border-radius:15px;object-fit:cover;background:#edf2f7;display:grid;place-items:center;font-size:25px;flex:none}.pill{font-size:11px;padding:5px 8px;border-radius:99px;background:#edf4ff;color:#2456b9}.nav{position:fixed;z-index:5;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #e5eaf2;display:flex;justify-content:center}.navin{width:760px;display:flex;justify-content:space-around}.nav button{background:none;color:#758197;padding:10px 7px 9px;font-size:11px}.nav button.active{color:#2563eb;font-weight:800}.nav b{display:block;font-size:20px;line-height:22px}.hidden{display:none!important}.empty{text-align:center;padding:25px;color:#7b8798}.hero{background:linear-gradient(135deg,#101a33,#263a6b);color:#fff}.hero .price{color:#facc15;font-size:26px}.actions{display:flex;gap:8px;flex-wrap:wrap}.search{margin-bottom:10px}.statline{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #edf0f5}.statline:last-child{border:0}.modal{position:fixed;inset:0;background:#0008;z-index:20;display:none;align-items:flex-end}.modal.show{display:flex}.sheet{background:#fff;width:100%;max-width:760px;margin:auto;border-radius:24px 24px 0 0;padding:18px;max-height:92vh;overflow:auto}.x{float:right;background:#eef2f7;border-radius:50%;width:34px;height:34px}.toast{position:fixed;z-index:30;left:50%;bottom:90px;transform:translateX(-50%);background:#172033;color:#fff;padding:11px 15px;border-radius:12px;display:none}.toast.show{display:block}
</style>
</head>
<body>
<div class="app">
<header class="top"><h1>📲 Telegram Sales Manager</h1><p>ምርት • ሽያጭ • ትርፍ • አውቶማቲክ ፖስት</p></header>
<main class="page">
<section id="dashboard" class="screen"></section>
<section id="products" class="screen hidden"></section>
<section id="orders" class="screen hidden"></section>
<section id="customers" class="screen hidden"></section>
<section id="telegram" class="screen hidden"></section>
<section id="reports" class="screen hidden"></section>
</main>
</div>

<nav class="nav"><div class="navin">
<button data-page="dashboard" class="active">🏠<b>⌂</b>ዋና</button>
<button data-page="products">📦<b>▣</b>ምርቶች</button>
<button data-page="orders">🛒<b>🛍</b>ሽያጭ</button>
<button data-page="telegram">📢<b>✈</b>Telegram</button>
<button data-page="reports">📊<b>▥</b>ሪፖርት</button>
</div></nav>

<div id="modal" class="modal"><div class="sheet"><button class="x" onclick="closeModal()">✕</button><div id="modalBody"></div></div></div>
<div id="toast" class="toast"></div>

<script>
let db = loadDbSync();
function loadDbSync(){
    let local = localStorage.getItem("tsm_v2_db");
    if(local) {
        try { return JSON.parse(local); } catch(e){}
    }
    return {"products":[],"orders":[],"customers":[]};
}

const save=()=>{
    localStorage.setItem("tsm_v2_db",JSON.stringify(db));
    fetch('/api/save', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(db)}).catch(e=>{});
    renderAll();
};

const money=n=>new Intl.NumberFormat("en-US",{maximumFractionDigits:0}).format(Number(n)||0)+" ETB";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const today=()=>new Date().toISOString().slice(0,10);
const profitOf=p=>(Number(p.sell)||0)-(Number(p.buy)||0);

function toast(t){let e=document.getElementById("toast");e.textContent=t;e.classList.add("show");setTimeout(()=>e.classList.remove("show"),1800)}
function nav(page){document.querySelectorAll(".screen").forEach(x=>x.classList.add("hidden"));document.getElementById(page).classList.remove("hidden");document.querySelectorAll(".nav button").forEach(x=>x.classList.toggle("active",x.dataset.page===page))}
document.querySelectorAll(".nav button").forEach(b=>b.onclick=()=>nav(b.dataset.page));
function openModal(html){document.getElementById("modalBody").innerHTML=html;document.getElementById("modal").classList.add("show")}
function closeModal(){document.getElementById("modal").classList.remove("show")}
document.getElementById("modal").onclick=e=>{if(e.target.id==="modal")closeModal()};

function resizeImage(file,cb){if(!file)return cb("");let r=new FileReader();r.onload=e=>{let im=new Image();im.onload=()=>{let max=800,s=Math.min(1,max/Math.max(im.width,im.height)),c=document.createElement("canvas");c.width=im.width*s;c.height=im.height*s;c.getContext("2d").drawImage(im,0,0,c.width,c.height);cb(c.toDataURL("image/jpeg",.78))};im.src=e.target.result};r.readAsDataURL(file)}

function productForm(id=""){
 let p=db.products.find(x=>x.id===id)||{name:"",qty:0,buy:0,sell:0,img:""};
 openModal(`<h2>${id?"✏️ ምርት አስተካክል":"➕ አዲስ ምርት"}</h2>
 <div class="form"><label>የምርት ፎቶ</label><input id="pimg" type="file" accept="image/*">
 <label>የምርት ስም</label><input id="pname" value="${esc(p.name)}" placeholder="ለምሳሌ የሴቶች ቦርሳ">
 <label>የተገዛ ብዛት</label><input id="pqty" type="number" min="0" value="${p.qty}">
 <label>የመግዣ ዋጋ / አንድ</label><input id="pbuy" type="number" min="0" value="${p.buy}">
 <label>የመሸጫ ዋጋ / አንድ</label><input id="psell" type="number" min="0" value="${p.sell}">
 <button class="btn" style="width:100%;margin-top:15px" onclick="saveProduct('${id}')">💾 አስቀምጥ</button></div>`);
}

function saveProduct(id){
 let name=document.getElementById("pname").value.trim(),qty=+document.getElementById("pqty").value,buy=+document.getElementById("pbuy").value,sell=+document.getElementById("psell").value,file=document.getElementById("pimg").files[0];
 if(!name||qty<0||buy<0||sell<0)return toast("እባክዎ መረጃውን ሙሉ ያድርጉ");
 let old=db.products.find(x=>x.id===id);
 let finish=img=>{if(old){old.name=name;old.qty=qty;old.buy=buy;old.sell=sell;if(img)old.img=img}else db.products.push({id:Date.now().toString(),name,qty,buy,sell,img:img||"",initialQty:qty});closeModal();save();toast("ምርቱ ተቀምጧል")};
 if(file)resizeImage(file,finish);else finish("");
}

function deleteProduct(id){if(db.orders.some(o=>o.productId===id))return toast("ይህ ምርት የሽያጭ መዝገብ አለው");if(confirm("ይህን ምርት መሰረዝ ይፈልጋሉ?")){db.products=db.products.filter(p=>p.id!==id);save()}}

function renderProducts(){
 let q=(document.getElementById("prodSearch")?.value||"").toLowerCase();
 let arr=db.products.filter(p=>p.name.toLowerCase().includes(q));
 document.getElementById("products").innerHTML=`<div class="section"><h2>📦 ምርቶች (${db.products.length})</h2><button class="btn" onclick="productForm()">＋ አዲስ</button></div>
 <input id="prodSearch" class="search form" style="width:100%;padding:11px;border:1px solid #dbe2ee;border-radius:11px" placeholder="🔎 ምርት ፈልግ" value="${esc(q)}" oninput="renderProducts()">
 ${arr.length?arr.map(p=>`<div class="card"><div class="product"><img class="pic" src="${p.img\vert{}\vert{}""}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><div class="pic" style="display:${p.img?'none':'grid'}">📦</div><div class="grow"><b>${esc(p.name)}</b><div class="muted">Stock: ${p.qty} • ትርፍ/አንድ: <span class="profit">${money(profitOf(p))}</span></div><div class="muted">መግዣ ${money(p.buy)} • መሸጫ ${money(p.sell)}</div></div></div><div class="actions" style="margin-top:12px"><button class="btn green" onclick="saleModal('${p.id}')">🛒 ሽያጭ</button><button class="btn alt" onclick="productForm('${p.id}')">✏️</button><button class="btn red" onclick="deleteProduct('${p.id}')">🗑</button></div></div>`).join(""):`<div class="card empty">📦 እስካሁን ምርት የለም<br><button class="btn" style="margin-top:12px" onclick="productForm()">አክል</button></div>`}`;
}

function saleModal(pid){
 let p=db.products.find(x=>x.id===pid);if(!p||p.qty<=0)return toast("ይህ ምርት ክምችት የለውም");
 openModal(`<h2>🛒 ሽያጭ መመዝገብ</h2><p><b>${esc(p.name)}</b> — Stock ${p.qty}</p><div class="form"><label>ብዛት</label><input id="oq" type="number" min="1" max="${p.qty}" value="1"><label>ደንበኛ</label><input id="oc" placeholder="ስም"><label>ስልክ</label><input id="op" placeholder="09..."><label>አካባቢ</label><input id="oa" placeholder="አካባቢ"><button class="btn" style="width:100%;margin-top:15px" onclick="saveSale('${pid}')">✅ ሽያጭ አስቀምጥ</button></div>`)
}

function saveSale(pid){
 let p=db.products.find(x=>x.id===pid),qty=+document.getElementById("oq").value;if(qty<1||qty>p.qty)return toast("የብዛቱ መረጃ ልክ አይደለም");
 let name=document.getElementById("oc").value.trim(),phone=document.getElementById("op").value.trim(),area=document.getElementById("oa").value.trim();
 p.qty-=qty;let total=p.sell*qty,profit=profitOf(p)*qty;db.orders.push({id:Date.now().toString(),productId:pid,productName:p.name,qty,total,profit,customer:name,phone,area,status:"Paid",date:new Date().toISOString()});
 closeModal();save();toast("ሽያጩ ተመዝግቧል");
}

function renderOrders(){
 let arr=[...db.orders].reverse();
 document.getElementById("orders").innerHTML=`<div class="section"><h2>🛒 ሽያጮች (${db.orders.length})</h2></div>
 ${arr.length?arr.map(o=>`<div class="card"><div class="row"><div class="grow"><b>${esc(o.productName)}</b><div class="muted">${new Date(o.date).toLocaleString("am-ET")} • ${esc(o.customer\vert{}\vert{}"ያልተጠቀሰ")}</div></div><span class="pill">${esc(o.status)}</span></div><div class="statline"><span>ብዛት</span><b>${o.qty}</b></div><div class="statline"><span>ሽያጭ</span><b>${money(o.total)}</b></div><div class="statline"><span>ትርፍ</span><b class="profit">${money(o.profit)}</b></div><div class="actions" style="margin-top:10px"><button class="btn red" onclick="deleteOrder('${o.id}')">🗑 ሰርዝ</button></div></div>`).join(""):`<div class="card empty">🛒 ሽያጭ የለም</div>`}`;
}

function deleteOrder(id){let o=db.orders.find(x=>x.id===id);if(!o)return;if(confirm("ሽያጩን ሰርዘው ክምችቱን መመለስ ይፈልጋሉ?")){let p=db.products.find(x=>x.id===o.productId);if(p)p.qty+=o.qty;db.orders=db.orders.filter(x=>x.id!==id);save()}}

function renderTelegram(){
 let opts=db.products.map(p=>`<option value="${p.id}">${esc(p.name)} — ${money(p.sell)}</option>`).join("");
 document.getElementById("telegram").innerHTML=`
 <div class="section"><h2>📢 ቴሌግራም አውቶማቲክ ፖስት</h2></div>
 <div class="card">
   <div class="form">
     <label>ምርት ይምረጡ</label><select id="tgP">${opts||'<option>ምርት የለም</option>'}</select>
     <label>የፖስት ዓይነት</label><select id="tgT"><option>🆕 አዲስ ምርት ገብቷል!</option><option>🔥 ልዩ ቅናሽ ማስታወቂያ</option><option>⏳ ውስን ቁጥር ያላቸው</option></select>
     <label>የቴሌግራም ቻናል ዩዘርናም (ወይም Chat ID)</label><input id="tgChat" placeholder="ለምሳሌ @mychannelname">
     <label>ተጨማሪ መልእክት</label><textarea id="tgNote">🚚 ለማዘዝ በውስጥ መስመር ያግኙን!</textarea>
     <button class="btn green" style="width:100%;margin-top:15px" onclick="sendAutoPost()">🚀 በቀጥታ ወደ ቴሌግራም ፖስት አድርግ</button>
   </div>
 </div>`;
}

function sendAutoPost(){
 let pid=document.getElementById("tgP").value;
 let p=db.products.find(x=>x.id===pid);
 if(!p)return toast("እባክዎ ምርት ይምረጡ");
 let type=document.getElementById("tgT").value;
 let chat=document.getElementById("tgChat").value.trim();
 let note=document.getElementById("tgNote").value.trim();
 if(!chat)return toast("እባክዎ የቻናል ዩዘርናም ያስገቡ");

 let text=`${type}\\n\\n✨ ስም: ${p.name}\\n💰 ዋጋ: ${money(p.sell)}\\n📦 የቀረ ብዛት: ${p.qty} ቁራጭ\\n\\n${note}`;

 fetch('/api/telegram-post', {
     method: 'POST',
     headers: {'Content-Type': 'application/json'},
     body: JSON.stringify({chat_id: chat, text: text})
 })
 .then(res => res.json())
 .then(data => {
     if(data.success) toast("✅ ማስታወቂያው ወደ ቴሌግራም ተልኳል!");
     else toast("❌ መላክ አልተቻለም: " + (data.error || "ስህተት አጋጥሟል"));
 })
 .catch(err => toast("❌ የኔትወርክ ስህተት አጋጥሟል"));
}

function renderReports(){
 let sales=db.orders.reduce((a,o)=>a+o.total,0),profit=db.orders.reduce((a,o)=>a+o.profit,0),stock=db.products.reduce((a,p)=>a+p.qty,0),sold=db.orders.reduce((a,o)=>a+o.qty,0);
 document.getElementById("reports").innerHTML=`<div class="section"><h2>📊 ሪፖርት</h2></div><div class="grid"><div class="card metric"><small>ጠቅላላ ሽያጭ</small><strong>${money(sales)}</strong></div><div class="card metric"><small>ጠቅላላ ትርፍ</small><strong class="profit">${money(profit)}</strong></div><div class="card metric"><small>የተሸጠ</small><strong>${sold}</strong></div><div class="card metric"><small>የቀረ Stock</small><strong>${stock}</strong></div></div>`;
}

function renderDashboard(){
 let d=today(),todayOrders=db.orders.filter(o=>o.date.slice(0,10)===d),sales=todayOrders.reduce((a,o)=>a+o.total,0),profit=todayOrders.reduce((a,o)=>a+o.profit,0),stock=db.products.reduce((a,p)=>a+p.qty,0),newO=db.orders.filter(o=>o.status==="New").length;
 document.getElementById("dashboard").innerHTML=`<div class="section"><h2>👋 ዛሬ እንዴት ነው?</h2><button class="btn" onclick="productForm()">＋ ምርት</button></div><div class="grid"><div class="card metric"><small>የዛሬ ሽያጭ</small><strong>${money(sales)}</strong></div><div class="card metric"><small>የዛሬ ትርፍ</small><strong class="profit">${money(profit)}</strong></div><div class="card metric"><small>የቀረ Stock</small><strong>${stock}</strong></div><div class="card metric"><small>አዲስ Orders</small><strong>${newO}</strong></div></div><div class="card hero"><h2>💰 የእርስዎ ትርፍ</h2><div class="price">${money(db.orders.reduce((a,o)=>a+o.profit,0))}</div><p>ትርፍ = የመሸጫ ዋጋ − የመግዣ ዋጋ</p></div>`;
}

function renderAll(){renderDashboard();renderProducts();renderOrders();renderTelegram();renderReports()}
fetch('/api/load').then(r=>r.json()).then(d=>{if(d && d.products){db=d;renderAll();}}).catch(e=>{});
renderAll();
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
.box{background:#fff;padding:22px;border-radius:16px;box-shadow:0 4px 15px rgba(0,0,0,0.05);width:320px}
input{width:100%;padding:11px;margin:10px 0;border:1px solid #ddd;border-radius:10px;box-sizing:border-box}
button{width:100%;padding:11px;background:#2563eb;color:#fff;border:0;border-radius:10px;font-weight:bold;cursor:pointer}
</style>
</head>
<body>
<div class="box">
  <h3>🔐 ዌብ ፓነል መግቢያ</h3>
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
    
    if not chat_id or not text:
        return {"success": False, "error": "Missing chat_id or text"}
    
    # ቴሌግራም ቦቱን በመጠቀም መልዕክቱን መላክ
    url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text.replace("\\n", "\n"),
        "parse_mode": "HTML"
    }
    
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
    port = int(os.environ.get("PORT", 5000))
    app_flask.run(host="0.0.0.0", port=port, debug=False)
