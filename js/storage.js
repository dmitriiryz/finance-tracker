const META_KEY='fin_meta_v3',OLD_KEY='fin_data_v1',TX_PREFIX='fin_tx_',SCHEMA=3,CHUNK_SIZE=3000,CURRENCIES=['ARS','USD','RUB'];

function cloudStorage(){return window.Telegram?.WebApp?.CloudStorage||null}

function cloudGet(key){return new Promise(resolve=>{let cs=cloudStorage();if(!cs?.getItem)return resolve({ok:false,value:null});try{cs.getItem(key,(err,val)=>resolve({ok:!err,value:val??null}))}catch(e){resolve({ok:false,value:null})}})}

function cloudSet(key,value){return new Promise(resolve=>{let cs=cloudStorage();if(!cs?.setItem)return resolve(false);try{cs.setItem(key,value,err=>resolve(!err))}catch(e){resolve(false)}})}

function cloudRemove(key){return new Promise(resolve=>{let cs=cloudStorage();if(!cs?.removeItem)return resolve(false);try{cs.removeItem(key,err=>resolve(!err))}catch(e){resolve(false)}})}

function localGet(key){try{return localStorage.getItem(key)}catch(e){return null}}

function localSet(key,value){try{localStorage.setItem(key,value);return true}catch(e){return false}}

function localRemove(key){try{localStorage.removeItem(key);return true}catch(e){return false}}

function parseJSON(s){try{return s?JSON.parse(s):null}catch(e){return null}}

function stampOf(o){let t=Date.parse(o?.updatedAt||o?.monthUpdatedAt||0);return Number.isFinite(t)?t:0}

async function storageGet(key){if(key===META_KEY)return await storageGetMeta();let c=await cloudGet(key);if(c.ok&&c.value!==null&&c.value!=='')return c.value;return localGet(key)}

async function storageGetMeta(){let [c,l]=await Promise.all([cloudGet(META_KEY),Promise.resolve(localGet(META_KEY))]),cm=parseJSON(c.value),lm=parseJSON(l);if(cm&&lm){if(stampOf(lm)>stampOf(cm)){if(c.ok)await cloudSet(META_KEY,l);return l}else{localSet(META_KEY,c.value);return c.value}}if(cm){localSet(META_KEY,c.value);return c.value}if(lm){if(c.ok||cloudStorage())await cloudSet(META_KEY,l);return l}return null}

async function storageSet(key,value){let hasCloud=!!cloudStorage(),cloudOk=hasCloud?await cloudSet(key,value):true,localOk=localSet(key,value),ok=hasCloud?(cloudOk||localOk):localOk,degraded=hasCloud&&!cloudOk&&localOk;if(degraded)toast('Guardado localmente, pero no en Telegram CloudStorage');if(!localOk&&!cloudOk)toast('No se pudo guardar');return{ok,cloudOk,localOk,degraded}}

async function storageRemove(key){let hasCloud=!!cloudStorage(),cloudOk=hasCloud?await cloudRemove(key):true,localOk=localRemove(key);return{ok:hasCloud?(cloudOk||localOk):localOk,cloudOk,localOk,degraded:hasCloud&&!cloudOk&&localOk}}

function resultOK(r){return !!(r&&r.ok)}

function resultDegraded(r){return !!(r&&r.degraded)}

function monthStore(k){return TX_PREFIX+k}

function monthMetaKey(k){return monthStore(k)+'_meta'}

function monthChunkKey(k,i){return monthStore(k)+'_chunk_'+i}

function touchMeta(ts=new Date().toISOString()){meta.updatedAt=ts;meta.storageSchemaVersion=SCHEMA;meta.months||={}}

function createMeta(){let m={schemaVersion:SCHEMA,storageSchemaVersion:SCHEMA,migrationDone:true,updatedAt:new Date().toISOString(),availableMonths:[],months:{},nextId:1,categories:JSON.parse(JSON.stringify(DEF)),settings:{usdRateSource:'blue',language:'es',ratesCache:{}}};return m}

async function readMonthPayload(k){let mm=parseJSON(await storageGet(monthMetaKey(k)));if(mm&&Number(mm.chunksCount)>0){let parts=[];for(let i=0;i<mm.chunksCount;i++){let part=await storageGet(monthChunkKey(k,i));if(part===null)return null;parts.push(part)}return parts.join('')}let direct=await storageGet(monthStore(k));if(direct!==null&&direct!=='')return direct;if(mm&&Number(mm.chunksCount)===0)return '[]';return null}

async function loadRows(k){try{return JSON.parse(await readMonthPayload(k)||'[]')||[]}catch{return[]}}

async function saveMonthPayload(k,rows,ts){let json=JSON.stringify(rows),old=parseJSON(await storageGet(monthMetaKey(k)))||meta.months?.[k]||{},oldChunks=Number(old.chunksCount)||0,newChunks=json.length>CHUNK_SIZE?Math.ceil(json.length/CHUNK_SIZE):0,ok=true,degraded=false;if(newChunks>0){await storageRemove(monthStore(k));for(let i=0;i<newChunks;i++){let r=await storageSet(monthChunkKey(k,i),json.slice(i*CHUNK_SIZE,(i+1)*CHUNK_SIZE));ok=resultOK(r)&&ok;degraded=resultDegraded(r)||degraded}for(let i=newChunks;i<oldChunks;i++)await storageRemove(monthChunkKey(k,i))}else{let r=await storageSet(monthStore(k),json);ok=resultOK(r)&&ok;degraded=resultDegraded(r)||degraded;for(let i=0;i<oldChunks;i++)await storageRemove(monthChunkKey(k,i))}let mm={chunksCount:newChunks,updatedAt:ts,monthUpdatedAt:ts,totalLength:json.length,chunkSize:CHUNK_SIZE,storageMode:newChunks>0?'chunked':'single'};let mr=await storageSet(monthMetaKey(k),JSON.stringify(mm));ok=resultOK(mr)&&ok;degraded=resultDegraded(mr)||degraded;meta.months||={};meta.months[k]=mm;return{ok,degraded}}

