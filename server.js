"use strict";

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");

const app = express();

const PORT = Number(process.env.PORT || 10000);

/* =========================================================
   BASIC APP SETUP
========================================================= */

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

/* =========================================================
   ENVIRONMENT
========================================================= */

const SUPABASE_URL =
  String(process.env.SUPABASE_URL || "").trim();

const SUPABASE_SERVICE_ROLE_KEY =
  String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

const BOT_TOKEN =
  String(process.env.TELEGRAM_BOT_TOKEN || "").trim();

const BOT_USERNAME =
  String(
    process.env.TELEGRAM_BOT_USERNAME || "uni_market_shop_bot"
  )
    .replace(/^@/, "")
    .trim();

const ADMIN_CHAT_ID =
  String(process.env.ADMIN_CHAT_ID || "").trim();

const AUTH_SECRET =
  String(
    process.env.AUTH_SECRET ||
      "uni_market_static_secret_key_2026"
  ).trim();

const MASTER_ADMIN_USERNAME =
  String(
    process.env.MASTER_ADMIN_USERNAME || "admin"
  ).trim();

const MASTER_ADMIN_PASSWORD =
  process.env.MASTER_ADMIN_PASS ||
  process.env.MASTER_ADMIN_PASSWORD ||
  "123456";

const STORAGE_BUCKET =
  String(
    process.env.SUPABASE_STORAGE_BUCKET || "product-images"
  ).trim();

const WEBHOOK_URL =
  String(process.env.WEBHOOK_URL || "")
    .trim()
    .replace(/\/+$/, "");

/* =========================================================
   SUPABASE
========================================================= */

let supabase = null;

try {
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

    console.log("Supabase initialized.");
  } else {
    console.warn(
      "Supabase environment variables are missing."
    );
  }
} catch (error) {
  console.error(
    "Supabase initialization error:",
    error
  );
}

/* =========================================================
   MULTER
========================================================= */

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

/* =========================================================
   HELPERS
========================================================= */

function nowISO() {
  return new Date().toISOString();
}

function safeString(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(value).trim();
}

function firstDefined(...values) {
  for (const value of values) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      return value;
    }
  }

  return null;
}

