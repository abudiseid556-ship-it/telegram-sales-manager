const express=require("express");
const {createClient}=require("@supabase/supabase-js");
const TelegramBot=require("node-telegram-bot-api");
const multer=require("multer");
const path=require("path");
const crypto=require("crypto");

const app=express();
const PORT=process.env.PORT||10000;

const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const TELEGRAM_BOT_TOKEN=process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_BOT_USERNAME=(process.env.TELEGRAM_BOT_USERNAME||"uni_market_shop_bot").replace(/^@/,"");
const WEBHOOK_URL=process.env.WEBHOOK_URL||"https://telegram-sales-manager-ga96.onrender.com/telegram/webhook";
const ADMIN_CHAT_ID=process.env.ADMIN_CHAT_ID;

const MASTER_ADMIN_USERNAME=process.env.MASTER_ADMIN_USERNAME||"admin";
const MASTER_ADMIN_PASSWORD=process.env.MASTER_ADMIN_PASSWORD||"";
const AUTH_SECRET=process.env.AUTH_SECRET||SUPABASE_SERVICE_ROLE_KEY;

if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY){
 console.error("❌ Supabase ENV missing");
 process.exit(1);
}

if(!MASTER_ADMIN_PASSWORD){
 console.error("⚠️ MASTER_ADMIN_PASSWORD is missing");
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
app.use(express.static(path.join(__dirname,"public")));


/* =========================================================
AUTH
========================================================= */

const PERMISSIONS=[
 "view_orders",
 "verify_payment",
 "confirm_order",
 "view_products",
 "add_product",
 "edit_product",
 "delete_product",
 "advertising",
 "publish_advertisement",
 "payment_settings",
 "telegram_settings",
 "reports",
 "employees"
];

function base64url(input){
 return Buffer.from(input)
  .toString("base64")
  .replace(/\+/g,"-")
  .replace(/\//g,"_")
  .replace(/=+$/,"");
}

function fromBase64url(input){
 return Buffer.from(
  input.replace(/-/g,"+").replace(/_/g,"/"),
  "base64"
 ).toString();
}

function hashPassword(password){
 const salt=crypto.randomBytes(16).toString("hex");
 const hash=crypto.scryptSync(
  String(password),
  salt,
  64
 ).toString("hex");

 return `${salt}:${hash}`;
}

function verifyPassword(password,stored){
 try{
  const [salt,storedHash]=String(stored||"").split(":");

  if(!salt||!storedHash)return false;

  const hash=crypto.scryptSync(
   String(password),
   salt,
   64
  ).toString("hex");

  return crypto.timingSafeEqual(
   Buffer.from(hash,"hex"),
   Buffer.from(storedHash,"hex")
  );
 }catch{
  return false;
 }

}

function createToken(payload){
 const data={
  ...payload,
  exp:Date.now()+1000*60*60*24
 };

 const encoded=base64url(JSON.stringify(data));

 const signature=crypto
  .createHmac("sha256",AUTH_SECRET)
  .update(encoded)
  .digest("hex");

 return `${encoded}.${signature}`;
}

function verifyToken(token){
 try{
  const parts=String(token||"").split(".");

  if(parts.length!==2)return null;

  const encoded=parts[0];
  const signature=parts[1];

  const expected=crypto
   .createHmac("sha256",AUTH_SECRET)
   .update(encoded)
   .digest("hex");

  if(
   signature.length!==expected.length||
   !crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
   )
  ){
   return null;
  }

  const payload=JSON.parse(fromBase64url(encoded));

  if(!payload.exp||Date.now()>payload.exp){
   return null;
  }

  return payload;
 }catch{
  return null;
 }
}

function getToken(req){
 const header=String(req.headers.authorization||"");

 if(!header.startsWith("Bearer ")){
  return null;
 }

 return header.slice(7).trim();
}

async function getEmployeePermissions(employeeId){
 const {data,error}=await supabase
  .from("employee_permissions")
  .select("permission,enabled")
  .eq("employee_id",employeeId)
  .eq("enabled",true);

 if(error)throw error;

 return (data||[])
  .map(x=>x.permission)
  .filter(x=>PERMISSIONS.includes(x));
}

async function getCurrentUser(req){
 const token=getToken(req);

 if(!token)return null;

 const payload=verifyToken(token);

 if(!payload)return null;

 if(payload.role==="master"){
  return {
   id:"master",
   role:"master",
   username:MASTER_ADMIN_USERNAME,
   name:"Master Admin",
   permissions:[...PERMISSIONS]
  };
 }

 if(payload.role==="employee"){
  const {data:employee,error}=await supabase
   .from("employees")
   .select("id,name,username,phone,is_active")
   .eq("id",payload.id)
   .maybeSingle();

  if(error||!employee||!employee.is_active){
   return null;
  }

  const permissions=await getEmployeePermissions(employee.id);

  return {
   id:employee.id,
   role:"employee",
   name:employee.name,
   username:employee.username,
   phone:employee.phone||"",
   permissions
  };
 }

 return null;
}

async function requireAuth(req,res,next){
 try{
  const user=await getCurrentUser(req);

  if(!user){
   return res.status(401).json({
    error:"Unauthorized",
    message:"Login ያስፈልጋል።"
   });
  }

  req.user=user;
  next();
 }catch(err){
  console.error("AUTH:",err);
  res.status(500).json({error:"Authentication error"});
 }
}

function requireMaster(req,res,next){
 if(req.user?.role!=="master"){
  return res.status(403).json({
   error:"Forbidden",
   message:"Master Admin ብቻ ይህን ማድረግ ይችላል።"
  });
 }

 next();
}

function requirePermission(permission){
 return async(req,res,next)=>{
  try{
   if(req.user?.role==="master"){
    return next();
   }

   if(
    !req.user?.permissions||
    !req.user.permissions.includes(permission)
   ){
    return res.status(403).json({
     error:"Forbidden",
     message:`Permission የለዎትም: ${permission}`
    });
   }

   next();
  }catch(err){
   res.status(500).json({error:err.message});
  }
 };
}


/* =========================================================
ROOT
========================================================= */

app.get("/",(req,res)=>{
 res.sendFile(path.join(__dirname,"public","admin.html"));
});


/* =========================================================
HEALTH
========================================================= */

app.get("/api/health",(req,res)=>{
 res.json({
  success:true,
  message:"Telegram Sales Manager API is running ✅",
  telegram:!!bot
 });
});


/* =========================================================
AUTH LOGIN
========================================================= */

app.post("/api/auth/login",async(req,res)=>{
 try{
  const username=String(req.body.username||"").trim();
  const password=String(req.body.password||"");

  if(!username||!password){
   return res.status(400).json({
    error:"Username እና Password ያስፈልጋሉ።"
   });
  }

  /* MASTER ADMIN */

  if(username===MASTER_ADMIN_USERNAME){
   if(
    !MASTER_ADMIN_PASSWORD||
    password!==MASTER_ADMIN_PASSWORD
   ){
    return res.status(401).json({
     error:"Username ወይም Password ትክክል አይደለም።"
    });
   }

   const token=createToken({
    id:"master",
    role:"master"
   });

   return res.json({
    success:true,
    token,
    user:{
     id:"master",
     role:"master",
     name:"Master Admin",
     username:MASTER_ADMIN_USERNAME,
     permissions:[...PERMISSIONS]
    }
   });
  }

  /* EMPLOYEE */

  const {data:employee,error}=await supabase
   .from("employees")
   .select("*")
   .eq("username",username)
   .maybeSingle();

  if(error)throw error;

  if(
   !employee||
   !employee.is_active||
   !verifyPassword(password,employee.password_hash)
  ){
   return res.status(401).json({
    error:"Username ወይም Password ትክክል አይደለም።"
   });
  }

  const token=createToken({
   id:employee.id,
   role:"employee"
  });

  const permissions=await getEmployeePermissions(employee.id);

  res.json({
   success:true,
   token,
   user:{
    id:employee.id,
    role:"employee",
    name:employee.name,
    username:employee.username,
    phone:employee.phone||"",
    permissions
   }
  });

 }catch(err){
  console.error("LOGIN:",err);
  res.status(500).json({
   error:"Login error"
  });
 }
});

app.get("/api/auth/me",requireAuth,async(req,res)=>{
 res.json({
  success:true,
  user:req.user
 });
});

app.post("/api/auth/logout",requireAuth,(req,res)=>{
 res.json({
  success:true,
  message:"Logged out"
 });
});


/* =========================================================
EMPLOYEES
MASTER ONLY
========================================================= */

app.get(
 "/api/employees",
 requireAuth,
 requireMaster,
 async(req,res)=>{
  try{
   const {data,error}=await supabase
    .from("employees")
    .select("id,name,username,phone,is_active,created_at,updated_at")
    .order("id",{ascending:false});

   if(error)throw error;

   const employees=data||[];

   for(const employee of employees){
    employee.permissions=await getEmployeePermissions(employee.id);
   }

   res.json(employees);
  }catch(err){
   console.error("EMPLOYEES:",err);
   res.status(500).json({error:err.message});
  }
 }
);

app.post(
 "/api/employees",
 requireAuth,
 requireMaster,
 async(req,res)=>{
  try{
   const name=String(req.body.name||"").trim();
   const username=String(req.body.username||"").trim();
   const password=String(req.body.password||"");
   const phone=String(req.body.phone||"").trim();

   if(!name||!username||!password){
    return res.status(400).json({
     error:"Name, Username እና Password ያስፈልጋሉ።"
    });
   }

   if(password.length<6){
    return res.status(400).json({
     error:"Password ቢያንስ 6 ቁምፊ ይሁን።"
    });
   }

   const {data:existing}=await supabase
    .from("employees")
    .select("id")
    .eq("username",username)
    .maybeSingle();

   if(existing){
    return res.status(400).json({
     error:"ይህ Username ቀድሞ ተጠቅሟል።"
    });
   }

   const {data:employee,error}=await supabase
    .from("employees")
    .insert([{
     name,
     username,
     phone,
     password_hash:hashPassword(password),
     is_active:true
    }])
    .select("id,name,username,phone,is_active,created_at,updated_at")
    .single();

   if(error)throw error;

   res.json({
    success:true,
    employee:{
     ...employee,
     permissions:[]
    }
   });

  }catch(err){
   console.error("CREATE EMPLOYEE:",err);
   res.status(500).json({error:err.message});
  }
 }
);

app.patch(
 "/api/employees/:id",
 requireAuth,
 requireMaster,
 async(req,res)=>{
  try{
   const id=req.params.id;

   const update={};

   if(req.body.name!==undefined){
    update.name=String(req.body.name).trim();
   }

   if(req.body.username!==undefined){
    update.username=String(req.body.username).trim();
   }

   if(req.body.phone!==undefined){
    update.phone=String(req.body.phone).trim();
   }

   if(req.body.is_active!==undefined){
    update.is_active=Boolean(req.body.is_active);
   }

   if(req.body.password){
    if(String(req.body.password).length<6){
     return res.status(400).json({
      error:"Password ቢያንስ 6 ቁምፊ ይሁን።"
     });
    }

    update.password_hash=hashPassword(
     String(req.body.password)
    );
   }

   update.updated_at=new Date().toISOString();

   const {data,error}=await supabase
    .from("employees")
    .update(update)
    .eq("id",id)
    .select("id,name,username,phone,is_active,created_at,updated_at")
    .single();

   if(error)throw error;

   const permissions=await getEmployeePermissions(id);

   res.json({
    success:true,
    employee:{
     ...data,
     permissions
    }
   });

  }catch(err){
   console.error("UPDATE EMPLOYEE:",err);
   res.status(500).json({error:err.message});
  }
 }
);

app.delete(
 "/api/employees/:id",
 requireAuth,
 requireMaster,
 async(req,res)=>{
  try{
   const {error}=await supabase
    .from("employees")
    .delete()
    .eq("id",req.params.id);

   if(error)throw error;

   res.json({success:true});
  }catch(err){
   res.status(500).json({error:err.message});
  }
 }
);

app.put(
 "/api/employees/:id/permissions",
 requireAuth,
 requireMaster,
 async(req,res)=>{
  try{
   const employeeId=req.params.id;
   const permissions=Array.isArray(req.body.permissions)
    ?req.body.permissions
    :[];

   const clean=[...new Set(
    permissions.filter(x=>PERMISSIONS.includes(x))
   )];

   const {error:deleteError}=await supabase
    .from("employee_permissions")
    .delete()
    .eq("employee_id",employeeId);

   if(deleteError)throw deleteError;

   if(clean.length){
    const rows=clean.map(permission=>({
     employee_id:employeeId,
     permission,
     enabled:true
    }));

    const {error:insertError}=await supabase
     .from("employee_permissions")
     .insert(rows);

    if(insertError)throw insertError;
   }

   res.json({
    success:true,
    permissions:clean
   });

  }catch(err){
   console.error("PERMISSIONS:",err);
   res.status(500).json({error:err.message});
  }
 }
);


/* =========================================================
TELEGRAM SETTINGS
========================================================= */

async function getTelegramSettings(){
 const {data,error}=await supabase
  .from("telegram_settings")
  .select("*")
  .order("id",{ascending:true})
  .limit(1)
  .maybeSingle();

 if(error)throw error;

 return data||{
  id:null,
  ad_chat_id:"",
  ad_chat_title:"",
  detected_chat_id:"",
  detected_chat_title:"",
  bot_username:TELEGRAM_BOT_USERNAME
 };
}

app.get(
 "/api/telegram-settings",
 requireAuth,
 requirePermission("telegram_settings"),
 async(req,res)=>{
  try{
   res.json(await getTelegramSettings());
  }catch(err){
   res.status(500).json({error:err.message});
  }
 }
);

app.post(
 "/api/telegram-settings",
 requireAuth,
 requirePermission("telegram_settings"),
 async(req,res)=>{
  try{
   const adChatId=String(
    req.body.ad_chat_id||""
   ).trim();

   const botUsername=String(
    req.body.bot_username||TELEGRAM_BOT_USERNAME
   ).trim().replace(/^@/,"");

   const {data:old,error:findError}=await supabase
    .from("telegram_settings")
    .select("id")
    .order("id",{ascending:true})
    .limit(1)
    .maybeSingle();

   if(findError)throw findError;

   const payload={
    ad_chat_id:adChatId,
    bot_username:botUsername,
    updated_at:new Date().toISOString()
   };

   let result;

   if(old?.id){
    result=await supabase
     .from("telegram_settings")
     .update(payload)
     .eq("id",old.id)
     .select()
     .single();
   }else{
    result=await supabase
     .from("telegram_settings")
     .insert([payload])
     .select()
     .single();
   }

   if(result.error)throw result.error;

   res.json({
    success:true,
    settings:result.data
   });

  }catch(err){
   console.error("TELEGRAM SETTINGS:",err);
   res.status(500).json({error:err.message});
  }
 }
);


/* =========================================================
UPLOAD
========================================================= */

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

app.post(
 "/api/upload",
 requireAuth,
 (req,res,next)=>{
  upload.single("photo")(req,res,err=>{
   if(err){
    return res.status(400).json({
     error:err.message
    });
   }

   next();
  });
 },
 async(req,res)=>{
  try{
   if(!req.file){
    return res.status(400).json({
     error:"ፎቶ አልተገኘም።"
    });
   }

   const context=
    String(req.body.context||"product").toLowerCase();

   if(context==="ad"){
    if(
     req.user.role!=="master" &&
     !req.user.permissions.includes("advertising")
    ){
     return res.status(403).json({
      error:"Advertising permission የለዎትም።"
     });
    }
   }else{
    if(
     req.user.role!=="master" &&
     !req.user.permissions.includes("add_product") &&
     !req.user.permissions.includes("edit_product")
    ){
     return res.status(403).json({
      error:"Product upload permission የለዎትም።"
     });
    }
   }

   let ext=path
    .extname(req.file.originalname)
    .toLowerCase();

   if(
    ![".jpg",".jpeg",".png",".webp",".gif"]
     .includes(ext)
   ){
    ext=".jpg";
   }

   const folder=
    context==="ad"
    ?"ads"
    :"products";

   const fileName=
    `${folder}/img_${Date.now()}_${Math.random()
     .toString(36)
     .slice(2,8)}${ext}`;

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
 }
);


/* =========================================================
PRODUCTS
========================================================= */

app.get(
 "/api/products",
 requireAuth,
 requirePermission("view_products"),
 async(req,res)=>{
  try{
   const {data,error}=await supabase
    .from("products")
    .select("*")
    .order("id",{ascending:false});

   if(error)throw error;

   res.json(data||[]);
  }catch(err){
   res.status(500).json({error:err.message});
  }
 }
);

app.post(
 "/api/products",
 requireAuth,
 requirePermission("add_product"),
 async(req,res)=>{
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
   res.status(500).json({error:err.message});
  }
 }
);

app.patch(
 "/api/products/:id",
 requireAuth,
 requirePermission("edit_product"),
 async(req,res)=>{
  try{
   const {
    name,
    buyPrice,
    sellPrice,
    stock,
    photoUrl
   }=req.body;

   if(!name?.trim()){
    return res.status(400).json({
     error:"የምርት ስም ያስፈልጋል።"
    });
   }

   const buy=Number(buyPrice);
   const sell=Number(sellPrice);
   const qty=Number(stock);

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
    .update({
     name:name.trim(),
     buy_price:buy,
     sell_price:sell,
     stock:qty,
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
   res.status(500).json({error:err.message});
  }
 }
);

app.delete(
 "/api/products/:id",
 requireAuth,
 requirePermission("delete_product"),
 async(req,res)=>{
  try{
   const {error}=await supabase
    .from("products")
    .delete()
    .eq("id",req.params.id);

   if(error)throw error;

   res.json({success:true});
  }catch(err){
   res.status(500).json({error:err.message});
  }
 }
);


/* =========================================================
ADVERTISEMENTS
========================================================= */

app.get(
 "/api/advertisements",
 requireAuth,
 requirePermission("advertising"),
 async(req,res)=>{
  try{
   const {data,error}=await supabase
    .from("advertisements")
    .select("*")
    .order("id",{ascending:false});

   if(error)throw error;

   res.json(data||[]);
  }catch(err){
   res.status(500).json({error:err.message});
  }
 }
);

app.post(
 "/api/advertisements",
 requireAuth,
 requirePermission("advertising"),
 async(req,res)=>{
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

   const settings=await getTelegramSettings();

   const chatId=
    String(targetChatId||"").trim()||
    String(settings.ad_chat_id||"").trim()||
    null;

   const {data,error}=await supabase
    .from("advertisements")
    .insert([{
     product_id:productId
      ?String(productId)
      :null,
     title:title||"",
     text:text||"",
     photo_url:photoUrl||null,
     button_text:
      buttonText||
      "🛒 በዚህ ይዘዙን",
     ad_type:adType||"PRODUCT",
     discount:Number(discount)||0,
     old_price:Number(oldPrice)||0,
     start_at:startAt||null,
     end_at:endAt||null,
     target_chat_id:chatId,
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
   console.error("CREATE AD:",err);
   res.status(500).json({error:err.message});
  }
 }
);

app.patch(
 "/api/advertisements/:id",
 requireAuth,
 requirePermission("advertising"),
 async(req,res)=>{
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

   const settings=await getTelegramSettings();

   const chatId=
    String(targetChatId||"").trim()||
    String(settings.ad_chat_id||"").trim()||
    null;

   const {data,error}=await supabase
    .from("advertisements")
    .update({
     product_id:productId
      ?String(productId)
      :null,
     title:title||"",
     text:text||"",
     photo_url:photoUrl||null,
     button_text:
      buttonText||
      "🛒 በዚህ ይዘዙን",
     ad_type:adType||"PRODUCT",
     discount:Number(discount)||0,
     old_price:Number(oldPrice)||0,
     start_at:startAt||null,
     end_at:endAt||null,
     target_chat_id:chatId,
     status:status||"ACTIVE"
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
   console.error("UPDATE AD:",err);
   res.status(500).json({error:err.message});
  }
 }
);

app.delete(
 "/api/advertisements/:id",
 requireAuth,
 requirePermission("advertising"),
 async(req,res)=>{
  try{
   const {error}=await supabase
    .from("advertisements")
    .delete()
    .eq("id",req.params.id);

   if(error)throw error;

   res.json({success:true});
  }catch(err){
   res.status(500).json({error:err.message});
  }
 }
);


/* =========================================================
TELEGRAM AD PUBLISH
========================================================= */

app.post(
 "/api/advertisements/:id/publish",
 requireAuth,
 requirePermission("publish_advertisement"),
 async(req,res)=>{
  try{
   if(!bot){
    return res.status(400).json({
     error:"Telegram Bot አልተገናኘም።"
    });
   }

   const {data:ad,error:adError}=await supabase
    .from("advertisements")
    .select("*")
    .eq("id",req.params.id)
    .single();

   if(adError||!ad){
    return res.status(404).json({
     error:"Advertisement አልተገኘም።"
    });
   }

   const settings=await getTelegramSettings();

   const chatId=
    String(ad.target_chat_id||"").trim()||
    String(settings.ad_chat_id||"").trim();

   if(!chatId){
    return res.status(400).json({
     error:
      "Dashboard → Telegram Settings ላይ Channel/Group ID አስገባ።"
    });
   }

   let product=null;

   if(ad.product_id){
    const {data,error}=await supabase
     .from("products")
     .select("*")
     .eq("id",String(ad.product_id))
     .maybeSingle();

    if(error)throw error;

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
     `🛍️ ${product.name}\n`;

    caption+=
     `💰 ${Number(
      product.sell_price||0
     ).toLocaleString()} ETB\n`;

    if(Number(ad.old_price)>0){
     caption+=
      `❌ ${Number(
       ad.old_price
      ).toLocaleString()} ETB\n`;
    }

    if(Number(ad.discount)>0){
     caption+=
      `🔥 ${Number(ad.discount)}% OFF\n`;
    }

    caption+="\n";
   }

   caption+="👇 ለማዘዝ ከታች ይጫኑ።";

   const username=String(
    settings.bot_username||
    TELEGRAM_BOT_USERNAME
   ).replace(/^@/,"");

   const startParam=
    ad.product_id
    ?`?start=product_${encodeURIComponent(
      String(ad.product_id)
     )}`
    :"";

   const keyboard={
    inline_keyboard:[[
     {
      text:
       ad.button_text||
       "🛒 በዚህ ይዘዙን",
      url:
       `https://t.me/${username}${startParam}`
     }
    ]]
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
     published_at:
      new Date().toISOString()
    })
    .eq("id",ad.id);

   res.json({
    success:true,
    message:
     "Advertisement published successfully ✅",
    telegramMessageId:sent.message_id
   });

  }catch(err){
   console.error("PUBLISH AD:",err);
   res.status(500).json({
    error:err.message
   });
  }
 }
);


/* =========================================================
PAYMENT SETTINGS
========================================================= */

app.get(
 "/api/payment-settings",
 requireAuth,
 requirePermission("payment_settings"),
 async(req,res)=>{
  try{
   const {data,error}=await supabase
    .from("payment_settings")
    .select("*")
    .eq("is_active",true)
    .order("id",{ascending:false})
    .limit(1);

   if(error)throw error;

   res.json(data?.[0]||null);
  }catch(err){
   res.status(500).json({error:err.message});
  }
 }
);

app.post(
 "/api/payment-settings",
 requireAuth,
 requirePermission("payment_settings"),
 async(req,res)=>{
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

   const {error:disableError}=await supabase
    .from("payment_settings")
    .update({is_active:false})
    .eq("is_active",true);

   if(disableError)throw disableError;

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
   res.status(500).json({error:err.message});
  }
 }
);


/* =========================================================
ORDERS
========================================================= */

app.get(
 "/api/orders",
 requireAuth,
 requirePermission("view_orders"),
 async(req,res)=>{
  try{
   const {data,error}=await supabase
    .from("orders")
    .select("*")
    .order("created_at",{ascending:false});

   if(error)throw error;

   res.json(data||[]);
  }catch(err){
   res.status(500).json({error:err.message});
  }
 }
);

async function confirmOrder(order){
 const {data:product,error}=await supabase
  .from("products")
  .select("*")
  .eq("id",String(order.product_id))
  .maybeSingle();

 if(error)throw error;

 if(!product){
  throw new Error(
   "የትዕዛዙ Product አልተገኘም።"
  );
 }

 const stock=Number(product.stock||0);
 const quantity=Number(order.quantity||1);

 if(stock<quantity){
  throw new Error(
   `Stock አይበቃም። ያለው Stock: ${stock}`
  );
 }

 const {error:updateError}=await supabase
  .from("products")
  .update({
   stock:stock-quantity
  })
  .eq("id",product.id);

 if(updateError)throw updateError;
}

async function notifyOrderCustomer(order,status){
 if(!bot||!order.customer_id)return;

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
  ).catch(()=>{});
 }
}

app.patch(
 "/api/orders/:id",
 requireAuth,
 async(req,res)=>{
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

   if(
    status==="CONFIRMED" &&
    req.user.role!=="master" &&
    !req.user.permissions.includes("confirm_order")
   ){
    return res.status(403).json({
     error:"Confirm Order permission የለዎትም።"
    });
   }

   if(
    status==="REJECTED" &&
    req.user.role!=="master" &&
    !req.user.permissions.includes("verify_payment")
   ){
    return res.status(403).json({
     error:"Verify Payment permission የለዎትም።"
    });
   }

   if(
    status!=="CONFIRMED"&&
    status!=="REJECTED"&&
    req.user.role!=="master" &&
    !req.user.permissions.includes("view_orders")
   ){
    return res.status(403).json({
     error:"Order permission የለዎትም።"
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

   if(status===order.status){
    return res.json({
     success:true,
     status
    });
   }

   if(
    status==="CONFIRMED"&&
    order.status!=="CONFIRMED"
   ){
    try{
     await confirmOrder(order);
    }catch(err){
     return res.status(400).json({
      error:err.message
     });
    }
   }

   const {error}=await supabase
    .from("orders")
    .update({status})
    .eq("id",req.params.id);

   if(error)throw error;

   await notifyOrderCustomer(
    order,
    status
   );

   res.json({
    success:true,
    status
   });

  }catch(err){
   console.error("ORDER STATUS:",err);

   res.status(500).json({
    error:err.message
   });
  }
 }
);


/* =========================================================
TELEGRAM BOT
========================================================= */

let bot=null;

if(TELEGRAM_BOT_TOKEN){

 bot=new TelegramBot(
  TELEGRAM_BOT_TOKEN,
  {
   polling:false
  }
 );

 app.post(
  "/telegram/webhook",
  (req,res)=>{
   try{
    bot.processUpdate(req.body);
    res.sendStatus(200);
   }catch(err){
    console.error(
     "Webhook:",
     err
    );

    res.sendStatus(500);
   }
  }
 );

 app.get(
  "/api/telegram/webhook-info",
  async(req,res)=>{
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
  }
 );
}


/* =========================================================
BOT HELPERS
========================================================= */

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
   `🛍️ ${p.name} — ${
    Number(
     p.sell_price||0
    ).toLocaleString()
   } ETB`,
  callback_data:`product_${p.id}`
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
  `\n💰 መክፈል ያለብዎት: ${
   Number(total).toLocaleString()
  } ETB\n\n`+
  `📸 ክፍያ ካደረጉ በኋላ Receipt ፎቶ ይላኩ።`;

 return text;
}


/* =========================================================
BOT EVENTS
========================================================= */

if(bot){

 bot.setMyCommands([
  {
   command:"start",
   description:"🛍️ መግዛት ይጀምሩ"
  }
 ]).catch(()=>{});


 /* START */

 bot.onText(
  /^\/start(?:\s+(.+))?$/,
  async(msg,match)=>{
   try{
    const chatId=msg.chat.id;
    const param=String(
     match?.[1]||""
    ).trim();

    clearSession(chatId);

    const session=getSession(chatId);

    if(param.startsWith("product_")){

     const productId=
      param.slice(
       "product_".length
      );

     const {data:product,error}=await supabase
      .from("products")
      .select("*")
      .eq("id",String(productId))
      .maybeSingle();

     if(error)throw error;

     if(
      product&&
      Number(product.stock||0)>0
     ){

      session.product=product;
      session.quantity=1;
      session.step="QUANTITY";

      return bot.sendMessage(
       chatId,
       `🛍️ ${product.name}\n\n`+
       `💰 ${Number(
        product.sell_price||0
       ).toLocaleString()} ETB\n`+
       `📦 Stock: ${product.stock}\n\n`+
       `🔢 ስንት ይፈልጋሉ?`
      );
     }

     if(
      product&&
      Number(product.stock||0)<=0
     ){
      return bot.sendMessage(
       chatId,
       `❌ ${product.name}\n\n`+
       `ይህ ምርት አሁን ከStock ውጭ ነው።`
      );
     }
    }

    getSession(chatId);

    return bot.sendMessage(
     chatId,
     "👋 እንኳን ወደ UNI MARKET በደህና መጡ!\n\n"+
     "🛍️ ምርት ለመግዛት ከታች ያለውን ይጫኑ።",
     {
      reply_markup:{
       keyboard:[
        [{
         text:"🛍️ ምርቶች"
        }]
       ],
       resize_keyboard:true
      }
     }
    );

   }catch(err){
    console.error(
     "START ERROR:",
     err
    );

    bot.sendMessage(
     msg.chat.id,
     "❌ ስህተት ተፈጥሯል።"
    ).catch(()=>{});
   }
  }
 );


 /* MESSAGE */

 bot.on(
  "message",
  async msg=>{
   try{
    const chatId=msg.chat.id;
    const text=msg.text||"";

    if(text.startsWith("/start")){
     return;
    }

    if(msg.photo){
     return;
    }

    const session=getSession(chatId);

    if(text==="🛍️ ምርቶች"){
     session.step="PRODUCTS";
     return sendProducts(chatId);
    }

    if(session.step==="QUANTITY"){

     const quantity=parseInt(
      text,
      10
     );

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
      Number(session.product?.stock||0)
     ){
      return bot.sendMessage(
       chatId,
       `❌ በቂ Stock የለም። ያለው: ${
        session.product?.stock||0
       }`
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
      Number(
       p.sell_price||0
      )*
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
          callback_data:
           "confirm_order"
         }],
         [{
          text:"❌ ሰርዝ",
          callback_data:
           "cancel_order"
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


 /* CALLBACK */

 bot.on(
  "callback_query",
  async query=>{
   try{

    const data=query.data||"";
    const chatId=
     query.message?.chat?.id;

    await bot.answerCallbackQuery(
     query.id
    ).catch(()=>{});


    /* ADMIN */

    if(data.startsWith("admin_")){

     const parts=data.split("_");
     const action=parts[1];
     const orderId=
      parts.slice(2).join("_");

     if(
      String(chatId)!==
      String(ADMIN_CHAT_ID)
     ){
      return;
     }

     const status=
      action==="confirm"
      ?"CONFIRMED"
      :"REJECTED";

     const {data:order,error}=await supabase
      .from("orders")
      .select("*")
      .eq("id",orderId)
      .single();

     if(error||!order)return;

     if(
      status==="CONFIRMED"&&
      order.status!=="CONFIRMED"
     ){
      try{
       await confirmOrder(order);
      }catch(err){
       return bot.sendMessage(
        ADMIN_CHAT_ID,
        `❌ ${err.message}`
       );
      }
     }

     await supabase
      .from("orders")
      .update({status})
      .eq("id",orderId);

     await notifyOrderCustomer(
      order,
      status
     );

     if(
      query.message?.message_id
     ){
      await bot.editMessageCaption(
       `🧾 Receipt\n\n`+
       `Order: #${orderId}\n\n`+
       `Status: ${status}`,
       {
        chat_id:
         query.message.chat.id,
        message_id:
         query.message.message_id,
        reply_markup:{
         inline_keyboard:[]
        }
       }
      ).catch(()=>{});
     }

     return;
    }


    const session=getSession(
     chatId
    );

    if(data==="cancel_order"){

     clearSession(chatId);

     return bot.sendMessage(
      chatId,
      "❌ ትዕዛዙ ተሰርዟል።"
     );
    }


    if(data.startsWith("product_")){

     const id=
      data.slice(
       "product_".length
      );

     const {data:product,error}=await supabase
      .from("products")
      .select("*")
      .eq("id",String(id))
      .maybeSingle();

     if(error||!product){
      return bot.sendMessage(
       chatId,
       "❌ ምርቱ አልተገኘም።"
      );
     }

     if(
      Number(product.stock||0)<=0
     ){
      return bot.sendMessage(
       chatId,
       "❌ ይህ ምርት Stock የለውም።"
      );
     }

     session.product=product;
     session.quantity=1;
     session.step="QUANTITY";

     return bot.sendMessage(
      chatId,
      `🛍️ ${product.name}\n\n`+
      `💰 ${Number(
       product.sell_price||0
      ).toLocaleString()} ETB\n`+
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

     const current={
      quantity:session.quantity,
      name:session.name,
      phone:session.phone,
      address:session.address
     };

     const total=
      Number(p.sell_price||0)*
      current.quantity;

     const profit=
      (
       Number(p.sell_price||0)-
       Number(p.buy_price||0)
      )*
      current.quantity;

     const {data:order,error}=await supabase
      .from("orders")
      .insert([{
       product_id:String(p.id),
       product_name:p.name,
       buy_price:
        Number(p.buy_price||0),
       sell_price:
        Number(p.sell_price||0),
       quantity:current.quantity,
       total,
       profit,
       customer_id:String(chatId),
       customer_name:current.name,
       username:
        query.from.username
        ?`@${query.from.username}`
        :"",
       phone:current.phone,
       address:current.address,
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
      :`✅ ትዕዛዝዎ ተመዝግቧል።\n\n`+
       `⚠️ የክፍያ መረጃ አልተዘጋጀም።`
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


 /* ======================================================
 RECEIPT
 ====================================================== */

 bot.on(
  "photo",
  async msg=>{
   try{

    const chatId=msg.chat.id;
    const session=getSession(chatId);

    let orderId=session.orderId;
    let order=null;

    /*
     Server restart ቢሆንም latest pending order
     እንዲገኝ እንፈልጋለን።
    */

    if(orderId){

     const result=await supabase
      .from("orders")
      .select("*")
      .eq("id",orderId)
      .maybeSingle();

     order=result.data||null;
    }

    if(!order){

     const result=await supabase
      .from("orders")
      .select("*")
      .eq(
       "customer_id",
       String(chatId)
      )
      .in(
       "status",
       [
        "PENDING",
        "RECEIPT_PENDING",
        "VERIFYING"
       ]
      )
      .order(
       "created_at",
       {
        ascending:false
       }
      )
      .limit(1);

     order=result.data?.[0]||null;

     if(order){
      orderId=order.id;
      session.orderId=order.id;
     }
    }

    if(!orderId||!order){
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

    const {error:updateError}=await supabase
     .from("orders")
     .update({
      receipt_url:fileUrl,
      status:"VERIFYING"
     })
     .eq("id",orderId);

    if(updateError)throw updateError;

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
        `Order: #${orderId}\n`+
        `👤 ${order.customer_name||session.name||""}\n`+
        `📱 ${order.phone||session.phone||""}\n`+
        `📍 ${order.address||session.address||""}\n`+
        `🛍️ ${order.product_name||session.product?.name||""}\n`+
        `🔢 ${order.quantity||session.quantity||1}\n`+
        `💰 ${Number(order.total||0).toLocaleString()} ETB`,
       reply_markup:{
        inline_keyboard:[[
         {
          text:"✅ CONFIRM",
          callback_data:
           `admin_confirm_${orderId}`
         },
         {
          text:"❌ REJECT",
          callback_data:
           `admin_reject_${orderId}`
         }
        ]]
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


 /* ======================================================
 CHANNEL DETECTION
 ====================================================== */

 bot.on(
  "channel_post",
  async msg=>{
   try{

    if(!msg.chat)return;

    const chatId=String(
     msg.chat.id
    );

    const title=
     msg.chat.title||
     msg.chat.username||
     "";

    const {data:old,error:findError}=await supabase
     .from("telegram_settings")
     .select("id")
     .order("id",{ascending:true})
     .limit(1)
     .maybeSingle();

    if(findError)throw findError;

    const payload={
     detected_chat_id:chatId,
     detected_chat_title:title,
     updated_at:new Date().toISOString()
    };

    if(old?.id){

     await supabase
      .from("telegram_settings")
      .update(payload)
      .eq("id",old.id);

    }else{

     await supabase
      .from("telegram_settings")
      .insert([{
       ...payload,
       bot_username:
        TELEGRAM_BOT_USERNAME,
       ad_chat_id:""
      }]);

    }

    console.log(
     "📢 Telegram Channel detected:",
     chatId,
     title
    );

   }catch(err){
    console.error(
     "CHANNEL DETECTION:",
     err.message
    );
   }
  }
 );

}


/* =========================================================
SERVER
========================================================= */

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
