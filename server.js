const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TELEGRAM_TOKEN = process.env.TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME || "yabustech_bot";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.get('/api/data', async (req, res) => {
    const [products, channels, orders, ads] = await Promise.all([
        supabase.from('products').select('*'),
        supabase.from('channels').select('*'),
        supabase.from('orders').select('*'),
        supabase.from('ads').select('*')
    ]);
    res.json({ products: products.data || [], channels: channels.data || [], orders: orders.data || [], ads: ads.data || [] });
});

app.post('/api/products', async (req, res) => {
    const { data, error } = await supabase.from('products').insert([req.body]);
    if (error) return res.status(400).json({ success: false, error: error.message });
    res.json({ success: true, data });
});

app.post('/api/ads', async (req, res) => {
    const ad = req.body;
    await supabase.from('ads').insert([ad]);

    const caption = `<b>📢 ${ad.type}</b>\n\n📌 <b>${ad.title}</b>\n${ad.text}\n`;
    const inlineKeyboard = {
        inline_keyboard: [
            [{ text: "🛒 አሁን ይዘዙ (Order Now)", url: `https://t.me/${BOT_USERNAME}?start=order_${ad.id}` }]
        ]
    };

    if (ad.photo) {
        await sendTelegramPhoto(ad.target_channel, ad.photo, caption, inlineKeyboard);
    } else {
        await sendTelegramMessage(ad.target_channel, caption, inlineKeyboard);
    }

    res.json({ success: true });
});

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML', reply_markup: replyMarkup })
    });
}

async function sendTelegramPhoto(chatId, photoUrl, caption, replyMarkup = null) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption: caption, parse_mode: 'HTML', reply_markup: replyMarkup })
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

