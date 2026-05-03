const SUPABASE_URL = "https://vstdcekxtaxmzmmpnetf.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_17Z9a4l47A003ozhgKBw4w_uAOd_St_";

let supabaseClient = null;

function isSupabaseConfigured(){
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY && window.supabase?.createClient);
}

function getSupabaseClient(){
  if(!isSupabaseConfigured()) return null;
  if(!supabaseClient){
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
    });
  }
  return supabaseClient;
}

function getTelegramUser(){
  // Telegram.WebApp.initDataUnsafe is convenient client-side context, but it is not reliable authorization
  // unless the signed initData is verified on a backend or Supabase Edge Function.
  let user = window.Telegram?.WebApp?.initDataUnsafe?.user || null;
  if(!user) return null;
  return {
    tg_id: user.id,
    first_name: user.first_name || '',
    username: user.username || '',
    language_code: user.language_code || ''
  };
}

async function supabaseFunctionErrorMessage(error){
  if(!error) return 'Unknown Supabase function error';
  let message = error.message || String(error);
  try{
    if(error.context?.json){
      let body = await error.context.json();
      if(body?.error) message += ': '+body.error;
    }
  }catch{}
  return message;
}

async function ensureSupabaseAuth(){
  let client = getSupabaseClient();
  if(!client) return null;
  let {data:{session}} = await client.auth.getSession();
  if(!session){
    let anon = await client.auth.signInAnonymously();
    if(anon.error) throw anon.error;
  }

  const tg = window.Telegram?.WebApp || null;
  if(tg?.ready) tg.ready();
  const initData = tg?.initData || "";

  console.log("Telegram WebApp exists:", Boolean(tg));
  console.log("Telegram initData length:", initData.length);
  console.log("Telegram initDataUnsafe user:", tg?.initDataUnsafe?.user || null);

  if(!initData){
    alert("Открой приложение через Telegram Mini App, не напрямую в браузере.");
    throw new Error("Telegram initData is empty. Open the app inside Telegram Mini App.");
  }

  let {data:{session:currentSession}} = await client.auth.getSession();
  console.log("Supabase auth uid:", currentSession?.user?.id || null);

  const res = await client.functions.invoke("tg-auth", {
    body: { initData }
  });
  if(res.error){
    let message = await supabaseFunctionErrorMessage(res.error);
    console.error('tg-auth invoke error:', message, res.error);
    throw new Error(message);
  }
  console.log("tg-auth app_user id:", res.data?.app_user?.id || null);
  console.log("tg-auth app_user tg_id:", res.data?.app_user?.tg_id || res.data?.tg_id || null);
  console.log("tg-auth session linked:", Boolean(res.data?.session_linked));
  return res.data?.app_user || null;
}
