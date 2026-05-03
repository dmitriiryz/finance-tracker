let appMode = 'personal';
let currentHousehold = null;
let sharedUser = null;
let sharedMembers = [];
let sharedInviteCode = '';
let activeHouseholdId = null;
let personalRuntime = null;
let sharedHooksInstalled = false;
let sharedLastUpdatedAt = null;

function isSharedMode(){return appMode === 'shared'}
function sharedClient(){return getSupabaseClient ? getSupabaseClient() : null}
function sharedErrorMessage(e){return e?.message || e?.error_description || e?.details || e?.hint || String(e || 'Supabase error')}
function sharedToastError(e, context='Supabase'){let message=sharedErrorMessage(e);console.error(context+':', message, e);toast(context+': '+message)}
function isUuid(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(String(v||''))}
function sharedTxId(id){return String(id)}
function sharedModeWanted(){try{return localStorage.getItem('fin_app_mode')==='shared'}catch{return false}}
function rememberMode(mode){try{localStorage.setItem('fin_app_mode',mode)}catch{}}
function rememberActiveHousehold(id){activeHouseholdId=id||null;try{id?localStorage.setItem('fin_active_household_id',id):localStorage.removeItem('fin_active_household_id')}catch{}}
function loadActiveHousehold(){try{return localStorage.getItem('fin_active_household_id')||null}catch{return null}}

function toAppCategory(r){return{id:r.id,emoji:r.emoji||'📦',name:r.name||'Categoria',type:r.type||'expense',budget:Number(r.budget)||0,archived:!!r.archived}}
function toAppTx(r){return{id:r.id,type:r.type,desc:r.desc,catId:r.category_id||'uncategorized',date:r.date,amountOriginal:Number(r.amount_original)||0,currency:r.currency||'ARS',rateToARS:Number(r.rate_to_ars)||1,amountARS:Number(r.amount_ars)||0,rateProvider:r.rate_provider||'',rateFetchedAt:r.rate_fetched_at||null,createdBy:r.created_by||null,authorName:sharedMemberNameById(r.created_by)}}
function txToDb(t){
  if(!isUuid(t.catId)) throw new Error('Invalid shared category id');
  return{household_id:currentHousehold.id,type:t.type,desc:t.desc,category_id:t.catId,date:t.date,amount_original:t.amountOriginal,currency:t.currency,rate_to_ars:t.rateToARS,amount_ars:t.amountARS,rate_provider:t.rateProvider,rate_fetched_at:t.rateFetchedAt}
}
function catToDb(c){return{household_id:currentHousehold.id,emoji:c.emoji||'📦',name:c.name,type:c.type,budget:Number(c.budget)||0,archived:!!c.archived}}

function extendSharedI18N(){
  if(typeof I18N === 'undefined') return;
  Object.assign(I18N.es, {
    sharedBudget:'Presupuesto compartido', sharedPersonal:'Personal', sharedShared:'Compartido', sharedCreate:'Crear presupuesto compartido', sharedInviteCode:'Código de invitación', sharedJoin:'Unirse', sharedHousehold:'Household', sharedCopyCode:'Copiar código', sharedCopyData:'Copiar mis datos al compartido', sharedLeave:'Salir del presupuesto compartido', sharedUser:'Usuario', sharedOwner:'owner', sharedMember:'member', sharedCodeRequired:'Código requerido', sharedJoined:'Unido al presupuesto compartido', sharedCreated:'Presupuesto compartido creado', sharedDataUpdated:'Datos actualizados', sharedRefresh:'Actualizar presupuesto compartido', sharedUpdated:'Actualizado', sharedNowActive:'Activo ahora', modePersonal:'Modo: Presupuesto personal', modeShared:'Modo: Presupuesto compartido', addPersonalHint:'La operación se guardará solo para ti', addSharedHint:'La operación se agregará al presupuesto compartido', sharedEmptyOps:'Todavía no hay operaciones en el presupuesto compartido', personalEmptyOps:'Todavía no hay operaciones personales', sharedCopyConfirm:'Tus operaciones y categorías personales se copiarán al presupuesto compartido. ¿Continuar?', sharedCopyDone:'Datos copiados al presupuesto compartido', sharedLeaveConfirm:'¿Salir del presupuesto compartido?', sharedCodeCopied:'Código copiado', sharedAddedBy:'Agregó'
  });
  Object.assign(I18N.ru, {
    sharedBudget:'Общий бюджет', sharedPersonal:'Личный', sharedShared:'Общий', sharedCreate:'Создать общий бюджет', sharedInviteCode:'Код приглашения', sharedJoin:'Вступить', sharedHousehold:'Бюджет', sharedCopyCode:'Скопировать код', sharedCopyData:'Перенести мои данные в общий бюджет', sharedLeave:'Выйти из общего бюджета', sharedUser:'Пользователь', sharedOwner:'владелец', sharedMember:'участник', sharedCodeRequired:'Введите код приглашения', sharedJoined:'Вы вступили в общий бюджет', sharedCreated:'Общий бюджет создан', sharedDataUpdated:'Данные обновлены', sharedRefresh:'Обновить общий бюджет', sharedUpdated:'Обновлено', sharedNowActive:'Сейчас активно', modePersonal:'Режим: Личный бюджет', modeShared:'Режим: Общий бюджет', addPersonalHint:'Операция будет сохранена только у вас', addSharedHint:'Операция будет добавлена в общий бюджет', sharedEmptyOps:'Пока нет операций в общем бюджете', personalEmptyOps:'Пока нет личных операций', sharedCopyConfirm:'Ваши личные операции и категории будут скопированы в общий бюджет. Продолжить?', sharedCopyDone:'Данные скопированы в общий бюджет', sharedLeaveConfirm:'Выйти из общего бюджета?', sharedCodeCopied:'Код скопирован', sharedAddedBy:'Добавил(а)'
  });
}