async function saveAll(){let ts=new Date().toISOString(),g={};transactions.forEach(t=>{let k=monthKey(t);if(k)(g[k]??=[]).push(t)});let oldMonths=[...(meta.availableMonths||[])],newMonths=Object.keys(g).sort(),ok=true,degraded=false;meta.availableMonths=newMonths;for(let[k,v]of Object.entries(g)){let r=await saveMonthPayload(k,v,ts);ok=r.ok&&ok;degraded=r.degraded||degraded}for(let k of oldMonths)if(!newMonths.includes(k)){let old=meta.months?.[k]||parseJSON(await storageGet(monthMetaKey(k)))||{};await storageRemove(monthStore(k));for(let i=0;i<(Number(old.chunksCount)||0);i++)await storageRemove(monthChunkKey(k,i));await storageRemove(monthMetaKey(k));if(meta.months)delete meta.months[k]}touchMeta(ts);let mr=await writeMeta(false);ok=resultOK(mr)&&ok;degraded=resultDegraded(mr)||degraded;return{ok,degraded}}

async function saveMonth(k){let ts=new Date().toISOString(),rows=transactions.filter(t=>monthKey(t)===k),r=await saveMonthPayload(k,rows,ts);if(!meta.availableMonths.includes(k))meta.availableMonths.push(k);meta.availableMonths=[...new Set(meta.availableMonths)].sort();touchMeta(ts);let mr=await writeMeta(false);return{ok:r.ok&&resultOK(mr),degraded:r.degraded||resultDegraded(mr)}}

async function load(){let raw=await storageGet(META_KEY);try{meta=raw?JSON.parse(raw):null}catch{meta=null}if(meta?.schemaVersion===SCHEMA&&meta.migrationDone){let changed=false;meta.categories=(meta.categories||[]).map(normCat);meta.settings||={usdRateSource:'blue',language:'es',ratesCache:{}};meta.settings.language||='es';meta.settings.ratesCache||={};meta.months||={};if(!meta.updatedAt){meta.updatedAt=new Date().toISOString();changed=true}if(!meta.storageSchemaVersion){meta.storageSchemaVersion=SCHEMA;changed=true}transactions=[];for(let k of meta.availableMonths||[])transactions.push(...await loadRows(k));transactions.sort((a,b)=>b.date.localeCompare(a.date)||Number(b.id)-Number(a.id));if(changed)await writeMeta(false);return}let oldRaw=await storageGet(OLD_KEY),old=null;try{old=oldRaw?JSON.parse(oldRaw):null}catch{}meta=createMeta();if(old){let b=old.budgets||{};meta.categories=meta.categories.map(c=>({...c,budget:Number(b[label(c)]??c.budget)||0}));transactions=(old.transactions||[]).map(migrateTx);meta.nextId=Math.max(Number(old.nextId)||1,transactions.reduce((m,t)=>Math.max(m,Number(t.id)||0),0)+1)}await saveAll()}

async function exportData(){let raw=await storageGet(META_KEY),fresh=parseJSON(raw)||meta,by={};for(let k of fresh.availableMonths||[])by[k]=await loadRows(k);return{schemaVersion:SCHEMA,meta:fresh,transactionsByMonth:by,transactions:Object.values(by).flat(),settings:fresh.settings,categories:fresh.categories,ratesCache:fresh.settings?.ratesCache||{}}}

function dl(n,m,t){let b=new Blob([t],{type:m}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=n;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(u)}

async function exportJSON(){dl('finanzas-export-v3.json','application/json',JSON.stringify(await exportData(),null,2))}

function csv(v){return '"'+String(v??'').replace(/"/g,'""')+'"'}

function exportCSV(){let h='id,type,desc,catName,date,amountOriginal,currency,rateToARS,amountARS,rateProvider',r=transactions.map(t=>[t.id,t.type,t.desc,cat(t.catId)?.name||'',t.date,t.amountOriginal,t.currency,t.rateToARS,t.amountARS,t.rateProvider].map(csv).join(','));dl('finanzas-transacciones.csv','text/csv;charset=utf-8',h+'\n'+r.join('\n'))}

function importJSONFile(e){let f=e.target.files?.[0];e.target.value='';if(!f)return;if(!confirm(t('confirmImport')))return;let rd=new FileReader();rd.onload=async()=>{let oldMeta=JSON.parse(JSON.stringify(meta)),oldTx=[...transactions];try{let d=JSON.parse(rd.result),m=d.meta||{};meta=createMeta();meta.categories=(d.categories||m.categories||DEF).map(normCat);meta.settings=m.settings||d.settings||{usdRateSource:'blue',ratesCache:d.ratesCache||{}};meta.settings.ratesCache||=d.ratesCache||{};transactions=(d.transactions||Object.values(d.transactionsByMonth||{}).flat()).map(migrateTx);meta.nextId=Math.max(Number(m.nextId)||1,transactions.reduce((x,t)=>Math.max(x,Number(t.id)||0),0)+1);let r=await saveAll();if(!r.ok){meta=oldMeta;transactions=oldTx;renderAll();return}renderAll();if(!r.degraded)toast('Importación lista')}catch{meta=oldMeta;transactions=oldTx;toast('JSON inválido')}};rd.readAsText(f)}
