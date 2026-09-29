/* =========================================================
UNI MARKET — TELEGRAM ORDER ENGINE
ADDITIVE ORDER/CART SYSTEM
========================================================= */

const telegramOrderSessions = new Map();

/*
SESSION STRUCTURE

{
  step: "QUANTITY" | "CUSTOM_QUANTITY" | "CUSTOMER" |
        "CART" | "PAYMENT",

  cart: [
    {
      product_id,
      name,
      quantity,
      unit_price,
      buy_price,
      photo_url
    }
  ],

  pendingProductId: null,
  customerName: "",
  customerPhone: "",
  paymentMethod: ""
}
*/

function getTelegramSession(chatId) {
  const key = String(chatId);

  if (!telegramOrderSessions.has(key)) {
    telegramOrderSessions.set(key, {
      step: null,
      cart: [],
      pendingProductId: null,
      customerName: "",
      customerPhone: "",
      paymentMethod: ""
    });
  }

  return telegramOrderSessions.get(key);
}

function resetTelegramSession(chatId) {
  telegramOrderSessions.delete(
    String(chatId)
  );
}

function cartTotal(session) {
  return session.cart.reduce(
    (sum, item) =>
      sum +
      numberValue(item.unit_price, 0) *
        numberValue(item.quantity, 0),
    0
  );
}

function cartQuantity(session) {
  return session.cart.reduce(
    (sum, item) =>
      sum + numberValue(item.quantity, 0),
    0
  );
}

function formatMoney(value) {
  return `${numberValue(value, 0).toLocaleString()} ብር`;
}

function escapeTelegramHtml(value) {
  return safeString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function quantityKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "1",
          callback_data: "qty_1"
        },
        {
          text: "2",
          callback_data: "qty_2"
        },
        {
          text: "3",
          callback_data: "qty_3"
        },
        {
          text: "4",
          callback_data: "qty_4"
        }
      ],
      [
        {
          text: "✏️ ሌላ ብዛት",
          callback_data: "qty_custom"
        }
      ],
      [
        {
          text: "⬅️ ምርቶች",
          callback_data: "catalog"
        }
      ]
    ]
  };
}

function cartKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "➕ ሌላ ምርት ጨምር",
          callback_data: "cart_add_more"
        }
      ],
      [
        {
          text: "🧾 ትዕዛዝ አጠናቅ",
          callback_data: "cart_checkout"
        }
      ],
      [
        {
          text: "🗑️ ትዕዛዝ ሰርዝ",
          callback_data: "cart_cancel"
        }
      ]
    ]
  };
}

function paymentKeyboard(settings = {}) {
  const rows = [];

  /*
   * Supports different column names so the
   * existing payment_settings table can continue
   * working with different dashboard versions.
   */

  const advanceEnabled =
    settings.advance_payment !== false &&
    settings.enable_advance !== false &&
    settings.allow_advance !== false;

  const depositEnabled =
    settings.deposit_payment !== false &&
    settings.enable_deposit !== false &&
    settings.allow_deposit !== false;

  const fullEnabled =
    settings.full_payment !== false &&
    settings.enable_full_payment !== false &&
    settings.allow_full_payment !== false;

  if (advanceEnabled) {
    rows.push([
      {
        text: "💳 ቅድሚያ ክፍያ",
        callback_data: "payment_advance"
      }
    ]);
  }

  if (depositEnabled) {
    rows.push([
      {
        text: "💵 ቀብድ",
        callback_data: "payment_deposit"
      }
    ]);
  }

  if (fullEnabled) {
    rows.push([
      {
        text: "💰 ሙሉ ክፍያ",
        callback_data: "payment_full"
      }
    ]);
  }

  rows.push([
    {
      text: "❌ ሰርዝ",
      callback_data: "cart_cancel"
    }
  ]);

  return {
    inline_keyboard: rows
  };
}