function syncSharedCategoryDropdowns(){
  let f=document.getElementById('f-cat');
  if(f) fillCats('f-cat', txType, isUuid(f.value)?f.value:'');
  let modal=document.getElementById('edit-modal'), e=document.getElementById('e-cat');
  if(e && modal?.classList.contains('open')) fillCats('e-cat', editType, isUuid(e.value)?e.value:'');
}

function validateSharedTxCategory(t){
  let selected = meta.categories.find(c=>c.id===t?.catId) || null;
  console.log('shared add tx category debug', {
    appMode,
    selectedCatId: t?.catId,
    isUuid: isUuid(t?.catId),
    category: cat(t?.catId),
    currentHouseholdId: currentHousehold?.id,
    categories: meta.categories.map(c => ({id:c.id,name:c.name,emoji:c.emoji,type:c.type}))
  });
  if(!t?.catId || !isUuid(t.catId) || !selected){
    console.error('Invalid shared transaction category', {selectedCatId:t?.catId, appMode, currentHouseholdId:currentHousehold?.id, categories:meta.categories});
    toast('Категория не синхронизирована. Обновите общий бюджет.');
    return false;
  }
  return true;
}

function sharedMemberNameById(id){
  if(!id) return '';
  let member = sharedMembers.find(m=>m.app_users?.id===id);
  return member?.app_users?.first_name || member?.app_users?.username || '';
}

function sharedModeLabel(){
  return isSharedMode() ? t('modeShared') + (currentHousehold?.name ? ' · ' + currentHousehold.name : '') : t('modePersonal');
}

function sharedAddHint(){
  return isSharedMode() ? t('addSharedHint') + ': ' + (currentHousehold?.name || t('sharedBudget')) : t('addPersonalHint');
}

function upsertAfterHeader(pageId, id, className, text){
  let page = document.getElementById(pageId), head = page?.querySelector('.page-header');
  if(!page || !head) return;
  let el = document.getElementById(id);
  if(!el){head.insertAdjacentHTML('afterend','<div id="'+id+'" class="'+className+'"></div>');el=document.getElementById(id)}
  el.textContent = text;
}

function renderModeIndicators(){
  upsertAfterHeader('page-home','home-mode-indicator','mode-indicator',sharedModeLabel());
  upsertAfterHeader('page-add','add-mode-indicator','mode-indicator',sharedModeLabel());
  upsertAfterHeader('page-more','more-mode-indicator','mode-indicator',sharedModeLabel());
  upsertAfterHeader('page-add','add-mode-hint','mode-add-hint',sharedAddHint());
}

function renderModeEmptyStates(){
  if((transactions || []).length) return;
  let text = isSharedMode() ? t('sharedEmptyOps') : t('personalEmptyOps');
  ['recent-list','history-list'].forEach(id=>{let e=document.querySelector('#'+id+' .empty');if(e)e.textContent=text});
}

function sharedUpdatedText(){
  if(!sharedLastUpdatedAt) return '';
  return t('sharedUpdated') + ': ' + sharedLastUpdatedAt.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
}

