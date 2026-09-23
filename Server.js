
const express=require("express");
const {createClient}=require("@supabase/supabase-js");
const TelegramBot=require("node-telegram-bot-api");
const multer=require("multer");
const path=require("path");

const app=express();
const PORT=process.env.PORT||10000;

const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const TELEGRAM_BOT_TOKEN=process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL=process.env.WEBHOOK_URL||"https://telegram-sales-manager-ga96.onrender.com/telegram/webhook";
const ADMIN_CHAT_ID=process.env.ADMIN_CHAT_ID;
const TELEGRAM_AD_CHAT_ID=process.env.TELEGRAM_AD_CHAT_ID;

if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY){
console.error("❌ Supabase ENV missing");
process.exit(1);
}

const supabase=createClient(
SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY,
{
auth:{
autoRefreshToken:false,
persistSession:false
}
}
);

app.use(express.json({limit:"10mb"}));
app.use(express.urlencoded({extended:true}));
app.use(express.static("public"));

app.get("/",(req,res)=>{
res.sendFile(
path.join(__dirname,"public","admin.html")
);
});

let bot=null;

if(TELEGRAM_BOT_TOKEN){

bot=new TelegramBot(
TELEGRAM_BOT_TOKEN,
{polling:false}
);

app.post("/telegram/webhook",(req,res)=>{
try{
bot.processUpdate(req.body);
res.sendStatus(200);
}catch(err){
console.error("Webhook:",err);
res.sendStatus(500);
}
});

app.get("/api/telegram/webhook-info",async(req,res)=>{
try{
const info=await bot.getWebHookInfo();
res.json({
success:true,
webhook:info
});
}catch(err){
res.status(500).json({
success:false,
error:err.message
});
}
});
}

app.get("/api/health",(req,res)=>{
res.json({
success:true,
message:"Telegram Sales Manager API is running ✅",
telegram:!!bot
});
});


/* =========================
UPLOAD
========================= */

const upload=multer({
storage:multer.memoryStorage(),
limits:{
fileSize:5*1024*1024
},
fileFilter:(req,file,cb)=>{
if(!file.mimetype?.startsWith("image/")){
return cb(
new Error("የፎቶ ፋይል ብቻ ይፈቀዳል።")
);
}
cb(null,true);
}
});

app.post("/api/upload",(req,res,next)=>{

upload.single("photo")(
req,
res,
err=>{
if(err){
return res.status(400).json({
error:err.message
});
}
next();
}
);

},async(req,res)=>{

try{

if(!req.file){
return res.status(400).json({
error:"ፎቶ አልተገኘም።"
});
}

let ext=
path.extname(
req.file.originalname
).toLowerCase();

if(![
".jpg",
".jpeg",
".png",
".webp",
".gif"
].includes(ext)){
ext=".jpg";
}

const fileName=
`products/prod_${Date.now()}_${Math.random().toString(36).slice(2,8)}${ext}`;

const {error}=await supabase.storage
.from("product-photos")
.upload(
fileName,
req.file.buffer,
{
contentType:req.file.mimetype,
cacheControl:"3600",
upsert:false
}
);

if(error)throw error;

const {data}=supabase.storage
.from("product-photos")
.getPublicUrl(fileName);

res.json({
success:true,
url:data.publicUrl,
path:fileName
});

}catch(err){

console.error("UPLOAD:",err);

res.status(500).json({
error:err.message
});

}

});


/* =========================
PRODUCTS
========================= */

app.get("/api/products",async(req,res)=>{

try{

const {data,error}=await supabase
.from("products")
.select("*")
.order("id",{ascending:false});

if(error)throw error;

res.json(data||[]);

}catch(err){

res.status(500).json({
error:err.message
});

}

});


app.post("/api/products",async(req,res)=>{

try{

const {
name,
buyPrice,
sellPrice,
stock,
photoUrl
}=req.body;

const buy=Number(buyPrice);
const sell=Number(sellPrice);
const qty=Number(stock);

if(!name?.trim()){
return res.status(400).json({
error:"የምርት ስም ያስፈልጋል።"
});
}

if(
![buy,sell,qty].every(Number.isFinite)||
buy<0||
sell<0||
qty<0
){
return res.status(400).json({
error:"ዋጋ እና Stock ትክክለኛ ይሁን።"
});
}

const {data,error}=await supabase
.from("products")
.insert([{
name:name.trim(),
buy_price:buy,
sell_price:sell,
stock:qty,
photo_url:photoUrl||null
}])
.select()
.single();

if(error)throw error;

res.json({
success:true,
product:data
});

}catch(err){

res.status(500).json({
error:err.message
});

}

});