async function getProductForOrder(productId) {
  if (!supabase) {
    throw new Error(
      "Supabase unavailable"
    );
  }

  const {
    data,
    error
  } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error(
      "Product not found"
    );
  }

  if (
    numberValue(data.stock, 0) <= 0
  ) {
    throw new Error(
      "ይህ ምርት አሁን ከእቃ አልቋል።"
    );
  }

  return data;
}

function addProductToCart(
  session,
  product,
  quantity
) {
  const qty = Math.floor(
    numberValue(quantity, 0)
  );

  if (qty <= 0) {
    throw new Error(
      "የምርት ብዛት ትክክል አይደለም።"
    );
  }

  const existing =
    session.cart.find(
      item =>
        String(item.product_id) ===
        String(product.id)
    );

  if (existing) {
    existing.quantity += qty;
  } else {
    session.cart.push({
      product_id:
        product.id,

      name:
        safeString(product.name) ||
        "ምርት",

      quantity:
        qty,

      unit_price:
        numberValue(
          product.sell_price,
          0
        ),

      buy_price:
        numberValue(
          product.buy_price,
          0
        ),

      photo_url:
        firstDefined(
          product.photo_url,
          product.photoUrl,
          product.photo
        )
    });
  }
}

function buildCartText(session) {
  if (!session.cart.length) {
    return "🛒 ቅርጫትዎ ባዶ ነው።";
  }

  let text =
    "🛒 <b>የትዕዛዝ ቅርጫት</b>\n\n";

  session.cart.forEach(
    (item, index) => {
      const lineTotal =
        numberValue(
          item.unit_price,
          0
        ) *
        numberValue(
          item.quantity,
          0
        );

      text +=
        `${index + 1}. <b>${escapeTelegramHtml(
          item.name
        )}</b>\n` +
        `   🔢 ብዛት: ${item.quantity}\n` +
        `   💰 አንዱ: ${formatMoney(
          item.unit_price
        )}\n` +
        `   💵 ድምር: ${formatMoney(
          lineTotal
        )}\n\n`;
    }
  );

  text +=
    `📦 ጠቅላላ ብዛት: <b>${cartQuantity(
      session
    )}</b>\n` +
    `💰 <b>ጠቅላላ ዋጋ: ${formatMoney(
      cartTotal(session)
    )}</b>`;

  return text;
}

async function sendCart(chatId) {
  const session =
    getTelegramSession(chatId);

  if (!session.cart.length) {
    return sendMessage(
      chatId,
      "🛒 ቅርጫትዎ ባዶ ነው።",
      {
        reply_markup:
          productCategoriesKeyboard()
      }
    );
  }

  return sendMessage(
    chatId,
    buildCartText(session),
    {
      parse_mode: "HTML",
      reply_markup:
        cartKeyboard()
    }
  );
}

async function startProductOrder(
  chatId,
  productId
) {
  const product =
    await getProductForOrder(
      productId
    );

  const session =
    getTelegramSession(chatId);

  session.pendingProductId =
    product.id;

  session.step =
    "QUANTITY";

  await sendMessage(
    chatId,

    `🛒 <b>${escapeTelegramHtml(
      product.name
    )}</b>\n\n` +
      `💰 ዋጋ: <b>${formatMoney(
        product.sell_price
      )}</b>\n` +
      `📦 ያለው: <b>${numberValue(
        product.stock,
        0
      )}</b>\n\n` +
      `🔢 እባክዎ የሚፈልጉትን ብዛት ይምረጡ።`,

    {
      parse_mode: "HTML",
      reply_markup:
        quantityKeyboard()
    }
  );
}

