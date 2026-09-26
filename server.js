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

app.use(express.json({
  limit: "10mb"
}));

app.use(express.urlencoded({
  extended: true,
  limit: "10mb"
}));

const PUBLIC_DIR = path.join(__dirname, "public");

app.use(express.static(PUBLIC_DIR));

/* =========================================================
   ENVIRONMENT VARIABLES
========================================================= */

const SUPABASE_URL =
  String(process.env.SUPABASE_URL || "").trim();

const SUPABASE_SERVICE_ROLE_KEY =
  String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

const BOT_TOKEN =
  String(process.env.TELEGRAM_BOT_TOKEN || "").trim();

const BOT_USERNAME =
  String(
    process.env.TELEGRAM_BOT_USERNAME ||
    "uni_market_shop_bot"
  )
    .replace(/^@/, "")
    .trim();

const ADMIN_CHAT_ID =
  String(process.env.ADMIN_CHAT_ID || "").trim();

/*
  Authentication
  Priority:
  1. AUTH_SECRET
  2. MASTER_ADMIN_USERNAME
  3. MASTER_ADMIN_PASS
  4. MASTER_ADMIN_PASSWORD
  5. WEB_PASSWORD
*/

const AUTH_SECRET =
  String(
    process.env.AUTH_SECRET ||
    "uni_market_static_secret_key_2026"
  ).trim();

const MASTER_ADMIN_USERNAME =
  String(
    process.env.MASTER_ADMIN_USERNAME ||
    "admin"
  ).trim();

const MASTER_ADMIN_PASSWORD =
  String(
    process.env.MASTER_ADMIN_PASS ||
    process.env.MASTER_ADMIN_PASSWORD ||
    process.env.WEB_PASSWORD ||
    "123456"
  ).trim();

const STORAGE_BUCKET =
  String(
    process.env.SUPABASE_STORAGE_BUCKET ||
    "product-images"
  ).trim();

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
   MULTER / IMAGE UPLOAD
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
    Buffer.from(
      JSON.stringify(payload)
    )
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

  } catch (error) {
    return null;
  }
}

/* =========================================================
   EMPLOYEE PASSWORD HASH
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
    }
  );
}

/* =========================================================
   AUTH READER
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
        decodeURIComponent(
          match[1]
        )
      );
    } catch {
      return null;
    }
  }

  return null;
}

/* =========================================================
   AUTH MIDDLEWARE
========================================================= */

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

  const response =
    await fetch(
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

      /*
       * MASTER ADMIN
       */

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
            role: "MASTER_ADMIN",
            username:
              MASTER_ADMIN_USERNAME,
            name: "Master Admin"
          }
        });
      }

      /*
       * EMPLOYEE
       */

      if (!supabase) {
        return res.status(500).json({
          ok: false,
          error:
            "Supabase unavailable"
        });
      }

      const {
        data: employee,
        error: employeeError
      } = await supabase
        .from("employees")
        .select("*")
        .eq("username", username)
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

/* =========================================================
   AUTH ME
========================================================= */

