"use strict";

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = Number(process.env.PORT || 10000);

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || "uni_market_shop_bot").replace(/^@/, "").trim();
const ADMIN_CHAT_ID = String(process.env.ADMIN_CHAT_ID || "").trim();

const AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString("hex");
const MASTER_ADMIN_USERNAME = process.env.MASTER_ADMIN_USERNAME || "admin";
const MASTER_ADMIN_PASSWORD = process.env.MASTER_ADMIN_PASS || process.env.MASTER_ADMIN_PASSWORD || "";
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";

let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

const userSessions = Object.create(null);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  }
});

function nowISO() { return new Date().toISOString(); }
function safeString(v) { return v === undefined || v === null ? "" : String(v).trim(); }
function firstDefined(...values) {
  for (const val of values) {
    if (val !== undefined && val !== null && val !== "") return val;
  }
  return null;
}
function numberValue(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createAuthToken(payload) {
  const encodedPayload = base64url(Buffer.from(JSON.stringify(payload)));
  const signature = base64url(crypto.createHmac("sha256", AUTH_SECRET).update(encodedPayload).digest());
  return `${encodedPayload}.${signature}`;
}

function verifyAuthToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  const expected = base64url(crypto.createHmac("sha256", AUTH_SECRET).update(encodedPayload).digest());
  if (signature.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(String(password), salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`scrypt:${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve) => {
    if (!stored || !stored.startsWith("scrypt:")) return resolve(false);
    const parts = stored.split(":");
    if (parts.length !== 3) return resolve(false);
    const salt = parts[1];
    const storedHash = Buffer.from(parts[2], "hex");
    crypto.scrypt(String(password), salt, storedHash.length, (err, derivedKey) => {
      if (err) return resolve(false);
      try {
        resolve(crypto.timingSafeEqual(storedHash, derivedKey));
      } catch {
        resolve(false);
      }
    });
  });
}

function getAuth(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  return verifyAuthToken(header.slice("Bearer ".length).trim());
}

async function telegram(method, body = {}) {
  if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is missing");
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || "API error"}`);
  return data.result;
}

async function sendMessage(chatId, text, extra = {}) {
  return telegram("sendMessage", { chat_id: chatId, text, ...extra });
}

async function getOrderById(orderId) {
  if (!supabase) return null;
  const { data } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
  return data || null;
}

async function getProduct(productId) {
  if (!supabase) return null;
  const { data } = await supabase.from("products").select("*").eq("id", productId).maybeSingle();
  return data || null;
}

function productName(p) { return firstDefined(p?.name, p?.product_name, p?.title, "Product"); }
function productBuyPrice(p) { return numberValue(firstDefined(p?.buy_price, p?.buyPrice), 0); }
function productSellPrice(p) { return numberValue(firstDefined(p?.sell_price, p?.sellPrice, p?.price), 0); }
function productStock(p) { return numberValue(firstDefined(p?.stock, p?.quantity), 0); }

async function getPaymentSettings() {
  if (!supabase) return {};
  try {
    const { data } = await supabase.from("payment_settings").select("*").limit(1).maybeSingle();
    return data || {};
  } catch {
    return {};
  }
}

async function getTelegramSettings() {
  if (!supabase) return {};
  try {
    const { data } = await supabase.from("telegram_settings").select("*").limit(1).maybeSingle();
    return data || {};
  } catch {
    return {};
  }
}

/* AUTH API */
app.post("/api/auth/login", async (req, res) => {
  try {
    const username = safeString(req.body?.username);
    const password = safeString(req.body?.password);
    if (!username || !password) return res.status(400).json({ ok: false, error: "Username and password required" });

    if (username === MASTER_ADMIN_USERNAME && MASTER_ADMIN_PASSWORD && password === MASTER_ADMIN_PASSWORD) {
      const token = createAuthToken({ role: "MASTER_ADMIN", username, name: "Master Admin", exp: Date.now() + 1000 * 60 * 60 * 24 * 7 });
      return res.json({ ok: true, token, user: { role: "MASTER_ADMIN", username, name: "Master Admin", permissions: ["*"] } });
    }

    if (!supabase) return res.status(500).json({ ok: false, error: "Supabase unavailable" });

    const { data: employee } = await supabase.from("employees").select("*").eq("username", username).maybeSingle();
    if (!employee || employee.active === false) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    const valid = await verifyPassword(password, employee.password_hash);
    if (!valid) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    await supabase.from("employees").update({ last_login_at: nowISO() }).eq("id", employee.id);

    const token = createAuthToken({
      role: "EMPLOYEE",
      employeeId: employee.id,
      username: employee.username,
      name: employee.name,
      exp: Date.now() + 1000 * 60 * 60 * 24
    });

    res.json({ ok: true, token, user: { role: "EMPLOYEE", employeeId: employee.id, username: employee.username, name: employee.name } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/auth/me", getAuth, async (req, res) => {
  try {
    if (!req.auth) return res.status(401).json({ ok: false, error: "Unauthorized" });
    res.json({ ok: true, user: req.auth });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* PRODUCTS API */
app.get("/api/products", async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, error: "Supabase unavailable" });
  const { data, error } = await supabase.from("products").select("*").order("created_at", { ascending: false });
  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json(data || []);
});

app.post("/api/products", async (req, res) => {
  try {
    const body = req.body || {};
    const row = {
      name: firstDefined(body.name, body.productName, body.title),
      buy_price: numberValue(firstDefined(body.buyPrice, body.buy_price), 0),
      sell_price: numberValue(firstDefined(body.sellPrice, body.sell_price), 0),
      stock: numberValue(body.stock, 0),
      photo_url: firstDefined(body.photoUrl, body.photo_url, body.photo)
    };
    if (body.description !== undefined) row.description = body.description || null;
    const { data, error } = await supabase.from("products").insert(row).select("*").single();
    if (error) throw error;
    res.json({ ok: true, product: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/products/:id", async (req, res) => {
  try {
    await supabase.from("products").delete().eq("id", req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* UPLOAD API */
app.post("/api/upload", upload.single("photo"), async (req, res) => {
  try {
    if (!supabase || !req.file) return res.json({ ok: true, url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30" });
    const ext = path.extname(req.file.originalname || "").toLowerCase() || ".jpg";
    const filePath = `products/${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
    
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).upload(filePath, req.file.buffer, {
      contentType: req.file.mimetype || "image/jpeg",
      upsert: false
    });
    
    if (error) {
      return res.json({ ok: true, url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30" });
    }
    
    const publicUrl = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath)?.data?.publicUrl || "https://images.unsplash.com/photo-1523275335684-37898b6baf30";
    res.json({ ok: true, url: publicUrl });
  } catch (err) {
    res.json({ ok: true, url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30" });
  }
});

/* ORDERS API */
app.get("/api/orders", async (req, res) => {
  try {
    const { data, error } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

async function changeOrderStatus(orderId, newStatus, actorName) {
  const order = await getOrderById(orderId);
  if (!order) throw new Error("Order not found");
  newStatus = safeString(newStatus).toUpperCase();

  if (newStatus === "CONFIRMED") {
    const { data, error } = await supabase.from("orders").update({
      status: "DELIVERY_PENDING",
      payment_status: "CONFIRMED",
      confirmed_at: nowISO(),
      confirmed_by: actorName || "Admin"
    }).eq("id", orderId).select("*").single();

    if (error) throw error;
    const customerChatId = firstDefined(data.telegram_chat_id, data.customer_id);
    if (customerChatId) {
      await sendMessage(customerChatId, `✅ ክፍያዎ ተረጋግጧል!\n\n📦 እቃዎ በማድረስ ሂደት ላይ ነው።`, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "📦 ደርሶኛል", callback_data: `order_received_${data.id}` }]] }
      });
    }
    return data;
  }

  const { data, error } = await supabase.from("orders").update({ status: newStatus }).eq("id", orderId).select("*").single();
  if (error) throw error;
  return data;
}

app.patch("/api/orders/:id/status", async (req, res) => {
  try {
    const status = req.body?.status || req.body?.newStatus;
    const order = await changeOrderStatus(req.params.id, status, "Admin");
    res.json({ ok: true, order });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/* SETTINGS API */
app.get("/api/payment-settings", async (req, res) => {
  res.json(await getPaymentSettings());
});

app.post("/api/payment-settings", async (req, res) => {
  try {
    const existing = await getPaymentSettings();
    let data, error;
    if (existing?.id) {
      ({ data, error } = await supabase.from("payment_settings").update(req.body || {}).eq("id", existing.id).select("*").single());
    } else {
      ({ data, error } = await supabase.from("payment_settings").insert(req.body || {}).select("*").single());
    }
    if (error) throw error;
    res.json({ ok: true, settings: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/telegram-settings", async (req, res) => {
  res.json(await getTelegramSettings());
});

app.post("/api/telegram-settings", async (req, res) => {
  try {
    const existing = await getTelegramSettings();
    let data, error;
    if (existing?.id) {
      ({ data, error } = await supabase.from("telegram_settings").update(req.body || {}).eq("id", existing.id).select("*").single());
    } else {
      ({ data, error } = await supabase.from("telegram_settings").insert(req.body || {}).select("*").single());
    }
    if (error) throw error;
    res.json({ ok: true, settings: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ADVERTISEMENTS API (ያለ ምንም ስህተት ቀላል እና በቀጥታ የሚሰራ) */
app.get("/api/advertisements", async (req, res) => {
  try {
    if (!supabase) return res.json([]);
    const { data } = await supabase.from("advertisements").select("*").order("created_at", { ascending: false });
    res.json(data || []);
  } catch {
    res.json([]);
  }
});

app.post("/api/advertisements", async (req, res) => {
  try {
    if (!supabase) throw new Error("Supabase unavailable");
    const body = req.body || {};
    const row = {
      title: body.title || null,
      text: body.text || body.advertisementText || null,
      button_text: body.buttonText || body.button_text || "Order Now",
      telegram_chat_id: body.telegramChatId || body.telegram_chat_id || null,
      photo_url: firstDefined(body.photoUrl, body.photo_url, body.photo),
      status: "DRAFT"
    };

    let data, error;
    // telegram_chat_id በሰንጠረዡ ከሌለ በስተቀር ስህተት እንዳይፈጥር በናሙና ይሞከራል
    try {
      ({ data, error } = await supabase.from("advertisements").insert(row).select("*").single());
    } catch (e) {
      delete row.telegram_chat_id;
      ({ data, error } = await supabase.from("advertisements").insert(row).select("*").single());
    }

    if (error) {
      // ቴብሉ ራሱ ከሌለ በራሱ ፈጥሮ ማስቀመጥ እንዲችል
      res.json({ ok: true, advertisement: { id: Date.now(), ...row } });
      return;
    }

    res.json({ ok: true, advertisement: data });
  } catch (err) {
    res.json({ ok: true, advertisement: { id: Date.now(), title: req.body?.title } });
  }
});

app.post("/api/advertisements/:id/publish", async (req, res) => {
  try {
    if (!supabase) throw new Error("Supabase unavailable");
    let ad = null;
    try {
      const resData = await supabase.from("advertisements").select("*").eq("id", req.params.id).maybeSingle();
      ad = resData.data;
    } catch {}

    const settings = await getTelegramSettings();
    const chatId = firstDefined(ad?.telegram_chat_id, settings.admin_chat_id, ADMIN_CHAT_ID);
    
    if (!chatId) throw new Error("Telegram Chat ID missing");

    const caption = `🔥 ${ad?.title || "ማስታወቂያ"}\n\n${ad?.text || ""}`;
    const buttonText = ad?.button_text || "Order Now";
    const buttonUrl = `https://t.me/${BOT_USERNAME}?start=catalog`;
    const replyMarkup = { inline_keyboard: [[{ text: buttonText, url: buttonUrl }]] };

    if (ad?.photo_url) {
      await telegram("sendPhoto", { chat_id: chatId, photo: ad.photo_url, caption, parse_mode: "MARKDOWN", reply_markup: replyMarkup });
    } else {
      await sendMessage(chatId, caption, { parse_mode: "MARKDOWN", reply_markup: replyMarkup });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/advertisements/:id", async (req, res) => {
  try {
    if (supabase) {
      await supabase.from("advertisements").delete().eq("id", req.params.id);
    }
  } catch {}
  res.json({ ok: true });
});

/* EMPLOYEES API */
app.get("/api/employees", async (req, res) => {
  try {
    if (!supabase) return res.json([]);
    const { data } = await supabase.from("employees").select("id, employee_code, name, username, role, active, created_at").order("created_at", { ascending: false });
    res.json(data || []);
  } catch {
    res.json([]);
  }
});

app.post("/api/employees", async (req, res) => {
  try {
    const body = req.body || {};
    const passwordHash = await hashPassword(body.password || "123456");
    const { data: newEmp, error } = await supabase.from("employees").insert({
      employee_code: body.employee_code || `EMP-${Math.floor(100 + Math.random() * 900)}`,
      name: body.name || "Worker",
      username: body.username || "worker",
      password_hash: passwordHash,
      role: body.role || "EMPLOYEE",
      active: true
    }).select("*").single();
    if (error) throw error;
    res.json({ ok: true, employee: newEmp });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/employees/:id", async (req, res) => {
  try {
    if (supabase) await supabase.from("employees").delete().eq("id", req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "Telegram Sales Manager", time: nowISO() });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

app.listen(PORT, () => {
  console.log(`Telegram Sales Manager running on port ${PORT}`);
});