async function refreshSharedBudget(){
  if(!isSupabaseConfigured()) return toast('Supabase no está configurado');
  try{
    await sharedLoadProfile(currentHousehold?.id || activeHouseholdId || loadActiveHousehold());
    if(currentHousehold) await sharedLoadData();
    sharedLastUpdatedAt = new Date();
    renderAll();
    toast('sharedDataUpdated');
  }catch(e){sharedToastError(e,'Shared refresh error')}
}

function sharedTxHTML(tx,a){
  let c=cat(tx.catId),sign=tx.type==='income'?'+':'−',orig=sign+money(tx.amountOriginal,tx.currency),ap=tx.currency==='ARS'?'':' ≈ '+fmt(tx.amountARS),id=escapeHTML(String(tx.id));
  let author=isSharedMode()&&tx.authorName?' · <span class="tx-author">'+escapeHTML(t('sharedAddedBy')+': '+tx.authorName)+'</span>':'';
  return '<div class="tx-item"><div class="tx-icon '+escapeHTML(tx.type)+'">'+escapeHTML(c?.emoji||'📦')+'</div><div class="tx-info"><div class="tx-desc">'+escapeHTML(tx.desc)+'</div><div class="tx-meta">'+escapeHTML(label(c))+' · '+escapeHTML(tx.date)+(c?.archived?' · archivada':'')+author+'</div></div><div class="tx-amount '+escapeHTML(tx.type)+'">'+escapeHTML(orig+ap)+'</div>'+(a?'<div><button class="tx-btn" onclick="openEdit(\''+id+'\')">✎</button><button class="tx-btn" onclick="delTx(\''+id+'\')">✕</button></div>':'')+'</div>';
}


async function sharedEnsureAuth(){
  if(!isSupabaseConfigured()) return null;
  if(sharedUser) return sharedUser;
  sharedUser = await ensureSupabaseAuth();
  console.log('shared stable app user:', sharedUser?.id || null, sharedUser?.tg_id || null);
  return sharedUser;
}

async function sharedLoadProfile(preferredHouseholdId=null){
  let client = sharedClient();
  if(!client) return;
  await sharedEnsureAuth();
  let wanted = preferredHouseholdId || activeHouseholdId || loadActiveHousehold();
  let mem = await client.from('household_members').select('role, joined_at, households(id,name,base_currency,created_by,created_at,updated_at)').eq('user_id', sharedUser.id).order('joined_at', {ascending:false});
  if(mem.error) throw mem.error;
  let rows = mem.data || [];
  let picked = rows.find(r=>r.households?.id === wanted) || rows[0] || null;
  currentHousehold = picked?.households || null;
  if(currentHousehold) rememberActiveHousehold(currentHousehold.id);
  console.log('shared currentHousehold:', currentHousehold?.id || null);
  sharedMembers = [];
  sharedInviteCode = '';
  if(currentHousehold) await sharedLoadHouseholdMeta();
}

async function sharedLoadHouseholdMeta(){
  let client = sharedClient();
  if(!client || !currentHousehold) return;
  let members = await client.from('household_members').select('role, app_users(id,tg_id,first_name,username)').eq('household_id', currentHousehold.id).order('joined_at');
  if(members.error) throw members.error;
  sharedMembers = members.data || [];
  let invites = await client.from('household_invites').select('code,expires_at,used_at').eq('household_id', currentHousehold.id).is('used_at', null).order('created_at', {ascending:false}).limit(1);
  if(invites.error) throw invites.error;
  sharedInviteCode = invites.data?.[0]?.code || '';
}


async function sharedLoadData(){
  let client = sharedClient();
  if(!client || !currentHousehold) return;
  let [cats,txs,rates] = await Promise.all([
    client.from('shared_categories').select('*').eq('household_id', currentHousehold.id).order('created_at'),
    client.from('shared_transactions').select('*').eq('household_id', currentHousehold.id).order('date', {ascending:false}).order('created_at', {ascending:false}),
    client.from('shared_rates_cache').select('*').eq('household_id', currentHousehold.id)
  ]);
  if(cats.error) throw cats.error;
  if(txs.error) throw txs.error;
  if(rates.error) throw rates.error;
  let personalSettings = personalRuntime?.meta?.settings || meta?.settings || {usdRateSource:'blue',language:'es',ratesCache:{}};
  meta = createMeta();
  meta.categories = (cats.data || []).map(toAppCategory);
  meta.settings = JSON.parse(JSON.stringify(personalSettings));
  meta.settings.ratesCache = {};
  (rates.data || []).forEach(r=>meta.settings.ratesCache[r.currency]={rateToARS:Number(r.rate_to_ars)||0,provider:r.provider||'manual',fetchedAt:r.fetched_at,updatedAt:r.updated_at});
  transactions = (txs.data || []).map(toAppTx);
  meta.availableMonths = [...new Set(transactions.map(monthKey).filter(Boolean))].sort();
  syncSharedCategoryDropdowns();
}