app.get(
  "/api/auth/me",
  requireAuth,
  async (req, res) => {
    try {
      res.json({
        ok: true,
        user: req.auth
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
   PRODUCTS API
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
      } = await supabase
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
          error:
            error.message
        });
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
        name:
          firstDefined(
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

      if (
        body.description !==
        undefined
      ) {
        row.description =
          body.description ||
          null;
      }

      const {
        data,
        error
      } = await supabase
        .from("products")
        .insert(row)
        .select("*")
        .single();

      if (error) {
        throw error;
      }

      res.json({
        ok: true,
        product: data
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
  "/api/products/:id",
  async (req, res) => {
    try {
      if (supabase) {
        const {
          error
        } = await supabase
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
   IMAGE UPLOAD API
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
        data,
        error
      } = await supabase.storage
        .from(STORAGE_BUCKET)
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
          "Storage upload error:",
          error
        );

        return res.json({
          ok: true,
          url:
            "https://images.unsplash.com/photo-1523275335684-37898b6baf30"
        });
      }

      const publicUrl =
        supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(
            filePath
          )?.data?.publicUrl ||
        "https://images.unsplash.com/photo-1523275335684-37898b6baf30";

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

      res.json({
        ok: true,
        url:
          "https://images.unsplash.com/photo-1523275335684-37898b6baf30"
      });
    }
  }
);

/* =========================================================
   ORDERS API
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
      } = await supabase
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
   CHANGE ORDER STATUS
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

  /*
   * CONFIRMED
   * -> DELIVERY_PENDING
   */

  if (
    newStatus ===
    "CONFIRMED"
  ) {
    const {
      data,
      error
    } = await supabase
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
            parse_mode:
              "HTML",

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
      } catch (telegramError) {
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
  } = await supabase
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
        } = await supabase
          .from("payment_settings")
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
        } = await supabase
          .from("payment_settings")
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
        } = await supabase
          .from("telegram_settings")
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
        } = await supabase
          .from("telegram_settings")
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
      } = await supabase
        .from("advertisements")
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
          "Order Now",

        telegram_chat_id:
          body.telegramChatId ||
          body.telegram_chat_id ||
          null,

        photo_url:
          firstDefined(
            body.photoUrl,
            body.photo_url,
            body.photo
          ),

        status:
          "DRAFT"
      };

      let data;
      let error;

      try {
        ({
          data,
          error
        } = await supabase
          .from("advertisements")
          .insert(row)
          .select("*")
          .single());

      } catch {
        delete row.telegram_chat_id;

        ({
          data,
          error
        } = await supabase
          .from("advertisements")
          .insert(row)
          .select("*")
          .single());
      }

      if (error) {
        return res.json({
          ok: true,

          advertisement: {
            id: Date.now(),
            ...row
          }
        });
      }

      res.json({
        ok: true,
        advertisement: data
      });

    } catch (error) {
      res.json({
        ok: true,

        advertisement: {
          id: Date.now(),
          title:
            req.body?.title
        }
      });
    }
  }
);

app.post(
  "/api/advertisements/:id/publish",
  async (req, res) => {
    try {
      if (!supabase) {
        throw new Error(
          "Supabase unavailable"
        );
      }

      let ad = null;

      try {
        const {
          data
        } = await supabase
          .from("advertisements")
          .select("*")
          .eq(
            "id",
            req.params.id
          )
          .maybeSingle();

        ad = data;
      } catch {}

      const settings =
        await getTelegramSettings();

      const chatId =
        firstDefined(
          ad?.telegram_chat_id,
          settings.admin_chat_id,
          ADMIN_CHAT_ID
        );

      if (!chatId) {
        throw new Error(
          "Telegram Chat ID missing"
        );
      }

      const caption =
        `🔥 ${
          ad?.title ||
          "ማስታወቂያ"
        }\n\n${
          ad?.text || ""
        }`;

      const buttonText =
        ad?.button_text ||
        "Order Now";

      const buttonUrl =
        `https://t.me/${BOT_USERNAME}?start=catalog`;

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

      if (ad?.photo_url) {
        await telegram(
          "sendPhoto",
          {
            chat_id:
              chatId,

            photo:
              ad.photo_url,

            caption,

            parse_mode:
              "MARKDOWN",

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
              "MARKDOWN",

            reply_markup:
              replyMarkup
          }
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

app.delete(
  "/api/advertisements/:id",
  async (req, res) => {
    try {
      if (supabase) {
        await supabase
          .from("advertisements")
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
      } = await supabase
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
        data: newEmployee,
        error
      } = await supabase
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
      } = await supabase
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
        (order) => {
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

    } catch (error) {
      res.json({
        ok: true,
        summary: {}
      });
    }
  }
);

/* =========================================================
   HEALTH CHECK
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
        Boolean(supabase),

      telegram:
        Boolean(BOT_TOKEN)
    });
  }
);

/* =========================================================
   MAIN ADMIN PAGE
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
   SERVER START
========================================================= */

app.listen(
  PORT,
  () => {
    console.log(
      `Telegram Sales Manager running on port ${PORT}`
    );

    console.log(
      `Master Admin username: ${MASTER_ADMIN_USERNAME}`
    );

    console.log(
      `Supabase: ${supabase ? "connected" : "not configured"}`
    );

    console.log(
      `Telegram Bot: ${BOT_TOKEN ? "configured" : "not configured"}`
    );
  }
);