app.patch("/api/products/:id",async(req,res)=>{

try{

const {
name,
buyPrice,
sellPrice,
stock,
photoUrl
}=req.body;

const {data,error}=await supabase
.from("products")
.update({
name:name.trim(),
buy_price:Number(buyPrice),
sell_price:Number(sellPrice),
stock:Number(stock),
photo_url:photoUrl||null
})
.eq("id",req.params.id)
.select()
.single();

if(error)throw error;

res.json({
success:true,
product:data
});

}catch(err){

res.status(500).json({
error:err.message
});

}

});


app.delete("/api/products/:id",async(req,res)=>{

try{

const {error}=await supabase
.from("products")
.delete()
.eq("id",req.params.id);

if(error)throw error;

res.json({
success:true
});

}catch(err){

res.status(500).json({
error:err.message
});

}

});


/* =========================
ADVERTISEMENTS
========================= */

app.get("/api/advertisements",async(req,res)=>{

try{

const {data,error}=await supabase
.from("advertisements")
.select("*")
.order("id",{ascending:false});

if(error)throw error;

res.json(data||[]);

}catch(err){

res.status(500).json({
error:err.message
});

}

});


app.post("/api/advertisements",async(req,res)=>{

try{

const {
productId,
title,
text,
photoUrl,
buttonText,
adType,
discount,
oldPrice,
startAt,
endAt,
targetChatId
}=req.body;

const {data,error}=await supabase
.from("advertisements")
.insert([{

product_id:productId||null,

title:title||"",

text:text||"",

photo_url:photoUrl||null,

button_text:
buttonText||
"🛒 በዚህ ይዘዙን",

ad_type:
adType||
"PRODUCT",

discount:
Number(discount)||0,

old_price:
Number(oldPrice)||0,

start_at:
startAt||null,

end_at:
endAt||null,

target_chat_id:
targetChatId||
TELEGRAM_AD_CHAT_ID||
null,

status:"ACTIVE",

publish_status:"DRAFT"

}])
.select()
.single();

if(error)throw error;

res.json({
success:true,
advertisement:data
});

}catch(err){

console.error(
"CREATE AD:",
err
);

res.status(500).json({
error:err.message
});

}

});


app.patch("/api/advertisements/:id",async(req,res)=>{

try{

const {
productId,
title,
text,
photoUrl,
buttonText,
adType,
discount,
oldPrice,
startAt,
endAt,
targetChatId,
status
}=req.body;

const {data,error}=await supabase
.from("advertisements")
.update({

product_id:productId||null,

title:title||"",

text:text||"",

photo_url:photoUrl||null,

button_text:
buttonText||
"🛒 በዚህ ይዘዙን",

ad_type:
adType||
"PRODUCT",

discount:
Number(discount)||0,

old_price:
Number(oldPrice)||0,

start_at:
startAt||null,

end_at:
endAt||null,

target_chat_id:
targetChatId||
TELEGRAM_AD_CHAT_ID||
null,

status:
status||
"ACTIVE"

})
.eq("id",req.params.id)
.select()
.single();

if(error)throw error;

res.json({
success:true,
advertisement:data
});

}catch(err){

res.status(500).json({
error:err.message
});

}

});


app.delete("/api/advertisements/:id",async(req,res)=>{

try{

const {error}=await supabase
.from("advertisements")
.delete()
.eq("id",req.params.id);

if(error)throw error;

res.json({
success:true
});

}catch(err){

res.status(500).json({
error:err.message
});

}

});


/* =========================
TELEGRAM AD PUBLISH
========================= */

