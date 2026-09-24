const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.set("trust proxy", 1);

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = Number(process.env.PORT || 10000);

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
).trim();

const BOT_TOKEN = String(
  process.env.TELEGRAM_BOT_TOKEN || ""
).trim();

const BOT_USERNAME = String(
  process.env.TELEGRAM_BOT_USERNAME || "uni_market_shop_bot"
)
  .replace("@", "")
  .trim();

const WEBHOOK_URL = String(process.env.WEBHOOK_URL || "")
  .replace(/\/$/, "")
  .trim();

const ADMIN_CHAT_ID = String(
  process.env.ADMIN_CHAT_ID ||
  process.env.ADMIN_CHAT_id ||
  ""
).trim();

const MASTER_USERNAME = String(
  process.env.MASTER_ADMIN_USERNAME || "admin"
).trim();

const masterPassKey = Object.keys(process.env).find((key) =>
  key.toUpperCase().startsWith("MASTER_ADMIN_PASS")
);

const MASTER_PASSWORD = masterPassKey
  ? String(process.env[masterPassKey] || "")
  : String(process.env.WEB_PASSWORD || "");

const AUTH_SECRET = String(
  SUPABASE_SERVICE_ROLE_KEY || "telegram-sales-manager-secret"
);

if (!SUPABASE_URL) {
  console.error("❌ SUPABASE_URL is missing");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY is missing");
}

if (!BOT_TOKEN) {
  console.error("⚠️ TELEGRAM_BOT_TOKEN is missing");
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

/* =========================================================
   UPLOAD
========================================================= */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024
  }
});

/* =========================================================
   SESSION
========================================================= */

const sessions = new Map();

/* =========================================================
   PERMISSIONS
========================================================= */

const PERMISSIONS = [
  "view_orders",
  "verify_payment",
  "confirm_order",
  "products",
  "delete_product",
  "advertising",
  "payment_settings",
  "telegram_settings",
  "employees",
  "reports"
];

/* =========================================================
   HELPERS
========================================================= */

function b64(value) {
  return Buffer.from(String(value)).toString("base64url");
}

function tokenSign(payload) {
  const body = b64(JSON.stringify(payload));

  const signature = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(body)
    .digest("base64url");

  return `${body}.${signature}`;
}

function tokenVerify(token) {
  try {
    const parts = String(token || "").split(".");

    if (parts.length !== 2) return null;

    const [body, signature] = parts;

    if (!body || !signature) return null;

    const expected = crypto
      .createHmac("sha256", AUTH_SECRET)
      .update(body)
      .digest("base64url");

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);

    if (a.length !== b.length) return null;

    if (!crypto.timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    );

    if (!payload.exp) return null;

    if (Date.now() > Number(payload.exp)) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}

function getAuth(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return tokenVerify(header.slice(7));
}

function requireAuth(req, res, next) {
  const auth = getAuth(req);

  if (!auth) {
    return res.status(401).json({
      error: "የመግቢያ ፍቃድ የለም።"
    });
  }

  req.auth = auth;
  next();
}

function requireMaster(req, res, next) {
  const auth = getAuth(req);

  if (!auth || auth.role !== "master") {
    return res.status(403).json({
      error: "Master Admin ብቻ የሚፈቀድ ነው።"
    });
  }

  req.auth = auth;
  next();
}

async function hasPermission(auth, permission) {
  if (!auth) return false;

  if (auth.role === "master") {
    return true;
  }

  if (!auth.employeeId) {
    return false;
  }

  const { data, error } = await supabase
    .from("employee_permissions")
    .select("enabled")
    .eq("employee_id", auth.employeeId)
    .eq("permission", permission)
    .maybeSingle();

  if (error) {
    console.error("Permission error:", error);
    return false;
  }

  return data?.enabled === true;
}

function requirePermission(permission) {
  return async (req, res, next) => {
    const auth = getAuth(req);

    if (!auth) {
      return res.status(401).json({
        error: "Login ያስፈልጋል።"
      });
    }

    if (auth.role === "master") {
      req.auth = auth;
      return next();
    }

    const allowed = await hasPermission(auth, permission);

    if (!allowed) {
      return res.status(403).json({
        error: `ይህን ስራ ለመስራት ${permission} Permission የለህም።`
      });
    }

    req.auth = auth;
    next();
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");

  const hash = crypto
    .scryptSync(String(password), salt, 64)
    .toString("hex");

  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, storedHash] = String(stored || "").split(":");

    if (!salt || !storedHash) {
      return false;
    }

    const calculated = crypto
      .scryptSync(String(password), salt, 64)
      .toString("hex");

    const a = Buffer.from(storedHash, "hex");
    const b = Buffer.from(calculated, "hex");

    if (a.length !== b.length) {
      return false;
    }

    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/* =========================================================
   TELEGRAM
========================================================= */

async function telegram(method, data = {}) {
  if (!BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN አልተዘጋጀም።");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(data)
    }
  );

  return response.json();
}