async function handleQuantity(
  chatId,
  quantity
) {
  const session =
    getTelegramSession(chatId);

  if (
    session.step !==
      "QUANTITY" &&
    session.step !==
      "CUSTOM_QUANTITY"
  ) {
    return;
  }

  if (
    !session.pendingProductId
  ) {
    return sendMessage(
      chatId,
      "⚠️ የሚያዙት ምርት አልተገኘም።"
    );
  }

  const qty =
    Math.floor(
      numberValue(
        quantity,
        0
      )
    );

  if (qty <= 0) {
    return sendMessage(
      chatId,
      "⚠️ እባክዎ ትክክለኛ ብዛት ያስገቡ።"
    );
  }

  const product =
    await getProductForOrder(
      session.pendingProductId
    );

  if (
    qty >
    numberValue(
      product.stock,
      0
    )
  ) {
    return sendMessage(
      chatId,
      `⚠️ የተፈለገው ብዛት ${qty} ነው፣ ነገር ግን ${numberValue(
        product.stock,
        0
      )} ብቻ ነው ያለው።`
    );
  }

  addProductToCart(
    session,
    product,
    qty
  );

  session.pendingProductId =
    null;

  session.step =
    "CART";

  await sendMessage(
    chatId,

    `✅ <b>${escapeTelegramHtml(
      product.name
    )}</b> × ${qty} ወደ ቅርጫት ተጨምሯል።`,

    {
      parse_mode: "HTML"
    }
  );

  await sendCart(chatId);
}

async function askCustomerDetails(
  chatId
) {
  const session =
    getTelegramSession(chatId);

  session.step =
    "CUSTOMER";

  await sendMessage(
    chatId,

    "👤 <b>የደንበኛ መረጃ</b>\n\n" +
      "እባክዎ <b>ሙሉ ስም + ስልክ ቁጥር</b> በአንድ መልዕክት ይላኩ።\n\n" +
      "ምሳሌ:\n" +
      "ካሚላ 0912345678",

    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                "❌ ሰርዝ",
              callback_data:
                "cart_cancel"
            }
          ]
        ]
      }
    }
  );
}