function numberValue(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

/* =========================================================
   AUTH TOKEN
========================================================= */

function base64url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createAuthToken(payload) {
  const encodedPayload = base64url(
    Buffer.from(JSON.stringify(payload))
  );

  const signature = base64url(
    crypto
      .createHmac("sha256", AUTH_SECRET)
      .update(encodedPayload)
      .digest()
  );

  return `${encodedPayload}.${signature}`;
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
      .createHmac("sha256", AUTH_SECRET)
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
    const validSignature =
      crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
      );

    if (!validSignature) {
      return null;
    }

    const payload = JSON.parse(
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

/* =========================================================
   EMPLOYEE PASSWORD
========================================================= */

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
        (error, derivedKey) => {
          if (error) {
            return reject(error);
          }

          resolve(
            `scrypt:${salt}:${derivedKey.toString(
              "hex"
            )}`
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
  return new Promise((resolve) => {
    if (
      !stored ||
      !stored.startsWith("scrypt:")
    ) {
      return resolve(false);
    }

    const parts = stored.split(":");

    if (parts.length !== 3) {
      return resolve(false);
    }

    const salt = parts[1];

    const storedHash =
      Buffer.from(parts[2], "hex");

    crypto.scrypt(
      String(password),
      salt,
      storedHash.length,
      (error, derivedKey) => {
        if (error) {
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
  });
}

/* =========================================================
   AUTH
========================================================= */

function getAuth(req) {
  const authorization =
    req.headers.authorization || "";

  if (
    authorization.startsWith(
      "Bearer "
    )
  ) {
    const token =
      authorization
        .slice("Bearer ".length)
        .trim();

    const auth =
      verifyAuthToken(token);

    if (auth) {
      return auth;
    }
  }

  const cookieHeader =
    req.headers.cookie || "";

  const match =
    cookieHeader.match(
      /(?:^|;\s*)auth_token=([^;]*)/
    );

  if (match) {
    try {
      return verifyAuthToken(
        decodeURIComponent(match[1])
      );
    } catch {
      return null;
    }
  }

  return null;
}

function requireAuth(
  req,
  res,
  next
) {
  const auth = getAuth(req);

  if (!auth) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  req.auth = auth;

  next();
}

/* =========================================================
   TELEGRAM API
========================================================= */

async function telegram(
  method,
  body = {}
) {
  if (!BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is missing"
    );
  }

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
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
      `Telegram ${method}: ${
        data.description ||
        "API error"
      }`
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

async function answerCallbackQuery(
  callbackQueryId,
  text = ""
) {
  try {
    return await telegram(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQueryId,
        text
      }
    );
  } catch (error) {
    console.error(
      "answerCallbackQuery error:",
      error.message
    );
  }
}

/* =========================================================
   DATABASE HELPERS
========================================================= */

async function getOrderById(
  orderId
) {
  if (!supabase) {
    return null;
  }

  try {
    const {
      data
    } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();

    return data || null;
  } catch {
    return null;
  }
}

async function getPaymentSettings() {
  if (!supabase) {
    return {};
  }

  try {
    const {
      data
    } = await supabase
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
    const {
      data
    } = await supabase
      .from("telegram_settings")
      .select("*")
      .limit(1)
      .maybeSingle();

    return data || {};
  } catch {
    return {};
  }
}

/* =========================================================
   AUTH API
========================================================= */

app.post(
  "/api/auth/login",
  async (req, res) => {
    try {
      const username =
        safeString(
          req.body?.username
        );

      const password =
        String(
          req.body?.password || ""
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

      /* MASTER ADMIN */

      if (
        username ===
          MASTER_ADMIN_USERNAME &&
        password ===
          MASTER_ADMIN_PASSWORD
      ) {
        const token =
          createAuthToken({
            role: "MASTER_ADMIN",
            username:
              MASTER_ADMIN_USERNAME,
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
            role:
              "MASTER_ADMIN",
            username:
              MASTER_ADMIN_USERNAME,
            name:
              "Master Admin"
          }
        });
      }

      /* EMPLOYEE */

      if (!supabase) {
        return res.status(500).json({
          ok: false,
          error:
            "Supabase unavailable"
        });
      }

      const {
        data: employee,
        error:
          employeeError
      } =
        await supabase
          .from("employees")
          .select("*")
          .eq(
            "username",
            username
          )
          .maybeSingle();

      if (employeeError) {
        console.error(
          "Employee login error:",
          employeeError
        );

        return res.status(500).json({
          ok: false,
          error:
            "Login service error"
        });
      }

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
    } catch (error) {
      console.error(
        "AUTH LOGIN ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Login service error"
      });
    }
  }
);

app.get(
  "/api/auth/me",
  requireAuth,
  async (req, res) => {
    res.json({
      ok: true,
      user: req.auth
    });
  }
);

/* =========================================================
   PRODUCT CATEGORIES
========================================================= */

const PRODUCT_CATEGORIES = [
  {
    id: "clothing",
    name: "👕 አልባሳት"
  },
  {
    id: "electronics",
    name: "📱 ኤሌክትሮኒክስ"
  },
  {
    id: "kids",
    name: "🧒 የህፃናት"
  },
  {
    id: "women",
    name: "👩 የሴቶች"
  },
  {
    id: "home",
    name: "🏠 የቤት እቃዎች"
  },
  {
    id: "other",
    name: "🛍️ ሌሎች"
  }
];

function validCategory(
  category
) {
  return PRODUCT_CATEGORIES.some(
    c => c.id === category
  )
    ? category
    : "other";
}

function productCategoriesKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "👕 አልባሳት",
          callback_data:
            "category_clothing"
        },
        {
          text: "📱 ኤሌክትሮኒክስ",
          callback_data:
            "category_electronics"
        }
      ],
      [
        {
          text: "🧒 የህፃናት",
          callback_data:
            "category_kids"
        },
        {
          text: "👩 የሴቶች",
          callback_data:
            "category_women"
        }
      ],
      [
        {
          text: "🏠 የቤት እቃዎች",
          callback_data:
            "category_home"
        },
        {
          text: "🛍️ ሌሎች",
          callback_data:
            "category_other"
        }
      ]
    ]
  };
}

