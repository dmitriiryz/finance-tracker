import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// Server-side only. Never put it in frontend code.
const BOT_TOKEN = Deno.env.get("BOT_TOKEN") || "";
// Server-side only. Never put it in frontend code.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function jsonResponse(body: unknown, status = 200){
  return Response.json(body, {status, headers: corsHeaders});
}

function bytesToHex(bytes: ArrayBuffer){
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function hmacSha256(key: Uint8Array, data: string){
  const cryptoKey = await crypto.subtle.importKey("raw", key, {name:"HMAC", hash:"SHA-256"}, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function verifyTelegramInitData(initData: string){
  if(!BOT_TOKEN) throw new Error("BOT_TOKEN is missing");
  if(!initData) throw new Error("Telegram initData is empty");

  const params = new URLSearchParams(initData);
  const hash = params.get("hash") || "";
  if(!hash) throw new Error("Telegram initData hash is missing");

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a],[b])=>a.localeCompare(b))
    .map(([k,v])=>`${k}=${v}`)
    .join("\n");

  const secret = new Uint8Array(await hmacSha256(new TextEncoder().encode("WebAppData"), BOT_TOKEN));
  const calculated = bytesToHex(await hmacSha256(secret, dataCheckString));
  if(calculated !== hash) throw new Error("Telegram initData hash is invalid");
}

function parseTelegramUserFromInitData(initData: string){
  if(!initData) return null;
  try{
    const raw = new URLSearchParams(initData).get("user");
    return raw ? JSON.parse(raw) : null;
  }catch(e){
    console.warn("tg-auth initData user parse failed:", e?.message || String(e));
    return null;
  }
}

function normalizeTelegramUser(user: any){
  const id = user?.id || user?.tg_id;
  if(!id) return null;
  return {
    id: Number(id),
    first_name: user.first_name || null,
    username: user.username || null
  };
}

Deno.serve(async (req) => {
  if(req.method === "OPTIONS"){
    return new Response("ok", {status:200, headers: corsHeaders});
  }

  try{
    if(req.method !== "POST"){
      return new Response("Method not allowed", {status:405, headers: corsHeaders});
    }

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const {initData} = await req.json();
    console.log("tg-auth initData exists:", Boolean(initData));

    await verifyTelegramInitData(initData);
    const tgUser = normalizeTelegramUser(parseTelegramUserFromInitData(initData));
    console.log("tg-auth telegram user:", tgUser?.id || null);
    if(!tgUser) return jsonResponse({error:"Telegram user is missing"}, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const {data:{user}, error:userError} = await admin.auth.getUser(token);
    console.log("tg-auth supabase user:", user?.id || null);
    if(userError || !user) throw userError || new Error("Supabase auth user is missing");

    const now = new Date().toISOString();
    const existing = await admin.from("app_users").select("*").eq("tg_id", tgUser.id).maybeSingle();
    if(existing.error) throw existing.error;

    let appUser = existing.data;
    if(appUser){
      const updated = await admin.from("app_users")
        .update({first_name:tgUser.first_name, username:tgUser.username, updated_at:now})
        .eq("tg_id", tgUser.id)
        .select("*")
        .single();
      if(updated.error) throw updated.error;
      appUser = updated.data;
    }else{
      const inserted = await admin.from("app_users")
        .insert({id:user.id, tg_id:tgUser.id, first_name:tgUser.first_name, username:tgUser.username, updated_at:now})
        .select("*")
        .single();
      if(inserted.error) throw inserted.error;
      appUser = inserted.data;
    }

    const session = await admin.from("app_user_sessions").upsert({
      auth_user_id:user.id,
      app_user_id:appUser.id,
      tg_id:tgUser.id,
      updated_at:now
    }, {onConflict:"auth_user_id"});
    if(session.error) throw session.error;

    console.log("tg-auth linked session:", {current_auth_user_id:user.id, app_user_id:appUser.id, tg_id:tgUser.id});
    return jsonResponse({app_user:appUser, current_auth_user_id:user.id, tg_id:tgUser.id, session_linked:true});
  }catch(e){
    const message = e?.message || String(e);
    console.error("tg-auth error:", message);
    return Response.json(
      { error: message },
      { status: 401, headers: corsHeaders }
    );
  }
});