async function sharedSaveMeta(){
  let client = sharedClient();
  if(!client || !currentHousehold) return{ok:false,degraded:false};
  try{
    let rates = meta.settings?.ratesCache || {};
    let rateRows = Object.keys(rates).filter(c=>c!=='ARS' && Number(rates[c]?.rateToARS)>0).map(c=>({household_id:currentHousehold.id,currency:c,rate_to_ars:Number(rates[c].rateToARS),provider:rates[c].provider||'manual',fetched_at:rates[c].fetchedAt||new Date().toISOString(),updated_at:new Date().toISOString()}));
    if(rateRows.length){let rr=await client.from('shared_rates_cache').upsert(rateRows,{onConflict:'household_id,currency'});if(rr.error)throw rr.error;}
    return{ok:true,degraded:false};
  }catch(e){sharedToastError(e);return{ok:false,degraded:false}}
}

async function initSharedMode(){
  installSharedHooks();
  if(!isSupabaseConfigured()) return;
  personalRuntime = {...personalRuntime, meta, transactions:[...transactions]};
  try{
    await sharedLoadProfile();
    if(currentHousehold && sharedModeWanted()) await switchAppMode('shared');
  }catch(e){console.warn(e);rememberMode('personal')}
}

async function switchAppMode(mode){
  if(mode === 'personal'){
    appMode = 'personal';
    rememberMode('personal');
    await load();
    personalRuntime = {...personalRuntime, meta, transactions:[...transactions]};
    renderAll();
    return;
  }
  if(!isSupabaseConfigured()) return toast('Supabase no está configurado');
  try{
    personalRuntime = {...personalRuntime, meta, transactions:[...transactions]};
    await sharedLoadProfile();
    if(!currentHousehold){
      await createSharedHousehold(true);
      if(!currentHousehold) return;
    }
    await sharedLoadData();
    syncSharedCategoryDropdowns();
    appMode = 'shared';
    rememberMode('shared');
    renderAll();
  }catch(e){sharedToastError(e)}
}

async function createSharedHousehold(autoSwitch=false){
  if(!isSupabaseConfigured()) return toast('Supabase no está configurado');
  let name = prompt(t('sharedBudget'), t('sharedBudget'));
  if(!name) return;
  let client = sharedClient();
  try{
    console.log('shared create: start');
    await sharedEnsureAuth();
    console.log('shared create: app user', sharedUser?.id || null);
    let created = await client.rpc('create_household_with_owner',{household_name:name});
    console.log('shared create_household_with_owner result:', created);
    if(created.error) throw created.error;
    if(!created.data) throw new Error('create_household_with_owner returned empty household id');
    let h = await client.from('households').select('*').eq('id', created.data).single();
    console.log('shared household select result:', h);
    if(h.error) throw h.error;
    currentHousehold = h.data;
    await ensureSharedDefaultCategories();
    await createSharedInvite();
    await sharedLoadHouseholdMeta();
    if(autoSwitch){
      await sharedLoadData();
      syncSharedCategoryDropdowns();
      appMode = 'shared';
      rememberMode('shared');
    }
    renderAll();
    toast('sharedCreated');
  }catch(e){sharedToastError(e,'Shared setup error')}
}

async function ensureSharedDefaultCategories(){
  let client = sharedClient();
  if(!currentHousehold?.id) throw new Error('No household id for default categories');
  let existing = await client.from('shared_categories').select('id').eq('household_id', currentHousehold.id).limit(1);
  console.log('shared default categories existing:', existing);
  if(existing.error) throw existing.error;
  if(existing.data?.length) return;
  let rows = DEF.map(c=>catToDb(c));
  let r = await client.from('shared_categories').insert(rows);
  console.log('shared default categories insert:', r);
  if(r.error) throw r.error;
}

function inviteCode(){return Math.random().toString(36).slice(2,8).toUpperCase()+Math.random().toString(36).slice(2,6).toUpperCase()}
async function createSharedInvite(){
  let client = sharedClient();
  if(!currentHousehold?.id) throw new Error('No household id for invite code');
  let existing = await client.from('household_invites').select('code,expires_at,used_at').eq('household_id', currentHousehold.id).is('used_at', null).order('created_at', {ascending:false}).limit(1);
  console.log('shared invite existing:', existing);
  if(existing.error) throw existing.error;
  if(existing.data?.[0]?.code){sharedInviteCode = existing.data[0].code; return sharedInviteCode;}
  let code = inviteCode();
  let r = await client.rpc('create_household_invite',{hid:currentHousehold.id,invite_code:code});
  console.log('shared create_household_invite result:', r);
  if(r.error) throw r.error;
  sharedInviteCode = r.data || code;
  return sharedInviteCode;
}