/* =========================================================
   PRODUCTS
========================================================= */

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
        throw error;
      }

      res.json(data || []);
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

app.post(
  "/api/products",
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
        name: firstDefined(
          body.name,
          body.productName,
          body.title
        ),

        description:
          body.description ||
          null,

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
          ),

        category:
          validCategory(
            safeString(
              body.category
            )
          )
      };

      let result =
        await supabase
          .from("products")
          .insert(row)
          .select("*")
          .single();

      /*
       If old products table doesn't have
       category column, keep old functionality.
      */

      if (
        result.error &&
        String(
          result.error.message || ""
        ).toLowerCase()
          .includes("category")
      ) {
        delete row.category;

        result =
          await supabase
            .from("products")
            .insert(row)
            .select("*")
            .single();
      }

      if (result.error) {
        throw result.error;
      }

      res.json({
        ok: true,
        product:
          result.data
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* EDIT PRODUCT */

app.patch(
  "/api/products/:id",
  async (req, res) => {
    try {
      if (!supabase) {
        throw new Error(
          "Supabase unavailable"
        );
      }

      const body =
        req.body || {};

      const row = {};

      if (
        body.name !==
          undefined
      ) {
        row.name =
          body.name;
      }

      if (
        body.description !==
          undefined
      ) {
        row.description =
          body.description ||
          null;
      }

      if (
        body.buyPrice !==
          undefined ||
        body.buy_price !==
          undefined
      ) {
        row.buy_price =
          numberValue(
            firstDefined(
              body.buyPrice,
              body.buy_price
            ),
            0
          );
      }

      if (
        body.sellPrice !==
          undefined ||
        body.sell_price !==
          undefined
      ) {
        row.sell_price =
          numberValue(
            firstDefined(
              body.sellPrice,
              body.sell_price
            ),
            0
          );
      }

      if (
        body.stock !==
          undefined
      ) {
        row.stock =
          numberValue(
            body.stock,
            0
          );
      }

      if (
        body.photoUrl !==
          undefined ||
        body.photo_url !==
          undefined
      ) {
        row.photo_url =
          firstDefined(
            body.photoUrl,
            body.photo_url
          );
      }

      if (
        body.category !==
          undefined
      ) {
        row.category =
          validCategory(
            safeString(
              body.category
            )
          );
      }

      let result =
        await supabase
          .from("products")
          .update(row)
          .eq(
            "id",
            req.params.id
          )
          .select("*")
          .single();

      if (
        result.error &&
        String(
          result.error.message || ""
        ).toLowerCase()
          .includes("category")
      ) {
        delete row.category;

        result =
          await supabase
            .from("products")
            .update(row)
            .eq(
              "id",
              req.params.id
            )
            .select("*")
            .single();
      }

      if (result.error) {
        throw result.error;
      }

      res.json({
        ok: true,
        product:
          result.data
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* DELETE PRODUCT */

app.delete(
  "/api/products/:id",
  async (req, res) => {
    try {
      if (supabase) {
        const {
          error
        } =
          await supabase
            .from("products")
            .delete()
            .eq(
              "id",
              req.params.id
            );

        if (error) {
          throw error;
        }
      }

      res.json({
        ok: true
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   IMAGE UPLOAD
========================================================= */

app.post(
  "/api/upload",
  upload.single("photo"),
  async (req, res) => {
    try {
      if (
        !supabase ||
        !req.file
      ) {
        return res.json({
          ok: true,
          url:
            "https://images.unsplash.com/photo-1523275335684-37898b6baf30"
        });
      }

      const ext =
        path.extname(
          req.file.originalname ||
            ""
        ).toLowerCase() ||
        ".jpg";

      const filePath =
        `products/${Date.now()}-${crypto
          .randomBytes(8)
          .toString("hex")}${ext}`;

      const {
        error
      } =
        await supabase.storage
          .from(
            STORAGE_BUCKET
          )
          .upload(
            filePath,
            req.file.buffer,
            {
              contentType:
                req.file
                  .mimetype ||
                "image/jpeg",
              upsert: false
            }
          );

      if (error) {
        console.error(
          "Storage upload error:",
          error
        );

        return res.status(500).json({
          ok: false,
          error:
            "Image upload failed: " +
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
          )?.data
          ?.publicUrl;

      if (!publicUrl) {
        throw new Error(
          "Could not create public image URL"
        );
      }

      res.json({
        ok: true,
        url: publicUrl,
        path: filePath
      });
    } catch (error) {
      console.error(
        "Upload error:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   ORDERS
========================================================= */

app.get(
  "/api/orders",
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
          .from("orders")
          .select("*")
          .order(
            "created_at",
            {
              ascending: false
            }
          );

      if (error) {
        throw error;
      }

      res.json(data || []);
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   ORDER STATUS
========================================================= */

async function changeOrderStatus(
  orderId,
  newStatus,
  actorName
) {
  const order =
    await getOrderById(
      orderId
    );

  if (!order) {
    throw new Error(
      "Order not found"
    );
  }

  newStatus =
    safeString(
      newStatus
    ).toUpperCase();

  if (
    newStatus ===
    "CONFIRMED"
  ) {
    /*
      Keep existing order flow:
      CONFIRMED -> DELIVERY_PENDING
    */

    const {
      data,
      error
    } =
      await supabase
        .from("orders")
        .update({
          status:
            "DELIVERY_PENDING",

          payment_status:
            "CONFIRMED",

          confirmed_at:
            nowISO(),

          confirmed_by:
            actorName ||
            "Admin"
        })
        .eq(
          "id",
          orderId
        )
        .select("*")
        .single();

    if (error) {
      throw error;
    }

    const customerChatId =
      firstDefined(
        data.telegram_chat_id,
        data.customer_id
      );

    if (customerChatId) {
      try {
        await sendMessage(
          customerChatId,

          `✅ ክፍያዎ ተረጋግጧል!\n\n📦 እቃዎ በማድረስ ሂደት ላይ ነው።`,

          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text:
                      "📦 ደርሶኛል",
                    callback_data:
                      `order_received_${data.id}`
                  }
                ]
              ]
            }
          }
        );
      } catch (
        telegramError
      ) {
        console.error(
          "Customer Telegram notification error:",
          telegramError.message
        );
      }
    }

    return data;
  }

  const {
    data,
    error
  } =
    await supabase
      .from("orders")
      .update({
        status:
          newStatus
      })
      .eq(
        "id",
        orderId
      )
      .select("*")
      .single();

  if (error) {
    throw error;
  }

  return data;
}

app.patch(
  "/api/orders/:id/status",
  async (req, res) => {
    try {
      const status =
        req.body?.status ||
        req.body?.newStatus;

      if (!status) {
        return res.status(400).json({
          ok: false,
          error:
            "Order status is required"
        });
      }

      const order =
        await changeOrderStatus(
          req.params.id,
          status,
          "Admin"
        );

      res.json({
        ok: true,
        order
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   PAYMENT SETTINGS
========================================================= */

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
      if (!supabase) {
        throw new Error(
          "Supabase unavailable"
        );
      }

      const existing =
        await getPaymentSettings();

      let data;
      let error;

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
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   TELEGRAM SETTINGS
========================================================= */

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
      if (!supabase) {
        throw new Error(
          "Supabase unavailable"
        );
      }

      const existing =
        await getTelegramSettings();

      let data;
      let error;

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
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   ADVERTISEMENTS
========================================================= */

app.get(
  "/api/advertisements",
  async (req, res) => {
    try {
      if (!supabase) {
        return res.json([]);
      }

      const {
        data
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
          body.title ||
          null,

        text:
          body.text ||
          body.advertisementText ||
          null,

        button_text:
          body.buttonText ||
          body.button_text ||
          "🛒 አሁን ይዘዙ",

        telegram_chat_id:
          firstDefined(
            body.telegramChatId,
            body.telegram_chat_id,
            body.chatId,
            body.chat_id
          ),

        photo_url:
          firstDefined(
            body.photoUrl,
            body.photo_url,
            body.photo
          ),

        category:
          validCategory(
            safeString(
              body.category
            )
          ),

        status:
          "DRAFT"
      };

      let result =
        await supabase
          .from(
            "advertisements"
          )
          .insert(row)
          .select("*")
          .single();

      /*
        Old advertisements table
        may not have category.
      */

      if (
        result.error &&
        String(
          result.error.message || ""
        ).toLowerCase()
          .includes("category")
      ) {
        delete row.category;

        result =
          await supabase
            .from(
              "advertisements"
            )
            .insert(row)
            .select("*")
            .single();
      }

      if (result.error) {
        throw result.error;
      }

      res.json({
        ok: true,
        advertisement:
          result.data
      });
    } catch (error) {
      console.error(
        "Advertisement create error:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* PUBLISH AD */

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
        data: ad
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

      if (!ad) {
        throw new Error(
          "Advertisement not found"
        );
      }

      const settings =
        await getTelegramSettings();

      const chatId =
        firstDefined(
          req.body?.telegramChatId,
          req.body?.telegram_chat_id,
          ad.telegram_chat_id,
          settings.telegram_chat_id,
          settings.channel_id,
          settings.group_id,
          settings.admin_chat_id,
          ADMIN_CHAT_ID
        );

      if (!chatId) {
        throw new Error(
          "Telegram Channel/Group Chat ID missing"
        );
      }

      const category =
        validCategory(
          safeString(
            req.body?.category ||
              ad.category
          )
        );

      const caption =
        `🔥 ${
          ad.title ||
          "UNI MARKET"
        }\n\n${
          ad.text || ""
        }`;

      const buttonText =
        ad.button_text ||
        "🛒 አሁን ይዘዙ";

      /*
        Advertisement button opens
        Telegram bot category.
      */

      const buttonUrl =
        `https://t.me/${BOT_USERNAME}?start=category_${category}`;

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

      let telegramResult;

      if (ad.photo_url) {
        telegramResult =
          await telegram(
            "sendPhoto",
            {
              chat_id:
                chatId,

              photo:
                ad.photo_url,

              caption:
                caption,

              reply_markup:
                replyMarkup
            }
          );
      } else {
        telegramResult =
          await sendMessage(
            chatId,
            caption,
            {
              reply_markup:
                replyMarkup
            }
          );
      }

      /*
        Best effort status update.
        It won't break publishing if
        old table doesn't have these columns.
      */

      try {
        await supabase
          .from(
            "advertisements"
          )
          .update({
            status:
              "PUBLISHED",
            published_at:
              nowISO(),
            telegram_message_id:
              telegramResult?.message_id ||
              null
          })
          .eq(
            "id",
            req.params.id
          );
      } catch {}

      res.json({
        ok: true,
        message:
          "Advertisement published",
        telegram:
          telegramResult
      });
    } catch (error) {
      console.error(
        "Advertisement publish error:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          error.message
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
    } catch {
      res.json({
        ok: true
      });
    }
  }
);

/* =========================================================
   EMPLOYEES
========================================================= */

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
      if (!supabase) {
        throw new Error(
          "Supabase unavailable"
        );
      }

      const body =
        req.body || {};

      const passwordHash =
        await hashPassword(
          body.password ||
            "123456"
        );

      const {
        data:
          newEmployee,
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
          newEmployee
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
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
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   REPORTS
========================================================= */

app.get(
  "/api/reports",
  async (req, res) => {
    try {
      if (!supabase) {
        return res.json({
          ok: true,
          summary: {}
        });
      }

      const {
        data: ordersData
      } =
        await supabase
          .from("orders")
          .select("*");

      const orders =
        Array.isArray(
          ordersData
        )
          ? ordersData
          : [];

      let totalSales = 0;
      let totalProfit = 0;
      let deliveredOrders = 0;
      let pendingOrders = 0;

      orders.forEach(
        order => {
          const status =
            String(
              order.status ||
                ""
            ).toUpperCase();

          if (
            status ===
              "DELIVERED" ||
            order.closed_at
          ) {
            totalSales +=
              Number(
                order.total ||
                  0
              );

            totalProfit +=
              Number(
                order.profit ||
                  0
              );

            deliveredOrders++;
          } else if (
            status !==
            "REJECTED"
          ) {
            pendingOrders++;
          }
        }
      );

      res.json({
        ok: true,

        summary: {
          totalOrders:
            orders.length,

          totalSales,

          totalProfit,

          deliveredOrders,

          pendingOrders
        }
      });
    } catch {
      res.json({
        ok: true,
        summary: {}
      });
    }
  }
);

/* =========================================================
   BOT PRODUCT FUNCTIONS
========================================================= */

async function getBotProducts(
  category = null
) {
  if (!supabase) {
    return [];
  }

  try {
    let query =
      supabase
        .from("products")
        .select("*")
        .order(
          "created_at",
          {
            ascending:
              false
          }
        );

    if (category) {
      query =
        query.eq(
          "category",
          category
        );
    }

    const {
      data,
      error
    } = await query;

    if (error) {
      console.error(
        "Bot products error:",
        error
      );

      return [];
    }

    return data || [];
  } catch (error) {
    console.error(
      "Bot products error:",
      error
    );

    return [];
  }
}

function productListKeyboard(
  products
) {
  const rows = [];

  for (const product of products) {
    rows.push([
      {
        text:
          `🛍️ ${
            product.name ||
            "Product"
          } - ${
            Number(
              product.sell_price ||
                0
            ).toLocaleString()
          } ETB`,

        callback_data:
          `product_${product.id}`
      }
    ]);
  }

  rows.push([
    {
      text:
        "⬅️ ወደ ምድቦች",

      callback_data:
        "product_categories"
    }
  ]);

  return {
    inline_keyboard:
      rows
  };
}

function productDetailsKeyboard(
  product
) {
  return {
    inline_keyboard: [
      [
        {
          text:
            "🛒 አሁን ይዘዙ",

          callback_data:
            `order_product_${product.id}`
        }
      ],

      [
        {
          text:
            "⬅️ ወደ ምርቶች",

          callback_data:
            `category_${
              product.category ||
              "other"
            }`
        }
      ],

      [
        {
          text:
            "📂 ምድቦች",

          callback_data:
            "product_categories"
        }
      ]
    ]
  };
}

/* =========================================================
   BOT SHOW CATEGORIES
========================================================= */

async function showBotCategories(
  chatId
) {
  await sendMessage(
    chatId,

    `🛍️ UNI MARKET\n\nየሚፈልጉትን የምርት ምድብ ይምረጡ፦`,

    {
      reply_markup:
        productCategoriesKeyboard()
    }
  );
}

/* =========================================================
   BOT SHOW CATEGORY PRODUCTS
========================================================= */

async function showBotCategory(
  chatId,
  category
) {
  category =
    validCategory(
      category
    );

  const products =
    await getBotProducts(
      category
    );

  const categoryName =
    PRODUCT_CATEGORIES.find(
      c =>
        c.id === category
    )?.name ||
    "🛍️ ሌሎች";

  if (!products.length) {
    return sendMessage(
      chatId,

      `${categoryName}\n\n❌ በዚህ ምድብ ላይ አሁን ምንም ምርት የለም።`,

      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  "⬅️ ምድቦች",

                callback_data:
                  "product_categories"
              }
            ]
          ]
        }
      }
    );
  }

  await sendMessage(
    chatId,

    `${categoryName}\n\n🛍️ የሚፈልጉትን ምርት ይምረጡ፦`,

    {
      reply_markup:
        productListKeyboard(
          products
        )
    }
  );
}

/* =========================================================
   BOT PRODUCT DETAIL
========================================================= */

async function showBotProduct(
  chatId,
  productId
) {
  if (!supabase) {
    return sendMessage(
      chatId,
      "❌ ሲስተሙ አሁን አይገኝም።"
    );
  }

  const {
    data: product,
    error
  } =
    await supabase
      .from("products")
      .select("*")
      .eq(
        "id",
        productId
      )
      .maybeSingle();

  if (error || !product) {
    return sendMessage(
      chatId,
      "❌ ይህ ምርት አልተገኘም።"
    );
  }

  const price =
    Number(
      product.sell_price ||
        0
    ).toLocaleString();

  const stock =
    Number(
      product.stock || 0
    );

  const text =
    `🛍️ ${
      product.name ||
      "Product"
    }\n\n` +

    `${
      product.description
        ? product.description +
          "\n\n"
        : ""
    }` +

    `💰 ዋጋ፦ ${price} ETB\n` +

    `📦 የቀረ እቃ፦ ${stock}\n\n` +

    `UNI MARKET`;

  if (product.photo_url) {
    try {
      await telegram(
        "sendPhoto",
        {
          chat_id:
            chatId,

          photo:
            product.photo_url,

          caption:
            text,

          reply_markup:
            productDetailsKeyboard(
              product
            )
        }
      );

      return;
    } catch (error) {
      console.error(
        "Bot product photo error:",
        error.message
      );
    }
  }

  await sendMessage(
    chatId,
    text,
    {
      reply_markup:
        productDetailsKeyboard(
          product
        )
    }
  );
}

/* =========================================================
   TELEGRAM BOT UPDATE HANDLER
========================================================= */

async function handleTelegramUpdate(
  update
) {
  if (!update) {
    return;
  }

  /* CALLBACK */

  if (
    update.callback_query
  ) {
    const callback =
      update.callback_query;

    const data =
      callback.data || "";

    const chatId =
      callback.message
        ?.chat?.id;

    if (!chatId) {
      return;
    }

    await answerCallbackQuery(
      callback.id
    );

    if (
      data ===
      "product_categories"
    ) {
      return showBotCategories(
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

      return showBotCategory(
        chatId,
        category
      );
    }

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

    if (
      data.startsWith(
        "order_product_"
      )
    ) {
      const productId =
        data.replace(
          "order_product_",
          ""
        );

      return sendMessage(
        chatId,

        `🛒 የመዘዣ ጥያቄዎ ተቀብሏል።\n\n📦 Product ID: ${productId}\n\n☎️ እባክዎ ስምዎን እና ስልክ ቁጥርዎን ይላኩ።`
      );
    }

    if (
      data.startsWith(
        "order_received_"
      )
    ) {
      const orderId =
        data.replace(
          "order_received_",
          ""
        );

      if (supabase) {
        try {
          await supabase
            .from("orders")
            .update({
              status:
                "DELIVERED",

              delivered_at:
                nowISO()
            })
            .eq(
              "id",
              orderId
            );
        } catch {}
      }

      return sendMessage(
        chatId,

        "✅ እቃዎ እንደደረሰ ተመዝግቧል።\n\n🙏 እናመሰግናለን!"
      );
    }

    return;
  }

  /* MESSAGE */

  const message =
    update.message;

  if (!message) {
    return;
  }

  const chatId =
    message.chat?.id;

  if (!chatId) {
    return;
  }

  const text =
    safeString(
      message.text
    );

  if (
    text === "/start" ||
    text.startsWith(
      "/start "
    ) ||
    text === "/products" ||
    text === "/catalog"
  ) {
    const parts =
      text.split(/\s+/);

    const startParam =
      parts[1] || "";

    if (
      startParam.startsWith(
        "category_"
      )
    ) {
      return showBotCategory(
        chatId,
        startParam.replace(
          "category_",
          ""
        )
      );
    }

    return showBotCategories(
      chatId
    );
  }

  if (
    text === "/help"
  ) {
    return sendMessage(
      chatId,

      `🛍️ UNI MARKET\n\n/products - ምርቶች\n/catalog - ምርቶች\n/start - ዋና ምናሌ`
    );
  }
}

/* =========================================================
   TELEGRAM WEBHOOK
========================================================= */

app.post(
  "/telegram/webhook",
  async (req, res) => {
    /*
      Telegram must receive 200 quickly.
    */

    res.sendStatus(200);

    try {
      await handleTelegramUpdate(
        req.body
      );
    } catch (error) {
      console.error(
        "Telegram webhook error:",
        error
      );
    }
  }
);

/* =========================================================
   TELEGRAM WEBHOOK SETUP
========================================================= */

async function setupTelegramWebhook() {
  if (!BOT_TOKEN) {
    console.warn(
      "Telegram webhook skipped: TELEGRAM_BOT_TOKEN missing"
    );

    return;
  }

  if (!WEBHOOK_URL) {
    console.warn(
      "Telegram webhook skipped: WEBHOOK_URL missing"
    );

    return;
  }

  try {
    const webhookUrl =
      WEBHOOK_URL.endsWith(
        "/telegram/webhook"
      )
        ? WEBHOOK_URL
        : `${WEBHOOK_URL}/telegram/webhook`;

    const result =
      await telegram(
        "setWebhook",
        {
          url:
            webhookUrl,

          allowed_updates: [
            "message",
            "callback_query"
          ]
        }
      );

    console.log(
      "Telegram webhook configured:",
      result
    );

    console.log(
      "Webhook URL:",
      webhookUrl
    );
  } catch (error) {
    console.error(
      "Telegram webhook setup error:",
      error.message
    );
  }
}

/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,

      service:
        "Telegram Sales Manager",

      time:
        nowISO(),

      supabase:
        Boolean(
          supabase
        ),

      telegram:
        Boolean(
          BOT_TOKEN
        ),

      bot_username:
        BOT_USERNAME,

      webhook:
        Boolean(
          WEBHOOK_URL
        )
    });
  }
);

/* =========================================================
   MAIN ADMIN
========================================================= */

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

/* =========================================================
   404
========================================================= */

app.use(
  (req, res) => {
    res.status(404).json({
      ok: false,
      error:
        "Not found"
    });
  }
);

/* =========================================================
   START
========================================================= */

app.listen(
  PORT,
  async () => {
    console.log(
      `Telegram Sales Manager running on port ${PORT}`
    );

    console.log(
      `Master Admin username: ${MASTER_ADMIN_USERNAME}`
    );

    console.log(
      `Master Admin password: ${MASTER_ADMIN_PASSWORD ? "configured" : "missing"}`
    );

    console.log(
      `Supabase: ${
        supabase
          ? "connected"
          : "not configured"
      }`
    );

    console.log(
      `Telegram Bot: ${
        BOT_TOKEN
          ? "configured"
          : "not configured"
      }`
    );

    console.log(
      `Bot username: @${BOT_USERNAME}`
    );

    await setupTelegramWebhook();
  }
);