app.post(
"/api/advertisements/:id/publish",
async(req,res)=>{

try{

if(!bot){
return res.status(400).json({
error:"Telegram Bot አልተገናኘም።"
});
}

const {data:ad,error}=await supabase
.from("advertisements")
.select("*")
.eq("id",req.params.id)
.single();

if(error||!ad){
return res.status(404).json({
error:"Advertisement አልተገኘም።"
});
}

const chatId=
ad.target_chat_id||
TELEGRAM_AD_CHAT_ID;

if(!chatId){
return res.status(400).json({
error:"Telegram Channel/Group Chat ID አልተዘጋጀም።"
});
}

let product=null;

if(ad.product_id){

const {data}=await supabase
.from("products")
.select("*")
.eq("id",ad.product_id)
.single();

product=data||null;

}

let caption="";

if(ad.title){
caption+=`📢 ${ad.title}\n\n`;
}

if(ad.text){
caption+=`${ad.text}\n\n`;
}

if(product){

caption+=
`🛍️ ${product.name}\n`+
`💰 ${Number(product.sell_price).toLocaleString()} ETB\n`;

if(ad.old_price>0){

caption+=
`❌ ${Number(ad.old_price).toLocaleString()} ETB\n`;

}

if(Number(ad.discount)>0){

caption+=
`🔥 ${Number(ad.discount)}% OFF\n`;

}

caption+="\n";

}

caption+=
`👇 ለማዘዝ ከታች ይጫኑ።`;

const keyboard={

inline_keyboard:[

[{
text:
ad.button_text||
"🛒 በዚህ ይዘዙን",

url:
`https://t.me/${process.env.TELEGRAM_BOT_USERNAME||"uni_market_shop_bot"}?start=product_${ad.product_id||""}`
}]

]

};

let sent;

if(ad.photo_url){

sent=await bot.sendPhoto(
chatId,
ad.photo_url,
{
caption,
reply_markup:keyboard
}
);

}else{

sent=await bot.sendMessage(
chatId,
caption,
{
reply_markup:keyboard
}
);

}

await supabase
.from("advertisements")
.update({
publish_status:"PUBLISHED",
published_at:new Date().toISOString()
})
.eq("id",ad.id);

res.json({
success:true,
message:"Advertisement published successfully ✅",
telegramMessageId:sent.message_id
});

}catch(err){

console.error(
"PUBLISH AD:",
err
);

res.status(500).json({
error:err.message
});

}

});


/* =========================
PAYMENT SETTINGS
========================= */

app.get("/api/payment-settings",async(req,res)=>{

try{

const {data,error}=await supabase
.from("payment_settings")
.select("*")
.eq("is_active",true)
.order("id",{ascending:false})
.limit(1);

if(error)throw error;

res.json(
data?.[0]||null
);

}catch(err){

res.status(500).json({
error:err.message
});

}

});


app.post("/api/payment-settings",async(req,res)=>{

try{

const {
method,
accountName,
accountNumber,
phone,
additionalInfo
}=req.body;

if(!method?.trim()){

return res.status(400).json({
error:"የክፍያ ዘዴ ያስገቡ።"
});

}

await supabase
.from("payment_settings")
.update({
is_active:false
})
.eq("is_active",true);

const {data,error}=await supabase
.from("payment_settings")
.insert([{

method:method.trim(),

account_name:
accountName?.trim()||"",

account_number:
accountNumber?.trim()||"",

phone:
phone?.trim()||"",

additional_info:
additionalInfo?.trim()||"",

is_active:true

}])
.select()
.single();

if(error)throw error;

res.json({
success:true,
payment:data
});

}catch(err){

res.status(500).json({
error:err.message
});

}

});


/* =========================
ORDERS
========================= */

app.get("/api/orders",async(req,res)=>{

try{

const {data,error}=await supabase
.from("orders")
.select("*")
.order("created_at",{ascending:false});

if(error)throw error;

res.json(data||[]);

}catch(err){

res.status(500).json({
error:err.message
});

}

});


