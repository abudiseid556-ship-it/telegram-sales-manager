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
const SUPABASE_SERVICE_ROLE_KEY =
(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

const BOT_TOKEN =
(process.env.TELEGRAM_BOT_TOKEN || "").trim();

const BOT_USERNAME =
(process.env.TELEGRAM_BOT_USERNAME ||
"uni_market_shop_bot")
.replace(/^@/, "")
.trim();

const ADMIN_CHAT_ID =
String(process.env.ADMIN_CHAT_ID || "").trim();

const AUTH_SECRET =
process.env.AUTH_SECRET ||
crypto.randomBytes(32).toString("hex");

const MASTER_ADMIN_USERNAME =
process.env.MASTER_ADMIN_USERNAME || "admin";

const MASTER_ADMIN_PASSWORD =
process.env.MASTER_ADMIN_PASS ||
process.env.MASTER_ADMIN_PASSWORD ||
"123456";

const STORAGE_BUCKET =
process.env.SUPABASE_STORAGE_BUCKET ||
"product-images";

let supabase = null;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
supabase = createClient(
SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY,
{
auth: {
persistSession: false,
autoRefreshToken: false
}
}
);
}

/* ==================================================
FILE UPLOAD
================================================== */

const upload = multer({
storage: multer.memoryStorage(),
limits: {
fileSize: 8 * 1024 * 1024
},
fileFilter: (req, file, cb) => {
if (
!file.mimetype ||
!file.mimetype.startsWith("image/")
) {
return cb(
new Error("Only image files are allowed")
);
}

cb(null, true);

}
});

/* ==================================================
BOT SESSIONS
================================================== */

const botOrderSessions = new Map();

/*
Session:
{
step,
productId,
quantity,
customerName,
phone,
address
}
*/

/* ==================================================
HELPERS
================================================== */

function nowISO() {
return new Date().toISOString();
}

function safeString(v) {
return v === undefined || v === null
? ""
: String(v).trim();
}

function firstDefined(...values) {
for (const val of values) {
if (
val !== undefined &&
val !== null &&
val !== ""
) {
return val;
}
}

return null;
}

function numberValue(v, fallback = 0) {
const n = Number(v);
return Number.isFinite(n) ? n : fallback;
}