async function joinSharedHousehold(){
  let code = document.getElementById('shared-invite-input')?.value.trim();
  if(!code) return toast('sharedCodeRequired');
  let client = sharedClient();
  try{
    await sharedEnsureAuth();
    let r = await client.rpc('join_household_by_code',{code_text:code});
    console.log('shared join_household_by_code result:', r);
    if(r.error) throw r.error;
    if(!r.data) throw new Error('join_household_by_code returned empty household id');
    rememberActiveHousehold(r.data);
    await sharedLoadProfile(r.data);
    await sharedLoadData();
    syncSharedCategoryDropdowns();
    appMode = 'shared';
    rememberMode('shared');
    renderAll();
    toast('sharedJoined');
  }catch(e){sharedToastError(e,'Join invite error')}
}

async function leaveSharedHousehold(){
  if(!currentHousehold || !confirm(t('sharedLeaveConfirm'))) return;
  let client = sharedClient();
  try{
    let r = await client.from('household_members').delete().eq('household_id', currentHousehold.id).eq('user_id', sharedUser.id);
    if(r.error) throw r.error;
    currentHousehold = null; sharedMembers=[]; sharedInviteCode=''; rememberActiveHousehold(null);
    await switchAppMode('personal');
  }catch(e){sharedToastError(e)}
}

async function copySharedInvite(){
  if(!sharedInviteCode && currentHousehold){try{await createSharedInvite();renderAll()}catch(e){return sharedToastError(e,'Invite error')}}
  try{await navigator.clipboard.writeText(sharedInviteCode);toast('sharedCodeCopied')}catch{prompt(t('sharedInviteCode'), sharedInviteCode)}
}

function renderSharedAccess(){
  let more = document.getElementById('page-more');
  if(!more) return;
  let card = document.getElementById('shared-card');
  if(!card){
    let head = document.getElementById('lang-card') || more.querySelector('.page-header');
    head.insertAdjacentHTML('afterend','<div class="card" id="shared-card"></div>');
    card = document.getElementById('shared-card');
  }
  let mode = '<div class="type-row shared-mode-switch" style="margin-bottom:10px"><button class="type-pill '+(!isSharedMode()?'active mode-active':'')+'" onclick="switchAppMode(\'personal\')">'+escapeHTML(t('sharedPersonal'))+(!isSharedMode()?'<span class="mode-status">'+escapeHTML(t('sharedNowActive'))+'</span>':'')+'</button><button class="type-pill '+(isSharedMode()?'active mode-active':'')+'" onclick="switchAppMode(\'shared\')">'+escapeHTML(t('sharedShared'))+(isSharedMode()?'<span class="mode-status">'+escapeHTML(t('sharedNowActive'))+'</span>':'')+'</button></div>';
  if(!isSupabaseConfigured()){
    card.innerHTML='<div class="section-label" style="margin-top:0">'+escapeHTML(t('sharedBudget'))+'</div><div class="note">Supabase no está configurado</div><div class="actions-row"><button class="btn ghost" disabled>'+escapeHTML(t('sharedPersonal'))+'</button><button class="btn ghost" disabled>'+escapeHTML(t('sharedShared'))+'</button></div>';
    return;
  }
  if(!currentHousehold){
    card.innerHTML='<div class="section-label" style="margin-top:0">'+escapeHTML(t('sharedBudget'))+'</div>'+mode+'<button class="btn full" onclick="createSharedHousehold()">'+escapeHTML(t('sharedCreate'))+'</button><div class="form-row" style="margin-top:10px"><div class="field"><label>'+escapeHTML(t('sharedInviteCode'))+'</label><input id="shared-invite-input" placeholder="ABC123"></div><button class="btn" onclick="joinSharedHousehold()" style="align-self:end">'+escapeHTML(t('sharedJoin'))+'</button></div>';
    return;
  }
  let members = sharedMembers.map(m=>escapeHTML(m.app_users?.first_name || m.app_users?.username || String(m.app_users?.tg_id || t('sharedUser')))+' · '+escapeHTML(t(m.role==='owner'?'sharedOwner':'sharedMember'))).join('<br>') || '—';
  card.innerHTML='<div class="section-label" style="margin-top:0">'+escapeHTML(t('sharedBudget'))+'</div>'+mode+'<div class="rate-grid"><div class="rate-pill"><span>'+escapeHTML(t('sharedHousehold'))+'</span><b>'+escapeHTML(currentHousehold.name)+'</b></div><div class="rate-pill"><span>'+escapeHTML(t('sharedInviteCode'))+'</span><b>'+escapeHTML(sharedInviteCode||'—')+'</b></div></div><div class="note">'+members+'</div><div class="actions-row"><button class="btn ghost" onclick="copySharedInvite()">'+escapeHTML(t('sharedCopyCode'))+'</button><button class="btn ghost" onclick="copyPersonalToShared()">'+escapeHTML(t('sharedCopyData'))+'</button><button class="btn ghost" onclick="refreshSharedBudget()">'+escapeHTML(t('sharedRefresh'))+'</button><button class="btn danger" onclick="leaveSharedHousehold()">'+escapeHTML(t('sharedLeave'))+'</button></div><div class="note shared-updated" id="shared-updated">'+escapeHTML(sharedUpdatedText())+'</div>';
}