app.patch("/api/orders/:id",async(req,res)=>{

try{

const status=req.body.status;

const allowed=[
"NEW",
"PENDING",
"RECEIPT_PENDING",
"VERIFYING",
"CONFIRMED",
"REJECTED"
];

if(!allowed.includes(status)){

return res.status(400).json({
error:"Invalid order status"
});

}

const {data:order,error:orderError}=await supabase
.from("orders")
.select("*")
.eq("id",req.params.id)
.single();

if(orderError||!order){

return res.status(404).json({
error:"Order not found"
});

}

if(
status==="CONFIRMED"&&
order.status!=="CONFIRMED"
){

const {data:product,error}=await supabase
.from("products")
.select("*")
.eq("id",order.product_id)
.single();

if(error)throw error;

if(product){

const stock=
Number(product.stock||0);

const quantity=
Number(order.quantity||1);

if(stock<quantity){

return res.status(400).json({
error:
`Stock አይበቃም። ያለው Stock: ${stock}`
});

}

const {error:updateError}=await supabase
.from("products")
.update({
stock:stock-quantity
})
.eq("id",product.id);

if(updateError)throw updateError;

}

}

const {error}=await supabase
.from("orders")
.update({status})
.eq("id",req.params.id);

if(error)throw error;

if(bot&&order.customer_id){

let message=null;

if(status==="CONFIRMED"){

message=
"✅ ክፍያዎ ተረጋግጧል።\n\n"+
"🛍️ ትዕዛዝዎ ተቀብሏል።";

}

if(status==="REJECTED"){

message=
"❌ Receipt ማረጋገጫዎ አልተቀበለም።\n\n"+
"እባክዎ ትክክለኛ Receipt እንደገና ይላኩ።";

}

if(message){

await bot.sendMessage(
order.customer_id,
message
);

}

}

res.json({
success:true,
status
});

}catch(err){

console.error(
"ORDER STATUS:",
err
);

res.status(500).json({
error:err.message
});

}

});


/* =========================
BOT
========================= */

const sessions=new Map();

function getSession(id){

if(!sessions.has(id)){

sessions.set(id,{

step:"START",

product:null,

quantity:1,

name:"",

phone:"",

address:"",

orderId:null

});

}

return sessions.get(id);

}

function clearSession(id){

sessions.delete(id);

}


async function sendProducts(chatId){

const {data,error}=await supabase
.from("products")
.select("*")
.gt("stock",0)
.order("id",{ascending:false});

if(error||!data?.length){

return bot.sendMessage(
chatId,
"😔 አሁን ምርት የለንም።"
);

}

const buttons=data.map(p=>[{

text:
`🛍️ ${p.name} — ${Number(p.sell_price).toLocaleString()} ETB`,

callback_data:
`product_${p.id}`

}]);

return bot.sendMessage(
chatId,
"🛍️ ምርት ይምረጡ፦",
{
reply_markup:{
inline_keyboard:buttons
}
}
);

}


async function getPaymentMessage(total){

const {data,error}=await supabase
.from("payment_settings")
.select("*")
.eq("is_active",true)
.order("id",{ascending:false})
.limit(1);

if(error)throw error;

const payment=data?.[0];

if(!payment)return null;

let text=
`💳 የክፍያ መረጃ\n\n`+
`🏦 ${payment.method}\n`;

if(payment.account_name){

text+=
`👤 ${payment.account_name}\n`;

}

if(payment.account_number){

text+=
`🔢 ${payment.account_number}\n`;

}

if(payment.phone){

text+=
`📱 ${payment.phone}\n`;

}

if(payment.additional_info){

text+=
`\n📝 ${payment.additional_info}\n`;

}

text+=
`\n💰 መክፈል ያለብዎት: ${Number(total).toLocaleString()} ETB\n\n`+
`📸 ክፍያ ካደረጉ በኋላ Receipt ፎቶ ይላኩ።`;

return text;

}