async function sendMessage(chatId, text, extra = {}) {
  if (!BOT_TOKEN || !chatId) {
    return null;
  }

  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    ...extra
  });
}

/* =========================================================
   SETTINGS
========================================================= */

async function getTelegramSettings() {
  const { data, error } = await supabase
    .from("telegram_settings")
    .select("*")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  return data || {};
}

async function saveTelegramSettings(values) {
  const old = await getTelegramSettings();

  const payload = {
    ...values,
    bot_username: BOT_USERNAME,
    updated_at: new Date().toISOString()
  };

  if (old?.id) {
    return supabase
      .from("telegram_settings")
      .update(payload)
      .eq("id", old.id)
      .select()
      .single();
  }

  return supabase
    .from("telegram_settings")
    .insert(payload)
    .select()
    .single();
}

async function getPaymentSettings() {
  const { data, error } = await supabase
    .from("payment_settings")
    .select("*")
    .order("id", { ascending: false });

  if (error) throw error;

  return data || [];
}

async function getProduct(id) {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;

  return data;
}

/* =========================================================
   CUSTOMER NOTIFICATION
========================================================= */

async function notifyOrder(order, text) {
  if (!order?.customer_id) {
    return;
  }

  try {
    await sendMessage(order.customer_id, text);
  } catch (error) {
    console.error(
      "Customer notification error:",
      error.message
    );
  }
}

/* =========================================================
   LOGIN
========================================================= */

app.get("/login", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "admin.html")
  );
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const username = String(
      req.body?.username || ""
    ).trim();

    const password = String(
      req.body?.password || ""
    );

    /* MASTER */

    if (
      username === MASTER_USERNAME &&
      MASTER_PASSWORD &&
      password === MASTER_PASSWORD
    ) {
      const token = tokenSign({
        role: "master",
        username: MASTER_USERNAME,
        exp: Date.now() + 1000 * 60 * 60 * 12
      });

      return res.json({
        ok: true,
        token,
        user: {
          role: "master",
          username: MASTER_USERNAME,
          name: "Master Admin"
        },
        permissions: ["*"]
      });
    }

    /* EMPLOYEE */

    const {
      data: employee,
      error
    } = await supabase
      .from("employees")
      .select("*")
      .eq("username", username)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    if (
      !employee ||
      !verifyPassword(
        password,
        employee.password_hash
      )
    ) {
      return res.status(401).json({
        error:
          "የተጠቃሚ ስም ወይም Password ተሳስቷል።"
      });
    }

    const {
      data: permissions,
      error: permissionError
    } = await supabase
      .from("employee_permissions")
      .select("permission")
      .eq("employee_id", employee.id)
      .eq("enabled", true);

    if (permissionError) {
      return res.status(500).json({
        error: permissionError.message
      });
    }

    const token = tokenSign({
      role: "employee",
      employeeId: employee.id,
      username: employee.username,
      exp: Date.now() + 1000 * 60 * 60 * 12
    });

    return res.json({
      ok: true,
      token,
      user: {
        role: "employee",
        id: employee.id,
        username: employee.username,
        name: employee.name,
        phone: employee.phone
      },
      permissions: (permissions || []).map(
        (x) => x.permission
      )
    });
  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      error: "Login error"
    });
  }
});