async function sharedAddTx(){
  let t = formTx('f',txType); if(!t) return;
  if(!validateSharedTxCategory(t)) return;
  let client = sharedClient();
  try{
    let r = await client.from('shared_transactions').insert({...txToDb(t),created_by:sharedUser.id}).select('*').single();
    if(r.error) throw r.error;
    transactions.unshift(toAppTx(r.data));
    meta.availableMonths=[...new Set(transactions.map(monthKey).filter(Boolean))].sort();
    document.getElementById('f-desc').value='';document.getElementById('f-amount').value='';preview('f');renderAll();toast(txType==='expense'?'− Gasto agregado':'+ Ingreso agregado');switchPage('home');
  }catch(e){sharedToastError(e)}
}

async function sharedDeleteTx(id){
  if(!confirm(t('confirmDelete'))) return;
  let client = sharedClient();
  try{
    let r = await client.from('shared_transactions').delete().eq('id', sharedTxId(id)).eq('household_id', currentHousehold.id);
    if(r.error) throw r.error;
    transactions = transactions.filter(t=>sharedTxId(t.id)!==sharedTxId(id));
    meta.availableMonths=[...new Set(transactions.map(monthKey).filter(Boolean))].sort();
    renderAll();
  }catch(e){sharedToastError(e)}
}

async function sharedSaveEdit(){
  let i = transactions.findIndex(t=>sharedTxId(t.id)===sharedTxId(editId));
  if(i<0) return;
  let t = formTx('e',editType,{id:transactions[i].id}); if(!t) return;
  if(!validateSharedTxCategory(t)) return;
  let client = sharedClient();
  try{
    let r = await client.from('shared_transactions').update(txToDb(t)).eq('id', sharedTxId(t.id)).eq('household_id', currentHousehold.id).select('*').single();
    if(r.error) throw r.error;
    transactions[i]=toAppTx(r.data);closeEditModal();renderAll();toast('Operación actualizada');
  }catch(e){sharedToastError(e)}
}

async function sharedCreateCategory(){
  let emoji=document.getElementById('new-cat-emoji').value.trim()||'📦',name=document.getElementById('new-cat-name').value.trim(),type=document.getElementById('new-cat-type').value,budget=Number(document.getElementById('new-cat-budget').value)||0;
  if(!name)return toast('Ingresa un nombre');
  let client=sharedClient();
  try{let r=await client.from('shared_categories').insert({household_id:currentHousehold.id,emoji,name,type,budget:Math.max(0,budget),archived:false}).select('*').single();if(r.error)throw r.error;meta.categories.push(toAppCategory(r.data));document.getElementById('new-cat-emoji').value='';document.getElementById('new-cat-name').value='';document.getElementById('new-cat-budget').value='';renderAll();toast('Categoría creada')}catch(e){sharedToastError(e)}
}

async function sharedSaveCategory(id){
  let c=cat(id),name=document.getElementById('cat-name-'+id).value.trim();if(!name)return toast('Nombre requerido');
  let patch={emoji:document.getElementById('cat-emoji-'+id).value.trim()||'📦',name,type:document.getElementById('cat-type-'+id).value,budget:Math.max(0,Number(document.getElementById('cat-budget-'+id).value)||0),archived:!!c.archived,updated_at:new Date().toISOString()};
  let client=sharedClient();
  try{let r=await client.from('shared_categories').update(patch).eq('id',id).eq('household_id',currentHousehold.id).select('*').single();if(r.error)throw r.error;Object.assign(c,toAppCategory(r.data));renderAll();toast('Categoría guardada')}catch(e){sharedToastError(e)}
}