if(bot){

bot.setMyCommands([

{
command:"start",
description:"🛍️ መግዛት ይጀምሩ"
}

]).catch(()=>{});


bot.onText(
/^\/start(?:\s.*)?$/,
msg=>{

const chatId=msg.chat.id;

clearSession(chatId);

getSession(chatId);

bot.sendMessage(
chatId,

"👋 እንኳን ወደ UNI MARKET በደህና መጡ!\n\n"+
"🛍️ ምርት ለመግዛት ከታች ያለውን ይጫኑ።",

{
reply_markup:{
keyboard:[
[
{text:"🛍️ ምርቶች"}
],
],
resize_keyboard:true
}
}

);

}
);


bot.on(
"message",
async msg=>{

try{

const chatId=msg.chat.id;
const text=msg.text||"";

if(text.startsWith("/start"))
return;

const session=getSession(chatId);

if(text==="🛍️ ምርቶች"){

session.step="PRODUCTS";

return sendProducts(chatId);

}

if(session.step==="QUANTITY"){

const quantity=
parseInt(text,10);

if(
!Number.isInteger(quantity)||
quantity<1
){

return bot.sendMessage(
chatId,
"❌ ትክክለኛ ብዛት ያስገቡ።"
);

}

if(
quantity>
Number(session.product.stock)
){

return bot.sendMessage(
chatId,
`❌ በቂ Stock የለም። ያለው: ${session.product.stock}`
);

}

session.quantity=quantity;
session.step="NAME";

return bot.sendMessage(
chatId,
"👤 ሙሉ ስምዎን ያስገቡ።"
);

}

if(session.step==="NAME"){

if(text.trim().length<2){

return bot.sendMessage(
chatId,
"❌ ሙሉ ስምዎን ያስገቡ።"
);

}

session.name=text.trim();
session.step="PHONE";

return bot.sendMessage(
chatId,
"📱 ስልክ ቁጥርዎን ያስገቡ።"
);

}

if(session.step==="PHONE"){

if(text.trim().length<7){

return bot.sendMessage(
chatId,
"❌ ትክክለኛ ስልክ ያስገቡ።"
);

}

session.phone=text.trim();
session.step="ADDRESS";

return bot.sendMessage(
chatId,
"📍 የመላኪያ አድራሻዎን ያስገቡ።"
);

}

if(session.step==="ADDRESS"){

if(text.trim().length<3){

return bot.sendMessage(
chatId,
"❌ አድራሻ ያስገቡ።"
);

}

session.address=text.trim();
session.step="REVIEW";

const p=session.product;

const total=
Number(p.sell_price)*
session.quantity;

return bot.sendMessage(

chatId,

`🧾 የትዕዛዝ ማረጋገጫ\n\n`+
`🛍️ ${p.name}\n`+
`🔢 ብዛት: ${session.quantity}\n`+
`💰 ${total.toLocaleString()} ETB\n\n`+
`👤 ${session.name}\n`+
`📱 ${session.phone}\n`+
`📍 ${session.address}`,

{
reply_markup:{
inline_keyboard:[

[{
text:"✅ ትዕዛዝ አረጋግጥ",
callback_data:"confirm_order"
}],

[{
text:"❌ ሰርዝ",
callback_data:"cancel_order"
}]

]
}
}

);

}

}catch(err){

console.error(
"BOT MESSAGE:",
err
);

}

}
);


bot.on(
"callback_query",
async query=>{

try{

const data=query.data||"";
const chatId=query.message?.chat?.id;

await bot.answerCallbackQuery(
query.id
);


if(data.startsWith("admin_")){

const parts=data.split("_");

const action=parts[1];
const orderId=parts[2];

const status=
action==="confirm"
?"CONFIRMED"
:"REJECTED";

const {data:order,error}=await supabase
.from("orders")
.select("*")
.eq("id",orderId)
.single();

if(error||!order){

return;
}

if(
status==="CONFIRMED"&&
order.status!=="CONFIRMED"
){

const {data:product,error}=await supabase
.from("products")
.select("*")
.eq("id",order.product_id)
.single();

if(error)throw error;

if(product){

const stock=
Number(product.stock||0);

const quantity=
Number(order.quantity||1);

if(stock<quantity){

return bot.sendMessage(
ADMIN_CHAT_ID,
"❌ Stock አይበቃም።"
);

}

await supabase
.from("products")
.update({
stock:stock-quantity
})
.eq("id",product.id);

}

}

await supabase
.from("orders")
.update({status})
.eq("id",orderId);

if(order.customer_id){

await bot.sendMessage(

order.customer_id,

status==="CONFIRMED"

?"✅ ክፍያዎ ተረጋግጧል። ትዕዛዝዎ ተቀብሏል።"

:"❌ Receipt አልተቀበለም። እባክዎ እንደገና ይላኩ።"

);

}

return;

}


const session=getSession(chatId);

if(data==="cancel_order"){

clearSession(chatId);

return bot.sendMessage(
chatId,
"❌ ትዕዛዙ ተሰርዟል።"
);

}


if(data.startsWith("product_")){

const id=
data.replace("product_","");

const {data:product,error}=await supabase
.from("products")
.select("*")
.eq("id",id)
.single();

if(error||!product){

return bot.sendMessage(
chatId,
"❌ ምርቱ አልተገኘም።"
);

}

session.product=product;
session.quantity=1;
session.step="QUANTITY";

return bot.sendMessage(

chatId,

`🛍️ ${product.name}\n\n`+
`💰 ${Number(product.sell_price).toLocaleString()} ETB\n`+
`📦 Stock: ${product.stock}\n\n`+
`🔢 ስንት ይፈልጋሉ?`

);

}


if(data==="confirm_order"){

const p=session.product;

if(!p){

return bot.sendMessage(
chatId,
"❌ የትዕዛዝ መረጃ ጠፍቷል።"
);

}

const total=
Number(p.sell_price)*
session.quantity;

const profit=
(
Number(p.sell_price)-
Number(p.buy_price)
)*
session.quantity;

const {data:order,error}=await supabase
.from("orders")
.insert([{

product_id:String(p.id),

product_name:p.name,

buy_price:
Number(p.buy_price),

sell_price:
Number(p.sell_price),

quantity:
session.quantity,

total,

profit,

customer_id:
String(chatId),

customer_name:
session.name,

username:
query.from.username
?`@${query.from.username}`
:"",

phone:
session.phone,

address:
session.address,

status:"PENDING"

}])
.select()
.single();

if(error)throw error;

session.orderId=order.id;
session.step="PAYMENT";

const payment=
await getPaymentMessage(total);

return bot.sendMessage(

chatId,

payment
?`✅ ትዕዛዝዎ ተመዝግቧል።\n\n${payment}`
:`✅ ትዕዛዝዎ ተመዝግቧል።\n\n⚠️ የክፍያ መረጃ አልተዘጋጀም።`

);

}

}catch(err){

console.error(
"CALLBACK:",
err
);

}

}
);


bot.on(
"photo",
async msg=>{

try{

const chatId=msg.chat.id;
const session=getSession(chatId);

if(!session.orderId){

return bot.sendMessage(
chatId,
"❌ መጀመሪያ ትዕዛዝ ያድርጉ።"
);

}

const photo=
msg.photo[
msg.photo.length-1
];

const fileUrl=
await bot.getFileLink(
photo.file_id
);

await supabase
.from("orders")
.update({

receipt_url:fileUrl,

status:"VERIFYING"

})
.eq("id",session.orderId);

await bot.sendMessage(

chatId,

"✅ Receipt ደርሶናል።\n\n"+
"⏳ Admin እየረጋገጠ ነው።"

);

if(ADMIN_CHAT_ID){

await bot.sendPhoto(

ADMIN_CHAT_ID,

photo.file_id,

{

caption:
`🧾 አዲስ Receipt\n\n`+
`Order: #${session.orderId}\n`+
`👤 ${session.name}\n`+
`📱 ${session.phone}\n`+
`🛍️ ${session.product?.name||""}\n`+
`🔢 ${session.quantity}`

},

{

reply_markup:{
inline_keyboard:[

[

{
text:"✅ CONFIRM",
callback_data:
`admin_confirm_${session.orderId}`
},

{
text:"❌ REJECT",
callback_data:
`admin_reject_${session.orderId}`
}

]

]
}

}

);

}

}catch(err){

console.error(
"RECEIPT:",
err
);

bot.sendMessage(
msg.chat.id,
"❌ Receipt ማስገባት አልተቻለም።"
).catch(()=>{});

}

}
);

}


app.listen(
PORT,
async()=>{

console.log(
`🚀 Server running on port ${PORT}`
);

if(bot){

try{

await bot.setWebHook(
WEBHOOK_URL
);

console.log(
"✅ Webhook:",
WEBHOOK_URL
);

}catch(err){

console.error(
"❌ Webhook:",
err.message
);

}

}

}
);