function base64url(buf) {
return buf
.toString("base64")
.replace(/+/g, "-")
.replace(///g, "_")
.replace(/=+$/g, "");
}

/* ==================================================
AUTH
================================================== */

function createAuthToken(payload) {
const encodedPayload = base64url(
Buffer.from(JSON.stringify(payload))
);

const signature = base64url(
crypto
.createHmac(
"sha256",
AUTH_SECRET
)
.update(encodedPayload)
.digest()
);

return "${encodedPayload}.${signature}";
}

function verifyAuthToken(token) {
if (
!token ||
typeof token !== "string"
) {
return null;
}

const parts = token.split(".");

if (parts.length !== 2) {
return null;
}

const [
encodedPayload,
signature
] = parts;

const expected = base64url(
crypto
.createHmac(
"sha256",
AUTH_SECRET
)
.update(encodedPayload)
.digest()
);

if (
signature.length !==
expected.length
) {
return null;
}

try {
if (
!crypto.timingSafeEqual(
Buffer.from(signature),
Buffer.from(expected)
)
) {
return null;
}

const payload =
  JSON.parse(
    Buffer.from(
      encodedPayload,
      "base64url"
    ).toString("utf8")
  );

if (
  payload.exp &&
  Date.now() > payload.exp
) {
  return null;
}

return payload;

} catch {
return null;
}
}

function hashPassword(password) {
return new Promise(
(resolve, reject) => {
const salt =
crypto
.randomBytes(16)
.toString("hex");

  crypto.scrypt(
    String(password),
    salt,
    64,
    (err, derivedKey) => {
      if (err) {
        return reject(err);
      }

      resolve(
        `scrypt:${salt}:${derivedKey.toString("hex")}`
      );
    }
  );
}

);
}

function verifyPassword(
password,
stored
) {
return new Promise(
(resolve) => {
if (
!stored ||
!stored.startsWith("scrypt:")
) {
return resolve(false);
}

  const parts =
    stored.split(":");

  if (parts.length !== 3) {
    return resolve(false);
  }

  const salt = parts[1];

  const storedHash =
    Buffer.from(
      parts[2],
      "hex"
    );

  crypto.scrypt(
    String(password),
    salt,
    storedHash.length,
    (err, derivedKey) => {
      if (err) {
        return resolve(false);
      }

      try {
        resolve(
          crypto.timingSafeEqual(
            storedHash,
            derivedKey
          )
        );
      } catch {
        resolve(false);
      }
    }
  );
}

);
}

function getAuth(
req,
res,
next
) {
const header =
req.headers.authorization || "";

if (
!header.startsWith(
"Bearer "
)
) {
req.auth = null;
return next();
}

const token =
header
.slice("Bearer ".length)
.trim();

req.auth =
verifyAuthToken(token);

next();
}

/* ==================================================
TELEGRAM
================================================== */

async function telegram(
method,
body = {}
) {
if (!BOT_TOKEN) {
throw new Error(
"TELEGRAM_BOT_TOKEN is missing"
);
}

const response =
await fetch(
"https://api.telegram.org/bot${BOT_TOKEN}/${method}",
{
method: "POST",
headers: {
"Content-Type":
"application/json"
},
body: JSON.stringify(body)
}
);

const data =
await response.json();

if (!data.ok) {
throw new Error(
"Telegram ${method}: ${ data.description || "API error" }"
);
}

return data.result;
}

async function sendMessage(
chatId,
text,
extra = {}
) {
return telegram(
"sendMessage",
{
chat_id: chatId,
text,
...extra
}
);
}

/* ==================================================
SUPABASE HELPERS
================================================== */

async function getOrderById(
orderId
) {
if (!supabase) {
return null;
}

const { data } =
await supabase
.from("orders")
.select("*")
.eq("id", orderId)
.maybeSingle();

return data || null;
}

async function getProduct(
productId
) {
if (!supabase) {
return null;
}

const { data } =
await supabase
.from("products")
.select("*")
.eq("id", productId)
.maybeSingle();

return data || null;
}

function productName(p) {
return firstDefined(
p?.name,
p?.product_name,
p?.title,
"ምርት"
);
}

function productBuyPrice(p) {
return numberValue(
firstDefined(
p?.buy_price,
p?.buyPrice
),
0
);
}

function productSellPrice(p) {
return numberValue(
firstDefined(
p?.sell_price,
p?.sellPrice,
p?.price
),
0
);
}

function productStock(p) {
return numberValue(
firstDefined(
p?.stock,
p?.quantity
),
0
);
}

/* ==================================================
SETTINGS
================================================== */

async function getPaymentSettings() {
if (!supabase) {
return {};
}

try {
const { data } =
await supabase
.from("payment_settings")
.select("*")
.limit(1)
.maybeSingle();

return data || {};

} catch {
return {};
}
}

async function getTelegramSettings() {
if (!supabase) {
return {};
}

try {
const { data } =
await supabase
.from("telegram_settings")
.select("*")
.limit(1)
.maybeSingle();

return data || {};

} catch {
return {};
}
}

/* ==================================================
AUTH API
================================================== */

app.post(
"/api/auth/login",
async (req, res) => {
try {
const username =
safeString(
req.body?.username
);

  const password =
    safeString(
      req.body?.password
    );

  if (
    !username ||
    !password
  ) {
    return res.status(400).json({
      ok: false,
      error:
        "Username and password required"
    });
  }

  if (
    username ===
      MASTER_ADMIN_USERNAME &&
    MASTER_ADMIN_PASSWORD &&
    password ===
      MASTER_ADMIN_PASSWORD
  ) {
    const token =
      createAuthToken({
        role: "MASTER_ADMIN",
        username,
        name: "Master Admin",
        exp:
          Date.now() +
          1000 *
            60 *
            60 *
            24 *
            7
      });

    return res.json({
      ok: true,
      token,
      user: {
        role: "MASTER_ADMIN",
        username,
        name: "Master Admin",
        permissions: ["*"]
      }
    });
  }

  if (!supabase) {
    return res.status(500).json({
      ok: false,
      error:
        "Supabase unavailable"
    });
  }

  const {
    data: employee
  } =
    await supabase
      .from("employees")
      .select("*")
      .eq("username", username)
      .maybeSingle();

  if (
    !employee ||
    employee.active === false
  ) {
    return res.status(401).json({
      ok: false,
      error:
        "Invalid credentials"
    });
  }

  const valid =
    await verifyPassword(
      password,
      employee.password_hash
    );

  if (!valid) {
    return res.status(401).json({
      ok: false,
      error:
        "Invalid credentials"
    });
  }

  await supabase
    .from("employees")
    .update({
      last_login_at:
        nowISO()
    })
    .eq(
      "id",
      employee.id
    );

  const token =
    createAuthToken({
      role: "EMPLOYEE",
      employeeId:
        employee.id,
      username:
        employee.username,
      name:
        employee.name,
      exp:
        Date.now() +
        1000 *
          60 *
          60 *
          24
    });

  return res.json({
    ok: true,
    token,
    user: {
      role: "EMPLOYEE",
      employeeId:
        employee.id,
      username:
        employee.username,
      name:
        employee.name
    }
  });

} catch (err) {
  return res.status(500).json({
    ok: false,
    error: err.message
  });
}

}
);

app.get(
"/api/auth/me",
getAuth,
async (req, res) => {
try {
if (!req.auth) {
return res.status(401).json({
ok: false,
error:
"Unauthorized"
});
}

  res.json({
    ok: true,
    user: req.auth
  });

} catch (err) {
  res.status(500).json({
    ok: false,
    error: err.message
  });
}

}
);

/* ==================================================
PRODUCTS
================================================== */

app.get(
"/api/products",
async (req, res) => {
if (!supabase) {
return res.status(500).json({
ok: false,
error:
"Supabase unavailable"
});
}

const {
  data,
  error
} =
  await supabase
    .from("products")
    .select("*")
    .order(
      "created_at",
      {
        ascending: false
      }
    );

if (error) {
  return res.status(500).json({
    ok: false,
    error: error.message
  });
}

res.json(data || []);

}
);

app.post(
"/api/products",
async (req, res) => {
try {
if (!supabase) {
return res.status(500).json({
ok: false,
error:
"Supabase unavailable"
});
}

  const body =
    req.body || {};

  const baseRow = {
    id: crypto.randomUUID(),

    name: firstDefined(
      body.name,
      body.productName,
      body.title
    ),

    buy_price:
      numberValue(
        firstDefined(
          body.buyPrice,
          body.buy_price
        ),
        0
      ),

    sell_price:
      numberValue(
        firstDefined(
          body.sellPrice,
          body.sell_price
        ),
        0
      ),

    stock:
      numberValue(
        body.stock,
        0
      ),

    photo_url:
      firstDefined(
        body.photoUrl,
        body.photo_url,
        body.photo
      )
  };

  const category =
    safeString(
      firstDefined(
        body.category,
        body.category_name,
        body.product_category
      )
    );

  let row = {
    ...baseRow
  };

  /*
   * category column ካለ ይቀመጣል።
   * ካልነበረ የቆየ schema እንዳይሰበር
   * ያለ category ይሞክራል።
   */

  if (category) {
    row.category =
      category;
  }

  let {
    data,
    error
  } =
    await supabase
      .from("products")
      .insert(row)
      .select("*")
      .single();

  if (
    error &&
    category &&
    /category|column/i.test(
      error.message || ""
    )
  ) {
    row = {
      ...baseRow
    };

    ({
      data,
      error
    } =
      await supabase
        .from("products")
        .insert(row)
        .select("*")
        .single());
  }

  if (error) {
    console.error(
      "PRODUCT CREATE ERROR:",
      error.message
    );

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }

  return res.json({
    ok: true,
    product: data,
    category_saved:
      Boolean(
        category &&
        data?.category
      )
  });

} catch (err) {
  console.error(
    "PRODUCT CREATE ERROR:",
    err.message
  );

  res.status(500).json({
    ok: false,
    error: err.message
  });
}

}
);

/* ==================================================
PRODUCT UPDATE
================================================== */

app.patch(
"/api/products/:id",
async (req, res) => {
try {
if (!supabase) {
return res.status(500).json({
ok: false,
error:
"Supabase unavailable"
});
}

  const body =
    req.body || {};

  const updates = {};

  if (
    body.name !== undefined ||
    body.productName !== undefined ||
    body.title !== undefined
  ) {
    updates.name =
      firstDefined(
        body.name,
        body.productName,
        body.title
      );
  }

  if (
    body.buyPrice !== undefined ||
    body.buy_price !== undefined
  ) {
    updates.buy_price =
      numberValue(
        firstDefined(
          body.buyPrice,
          body.buy_price
        ),
        0
      );
  }

  if (
    body.sellPrice !== undefined ||
    body.sell_price !== undefined
  ) {
    updates.sell_price =
      numberValue(
        firstDefined(
          body.sellPrice,
          body.sell_price
        ),
        0
      );
  }

  if (
    body.stock !== undefined
  ) {
    updates.stock =
      numberValue(
        body.stock,
        0
      );
  }

  if (
    body.photoUrl !== undefined ||
    body.photo_url !== undefined ||
    body.photo !== undefined
  ) {
    updates.photo_url =
      firstDefined(
        body.photoUrl,
        body.photo_url,
        body.photo
      );
  }

  const category =
    safeString(
      firstDefined(
        body.category,
        body.category_name,
        body.product_category
      )
    );

  if (category) {
    updates.category =
      category;
  }

  let {
    data,
    error
  } =
    await supabase
      .from("products")
      .update(updates)
      .eq(
        "id",
        req.params.id
      )
      .select("*")
      .single();

  if (
    error &&
    category &&
    /category|column/i.test(
      error.message || ""
    )
  ) {
    delete updates.category;

    ({
      data,
      error
    } =
      await supabase
        .from("products")
        .update(updates)
        .eq(
          "id",
          req.params.id
        )
        .select("*")
        .single());
  }

  if (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }

  res.json({
    ok: true,
    product: data
  });

} catch (err) {
  res.status(500).json({
    ok: false,
    error: err.message
  });
}

}
);

/* ==================================================
DELETE PRODUCT
================================================== */

app.delete(
"/api/products/:id",
async (req, res) => {
try {
if (!supabase) {
return res.status(500).json({
ok: false,
error:
"Supabase unavailable"
});
}

  const { error } =
    await supabase
      .from("products")
      .delete()
      .eq(
        "id",
        req.params.id
      );

  if (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }

  res.json({
    ok: true
  });

} catch (err) {
  res.status(500).json({
    ok: false,
    error: err.message
  });
}

}
);

/* ==================================================
UPLOAD
================================================== */

app.post(
"/api/upload",
upload.single("photo"),
async (req, res) => {
try {
if (!supabase) {
return res.status(500).json({
ok: false,
error:
"Supabase unavailable"
});
}

  if (!req.file) {
    return res.status(400).json({
      ok: false,
      error:
        "ፎቶ አልተመረጠም"
    });
  }

  const ext =
    path.extname(
      req.file.originalname ||
        ""
    ).toLowerCase() ||
    ".jpg";

  const filePath =
    `products/${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;

  const { error } =
    await supabase.storage
      .from(
        STORAGE_BUCKET
      )
      .upload(
        filePath,
        req.file.buffer,
        {
          contentType:
            req.file.mimetype ||
            "image/jpeg",
          upsert: false
        }
      );

  if (error) {
    console.error(
      "PRODUCT PHOTO UPLOAD ERROR:",
      error.message
    );

    return res.status(500).json({
      ok: false,
      error:
        "ፎቶው ወደ Storage መጫን አልተቻለም: " +
        error.message
    });
  }

  const publicUrl =
    supabase.storage
      .from(
        STORAGE_BUCKET
      )
      .getPublicUrl(
        filePath
      )
      ?.data
      ?.publicUrl;

  if (!publicUrl) {
    return res.status(500).json({
      ok: false,
      error:
        "የፎቶ ሊንክ መፍጠር አልተቻለም"
    });
  }

  res.json({
    ok: true,
    url: publicUrl
  });

} catch (err) {
  console.error(
    "UPLOAD ERROR:",
    err.message
  );

  res.status(500).json({
    ok: false,
    error: err.message
  });
}

}
);

/* ==================================================
PAYMENT SETTINGS
================================================== */

app.get(
"/api/payment-settings",
async (req, res) => {
res.json(
await getPaymentSettings()
);
}
);

app.post(
"/api/payment-settings",
async (req, res) => {
try {
const existing =
await getPaymentSettings();

  let data, error;

  if (existing?.id) {
    ({
      data,
      error
    } =
      await supabase
        .from(
          "payment_settings"
        )
        .update(
          req.body || {}
        )
        .eq(
          "id",
          existing.id
        )
        .select("*")
        .single());
  } else {
    ({
      data,
      error
    } =
      await supabase
        .from(
          "payment_settings"
        )
        .insert(
          req.body || {}
        )
        .select("*")
        .single());
  }

  if (error) {
    throw error;
  }

  res.json({
    ok: true,
    settings: data
  });

} catch (err) {
  res.status(500).json({
    ok: false,
    error: err.message
  });
}

}
);

/* ==================================================
TELEGRAM SETTINGS
================================================== */

app.get(
"/api/telegram-settings",
async (req, res) => {
res.json(
await getTelegramSettings()
);
}
);

app.post(
"/api/telegram-settings",
async (req, res) => {
try {
const existing =
await getTelegramSettings();

  let data, error;

  if (existing?.id) {
    ({
      data,
      error
    } =
      await supabase
        .from(
          "telegram_settings"
        )
        .update(
          req.body || {}
        )
        .eq(
          "id",
          existing.id
        )
        .select("*")
        .single());
  } else {
    ({
      data,
      error
    } =
      await supabase
        .from(
          "telegram_settings"
        )
        .insert(
          req.body || {}
        )
        .select("*")
        .single());
  }

  if (error) {
    throw error;
  }

  res.json({
    ok: true,
    settings: data
  });

} catch (err) {
  res.status(500).json({
    ok: false,
    error: err.message
  });
}

}
);

/* ==================================================
ADVERTISEMENTS
================================================== */

const AD_TYPES = {
normal: "📢 መደበኛ ማስታወቂያ",
new: "🆕 አዲስ ምርት",
discount: "🔥 ልዩ ቅናሽ",
limited_stock: "⚡ ውስን ስቶክ",
price_drop: "💰 የዋጋ ቅናሽ",
featured: "⭐ ተመራጭ ምርት"
};

app.get(
"/api/advertisement-types",
(req, res) => {
res.json({
ok: true,
types: AD_TYPES
});
}
);

app.get(
"/api/advertisements",
async (req, res) => {
try {
if (!supabase) {
return res.json([]);
}

  const {
    data,
    error
  } =
    await supabase
      .from(
        "advertisements"
      )
      .select("*")
      .order(
        "created_at",
        {
          ascending: false
        }
      );

  if (error) {
    console.error(
      "ADS LOAD ERROR:",
      error.message
    );

    return res.json([]);
  }

  res.json(
    data || []
  );

} catch {
  res.json([]);
}

}
);

app.post(
"/api/advertisements",
async (req, res) => {
try {
if (!supabase) {
throw new Error(
"Supabase unavailable"
);
}

  const body =
    req.body || {};

  const row = {
    title:
      firstDefined(
        body.title,
        body.adTitle
      ),

    text:
      firstDefined(
        body.text,
        body.advertisementText,
        body.description
      ),

    button_text:
      firstDefined(
        body.buttonText,
        body.button_text,
        "አሁን ይዘዙ"
      ),

    telegram_chat_id:
      firstDefined(
        body.target_chat_id,
        body.telegramChatId,
        body.telegram_chat_id
      ),

    photo_url:
      firstDefined(
        body.photoUrl,
        body.photo_url,
        body.photo
      ),

    status: "DRAFT"
  };

  /*
   * Optional fields.
   * Schema ውስጥ ካሉ ይቀመጣሉ።
   */

  const adType =
    safeString(
      body.ad_type ||
      body.adType ||
      "normal"
    );

  if (adType) {
    row.ad_type =
      adType;
  }

  if (
    body.product_id ||
    body.productId
  ) {
    row.product_id =
      firstDefined(
        body.product_id,
        body.productId
      );
  }

  let data, error;

  ({
    data,
    error
  } =
    await supabase
      .from(
        "advertisements"
      )
      .insert(row)
      .select("*")
      .single());

  /*
   * የአዲስ optional column
   * ችግር ካለ የቆየ schema
   * እንዳይሰበር።
   */

  if (error) {
    const fallbackRow = {
      title: row.title,
      text: row.text,
      button_text:
        row.button_text,
      telegram_chat_id:
        row.telegram_chat_id,
      photo_url:
        row.photo_url,
      status: "DRAFT"
    };

    ({
      data,
      error
    } =
      await supabase
        .from(
          "advertisements"
        )
        .insert(
          fallbackRow
        )
        .select("*")
        .single());
  }

  if (error) {
    throw error;
  }

  res.json({
    ok: true,
    advertisement: data
  });

} catch (err) {
  console.error(
    "ADVERTISEMENT CREATE ERROR:",
    err.message
  );

  res.status(500).json({
    ok: false,
    error: err.message
  });
}

}
);

/* ==================================================
PUBLISH AD
================================================== */

app.post(
"/api/advertisements/:id/publish",
async (req, res) => {
try {
if (!supabase) {
throw new Error(
"Supabase unavailable"
);
}

  const {
    data: ad,
    error: adError
  } =
    await supabase
      .from(
        "advertisements"
      )
      .select("*")
      .eq(
        "id",
        req.params.id
      )
      .maybeSingle();

  if (adError) {
    throw adError;
  }

  if (!ad) {
    throw new Error(
      "Advertisement not found"
    );
  }

  const settings =
    await getTelegramSettings();

  const chatId =
    firstDefined(
      ad.telegram_chat_id,
      settings.channel_chat_id,
      settings.channel_id,
      settings.admin_chat_id,
      ADMIN_CHAT_ID
    );

  if (!chatId) {
    throw new Error(
      "Telegram Channel / Chat ID missing"
    );
  }

  const adType =
    safeString(
      ad.ad_type ||
      "normal"
    );

  const typeLabel =
    AD_TYPES[adType] ||
    "";

  const caption =
    `${typeLabel ? typeLabel + "\n\n" : ""}` +
    `📢 <b>${ad.title || "UNI MARKET"}</b>\n\n` +
    `${ad.text || ""}`;

  const buttonText =
    ad.button_text ||
    "🛒 አሁን ይዘዙ";

  /*
   * Product-specific deep link
   * ካለ ወደ product ይሄዳል።
   * ካልሆነ catalog ይከፍታል።
   */

  const startValue =
    ad.product_id
      ? `product_${ad.product_id}`
      : "catalog";

  const buttonUrl =
    `https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(startValue)}`;

  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text:
            buttonText,
          url:
            buttonUrl
        }
      ]
    ]
  };

  if (ad.photo_url) {
    await telegram(
      "sendPhoto",
      {
        chat_id:
          chatId,
        photo:
          ad.photo_url,
        caption:
          caption,
        parse_mode:
          "HTML",
        reply_markup:
          replyMarkup
      }
    );
  } else {
    await sendMessage(
      chatId,
      caption,
      {
        parse_mode:
          "HTML",
        reply_markup:
          replyMarkup
      }
    );
  }

  /*
   * Publish status
   */

  try {
    await supabase
      .from(
        "advertisements"
      )
      .update({
        status:
          "PUBLISHED"
      })
      .eq(
        "id",
        req.params.id
      );
  } catch {}

  res.json({
    ok: true,
    chat_id: chatId
  });

} catch (err) {
  console.error(
    "ADVERTISEMENT PUBLISH ERROR:",
    err.message
  );

  res.status(500).json({
    ok: false,
    error: err.message
  });
}

}
);

app.delete(
"/api/advertisements/:id",
async (req, res) => {
try {
if (supabase) {
await supabase
.from(
"advertisements"
)
.delete()
.eq(
"id",
req.params.id
);
}

  res.json({
    ok: true
  });

} catch (err) {
  res.status(500).json({
    ok: false,
    error: err.message
  });
}

}
);

/* ==================================================
EMPLOYEES
================================================== */

app.get(
"/api/employees",
async (req, res) => {
try {
if (!supabase) {
return res.json([]);
}

  const {
    data
  } =
    await supabase
      .from("employees")
      .select(
        "id, employee_code, name, username, role, active, created_at"
      )
      .order(
        "created_at",
        {
          ascending: false
        }
      );

  res.json(
    data || []
  );

} catch {
  res.json([]);
}

}
);

app.post(
"/api/employees",
async (req, res) => {
try {
const body =
req.body || {};

  const passwordHash =
    await hashPassword(
      body.password ||
        "123456"
    );

  const {
    data: newEmp,
    error
  } =
    await supabase
      .from("employees")
      .insert({
        employee_code:
          body.employee_code ||
          `EMP-${Math.floor(
            100 +
            Math.random() *
              900
          )}`,

        name:
          body.name ||
          "Worker",

        username:
          body.username ||
          "worker",

        password_hash:
          passwordHash,

        role:
          body.role ||
          "EMPLOYEE",

        active:
          true
      })
      .select("*")
      .single();

  if (error) {
    throw error;
  }

  res.json({
    ok: true,
    employee:
      newEmp
  });

} catch (err) {
  res.status(500).json({
    ok: false,
    error: err.message
  });
}

}
);

app.delete(
"/api/employees/:id",
async (req, res) => {
try {
if (supabase) {
await supabase
.from("employees")
.delete()
.eq(
"id",
req.params.id
);
}

  res.json({
    ok: true
  });

} catch (err) {
  res.status(500).json({
    ok: false,
    error: err.message
  });
}

}
);

/* ==================================================
HEALTH
================================================== */

app.get(
"/api/health",
(req, res) => {
res.json({
ok: true,
service:
"Telegram Sales Manager",
time:
nowISO()
});
}
);

/* ==================================================
ADMIN PAGE
================================================== */

app.get(
"/",
(req, res) => {
res.sendFile(
path.join(
PUBLIC_DIR,
"admin.html"
)
);
}
);

/* ==================================================
TELEGRAM BOT
================================================== */

const TELEGRAM_WEBHOOK_URL =
(process.env.WEBHOOK_URL || "")
.trim();

const BOT_CATEGORIES = [
{
id: "clothes",
name: "👕 አልባሳት"
},
{
id: "electronics",
name: "📱 ኤሌክትሮኒክስ"
},
{
id: "children",
name: "🧒 የህፃናት"
},
{
id: "women",
name: "👩 የሴቶች"
},
{
id: "furniture",
name: "🛋️ የቤት እቃዎች"
},
{
id: "others",
name: "📦 ሌሎች"
}
];

/* ---------- Category keyboard ---------- */

function categoryKeyboard() {
return {
inline_keyboard: [
[
{
text:
"👕 አልባሳት",
callback_data:
"category_clothes"
},
{
text:
"📱 ኤሌክትሮኒክስ",
callback_data:
"category_electronics"
}
],
[
{
text:
"🧒 የህፃናት",
callback_data:
"category_children"
},
{
text:
"👩 የሴቶች",
callback_data:
"category_women"
}
],
[
{
text:
"🛋️ የቤት እቃዎች",
callback_data:
"category_furniture"
},
{
text:
"📦 ሌሎች",
callback_data:
"category_others"
}
]
]
};
}

/* ---------- Main dashboard ---------- */

async function sendCategoryDashboard(
chatId
) {
return sendMessage(
chatId,
"🛍️ <b>UNI MARKET</b>\n\n" +
"ለመግዛት የሚፈልጉትን የምርት ምድብ ይምረጡ፦",
{
parse_mode:
"HTML",
reply_markup:
categoryKeyboard()
}
);
}

/* ---------- Categories ---------- */

function normalizeCategory(
value
) {
return safeString(value)
.toLowerCase()
.replace(
/['’]/g,
""
)
.replace(
/\s+/g,
"_"
);
}

function getProductCategory(
product
) {
return normalizeCategory(
firstDefined(
product?.category,
product?.category_name,
product?.product_category,
product?.type,
"others"
)
);
}

function categoryMatches(
product,
category
) {
const pCategory =
getProductCategory(
product
);

const wanted =
normalizeCategory(
category
);

if (
wanted === "others"
) {
return ![
"clothes",
"clothing",
"cloth",
"electronics",
"electronic",
"children",
"childrens",
"kids",
"women",
"womens",
"woman",
"furniture"
].includes(
pCategory
);
}

const aliases = {
clothes: [
"clothes",
"clothing",
"cloth"
],

electronics: [
  "electronics",
  "electronic"
],

children: [
  "children",
  "childrens",
  "kids",
  "children_products"
],

women: [
  "women",
  "womens",
  "woman"
],

furniture: [
  "furniture"
]

};

return (
aliases[wanted] ||
[wanted]
).includes(
pCategory
);
}

/* ---------- Bot products ---------- */

async function getBotProducts(
category
) {
if (!supabase) {
return [];
}

try {
const {
data,
error
} =
await supabase
.from("products")
.select("*")
.order(
"created_at",
{
ascending: false
}
);

if (error) {
  console.error(
    "BOT PRODUCTS ERROR:",
    error.message
  );

  return [];
}

return (
  data || []
).filter(
  (product) =>
    categoryMatches(
      product,
      category
    )
);

} catch (err) {
console.error(
"BOT PRODUCTS ERROR:",
err.message
);

return [];

}
}

/* ---------- Product keyboard ---------- */

function productKeyboard(
products
) {
return {
inline_keyboard:
products.map(
(product) => [
{
text:
"🛍️ ${productName(product)}",
callback_data:
"product_${product.id}"
}
]
)
};
}

/* ---------- Category products ---------- */

async function showCategoryProducts(
chatId,
category
) {
const products =
await getBotProducts(
category
);

const categoryName =
BOT_CATEGORIES.find(
(item) =>
item.id ===
category
)?.name ||
"📦 ምርቶች";

if (!products.length) {
return sendMessage(
chatId,
"${categoryName}\n\n" +
"❌ በዚህ ምድብ ውስጥ አሁን ምንም ምርት የለም።\n\n" +
"👇 ሌላ ምድብ ይምረጡ።",
{
parse_mode:
"HTML",
reply_markup:
categoryKeyboard()
}
);
}

return sendMessage(
chatId,
"${categoryName}\n\n" +
"🛍️ <b>የሚገኙ ምርቶች</b>",
{
parse_mode:
"HTML",
reply_markup:
productKeyboard(
products
)
}
);
}

/* ---------- Product details ---------- */

async function showBotProduct(
chatId,
productId
) {
const product =
await getProduct(
productId
);

if (!product) {
return sendMessage(
chatId,
"❌ ምርቱ አልተገኘም።"
);
}

const name =
productName(product);

const price =
productSellPrice(
product
);

const stock =
productStock(
product
);

const photo =
firstDefined(
product.photo_url,
product.photo,
product.image_url
);

const text =
"🛍️ <b>${name}</b>\n\n" +
"💰 ዋጋ፦ <b>${price.toLocaleString()} ETB</b>\n" +
"📦 ያለው ብዛት፦ <b>${stock}</b>\n\n" +
(
stock > 0
? "🟢 አሁን ይገኛል"
: "🔴 ከStock ውጭ ነው"
);

const replyMarkup = {
inline_keyboard: [
...(stock > 0
? [
[
{
text:
"🛒 አሁን ይዘዙ",
callback_data:
"order_${product.id}"
}
]
]
: []),
[
{
text:
"⬅️ ወደ ምድቦች",
callback_data:
"show_categories"
}
]
]
};

if (photo) {
try {
return await telegram(
"sendPhoto",
{
chat_id:
chatId,
photo,
caption:
text,
parse_mode:
"HTML",
reply_markup:
replyMarkup
}
);

} catch {
  /* send text below */
}

}

return sendMessage(
chatId,
text,
{
parse_mode:
"HTML",
reply_markup:
replyMarkup
}
);
}

/* ==================================================
BOT ORDER FLOW
================================================== */

async function startBotOrder(
chatId,
productId
) {
const product =
await getProduct(
productId
);

if (!product) {
return sendMessage(
chatId,
"❌ ምርቱ አልተገኘም።"
);
}

const stock =
productStock(
product
);

if (stock <= 0) {
return sendMessage(
chatId,
"❌ ይህ ምርት አሁን ከStock ውጭ ነው።"
);
}

botOrderSessions.set(
String(chatId),
{
step:
"quantity",
productId,
quantity:
null,
customerName:
"",
phone:
"",
address:
""
}
);

return sendMessage(
chatId,
"🛒 <b>ኦርደር ማዘዣ</b>\n\n" +
"📦 ${productName(product)}\n" +
"💰 ${productSellPrice(product).toLocaleString()} ETB\n" +
"📦 ያለው Stock፦ ${stock}\n\n" +
"🔢 ምን ያህል ቁጥር መግዛት ይፈልጋሉ?",
{
parse_mode:
"HTML",
reply_markup: {
force_reply:
true
}
}
);
}

/* ---------- Order summary ---------- */

async function sendOrderSummary(
chatId,
session
) {
const product =
await getProduct(
session.productId
);

if (!product) {
botOrderSessions.delete(
String(chatId)
);

return sendMessage(
  chatId,
  "❌ ምርቱ አሁን አይገኝም።"
);

}

const unitPrice =
productSellPrice(
product
);

const total =
unitPrice *
session.quantity;

return sendMessage(
chatId,
"🧾 <b>የኦርደር ማጠቃለያ</b>\n\n" +
"📦 ምርት፦ <b>${productName(product)}</b>\n" +
"🔢 ብዛት፦ <b>${session.quantity}</b>\n" +
"💰 የአንዱ ዋጋ፦ <b>${unitPrice.toLocaleString()} ETB</b>\n" +
"💵 ጠቅላላ፦ <b>${total.toLocaleString()} ETB</b>\n\n" +
"👤 ስም፦ ${session.customerName}\n" +
"📱 ስልክ፦ ${session.phone}\n" +
"📍 አድራሻ፦ ${session.address}\n\n" +
"ኦርደሩን ለማረጋገጥ ከታች ይምረጡ።",
{
parse_mode:
"HTML",
reply_markup: {
inline_keyboard: [
[
{
text:
"✅ ኦርደሩን አረጋግጥ",
callback_data:
"order_confirm"
}
],
[
{
text:
"✏️ መረጃ ቀይር",
callback_data:
"order_edit"
},
{
text:
"❌ ሰርዝ",
callback_data:
"order_cancel"
}
]
]
}
}
);
}

/* ---------- Create order ---------- */

async function createBotOrder(
chatId,
message,
session
) {
if (!supabase) {
throw new Error(
"Supabase unavailable"
);
}

const product =
await getProduct(
session.productId
);

if (!product) {
throw new Error(
"Product not found"
);
}

const currentStock =
productStock(product);

if (
session.quantity <= 0 ||
session.quantity >
currentStock
) {
throw new Error(
"የሚፈልጉት ብዛት የለም። ያለው Stock ${currentStock} ነው።"
);
}

const unitPrice =
productSellPrice(
product
);

const total =
unitPrice *
session.quantity;

const username =
safeString(
message?.from
?.username
);

/*

* Existing orders schema
* ላይ የሚገኙ ዋና fields.
  */

const orderRow = {
id:
crypto.randomUUID(),

product_id:
  product.id,

product_name:
  productName(product),

quantity:
  session.quantity,

unit_price:
  unitPrice,

total:
  total,

customer_name:
  session.customerName,

phone:
  session.phone,

address:
  session.address,

telegram_chat_id:
  String(chatId),

telegram_username:
  username
    ? `@${username}`
    : null,

status:
  "NEW",

payment_status:
  "PENDING"

};

/*

* የorders schema ላይ
* አንዳንድ optional fields
* ካልነበሩ fallback እንሞክራለን።
  */

let {
data,
error
} =
await supabase
.from("orders")
.insert(
orderRow
)
.select("*")
.single();

if (error) {
const fallback = {
id:
orderRow.id,
product_id:
orderRow.product_id,
product_name:
orderRow.product_name,
quantity:
orderRow.quantity,
unit_price:
orderRow.unit_price,
total:
orderRow.total,
customer_name:
orderRow.customer_name,
telegram_chat_id:
orderRow.telegram_chat_id,
telegram_username:
orderRow.telegram_username,
status:
"NEW"
};

({
  data,
  error
} =
  await supabase
    .from("orders")
    .insert(
      fallback
    )
    .select("*")
    .single());

}

if (error) {
throw error;
}

/*

* Admin notification
  */

if (ADMIN_CHAT_ID) {
try {
await sendMessage(
ADMIN_CHAT_ID,
"🔔 <b>አዲስ ኦርደር</b>\n\n" +
"📦 ${productName(product)}\n" +
"🔢 ብዛት፦ ${session.quantity}\n" +
"💰 ጠቅላላ፦ ${total.toLocaleString()} ETB\n\n" +
"👤 ${session.customerName}\n" +
"📱 ${session.phone}\n" +
"📍 ${session.address}\n\n" +
"🆔 Order ID፦ ${data?.id || orderRow.id}",
{
parse_mode:
"HTML"
}
);
} catch (err) {
console.error(
"ADMIN ORDER NOTIFICATION ERROR:",
err.message
);
}
}

return data;
}

/* ---------- Callback queries ---------- */

async function handleBotCallback(
callback
) {
const callbackId =
callback.id;

const chatId =
callback.message
?.chat?.id;

const data =
safeString(
callback.data
);

if (!chatId) {
return;
}

try {
await telegram(
"answerCallbackQuery",
{
callback_query_id:
callbackId
}
);
} catch {}

/* Categories */

if (
data ===
"show_categories"
) {
return sendCategoryDashboard(
chatId
);
}

if (
data.startsWith(
"category_"
)
) {
const category =
data.replace(
"category_",
""
);

return showCategoryProducts(
  chatId,
  category
);

}

/* Product */

if (
data.startsWith(
"product_"
)
) {
const productId =
data.replace(
"product_",
""
);

return showBotProduct(
  chatId,
  productId
);

}

/* Start order */

if (
data.startsWith(
"order_"
) &&
data !==
"order_confirm" &&
data !==
"order_cancel" &&
data !==
"order_edit"
) {
const productId =
data.replace(
"order_",
""
);

return startBotOrder(
  chatId,
  productId
);

}

/* Confirm */

if (
data ===
"order_confirm"
) {
const key =
String(chatId);

const session =
  botOrderSessions.get(
    key
  );

if (!session) {
  return sendMessage(
    chatId,
    "❌ የኦርደር session አልተገኘም። እባክዎ እንደገና ምርት ይምረጡ።"
  );
}

try {
  const order =
    await createBotOrder(
      chatId,
      callback.message,
      session
    );

  botOrderSessions.delete(
    key
  );

  await sendMessage(
    chatId,
    `✅ <b>ኦርደርዎ ተመዝግቧል!</b>\n\n` +
    `🧾 Order ID፦ <b>${order?.id || "NEW"}</b>\n\n` +
    `ክፍያውን እና ቀጣይ መረጃዎችን በሚቀጥለው ደረጃ እንልክልዎታለን።`,
    {
      parse_mode:
        "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                "🛍️ ሌላ ምርት ይግዙ",
              callback_data:
                "show_categories"
            }
          ]
        ]
      }
    }
  );

} catch (err) {
  console.error(
    "BOT ORDER CREATE ERROR:",
    err.message
  );

  return sendMessage(
    chatId,
    `❌ ኦርደሩ ሊመዘገብ አልቻለም።\n\n${err.message}`
  );
}

return;

}

/* Edit */

if (
data ===
"order_edit"
) {
const session =
botOrderSessions.get(
String(chatId)
);

if (!session) {
  return sendCategoryDashboard(
    chatId
  );
}

session.step =
  "quantity";

return sendMessage(
  chatId,
  "🔢 እባክዎ እንደገና የሚፈልጉትን ብዛት ያስገቡ።",
  {
    reply_markup: {
      force_reply:
        true
    }
  }
);

}

/* Cancel */

if (
data ===
"order_cancel"
) {
botOrderSessions.delete(
String(chatId)
);

return sendMessage(
  chatId,
  "❌ ኦርደሩ ተሰርዟል።\n\n👇 ሌላ ምርት መምረጥ ይችላሉ።",
  {
    reply_markup:
      categoryKeyboard()
  }
);

}
}

/* ==================================================
BOT TEXT / ORDER STATE
================================================== */

async function handleBotMessage(
message
) {
const chatId =
message.chat?.id;

if (!chatId) {
return;
}

const text =
safeString(
message.text
);

const key =
String(chatId);

const session =
botOrderSessions.get(
key
);

/*

* Existing order flow
  */

if (session) {

if (
  text ===
  "/cancel"
) {
  botOrderSessions.delete(
    key
  );

  return sendMessage(
    chatId,
    "❌ ኦርደሩ ተሰርዟል።",
    {
      reply_markup:
        categoryKeyboard()
    }
  );
}

/* Quantity */

if (
  session.step ===
  "quantity"
) {
  const quantity =
    Number(
      text.replace(
        /,/g,
        ""
      )
    );

  if (
    !Number.isInteger(
      quantity
    ) ||
    quantity <= 0
  ) {
    return sendMessage(
      chatId,
      "❌ እባክዎ ትክክለኛ ቁጥር ያስገቡ። ለምሳሌ፦ 2",
      {
        reply_markup: {
          force_reply:
            true
        }
      }
    );
  }

  const product =
    await getProduct(
      session.productId
    );

  const stock =
    productStock(
      product
    );

  if (
    quantity >
    stock
  ) {
    return sendMessage(
      chatId,
      `❌ ያስገቡት ብዛት ከStock በላይ ነው።\n\n📦 ያለው፦ ${stock}`,
      {
        reply_markup: {
          force_reply:
            true
        }
      }
    );
  }

  session.quantity =
    quantity;

  session.step =
    "name";

  return sendMessage(
    chatId,
    "👤 እባክዎ ሙሉ ስምዎን ያስገቡ።",
    {
      reply_markup: {
        force_reply:
          true
      }
    }
  );
}

/* Name */

if (
  session.step ===
  "name"
) {
  if (
    text.length < 2
  ) {
    return sendMessage(
      chatId,
      "❌ እባክዎ ሙሉ ስምዎን ያስገቡ።",
      {
        reply_markup: {
          force_reply:
            true
        }
      }
    );
  }

  session.customerName =
    text;

  session.step =
    "phone";

  return sendMessage(
    chatId,
    "📱 እባክዎ የስልክ ቁጥርዎን ያስገቡ።",
    {
      reply_markup: {
        force_reply:
          true
      }
    }
  );
}

/* Phone */

if (
  session.step ===
  "phone"
) {
  const phone =
    text.replace(
      /[\s-]/g,
      ""
    );

  if (
    phone.length < 7
  ) {
    return sendMessage(
      chatId,
      "❌ እባክዎ ትክክለኛ ስልክ ቁጥር ያስገቡ።",
      {
        reply_markup: {
          force_reply:
            true
        }
      }
    );
  }

  session.phone =
    text;

  session.step =
    "address";

  return sendMessage(
    chatId,
    "📍 እባክዎ የመላኪያ አድራሻዎን ያስገቡ።",
    {
      reply_markup: {
        force_reply:
          true
      }
    }
  );
}

/* Address */

if (
  session.step ===
  "address"
) {
  if (
    text.length < 3
  ) {
    return sendMessage(
      chatId,
      "❌ እባክዎ የመላኪያ አድራሻዎን ያስገቡ።",
      {
        reply_markup: {
          force_reply:
            true
        }
      }
    );
  }

  session.address =
    text;

  session.step =
    "summary";

  return sendOrderSummary(
    chatId,
    session
  );
}

if (
  session.step ===
  "summary"
) {
  return sendOrderSummary(
    chatId,
    session
  );
}

}

/* /start */

if (
text ===
"/start" ||
text.startsWith(
"/start "
)
) {
const startArg =
text
.replace(
/^/start\s*/,
""
)
.trim();

if (
  startArg.startsWith(
    "product_"
  )
) {
  const productId =
    startArg.replace(
      "product_",
      ""
    );

  return showBotProduct(
    chatId,
    productId
  );
}

return sendCategoryDashboard(
  chatId
);

}

/* Menu */

if (
text ===
"/menu" ||
text ===
"/categories" ||
text.toLowerCase() ===
"menu" ||
text.toLowerCase() ===
"categories"
) {
return sendCategoryDashboard(
chatId
);
}

/* Normal text */

return sendCategoryDashboard(
chatId
);
}

/* ==================================================
TELEGRAM UPDATE
================================================== */

async function processTelegramUpdate(
update
) {
try {
if (
update.callback_query
) {
await handleBotCallback(
update.callback_query
);

  return;
}

if (
  update.message
) {
  await handleBotMessage(
    update.message
  );

  return;
}

} catch (err) {
console.error(
"TELEGRAM UPDATE ERROR:",
err.message
);
}
}

/* ==================================================
WEBHOOK
================================================== */

app.post(
"/api/telegram/webhook",
(req, res) => {
const update =
req.body;

res.sendStatus(200);

setImmediate(() => {
  processTelegramUpdate(
    update
  ).catch(
    (err) => {
      console.error(
        "BOT PROCESS ERROR:",
        err.message
      );
    }
  );
});

}
);

/* ==================================================
SET WEBHOOK
================================================== */

async function setupTelegramWebhook() {
if (
!BOT_TOKEN ||
!TELEGRAM_WEBHOOK_URL
) {
console.log(
"Telegram webhook not configured: BOT_TOKEN or WEBHOOK_URL missing"
);

return;

}

const webhookUrl =
"${TELEGRAM_WEBHOOK_URL.replace(/\/$/, "")}/api/telegram/webhook";

try {
const result =
await telegram(
"setWebhook",
{
url:
webhookUrl,

      allowed_updates: [
        "message",
        "callback_query"
      ],

      drop_pending_updates:
        false
    }
  );

console.log(
  "Telegram webhook configured:",
  webhookUrl
);

return result;

} catch (err) {
console.error(
"Telegram webhook setup failed:",
err.message
);
}
}

/* ==================================================
TELEGRAM STATUS
================================================== */

app.get(
"/api/telegram/status",
async (req, res) => {
try {
if (!BOT_TOKEN) {
return res.status(500).json({
ok: false,
connected: false,
error:
"TELEGRAM_BOT_TOKEN is missing"
});
}

  const me =
    await telegram(
      "getMe"
    );

  res.json({
    ok: true,
    connected:
      true,
    bot: me
  });

} catch (err) {
  res.status(500).json({
    ok: false,
    connected:
      false,
    error:
      err.message
  });
}

}
);

/* ==================================================
404
================================================== */

app.use(
(req, res) => {
res.status(404).json({
ok: false,
error:
"Not found"
});
}
);

/* ==================================================
START
================================================== */

app.listen(
PORT,
async () => {
console.log(
"Telegram Sales Manager running on port ${PORT}"
);

await setupTelegramWebhook();

}
);