app.get(
  "/api/auth/me",
  requireAuth,
  async (req, res) => {
    try {
      if (req.auth.role === "master") {
        return res.json({
          user: {
            role: "master",
            username: req.auth.username,
            name: "Master Admin"
          },
          permissions: ["*"]
        });
      }

      const { data: employee } = await supabase
        .from("employees")
        .select(
          "id,name,username,phone,is_active"
        )
        .eq("id", req.auth.employeeId)
        .maybeSingle();

      if (!employee || !employee.is_active) {
        return res.status(401).json({
          error: "Employee account is inactive."
        });
      }

      const { data: permissions } =
        await supabase
          .from("employee_permissions")
          .select("permission")
          .eq(
            "employee_id",
            req.auth.employeeId
          )
          .eq("enabled", true);

      res.json({
        user: {
          role: "employee",
          ...employee
        },
        permissions: (permissions || []).map(
          (x) => x.permission
        )
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   HEALTH
========================================================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "Telegram Sales Manager",
    port: PORT,
    telegram: !!BOT_TOKEN,
    supabase: !!SUPABASE_URL
  });
});

/* =========================================================
   PRODUCTS
========================================================= */

app.get(
  "/api/products",
  requirePermission("products"),
  async (req, res) => {
    try {
      const {
        data,
        error
      } = await supabase
        .from("products")
        .select("*")
        .order("created_at", {
          ascending: false
        });

      if (error) throw error;

      res.json(data || []);
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.post(
  "/api/products",
  requirePermission("products"),
  async (req, res) => {
    try {
      const b = req.body || {};

      if (!String(b.name || "").trim()) {
        return res.status(400).json({
          error: "Product name ያስፈልጋል።"
        });
      }

      const row = {
        name: String(b.name).trim(),
        buy_price: Number(
          b.buyPrice ??
          b.buy_price ??
          0
        ),
        sell_price: Number(
          b.sellPrice ??
          b.sell_price ??
          0
        ),
        stock: Number(b.stock ?? 0),
        photo_url:
          b.photoUrl ??
          b.photo_url ??
          b.photo ??
          null
      };

      const {
        data,
        error
      } = await supabase
        .from("products")
        .insert(row)
        .select()
        .single();

      if (error) throw error;

      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.patch(
  "/api/products/:id",
  requirePermission("products"),
  async (req, res) => {
    try {
      const b = req.body || {};
      const row = {};

      if (b.name !== undefined) {
        row.name = String(b.name).trim();
      }

      if (
        b.buyPrice !== undefined ||
        b.buy_price !== undefined
      ) {
        row.buy_price = Number(
          b.buyPrice ?? b.buy_price
        );
      }

      if (
        b.sellPrice !== undefined ||
        b.sell_price !== undefined
      ) {
        row.sell_price = Number(
          b.sellPrice ?? b.sell_price
        );
      }

      if (b.stock !== undefined) {
        row.stock = Number(b.stock);
      }

      if (
        b.photoUrl !== undefined ||
        b.photo_url !== undefined ||
        b.photo !== undefined
      ) {
        row.photo_url =
          b.photoUrl ??
          b.photo_url ??
          b.photo ??
          null;
      }

      if (!Object.keys(row).length) {
        return res.status(400).json({
          error: "ምንም የሚቀየር መረጃ የለም።"
        });
      }

      const {
        data,
        error
      } = await supabase
        .from("products")
        .update(row)
        .eq("id", req.params.id)
        .select()
        .single();

      if (error) throw error;

      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.delete(
  "/api/products/:id",
  requirePermission("delete_product"),
  async (req, res) => {
    try {
      const { error } =
        await supabase
          .from("products")
          .delete()
          .eq("id", req.params.id);

      if (error) throw error;

      res.json({
        ok: true
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   UPLOAD
========================================================= */

app.post(
  "/api/upload",
  requireAuth,
  upload.single("photo"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "Photo የለም።"
        });
      }

      const context =
        req.body?.context === "ad"
          ? "ads"
          : "products";

      const permission =
        context === "ads"
          ? "advertising"
          : "products";

      const allowed = await hasPermission(
        req.auth,
        permission
      );

      if (!allowed) {
        return res.status(403).json({
          error: "ይህን Photo upload ለማድረግ Permission የለህም።"
        });
      }

      if (
        !SUPABASE_URL ||
        !SUPABASE_SERVICE_ROLE_KEY
      ) {
        return res.status(500).json({
          error:
            "Supabase configuration ትክክል አይደለም።"
        });
      }

      const originalName =
        req.file.originalname || "photo.jpg";

      const extension =
        originalName.includes(".")
          ? originalName
              .split(".")
              .pop()
              .toLowerCase()
          : "jpg";

      const safeExtension =
        /^[a-z0-9]+$/.test(extension)
          ? extension
          : "jpg";

      const filePath =
        `${context}/` +
        `${Date.now()}-` +
        `${crypto.randomBytes(6).toString("hex")}.` +
        safeExtension;

      const {
        error: uploadError
      } = await supabase.storage
        .from("product-photos")
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

      if (uploadError) {
        console.error(
          "Supabase upload error:",
          uploadError
        );

        return res.status(500).json({
          error:
            uploadError.message ||
            "Photo upload failed."
        });
      }

      const {
        data: publicData
      } = supabase.storage
        .from("product-photos")
        .getPublicUrl(filePath);

      if (!publicData?.publicUrl) {
        return res.status(500).json({
          error:
            "Supabase Public URL ማመንጨት አልተቻለም።"
        });
      }

      res.json({
        ok: true,
        url: publicData.publicUrl,
        path: filePath
      });
    } catch (error) {
      console.error(
        "Upload error:",
        error
      );

      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   ORDERS
========================================================= */

app.get(
  "/api/orders",
  requirePermission("view_orders"),
  async (req, res) => {
    try {
      const {
        data,
        error
      } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", {
          ascending: false
        });

      if (error) throw error;

      res.json(data || []);
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

async function getOrder(id) {
  const {
    data,
    error
  } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;

  return data;
}

async function changeOrderStatus(
  id,
  status,
  actor
) {
  const order = await getOrder(id);

  if (!order) {
    throw new Error(
      "Order not found."
    );
  }

  const current =
    String(order.status || "").toUpperCase();

  const next =
    String(status || "").toUpperCase();

  const validStatuses = [
    "NEW",
    "PAYMENT_PENDING",
    "RECEIPT_PENDING",
    "CONFIRMED",
    "REJECTED",
    "CANCELLED"
  ];

  if (!validStatuses.includes(next)) {
    throw new Error(
      "Invalid order status."
    );
  }

  if (
    current === "CONFIRMED" &&
    next !== "CONFIRMED"
  ) {
    throw new Error(
      "Confirmed Order እንደገና መቀየር አይቻልም።"
    );
  }

  /* STOCK */

  if (
    next === "CONFIRMED" &&
    current !== "CONFIRMED"
  ) {
    const product =
      await getProduct(
        order.product_id
      );

    if (!product) {
      throw new Error(
        "Product not found."
      );
    }

    const stock = Number(
      product.stock || 0
    );

    const quantity = Number(
      order.quantity || 1
    );

    if (stock < quantity) {
      throw new Error(
        "Stock በቂ አይደለም።"
      );
    }

    const {
      error: stockError
    } = await supabase
      .from("products")
      .update({
        stock: stock - quantity
      })
      .eq("id", order.product_id);

    if (stockError) {
      throw stockError;
    }
  }

  const {
    data: updated,
    error
  } = await supabase
    .from("orders")
    .update({
      status: next
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  if (next === "CONFIRMED") {
    await notifyOrder(
      updated,
      "✅ ትዕዛዝዎ ተረጋግጧል።"
    );
  }

  if (next === "REJECTED") {
    await notifyOrder(
      updated,
      "❌ የክፍያ ደረሰኝዎ በAdmin አልተረጋገጠም።"
    );
  }

  return updated;
}

/* =========================================================
   ORDER STATUS
========================================================= */

app.patch(
  "/api/orders/:id",
  requireAuth,
  async (req, res) => {
    try {
      const status =
        String(
          req.body?.status || ""
        ).toUpperCase();

      if (!status) {
        return res.status(400).json({
          error:
            "Order status ያስፈልጋል።"
        });
      }

      if (
        status === "CONFIRMED"
      ) {
        const allowed =
          await hasPermission(
            req.auth,
            "confirm_order"
          );

        if (!allowed) {
          return res.status(403).json({
            error:
              "Confirm Order Permission የለህም።"
          });
        }
      }

      if (
        status === "REJECTED"
      ) {
        const allowed =
          await hasPermission(
            req.auth,
            "verify_payment"
          );

        if (!allowed) {
          return res.status(403).json({
            error:
              "Verify Payment Permission የለህም።"
          });
        }
      }

      if (
        status === "CANCELLED"
      ) {
        const allowed =
          await hasPermission(
            req.auth,
            "verify_payment"
          );

        if (!allowed) {
          return res.status(403).json({
            error:
              "Permission የለህም።"
          });
        }
      }

      const updated =
        await changeOrderStatus(
          req.params.id,
          status,
          req.auth
        );

      res.json(updated);
    } catch (error) {
      console.error(
        "Order status error:",
        error
      );

      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* Compatibility route */

app.patch(
  "/api/orders/:id/status",
  requireAuth,
  async (req, res) => {
    req.body = {
      ...(req.body || {}),
      status:
        req.body?.status ||
        req.body?.newStatus
    };

    const status =
      String(
        req.body.status || ""
      ).toUpperCase();

    if (
      status === "CONFIRMED" &&
      !(await hasPermission(
        req.auth,
        "confirm_order"
      ))
    ) {
      return res.status(403).json({
        error:
          "Confirm Order Permission የለህም።"
      });
    }

    if (
      status === "REJECTED" &&
      !(await hasPermission(
        req.auth,
        "verify_payment"
      ))
    ) {
      return res.status(403).json({
        error:
          "Verify Payment Permission የለህም።"
      });
    }

    try {
      const updated =
        await changeOrderStatus(
          req.params.id,
          status,
          req.auth
        );

      res.json(updated);
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   PAYMENT SETTINGS
========================================================= */

app.get(
  "/api/payment-settings",
  requirePermission("payment_settings"),
  async (req, res) => {
    try {
      res.json(
        await getPaymentSettings()
      );
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.post(
  "/api/payment-settings",
  requirePermission("payment_settings"),
  async (req, res) => {
    try {
      const b = req.body || {};

      const {
        data,
        error
      } = await supabase
        .from("payment_settings")
        .insert({
          method: b.method,
          account_name:
            b.accountName ??
            b.account_name,
          account_number:
            b.accountNumber ??
            b.account_number,
          phone: b.phone,
          additional_info:
            b.additionalInfo ??
            b.additional_info,
          is_active:
            b.isActive ?? true
        })
        .select()
        .single();

      if (error) throw error;

      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   TELEGRAM SETTINGS
========================================================= */

app.get(
  "/api/telegram-settings",
  requirePermission("telegram_settings"),
  async (req, res) => {
    try {
      res.json(
        await getTelegramSettings()
      );
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.post(
  "/api/telegram-settings",
  requirePermission("telegram_settings"),
  async (req, res) => {
    try {
      const b = req.body || {};

      const result =
        await saveTelegramSettings({
          ad_chat_id:
            b.adChatId ??
            b.ad_chat_id,
          ad_chat_title:
            b.adChatTitle ??
            b.ad_chat_title
        });

      if (result.error) {
        throw result.error;
      }

      res.json(result.data);
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   ADVERTISEMENTS
========================================================= */

app.get(
  "/api/advertisements",
  requirePermission("advertising"),
  async (req, res) => {
    try {
      const {
        data,
        error
      } = await supabase
        .from("advertisements")
        .select("*")
        .order("created_at", {
          ascending: false
        });

      if (error) throw error;

      res.json(data || []);
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.post(
  "/api/advertisements",
  requirePermission("advertising"),
  async (req, res) => {
    try {
      const b = req.body || {};

      const row = {
        product_id:
          b.productId ??
          b.product_id ??
          null,

        title: b.title || "",

        text: b.text || "",

        photo_url:
          b.photoUrl ??
          b.photo_url ??
          null,

        button_text:
          b.buttonText ??
          b.button_text ??
          "🛒 በዚህ ይዘዙን",

        status:
          b.status || "ACTIVE",

        ad_type:
          b.adType ??
          b.ad_type ??
          "PRODUCT",

        discount:
          Number(b.discount || 0),

        old_price:
          Number(
            b.oldPrice ??
            b.old_price ??
            0
          ),

        target_chat_id:
          b.targetChatId ??
          b.target_chat_id ??
          null,

        publish_status: "DRAFT"
      };

      const {
        data,
        error
      } = await supabase
        .from("advertisements")
        .insert(row)
        .select()
        .single();

      if (error) throw error;

      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.patch(
  "/api/advertisements/:id",
  requirePermission("advertising"),
  async (req, res) => {
    try {
      const b = req.body || {};
      const row = {};

      if (b.title !== undefined)
        row.title = b.title;

      if (b.text !== undefined)
        row.text = b.text;

      if (
        b.photoUrl !== undefined ||
        b.photo_url !== undefined
      ) {
        row.photo_url =
          b.photoUrl ??
          b.photo_url;
      }

      if (
        b.buttonText !== undefined ||
        b.button_text !== undefined
      ) {
        row.button_text =
          b.buttonText ??
          b.button_text;
      }

      if (b.status !== undefined)
        row.status = b.status;

      if (
        b.adType !== undefined ||
        b.ad_type !== undefined
      ) {
        row.ad_type =
          b.adType ??
          b.ad_type;
      }

      if (
        b.productId !== undefined ||
        b.product_id !== undefined
      ) {
        row.product_id =
          b.productId ??
          b.product_id;
      }

      if (b.discount !== undefined) {
        row.discount =
          Number(b.discount);
      }

      if (
        b.oldPrice !== undefined ||
        b.old_price !== undefined
      ) {
        row.old_price =
          Number(
            b.oldPrice ??
            b.old_price
          );
      }

      if (
        b.targetChatId !== undefined ||
        b.target_chat_id !== undefined
      ) {
        row.target_chat_id =
          b.targetChatId ??
          b.target_chat_id;
      }

      const {
        data,
        error
      } = await supabase
        .from("advertisements")
        .update(row)
        .eq("id", req.params.id)
        .select()
        .single();

      if (error) throw error;

      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.delete(
  "/api/advertisements/:id",
  requirePermission("advertising"),
  async (req, res) => {
    try {
      const { error } =
        await supabase
          .from("advertisements")
          .delete()
          .eq("id", req.params.id);

      if (error) throw error;

      res.json({
        ok: true
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.post(
  "/api/advertisements/:id/publish",
  requirePermission("advertising"),
  async (req, res) => {
    try {
      const {
        data: ad,
        error
      } = await supabase
        .from("advertisements")
        .select("*")
        .eq("id", req.params.id)
        .single();

      if (error) throw error;

      const settings =
        await getTelegramSettings();

      const chatId =
        ad.target_chat_id ||
        settings.ad_chat_id ||
        process.env.TELEGRAM_AD_CHAT_ID;

      if (!chatId) {
        throw new Error(
          "Telegram Channel/Group Chat ID አልተዘጋጀም።"
        );
      }

      const deep =
        `https://t.me/${BOT_USERNAME}` +
        `?start=product_${encodeURIComponent(
          ad.product_id || ""
        )}`;

      const replyMarkup = {
        inline_keyboard: [
          [
            {
              text:
                ad.button_text ||
                "🛒 በዚህ ይዘዙን",
              url: deep
            }
          ]
        ]
      };

      let result;

      if (ad.photo_url) {
        result = await telegram(
          "sendPhoto",
          {
            chat_id: chatId,
            photo: ad.photo_url,
            caption:
              `${ad.title || ""}\n\n` +
              `${ad.text || ""}`,
            reply_markup:
              replyMarkup
          }
        );
      } else {
        result = await telegram(
          "sendMessage",
          {
            chat_id: chatId,
            text:
              `${ad.title || ""}\n\n` +
              `${ad.text || ""}`,
            reply_markup:
              replyMarkup
          }
        );
      }

      if (!result.ok) {
        throw new Error(
          result.description ||
          "Telegram publish failed"
        );
      }

      await supabase
        .from("advertisements")
        .update({
          publish_status:
            "PUBLISHED",
          published_at:
            new Date().toISOString()
        })
        .eq("id", ad.id);

      res.json({
        ok: true,
        result
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   EMPLOYEES
========================================================= */

app.get(
  "/api/employees",
  requireMaster,
  async (req, res) => {
    try {
      const {
        data,
        error
      } = await supabase
        .from("employees")
        .select(
          "id,name,username,phone,is_active,created_at,updated_at"
        )
        .order("id", {
          ascending: false
        });

      if (error) throw error;

      const result = [];

      for (const employee of data || []) {
        const {
          data: permissions
        } = await supabase
          .from("employee_permissions")
          .select(
            "permission,enabled"
          )
          .eq(
            "employee_id",
            employee.id
          );

        result.push({
          ...employee,
          permissions:
            permissions || []
        });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.post(
  "/api/employees",
  requireMaster,
  async (req, res) => {
    try {
      const b = req.body || {};

      if (
        !b.name ||
        !b.username ||
        !b.password
      ) {
        return res.status(400).json({
          error:
            "Name, Username እና Password ያስፈልጋሉ።"
        });
      }

      const {
        data: existing
      } = await supabase
        .from("employees")
        .select("id")
        .eq(
          "username",
          String(b.username).trim()
        )
        .maybeSingle();

      if (existing) {
        return res.status(409).json({
          error:
            "ይህ Username ቀድሞ ተጠቅመዋል።"
        });
      }

      const {
        data: employee,
        error
      } = await supabase
        .from("employees")
        .insert({
          name: String(b.name).trim(),
          username:
            String(b.username).trim(),
          phone:
            b.phone || null,
          password_hash:
            hashPassword(
              b.password
            ),
          is_active: true
        })
        .select()
        .single();

      if (error) throw error;

      const requestedPermissions =
        Array.isArray(b.permissions)
          ? b.permissions
          : [];

      const rows =
        PERMISSIONS.map(
          (permission) => ({
            employee_id:
              employee.id,
            permission,
            enabled:
              requestedPermissions.includes(
                permission
              )
          })
        );

      if (rows.length) {
        const {
          error: permissionError
        } = await supabase
          .from(
            "employee_permissions"
          )
          .insert(rows);

        if (permissionError) {
          throw permissionError;
        }
      }

      res.json({
        ok: true,
        employee
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.patch(
  "/api/employees/:id",
  requireMaster,
  async (req, res) => {
    try {
      const b = req.body || {};
      const row = {};

      if (b.name !== undefined)
        row.name = b.name;

      if (
        b.username !== undefined
      )
        row.username = b.username;

      if (
        b.phone !== undefined
      )
        row.phone = b.phone;

      if (b.password) {
        row.password_hash =
          hashPassword(
            b.password
          );
      }

      if (
        b.isActive !== undefined
      ) {
        row.is_active =
          !!b.isActive;
      }

      if (Object.keys(row).length) {
        const {
          error
        } = await supabase
          .from("employees")
          .update(row)
          .eq(
            "id",
            req.params.id
          );

        if (error) throw error;
      }

      if (
        Array.isArray(
          b.permissions
        )
      ) {
        for (
          const permission
          of PERMISSIONS
        ) {
          const {
            error
          } = await supabase
            .from(
              "employee_permissions"
            )
            .upsert(
              {
                employee_id:
                  Number(
                    req.params.id
                  ),
                permission,
                enabled:
                  b.permissions.includes(
                    permission
                  )
              },
              {
                onConflict:
                  "employee_id,permission"
              }
            );

          if (error) {
            throw error;
          }
        }
      }

      const {
        data: employee
      } = await supabase
        .from("employees")
        .select(
          "id,name,username,phone,is_active,created_at,updated_at"
        )
        .eq(
          "id",
          req.params.id
        )
        .single();

      res.json({
        ok: true,
        employee
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.delete(
  "/api/employees/:id",
  requireMaster,
  async (req, res) => {
    try {
      const { error } =
        await supabase
          .from("employees")
          .delete()
          .eq(
            "id",
            req.params.id
          );

      if (error) throw error;

      res.json({
        ok: true
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   EMPLOYEE PERMISSIONS
========================================================= */

app.get(
  "/api/employees/:id/permissions",
  requireMaster,
  async (req, res) => {
    try {
      const {
        data,
        error
      } = await supabase
        .from(
          "employee_permissions"
        )
        .select(
          "permission,enabled"
        )
        .eq(
          "employee_id",
          req.params.id
        );

      if (error) throw error;

      res.json(
        data || []
      );
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.post(
  "/api/employees/:id/permissions",
  requireMaster,
  async (req, res) => {
    try {
      const permissions =
        Array.isArray(
          req.body?.permissions
        )
          ? req.body.permissions
          : [];

      for (
        const permission
        of PERMISSIONS
      ) {
        const {
          error
        } = await supabase
          .from(
            "employee_permissions"
          )
          .upsert(
            {
              employee_id:
                Number(
                  req.params.id
                ),
              permission,
              enabled:
                permissions.includes(
                  permission
                )
            },
            {
              onConflict:
                "employee_id,permission"
            }
          );

        if (error) {
          throw error;
        }
      }

      res.json({
        ok: true,
        permissions
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   TELEGRAM BOT - PRODUCTS
========================================================= */

async function botSendProducts(
  chatId
) {
  const {
    data: products
  } = await supabase
    .from("products")
    .select("*")
    .gt("stock", 0)
    .order("created_at", {
      ascending: false
    });

  if (!products?.length) {
    return sendMessage(
      chatId,
      "📦 በአሁኑ ጊዜ ምርት የለም።"
    );
  }

  const keyboard =
    products.map((product) => [
      {
        text:
          `🛍️ ${product.name} — ` +
          `${Number(
            product.sell_price || 0
          ).toLocaleString()} ETB`,
        callback_data:
          `product_${product.id}`
      }
    ]);

  return sendMessage(
    chatId,
    "🛒 እባክዎ የሚፈልጉትን ምርት ይምረጡ።",
    {
      reply_markup: {
        inline_keyboard:
          keyboard
      }
    }
  );
}

async function findPendingOrder(
  chatId
) {
  const {
    data
  } = await supabase
    .from("orders")
    .select("*")
    .eq(
      "customer_id",
      String(chatId)
    )
    .in(
      "status",
      [
        "PAYMENT_PENDING",
        "RECEIPT_PENDING",
        "NEW"
      ]
    )
    .order("created_at", {
      ascending: false
    })
    .limit(1)
    .maybeSingle();

  return data;
}

/* =========================================================
   TELEGRAM BOT PROCESSING
========================================================= */

async function processTelegram(
  update
) {
  try {
    /* CHANNEL POST */

    if (update.channel_post) {
      const chat =
        update.channel_post.chat;

      if (chat?.id) {
        await saveTelegramSettings({
          detected_chat_id:
            String(chat.id),
          detected_chat_title:
            chat.title ||
            chat.username ||
            "Telegram Channel/Group"
        }).catch(() => {});
      }
    }

    /* CALLBACK */

    if (update.callback_query) {
      const q =
        update.callback_query;

      const chatId =
        q.message?.chat?.id;

      const data =
        q.data || "";

      await telegram(
        "answerCallbackQuery",
        {
          callback_query_id:
            q.id
        }
      ).catch(() => {});

      /* ADMIN CONFIRM */

      if (
        data.startsWith(
          "admin_confirm_"
        )
      ) {
        const orderId =
          data.replace(
            "admin_confirm_",
            ""
          );

        try {
          const order =
            await changeOrderStatus(
              orderId,
              "CONFIRMED",
              {
                role: "master"
              }
            );

          await sendMessage(
            ADMIN_CHAT_ID,
            `✅ Order ${order.id} CONFIRMED`
          );
        } catch (error) {
          await sendMessage(
            ADMIN_CHAT_ID,
            `❌ Confirm failed:\n${error.message}`
          );
        }

        return;
      }

      /* ADMIN REJECT */

      if (
        data.startsWith(
          "admin_reject_"
        )
      ) {
        const orderId =
          data.replace(
            "admin_reject_",
            ""
          );

        try {
          const order =
            await changeOrderStatus(
              orderId,
              "REJECTED",
              {
                role: "master"
              }
            );

          await sendMessage(
            ADMIN_CHAT_ID,
            `❌ Order ${order.id} REJECTED`
          );
        } catch (error) {
          await sendMessage(
            ADMIN_CHAT_ID,
            `❌ Reject failed:\n${error.message}`
          );
        }

        return;
      }

      /* PRODUCT */

      if (
        data.startsWith(
          "product_"
        )
      ) {
        const productId =
          data.slice(8);

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

        sessions.set(
          String(chatId),
          {
            step: "quantity",
            productId:
              String(
                product.id
              ),
            quantity: 1
          }
        );

        return sendMessage(
          chatId,
          `🛍️ ${product.name}\n` +
          `💰 ${Number(
            product.sell_price
          ).toLocaleString()} ETB\n` +
          `📦 Stock: ${product.stock}\n\n` +
          `የሚፈልጉትን ብዛት ይጻፉ።`
        );
      }

      /* ORDER CONFIRM */

      if (
        data ===
        "order_confirm"
      ) {
        const session =
          sessions.get(
            String(chatId)
          );

        if (
          !session?.productId
        ) {
          return sendMessage(
            chatId,
            "❌ Order session አልተገኘም።"
          );
        }

        const product =
          await getProduct(
            session.productId
          );

        if (!product) {
          return sendMessage(
            chatId,
            "❌ ምርቱ አልተገኘም።"
          );
        }

        const quantity =
          Number(
            session.quantity || 1
          );

        const total =
          Number(
            product.sell_price
          ) * quantity;

        const profit =
          (
            Number(
              product.sell_price
            ) -
            Number(
              product.buy_price
            )
          ) * quantity;

        const {
          data: order,
          error
        } = await supabase
          .from("orders")
          .insert({
            product_id:
              String(
                product.id
              ),
            product_name:
              product.name,
            buy_price:
              Number(
                product.buy_price || 0
              ),
            sell_price:
              Number(
                product.sell_price || 0
              ),
            quantity,
            total,
            profit,
            customer_id:
              String(chatId),
            customer_name:
              session.name,
            username:
              q.from?.username
                ? `@${q.from.username}`
                : "",
            phone:
              session.phone,
            address:
              session.address ||
              "",
            status:
              "PAYMENT_PENDING"
          })
          .select()
          .single();

        if (error) {
          throw error;
        }

        sessions.set(
          String(chatId),
          {
            ...session,
            orderId:
              order.id,
            step: "payment"
          }
        );

        const payments =
          await getPaymentSettings();

        let paymentInfo =
          "💳 የክፍያ መረጃ ከAdmin ጋር ይረጋ
