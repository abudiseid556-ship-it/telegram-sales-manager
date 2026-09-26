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

function requireAuth(req, res, next) {
  const auth = getAuth(req);
  if (!auth) return res.status(401).json({ ok: false, error: "Unauthorized" });
  req.auth = auth;
  next();
}

async function hasPermission(employeeId, permission) {
  if (!supabase || !employeeId) return false;
  const { data } = await supabase
    .from("employee_permissions")
    .select("permission")
    .eq("employee_id", employeeId)
    .eq("permission", permission)
    .maybeSingle();
  return !!data;
}

function requirePermission(permission) {
  return async (req, res, next) => {
    const auth = getAuth(req);
    if (!auth) return res.status(401).json({ ok: false, error: "Unauthorized" });
    req.auth = auth;
    if (auth.role === "MASTER_ADMIN") return next();
    if (!auth.employeeId) return res.status(403).json({ ok: false, error: "Permission denied" });
    const allowed = await hasPermission(auth.employeeId, permission);
    if (!allowed) return res.status(403).json({ ok: false, error: `Permission denied: ${permission}` });
    next();
  };
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
  const { data } = await supabase.from("payment_settings").select("*").limit(1).maybeSingle();
  return data || {};
}

async function getTelegramSettings() {
  if (!supabase) return {};
  const { data } = await supabase.from("telegram_settings").select("*").limit(1).maybeSingle();
  return data || {};
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

    const { data: permsData } = await supabase.from("employee_permissions").select("permission").eq("employee_id", employee.id);
    const permissions = (permsData || []).map(p => p.permission);

    const token = createAuthToken({
      role: "EMPLOYEE",
      employeeId: employee.id,
      username: employee.username,
      name: employee.name,
      employeeCode: employee.employee_code,
      permissions,
      exp: Date.now() + 1000 * 60 * 60 * 24
    });

    res.json({ ok: true, token, user: { role: "EMPLOYEE", employeeId: employee.id, employeeCode: employee.employee_code, username: employee.username, name: employee.name, permissions } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const user = { role: req.auth.role, username: req.auth.username, name: req.auth.name };
    if (req.auth.role === "EMPLOYEE") {
      user.employeeId = req.auth.employeeId;
      user.employeeCode = req.auth.employeeCode;
      user.permissions = req.auth.permissions || [];
    } else {
      user.permissions = ["*"];
    }
    res.json({ ok: true, user });
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

app.post("/api/products", requirePermission("products"), async (req, res) => {
  try {
    const body = req.body || {};
    const row = {
      name: firstDefined(body.name, body.productName, body.title),
      buy_price: numberValue(firstDefined(body.buyPrice, body.buy_price), 0),
      sell_price: numberValue(firstDefined(body.sellPrice, body.sell_price), 0),
      stock: numberValue(body.stock, 0),
      photo_url: firstDefined(body.photoUrl, body.photo_url, body.photo),
      description: body.description || null
    };
    const { data, error } = await supabase.from("products").insert(row).select("*").single();
    if (error) throw error;
    res.json({ ok: true, product: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch("/api/products/:id", requirePermission("products"), async (req, res) => {
  try {
    const body = req.body || {};
    const row = {};
    if (body.name !== undefined) row.name = firstDefined(body.name, body.productName, body.title);
    if (body.buyPrice !== undefined) row.buy_price = numberValue(body.buyPrice, 0);
    if (body.sellPrice !== undefined) row.sell_price = numberValue(body.sellPrice, 0);
    if (body.stock !== undefined) row.stock = numberValue(body.stock, 0);
    if (body.photoUrl !== undefined) row.photo_url = firstDefined(body.photoUrl, body.photo);
    if (body.description !== undefined) row.description = body.description || null;

    const { data, error } = await supabase.from("products").update(row).eq("id", req.params.id).select("*").single();
    if (error) throw error;
    res.json({ ok: true, product: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/products/:id", requirePermission("delete_product"), async (req, res) => {
  try {
    const { error } = await supabase.from("products").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* UPLOAD API */
app.post("/api/upload", requireAuth, upload.single("photo"), async (req, res) => {
  try {
    if (!supabase) throw new Error("Supabase unavailable");
    if (!req.file) return res.status(400).json({ ok: false, error: "No photo selected" });
    const ext = path.extname(req.file.originalname || "").toLowerCase() || ".jpg";
    const filePath = `products/${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).upload(filePath, req.file.buffer, {
      contentType: req.file.mimetype || "image/jpeg",
      upsert: false
    });
    if (error) return res.status(500).json({ ok: false, error: error.message });
    const publicUrl = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath)?.data?.publicUrl || null;
    res.json({ ok: true, url: publicUrl, path: data?.path || filePath });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
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

async function decrementStockSafe(productId, quantity) {
  if (!productId) return;
  const product = await getProduct(productId);
  if (!product) return;
  const currentStock = productStock(product);
  const newStock = Math.max(0, currentStock - quantity);
  await supabase.from("products").update({ stock: newStock }).eq("id", productId);
}

async function changeOrderStatus(orderId, newStatus, actorName) {
  const order = await getOrderById(orderId);
  if (!order) throw new Error("Order not found");
  newStatus = safeString(newStatus).toUpperCase();

  if (newStatus === "CONFIRMED") {
    const quantity = Math.max(1, numberValue(order.quantity, 1));
    const productId = firstDefined(order.product_id, order.productId);
    
    if (productId) {
      await decrementStockSafe(productId, quantity);
    }

    const { data, error } = await supabase.from("orders").update({
      status: "DELIVERY_PENDING",
      delivery_status: "PENDING",
      payment_status: "CONFIRMED",
      confirmed_at: nowISO(),
      confirmed_by: actorName || "Admin"
    }).eq("id", orderId).select("*").single();

    if (error) throw error;
    const customerChatId = firstDefined(data.telegram_chat_id, data.customer_id);
    if (customerChatId) {
      await sendMessage(customerChatId, `✅ ክፍያዎ ተረጋግጧል!\n\n📦 እቃዎ በማድረስ ሂደት ላይ ነው።\n\nምርቱ ሲደርስዎት <b>ደርሶኛል</b> የሚለውን ቁልፍ ይጫኑ።`, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "📦 ደርሶኛል", callback_data: `order_received_${data.id}` }]] }
      });
    }
    return data;
  }

  if (newStatus === "REJECTED") {
    const { data, error } = await supabase.from("orders").update({ status: "REJECTED", payment_status: "REJECTED", rejected_at: nowISO() }).eq("id", orderId).select("*").single();
    if (error) throw error;
    const customerChatId = firstDefined(data.telegram_chat_id, data.customer_id);
    if (customerChatId) await sendMessage(customerChatId, "❌ የክፍያ ደረሰኝዎ አልተረጋገጠም። እባክዎ ትክክለኛ ደረሰኝ ይላኩ።");
    return data;
  }

  const { data, error } = await supabase.from("orders").update({ status: newStatus }).eq("id", orderId).select("*").single();
  if (error) throw error;
  return data;
}

app.patch("/api/orders/:id/status", async (req, res) => {
  try {
    const status = req.body?.status || req.body?.newStatus;
    const order = await changeOrderStatus(req.params.id, status, req.auth?.username || "Admin");
    res.json({ ok: true, order });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/* SETTINGS API */
app.get("/api/payment-settings", async (req, res) => {
  res.json(await getPaymentSettings());
});

app.post("/api/payment-settings", requirePermission("payment_settings"), async (req, res) => {
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

app.post("/api/telegram-settings", requirePermission("telegram_settings"), async (req, res) => {
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

/* ADVERTISEMENTS & AUTO ADS API */
app.get("/api/advertisements", async (req, res) => {
  const { data } = await supabase.from("advertisements").select("*").order("created_at", { ascending: false });
  res.json(data || []);
});

app.post("/api/advertisements", requirePermission("advertising"), async (req, res) => {
  try {
    const body = req.body || {};
    const row = {
      product_id: body.productId || body.product_id || null,
      title: body.title || null,
      text: body.text || null,
      photo_url: firstDefined(body.photoUrl, body.photo_url, body.photo),
      button_text: body.buttonText || body.button_text || "🔥 አሁኑኑ ይዘዙን",
      telegram_chat_id: body.target_chat_id || body.telegramChatId || null,
      status: "DRAFT"
    };
    const { data, error } = await supabase.from("advertisements").insert(row).select("*").single();
    if (error) throw error;
    res.json({ ok: true, advertisement: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// አጓጊ እና ዘመናዊ ማስታወቂያ በራስ ሰር የማመንጨት እና የመልቀቅ ሎጂክ
async function triggerAutoAd() {
  try {
    if (!supabase) return;
    const { data: products } = await supabase.from("products").select("*").gt("stock", 0);
    if (!products || products.length === 0) return;

    const randomProduct = products[Math.floor(Math.random() * products.length)];
    const settings = await getTelegramSettings();
    const chatId = firstDefined(settings.admin_chat_id, ADMIN_CHAT_ID);
    if (!chatId) return;

    const hookPhrases = [
      "🔥 **ሊያልቅ ነው! እንዳያመልጥዎ!** ⏳",
      "⚡️ **የተወሰነ እቃ ብቻ የቀረበት አስደናቂ ቅናሽ!** 🏃‍♂️",
      "🚨 **ፍጠን ይዘዙን! እቃዎቹ በፍጥነት እየተሸጡ ናቸው!** 🛒",
      "✨ **ልዩ ዕድል! አሁኑኑ ባለቤት ይሁኑ!** 👇"
    ];
    const selectedHook = hookPhrases[Math.floor(Math.random() * hookPhrases.length)];

    const adText = `${selectedHook}\n\n🛍 **${productName(randomProduct)}**\n💰 ዋጋ: **${productSellPrice(randomProduct)} ETB**\n📦 የቀረ ክምችት: **${productStock(randomProduct)} ብቻ!**\n\n👇 ለመግዛት ከታች ያለውን ሊንክ ይጫኑ፡`;
    const buttonUrl = `https://t.me/${BOT_USERNAME}?start=product_${randomProduct.id}`;
    const replyMarkup = { inline_keyboard: [[{ text: "🛒 አሁኑኑ ይዘዙን (Buy Now)", url: buttonUrl }]] };

    if (randomProduct.photo_url) {
      await telegram("sendPhoto", { chat_id: chatId, photo: randomProduct.photo_url, caption: adText, parse_mode: "MARKDOWN", reply_markup: replyMarkup });
    } else {
      await sendMessage(chatId, adText, { parse_mode: "MARKDOWN", reply_markup: replyMarkup });
    }
  } catch (e) {
    console.error("Auto Ad Error:", e);
  }
}

// በየ 6 ሰዓቱ እራሱ ማስታወቂያ እንዲለቅ
setInterval(triggerAutoAd, 6 * 60 * 60 * 1000);

app.post("/api/advertisements/:id/publish", requirePermission("advertising"), async (req, res) => {
  try {
    const { data: ad } = await supabase.from("advertisements").select("*").eq("id", req.params.id).single();
    if (!ad) throw new Error("Ad not found");
    const settings = await getTelegramSettings();
    const chatId = firstDefined(ad.telegram_chat_id, settings.admin_chat_id, ADMIN_CHAT_ID);
    if (!chatId) throw new Error("Target chat ID missing");

    const productId = firstDefined(ad.product_id, ad.productId);
    const buttonUrl = productId ? `https://t.me/${BOT_USERNAME}?start=product_${productId}` : `https://t.me/${BOT_USERNAME}?start=catalog`;
    const replyMarkup = { inline_keyboard: [[{ text: ad.button_text || "🔥 አሁኑኑ ይዘዙን", url: buttonUrl }]] };

    let result;
    const adCaption = `🔥 **ሊያልቅ ነው! እንዳያመልጥዎ!**\n\n${ad.text || ad.title || ""}`;
    if (ad.photo_url) {
      result = await telegram("sendPhoto", { chat_id: chatId, photo: ad.photo_url, caption: adCaption, parse_mode: "MARKDOWN", reply_markup: replyMarkup });
    } else {
      result = await sendMessage(chatId, adCaption, { parse_mode: "MARKDOWN", reply_markup: replyMarkup });
    }

    const { data: updated } = await supabase.from("advertisements").update({ status: "PUBLISHED", published_at: nowISO(), telegram_message_id: result?.message_id || null }).eq("id", ad.id).select("*").single();
    res.json({ ok: true, advertisement: updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/advertisements/:id", requirePermission("advertising"), async (req, res) => {
  await supabase.from("advertisements").delete().eq("id", req.params.id);
  res.json({ ok: true });
});

/* EMPLOYEES & PERMISSIONS API */
app.get("/api/employees", async (req, res) => {
  const { data } = await supabase.from("employees").select("id, employee_code, name, username, role, active, created_at").order("created_at", { ascending: false });
  const employees = [];
  for (const emp of (data || [])) {
    const { data: perms } = await supabase.from("employee_permissions").select("permission").eq("employee_id", emp.id);
    employees.push({ ...emp, permissions: (perms || []).map(p => p.permission) });
  }
  res.json(employees);
});

app.post("/api/employees", requirePermission("employees"), async (req, res) => {
  try {
    const body = req.body || {};
    const passwordHash = await hashPassword(body.password);
    const { data: newEmp, error } = await supabase.from("employees").insert({
      employee_code: body.employee_code || `EMP-${Math.floor(100 + Math.random() * 900)}`,
      name: body.name,
      username: body.username,
      password_hash: passwordHash,
      role: body.role || "EMPLOYEE",
      active: true
    }).select("*").single();
    if (error) throw error;

    const permissions = Array.isArray(body.permissions) ? body.permissions : [];
    for (const perm of permissions) {
      await supabase.from("employee_permissions").insert({ employee_id: newEmp.id, permission: perm });
    }

    res.json({ ok: true, employee: { ...newEmp, permissions } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/employees/:id", requirePermission("employees"), async (req, res) => {
  await supabase.from("employee_permissions").delete().eq("employee_id", req.params.id);
  await supabase.from("employees").delete().eq("id", req.params.id);
  res.json({ ok: true });
});

/* REPORTS API */
app.get("/api/reports", async (req, res) => {
  try {
    const { data } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
    const orders = data || [];
    let totalSales = 0, totalProfit = 0, deliveredOrders = 0, pendingOrders = 0;
    for (const o of orders) {
      const status = safeString(o.status).toUpperCase();
      if (status === "DELIVERED" || status === "CLOSED") {
        totalSales += Number(o.total || 0);
        totalProfit += Number(o.profit || 0);
        deliveredOrders++;
      } else {
        pendingOrders++;
      }
    }
    res.json({ ok: true, summary: { totalOrders: orders.length, deliveredOrders, pendingOrders, totalSales, totalProfit }, orders });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "Telegram Sales Manager", supabase: !!supabase, telegram: !!BOT_TOKEN, time: nowISO() });
});

/* TELEGRAM WEBHOOK */
async function processTelegram(update) {
  try {
    if (!update) return;
    if (update.callback_query) {
      const callback = update.callback_query;
      const chatId = callback.message?.chat?.id;
      const fromId = callback.from?.id;
      const data = callback.data || "";
      if (!chatId) return;
      await telegram("answerCallbackQuery", { callback_query_id: callback.id });

      if (data.startsWith("admin_confirm_")) {
        const orderId = data.replace("admin_confirm_", "");
        await changeOrderStatus(orderId, "CONFIRMED", "Telegram Admin");
        await sendMessage(chatId, `✅ ኦርደር (ID: ${orderId}) በተሳካ ሁኔታ ተረጋግጧል!`);
        return;
      }
      if (data.startsWith("admin_reject_")) {
        const orderId = data.replace("admin_reject_", "");
        await changeOrderStatus(orderId, "REJECTED", "Telegram Admin");
        await sendMessage(chatId, `❌ ኦርደር (ID: ${orderId}) ተሰርዟል።`);
        return;
      }
      if (data.startsWith("order_received_")) {
        const orderId = data.replace("order_received_", "");
        const order = await getOrderById(orderId);
        if (!order) return;
        await changeOrderStatus(orderId, "DELIVERED", `Telegram User ${fromId}`);
        delete userSessions[chatId];
        await sendMessage(chatId, "🎉 እናመሰግናለን! እቃው እንደደረሰዎት ተረጋግጧል። ❤️");
        return;
      }
      if (data.startsWith("product_select_") || data.startsWith("product_")) {
        const productId = data.replace("product_select_", "").replace("product_", "");
        const product = await getProduct(productId);
        
        if (!product || productStock(product) <= 0) { 
          await sendMessage(chatId, "❌ ይቅርታ፣ ይህ እቃ አልቋል (Out of stock)።"); 
          return; 
        }

        userSessions[chatId] = { productId, product };
        await sendMessage(chatId, `🔥 <b>${productName(product)}</b>\n\n💰 ዋጋ: ${productSellPrice(product)} ETB\n📦 ክምችት: ${productStock(product)}\n\nብዛት ይምረጡ፦`, {
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: [[{ text: "1", callback_data: "qty_1" }, { text: "2", callback_data: "qty_2" }, { text: "3", callback_data: "qty_3" }]] }
        });
        return;
      }
      if (data.startsWith("qty_")) {
        const quantity = Number(data.replace("qty_", ""));
        const session = userSessions[chatId];
        if (!session || !session.product) {
          await sendMessage(chatId, "❌ ክፍለ ጊዜው አብቅቷል። /start ይበሉ።");
          return;
        }

        if (quantity > productStock(session.product)) {
          await sendMessage(chatId, `❌ ይቅርታ! የሚገኘው ክምችት (${productStock(session.product)}) ብቻ ነው።`);
          return;
        }

        session.quantity = quantity;
        session.step = "NAME";
        await sendMessage(chatId, "👤 ሙሉ ስምዎን (Full Name) ይጻፉ።");
        return;
      }
      if (data === "order_confirm") {
        const session = userSessions[chatId];
        if (!session || !session.product) {
          await sendMessage(chatId, "❌ መረጃው አልተገኘም። እባክዎ እንደገና ይጀምሩ።");
          return;
        }
        const p = session.product;
        const quantity = Number(session.quantity || 1);

        const latestProduct = await getProduct(p.id);
        if (!latestProduct || productStock(latestProduct) < quantity) {
          delete userSessions[chatId];
          await sendMessage(chatId, "❌ ይቅርታ፣ እቃው ባለቀ ሰዓት ስለተያዘ መመዝገብ አልተቻለም።");
          return;
        }

        const sellPrice = productSellPrice(p);
        const buyPrice = productBuyPrice(p);
        const total = sellPrice * quantity;
        const profit = (sellPrice - buyPrice) * quantity;

        const { data: order, error } = await supabase.from("orders").insert({
          product_id: p.id,
          product_name: productName(p),
          customer_name: session.name || "Customer",
          phone: session.phone || "",
          telegram_chat_id: String(chatId),
          customer_id: String(chatId),
          quantity,
          buy_price: buyPrice,
          sell_price: sellPrice,
          total,
          profit,
          address: session.address || "",
          status: "PAYMENT_PENDING",
          payment_status: "PENDING",
          delivery_status: "PENDING"
        }).select("*").single();

        if (error) throw error;
        delete userSessions[chatId];

        const payment = await getPaymentSettings();
        const paymentText = `🧾 ኦርደርዎ ተመዝግቧል!\n\n🛍 ${productName(p)} (×${quantity})\n💰 ጠቅላላ: ${total} ETB\n\n🏦 ባንክ: ${payment.bank_name || "Commercial Bank"}\n👤 ስም: ${payment.account_name || "UNI MARKET"}\n💳 አካውንት: ${payment.account_number || "1000..."}\n\nክፍያውን ከፈጸሙ በኋላ ደረሰኙን (Receipt) ፎቶ ይላኩ።`;
        await sendMessage(chatId, paymentText);

        const targetAdmin = ADMIN_CHAT_ID || chatId;
        await sendMessage(targetAdmin, `🆕 <b>NEW ORDER</b>\n\n🆔 ${order.id}\n🛍 ${productName(p)}\n👤 ${order.customer_name}\n📱 ${order.phone}\n🔢 ${quantity}\n💰 ${total} ETB`, {
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: [[{ text: "✅ Confirm", callback_data: `admin_confirm_${order.id}` }, { text: "❌ Reject", callback_data: `admin_reject_${order.id}` }]] }
        });
        return;
      }
      return;
    }

    const message = update.message;
    if (!message) return;
    const chatId = message.chat.id;
    const textMessage = String(message.text || "").trim();

    if (message.photo && message.photo.length) {
      const photo = message.photo[message.photo.length - 1];
      
      let { data: orders } = await supabase
        .from("orders")
        .select("*")
        .eq("telegram_chat_id", String(chatId))
        .order("created_at", { ascending: false })
        .limit(1);

      let order = orders && orders.length ? orders[0] : null;

      if (!order) {
        const { data: altOrders } = await supabase
          .from("orders")
          .select("*")
          .eq("customer_id", String(chatId))
          .order("created_at", { ascending: false })
          .limit(1);
        if (altOrders && altOrders.length) order = altOrders[0];
      }

      if (!order) {
        await sendMessage(chatId, "❌ ንቁ ኦርደር አልተገኘም። መጀመሪያ እቃ ይምረጡ።");
        return;
      }

      await supabase.from("orders").update({ 
        status: "RECEIPT_PENDING", 
        payment_status: "RECEIPT_PENDING", 
        receipt_file_id: photo.file_id,
        telegram_chat_id: String(chatId),
        customer_id: String(chatId)
      }).eq("id", order.id);

      await sendMessage(chatId, "✅ ደረሰኙ ደርሶናልር። አድሚን እስኪያረጋግጥ ይጠብቁ።");

      const targetAdmin = ADMIN_CHAT_ID || chatId;
      await sendMessage(targetAdmin, `🧾 <b>አዲስ Receipt መጥቷል</b>\n\n🆔 ${order.id}\n🛍 ${order.product_name}\n👤 ${order.customer_name}\n💰 ${order.total} ETB`, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "✅ Confirm", callback_data: `admin_confirm_${order.id}` }, { text: "❌ Reject", callback_data: `admin_reject_${order.id}` }]] }
      });
      try {
        await telegram("sendPhoto", { chat_id: targetAdmin, photo: photo.file_id, caption: `Receipt for Order ${order.id}` });
      } catch (e) {}
      return;
    }

    if (textMessage === "/start" || textMessage.startsWith("/start ")) {
      const parts = textMessage.split(/\s+/);
      const startParam = parts[1] || "";
      if (startParam.startsWith("product_")) {
        const productId = startParam.replace("product_", "");
        const product = await getProduct(productId);
        
        if (!product || productStock(product) <= 0) { 
          await sendMessage(chatId, "❌ ይቅርታ፣ ይህ እቃ አልቋል (Out of stock)።"); 
          return; 
        }

        userSessions[chatId] = { productId, product };
        await sendMessage(chatId, `🔥 <b>${productName(product)}</b>\n\n💰 ዋጋ: ${productSellPrice(product)} ETB\n📦 ክምችት: ${productStock(product)}`, {
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: [[{ text: "1", callback_data: "qty_1" }, { text: "2", callback_data: "qty_2" }, { text: "3", callback_data: "qty_3" }]] }
        });
        return;
      }
      if (startParam === "catalog" || textMessage === "🛒 ምርቶች") {
        const { data: prods } = await supabase.from("products").select("*").gt("stock", 0).limit(10);
        if (!prods || prods.length === 0) { await sendMessage(chatId, "❌ ምንም የሚገኝ እቃ የለም።"); return; }
        const keyboard = prods.map(p => [{ text: `${productName(p)} - ${productSellPrice(p)} ETB`, callback_data: `product_select_${p.id}` }]);
        await sendMessage(chatId, "🛒 የሚፈልጉትን ምርት ይምረጡ፦", { reply_markup: { inline_keyboard: keyboard } });
        return;
      }
      await sendMessage(chatId, "🛒 እንኳን ወደ <b>UNI MARKET</b> በደህና መጡ!", {
        parse_mode: "HTML",
        reply_markup: { keyboard: [[{ text: "🛒 ምርቶች" }]], resize_keyboard: true }
      });
      return;
    }

    if (textMessage === "🛒 ምርቶች") {
      const { data: prods } = await supabase.from("products").select("*").gt("stock", 0).limit(10);
      if (!prods || prods.length === 0) { await sendMessage(chatId, "❌ ምንም የሚገኝ እቃ የለም።"); return; }
      const keyboard = prods.map(p => [{ text: `${productName(p)} - ${productSellPrice(p)} ETB`, callback_data: `product_select_${p.id}` }]);
      await sendMessage(chatId, "🛒 የሚፈልጉትን ምርት ይምረጡ፦", { reply_markup: { inline_keyboard: keyboard } });
      return;
    }

    const session = userSessions[chatId];
    if (session) {
      if (session.step === "NAME") {
        session.name = textMessage;
        session.step = "PHONE";
        await sendMessage(chatId, "📞 ስልክ ቁጥርዎን ይጻፉ።");
        return;
      }
      if (session.step === "PHONE") {
        session.phone = textMessage;
        session.step = "ADDRESS";
        await sendMessage(chatId, "📍 የመላኪያ አድራሻዎን ይጻፉ።");
        return;
      }
      if (session.step === "ADDRESS") {
        session.address = textMessage;
        session.step = "REVIEW";
        const p = session.product;
        const qty = Number(session.quantity || 1);
        const total = productSellPrice(p) * qty;
        await sendMessage(chatId, `🧾 <b>የኦርደር ማረጋገጫ</b>\n\n🛍 እቃ: ${productName(p)}\n🔢 ብዛት: ${qty}\n👤 ስም: ${session.name}\n📞 ስልክ: ${session.phone}\n📍 አድራሻ: ${session.address}\n💰 ድምር: ${total} ETB`, {
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: [[{ text: "✅ ኦርደር አረጋግጥ", callback_data: "order_confirm" }], [{ text: "❌ ሰርዝ", callback_data: "cancel" }]] }
        });
        return;
      }
    }
  } catch (err) {
    console.error("Webhook Error:", err);
  }
}

app.post("/telegram/webhook", async (req, res) => {
  res.json({ ok: true });
  await processTelegram(req.body);
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