async function sharedArchiveOrDeleteCategory(id){
  let has=transactions.some(t=>sharedTxId(t.catId)===sharedTxId(id)),client=sharedClient();
  try{let r=has?await client.from('shared_categories').update({archived:true,updated_at:new Date().toISOString()}).eq('id',id).eq('household_id',currentHousehold.id):await client.from('shared_categories').delete().eq('id',id).eq('household_id',currentHousehold.id);if(r.error)throw r.error;if(has){let c=cat(id);c.archived=true}else meta.categories=meta.categories.filter(c=>sharedTxId(c.id)!==sharedTxId(id));renderAll();toast(has?'Categoría archivada':'Categoría eliminada')}catch(e){sharedToastError(e)}
}

async function sharedRestoreCategory(id){let client=sharedClient();try{let r=await client.from('shared_categories').update({archived:false,updated_at:new Date().toISOString()}).eq('id',id).eq('household_id',currentHousehold.id).select('*').single();if(r.error)throw r.error;Object.assign(cat(id),toAppCategory(r.data));renderAll();toast('Categoría restaurada')}catch(e){sharedToastError(e)}}
async function sharedSaveBudgetLimit(id){let v=Number(document.getElementById('budget-'+id).value),c=cat(id);c.budget=Number.isFinite(v)&&v>0?v:0;let client=sharedClient();try{let r=await client.from('shared_categories').update({budget:c.budget,updated_at:new Date().toISOString()}).eq('id',id).eq('household_id',currentHousehold.id).select('*').single();if(r.error)throw r.error;Object.assign(c,toAppCategory(r.data));renderAll();toast('Límite guardado')}catch(e){sharedToastError(e)}}

async function copyPersonalToShared(){
  if(!currentHousehold || !confirm(t('sharedCopyConfirm'))) return;
  let client=sharedClient();
  try{
    let data = await personalRuntime.exports.exportData();
    let catMap = {};
    for(let pc of data.categories || []){
      let existing = meta.categories.find(c=>c.name===pc.name && c.emoji===pc.emoji && c.type===pc.type);
      if(existing){catMap[pc.id]=existing.id;continue}
      let ins=await client.from('shared_categories').insert({household_id:currentHousehold.id,emoji:pc.emoji||'📦',name:pc.name,type:pc.type,budget:Number(pc.budget)||0,archived:!!pc.archived}).select('*').single();
      if(ins.error) throw ins.error;
      let nc=toAppCategory(ins.data);meta.categories.push(nc);catMap[pc.id]=nc.id;
    }
    let existingSig = new Set(transactions.map(t=>[t.type,t.desc,t.date,t.amountOriginal,t.currency,t.rateToARS,cat(t.catId)?.name||''].join('|')));
    let rows=[];
    for(let pt of data.transactions || []){
      let sig=[pt.type,pt.desc,pt.date,pt.amountOriginal,pt.currency,pt.rateToARS,(data.categories||[]).find(c=>c.id===pt.catId)?.name||''].join('|');
      if(existingSig.has(sig)) continue;
      rows.push({household_id:currentHousehold.id,created_by:sharedUser.id,type:pt.type,desc:pt.desc,category_id:catMap[pt.catId]||null,date:pt.date,amount_original:pt.amountOriginal,currency:pt.currency,rate_to_ars:pt.rateToARS,amount_ars:pt.amountARS,rate_provider:pt.rateProvider,rate_fetched_at:pt.rateFetchedAt});
    }
    let copied=0;
    if(rows.length){let r=await client.from('shared_transactions').insert(rows).select('*');if(r.error)throw r.error;copied=r.data.length;transactions.unshift(...r.data.map(toAppTx));}
    meta.availableMonths=[...new Set(transactions.map(monthKey).filter(Boolean))].sort();renderAll();toast('sharedCopyDone');
  }catch(e){sharedToastError(e)}
}

async function sharedExportData(){
  return{schemaVersion:SCHEMA,mode:'shared',household:currentHousehold,meta,categories:meta.categories,settings:meta.settings,ratesCache:meta.settings?.ratesCache||{},transactions,transactionsByMonth:transactions.reduce((a,t)=>{let k=monthKey(t);(a[k]??=[]).push(t);return a},{})};
}