function parseCustomerDetails(
  text
) {
  const value =
    safeString(text);

  /*
   * Accept:
   * Name 0912345678
   * Name - 0912345678
   * Name / 0912345678
   * Name\n0912345678
   */

  const phoneMatch =
    value.match(
      /(?:\+251|251|0)?9\d{8}/
    );

  if (!phoneMatch) {
    return null;
  }

  const phone =
    phoneMatch[0];

  const name =
    value
      .replace(
        phone,
        ""
      )
      .replace(
        /[-/,:]/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  if (!name) {
    return null;
  }

  return {
    name,
    phone
  };
}

async function createTelegramOrder(
  chatId
) {
  if (!supabase) {
    throw new Error(
      "Supabase unavailable"
    );
  }

  const session =
    getTelegramSession(chatId);

  if (!session.cart.length) {
    throw new Error(
      "Cart is empty"
    );
  }

  if (
    !session.customerName ||
    !session.customerPhone
  ) {
    throw new Error(
      "Customer information missing"
    );
  }

  /*
   * Re-check stock immediately before creating
   * the order.
   */
  for (
    const item of session.cart
  ) {
    const product =
      await getProductForOrder(
        item.product_id
      );

    if (
      numberValue(
        product.stock,
        0
      ) <
      numberValue(
        item.quantity,
        0
      )
    ) {
      throw new Error(
        `የ${product.name} ያለው ብዛት አልበቃም።`
      );
    }

    /*
     * Refresh prices from DB so the order
     * always uses the current selling price.
     */
    item.unit_price =
      numberValue(
        product.sell_price,
        0
      );

    item.buy_price =
      numberValue(
        product.buy_price,
        0
      );

    item.name =
      safeString(
        product.name
      ) ||
      item.name;
  }

  const total =
    cartTotal(session);

  let paymentSettings =
    await getPaymentSettings();

  const paymentMethod =
    session.paymentMethod ||
    "FULL";

  /*
   * Payment amount.
   *
   * Dashboard settings can optionally define:
   * advance_amount
   * deposit_amount
   * advance_percent
   * deposit_percent
   */

  let paidAmount = 0;

  if (
    paymentMethod ===
    "ADVANCE"
  ) {
    if (
      paymentSettings.advance_amount !==
      undefined
    ) {
      paidAmount =
        numberValue(
          paymentSettings.advance_amount,
          0
        );
    } else if (
      paymentSettings.advance_percent !==
      undefined
    ) {
      paidAmount =
        total *
        numberValue(
          paymentSettings.advance_percent,
          0
        ) /
        100;
    } else {
      paidAmount =
        total;
    }
  } else if (
    paymentMethod ===
    "DEPOSIT"
  ) {
    if (
      paymentSettings.deposit_amount !==
      undefined
    ) {
      paidAmount =
        numberValue(
          paymentSettings.deposit_amount,
          0
        );
    } else if (
      paymentSettings.deposit_percent !==
      undefined
    ) {
      paidAmount =
        total *
        numberValue(
          paymentSettings.deposit_percent,
          0
        ) /
        100;
    } else {
      paidAmount =
        total;
    }
  } else {
    paidAmount =
      total;
  }

  /*
   * Try the richer order schema first.
   * If optional columns are not yet present,
   * fall back to the basic existing schema.
   */

  const orderPayload = {
    telegram_chat_id:
      String(chatId),

    telegram_user_id:
      String(chatId),

    customer_id:
      String(chatId),

    customer_name:
      session.customerName,

    customer_phone:
      session.customerPhone,

    status:
      "NEW",

    payment_status:
      "PENDING",

    payment_method:
      paymentMethod,

    total:
      total,

    paid_amount:
      paidAmount,

    profit:
      0,

    created_at:
      nowISO()
  };

  let orderResult =
    await supabase
      .from("orders")
      .insert(
        orderPayload
      )
      .select("*")
      .single();

  /*
   * If the current Supabase orders table does not
   * yet have one of the new optional columns,
   * use the existing columns so old deployment
   * does not immediately break.
   */
  if (
    orderResult.error
  ) {
    console.error(
      "Rich order insert failed:",
      orderResult.error
    );

    const fallbackPayload = {
      telegram_chat_id:
        String(chatId),

      customer_id:
        String(chatId),

      customer_name:
        session.customerName,

      customer_phone:
        session.customerPhone,

      status:
        "NEW",

      payment_status:
        "PENDING",

      total:
        total
    };

    orderResult =
      await supabase
        .from("orders")
        .insert(
          fallbackPayload
        )
        .select("*")
        .single();
  }

  if (
    orderResult.error
  ) {
    throw orderResult.error;
  }

  const order =
    orderResult.data;

  /*
   * Insert order_items if the table exists.
   */
  let itemsInserted =
    true;

  for (
    const item of session.cart
  ) {
    const lineTotal =
      numberValue(
        item.unit_price,
        0
      ) *
      numberValue(
        item.quantity,
        0
      );

    const lineProfit =
      (
        numberValue(
          item.unit_price,
          0
        ) -
        numberValue(
          item.buy_price,
          0
        )
      ) *
      numberValue(
        item.quantity,
        0
      );

    const itemPayload = {
      order_id:
        order.id,

      product_id:
        item.product_id,

      product_name:
        item.name,

      quantity:
        item.quantity,

      unit_price:
        item.unit_price,

      buy_price:
        item.buy_price,

      line_total:
        lineTotal,

      line_profit:
        lineProfit
    };

    const {
      error
    } =
      await supabase
        .from("order_items")
        .insert(
          itemPayload
        );

    if (error) {
      /*
       * Do not fail the entire order if the
       * optional order_items table has not yet
       * been created.
       */
      itemsInserted =
        false;

      console.error(
        "order_items insert error:",
        error.message
      );

      break;
    }
  }

  /*
   * Calculate profit.
   */
  const profit =
    session.cart.reduce(
      (sum, item) =>
        sum +
        (
          numberValue(
            item.unit_price,
            0
          ) -
          numberValue(
            item.buy_price,
            0
          )
        ) *
          numberValue(
            item.quantity,
            0
          ),
      0
    );

  /*
   * Update profit/payment details if available.
   */
  try {
    await supabase
      .from("orders")
      .update({
        profit:
          profit,

        paid_amount:
          paidAmount,

        payment_method:
          paymentMethod
      })
      .eq(
        "id",
        order.id
      );
  } catch {}

  /*
   * Send admin notification.
   */
  const adminChat =
    safeString(
      ADMIN_CHAT_ID
    );

  let itemText = "";

  session.cart.forEach(
    item => {
      itemText +=
        `• ${item.name} × ${item.quantity} = ${formatMoney(
          item.unit_price *
            item.quantity
        )}\n`;
    }
  );

  if (adminChat) {
    try {
      await sendMessage(
        adminChat,

        `🛒 <b>አዲስ ትዕዛዝ</b>\n\n` +
          `👤 ስም: <b>${escapeTelegramHtml(
            session.customerName
          )}</b>\n` +
          `📱 ስልክ: <b>${escapeTelegramHtml(
            session.customerPhone
          )}</b>\n` +
          `🆔 Order ID: <code>${order.id}</code>\n\n` +
          `${itemText}\n` +
          `💰 <b>ጠቅላላ: ${formatMoney(
            total
          )}</b>\n` +
          `💳 የክፍያ አይነት: <b>${paymentMethod}</b>\n` +
          `⏳ ሁኔታ: <b>NEW</b>`,

        {
          parse_mode:
            "HTML"
        }
      );
    } catch (
      notificationError
    ) {
      console.error(
        "Admin order notification error:",
        notificationError.message
      );
    }
  }

  return {
    order,
    total,
    paidAmount,
    profit,
    itemsInserted
  };
}

async function showPaymentOptions(
  chatId
) {
  const session =
    getTelegramSession(chatId);

  if (!session.cart.length) {
    return sendCart(chatId);
  }

  const settings =
    await getPaymentSettings();

  const total =
    cartTotal(session);

  await sendMessage(
    chatId,

    `💳 <b>የክፍያ አማራጭ</b>\n\n` +
      `🛒 የምርቶች ብዛት: <b>${cartQuantity(
        session
      )}</b>\n` +
      `💰 ጠቅላላ ዋጋ: <b>${formatMoney(
        total
      )}</b>\n\n` +
      `እባክዎ የክፍያ አማራጩን ይምረጡ።`,

    {
      parse_mode:
        "HTML",

      reply_markup:
        paymentKeyboard(
          settings
        )
    }
  );
}

async function finishTelegramOrder(
  chatId
) {
  const session =
    getTelegramSession(chatId);

  try {
    const result =
      await createTelegramOrder(
        chatId
      );

    const orderId =
      result.order.id;

    await sendMessage(
      chatId,

      `🎉 <b>ትዕዛዝዎ ተመዝግቧል!</b>\n\n` +
        `🆔 የትዕዛዝ ቁጥር: <code>${orderId}</code>\n` +
        `💰 ጠቅላላ ዋጋ: <b>${formatMoney(
          result.total
        )}</b>\n` +
        `💳 የሚከፈል: <b>${formatMoney(
          result.paidAmount
        )}</b>\n\n` +
        `📸 እባክዎ የክፍያ ደረሰኝዎን ፎቶ ይላኩ።\n\n` +
        `⏳ ደረሰኙ በአስተዳደሩ ከተረጋገጠ በኋላ ትዕዛዝዎ ይረጋገጣል።`,

      {
        parse_mode:
          "HTML"
      }
    );

    /*
     * Keep the session long enough to accept the receipt.
     */
    session.step =
      "RECEIPT";

    session.orderId =
      orderId;

    return result;
  } catch (error) {
    console.error(
      "CREATE TELEGRAM ORDER ERROR:",
      error
    );

    await sendMessage(
      chatId,

      `⚠️ <b>ትዕዛዙ ሊመዘገብ አልቻለም።</b>\n\n${escapeTelegramHtml(
        error.message
      )}`,

      {
        parse_mode:
          "HTML"
      }
    );

    return null;
  }
}