async function sharedImportData(d){
  let client=sharedClient();
  let cats=(d.categories||d.meta?.categories||DEF).map(normCat),txs=(d.transactions||Object.values(d.transactionsByMonth||{}).flat()).map(migrateTx);
  let delTx=await client.from('shared_transactions').delete().eq('household_id',currentHousehold.id).neq('id','00000000-0000-0000-0000-000000000000');if(delTx.error)throw delTx.error;
  let delCat=await client.from('shared_categories').delete().eq('household_id',currentHousehold.id).neq('id','00000000-0000-0000-0000-000000000000');if(delCat.error)throw delCat.error;
  let insertedCats=[],catMap={};
  if(cats.length){let cr=await client.from('shared_categories').insert(cats.map(c=>({household_id:currentHousehold.id,emoji:c.emoji,name:c.name,type:c.type,budget:c.budget,archived:c.archived}))).select('*');if(cr.error)throw cr.error;insertedCats=cr.data.map(toAppCategory);cats.forEach((c,i)=>catMap[c.id]=insertedCats[i].id)}
  let insertedTx=[];
  if(txs.length){let tr=await client.from('shared_transactions').insert(txs.map(t=>({household_id:currentHousehold.id,created_by:sharedUser.id,type:t.type,desc:t.desc,category_id:catMap[t.catId]||null,date:t.date,amount_original:t.amountOriginal,currency:t.currency,rate_to_ars:t.rateToARS,amount_ars:t.amountARS,rate_provider:t.rateProvider,rate_fetched_at:t.rateFetchedAt}))).select('*');if(tr.error)throw tr.error;insertedTx=tr.data.map(toAppTx)}
  meta.categories=insertedCats;transactions=insertedTx;meta.availableMonths=[...new Set(transactions.map(monthKey).filter(Boolean))].sort();
  let rates=d.ratesCache||d.settings?.ratesCache||{};meta.settings.ratesCache=rates;await sharedSaveMeta();renderAll();toast('Importación lista');
}

function installSharedHooks(){
  if(sharedHooksInstalled) return; sharedHooksInstalled = true;
  personalRuntime = personalRuntime || {};
  extendSharedI18N();
  personalRuntime.addTx=window.addTx; personalRuntime.txHTML=window.txHTML; personalRuntime.delTx=window.delTx; personalRuntime.saveEdit=window.saveEdit; personalRuntime.writeMeta=window.writeMeta; personalRuntime.createCategory=window.createCategory; personalRuntime.saveCategory=window.saveCategory; personalRuntime.archiveOrDeleteCategory=window.archiveOrDeleteCategory; personalRuntime.restoreCategory=window.restoreCategory; personalRuntime.saveBudgetLimit=window.saveBudgetLimit; personalRuntime.renderAll=window.renderAll; personalRuntime.exportData=window.exportData; personalRuntime.importJSONFile=window.importJSONFile; personalRuntime.exports={exportData:window.exportData};
  window.writeMeta=async function(touch=true){return isSharedMode()?await sharedSaveMeta():await personalRuntime.writeMeta(touch)};
  window.txHTML=function(tx,a){return sharedTxHTML(tx,a)};
  window.addTx=async function(){return isSharedMode()?await sharedAddTx():await personalRuntime.addTx()};
  window.delTx=async function(id){return isSharedMode()?await sharedDeleteTx(id):await personalRuntime.delTx(id)};
  window.saveEdit=async function(){return isSharedMode()?await sharedSaveEdit():await personalRuntime.saveEdit()};
  window.createCategory=async function(){return isSharedMode()?await sharedCreateCategory():await personalRuntime.createCategory()};
  window.saveCategory=async function(id){return isSharedMode()?await sharedSaveCategory(id):await personalRuntime.saveCategory(id)};
  window.archiveOrDeleteCategory=async function(id){return isSharedMode()?await sharedArchiveOrDeleteCategory(id):await personalRuntime.archiveOrDeleteCategory(id)};
  window.restoreCategory=async function(id){return isSharedMode()?await sharedRestoreCategory(id):await personalRuntime.restoreCategory(id)};
  window.saveBudgetLimit=async function(id){return isSharedMode()?await sharedSaveBudgetLimit(id):await personalRuntime.saveBudgetLimit(id)};
  window.exportData=async function(){return isSharedMode()?await sharedExportData():await personalRuntime.exportData()};
  window.importJSONFile=function(e){if(!isSharedMode())return personalRuntime.importJSONFile(e);let f=e.target.files?.[0];e.target.value='';if(!f)return;if(!confirm(t('confirmImport')))return;let rd=new FileReader();rd.onload=async()=>{try{await sharedImportData(JSON.parse(rd.result))}catch(err){sharedToastError(err)}};rd.readAsText(f)};
  window.renderAll=function(){personalRuntime.renderAll();renderSharedAccess();renderModeIndicators();renderModeEmptyStates()};
}
