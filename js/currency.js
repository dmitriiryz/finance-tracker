function cache(c){if(c==='ARS')return{rate:1,provider:'ARS',at:null};let r=meta.settings.ratesCache[c]||{};return{rate:Number(r.rateToARS)||0,provider:r.provider||'manual',at:r.fetchedAt||null}}

async function setRate(c,r,p,at=new Date().toISOString()){if(c!=='ARS'&&r>0){meta.settings.ratesCache[c]={rateToARS:r,provider:p,fetchedAt:at,updatedAt:at};return await writeMeta()}return{ok:true,degraded:false}}

async function usdars(){let src=meta.settings.usdRateSource||'blue';if(src==='manual')return cache('USD').rate||null;let end={oficial:'oficial',blue:'blue',mep:'bolsa'}[src]||'blue',res=await fetch('https://dolarapi.com/v1/dolares/'+end,{cache:'no-store'});if(!res.ok)throw Error();let d=await res.json(),r=Number(d.venta||d.promedio||d.compra);if(!r)throw Error();await setRate('USD',r,src,d.fechaActualizacion||new Date().toISOString());return r}

async function fetchRateToARS(c){if(c==='ARS')return{rateToARS:1,provider:'ARS',rateFetchedAt:null};if(meta.settings.usdRateSource==='manual'){let k=cache(c);return k.rate>0?{rateToARS:k.rate,provider:'manual',rateFetchedAt:k.at}:null}try{if(c==='USD'){let r=await usdars();if(!r)throw Error();return{rateToARS:r,provider:meta.settings.usdRateSource,rateFetchedAt:cache('USD').at}}if(c==='RUB'){let u=await usdars(),res=await fetch('https://open.er-api.com/v6/latest/USD',{cache:'no-store'});if(!res.ok)throw Error();let d=await res.json(),rub=Number(d.rates?.RUB),r=u/rub;if(!r)throw Error();await setRate('RUB',r,'open.er-api.com + USDARS',d.time_last_update_utc||new Date().toISOString());return{rateToARS:r,provider:'open.er-api.com + USDARS',rateFetchedAt:cache('RUB').at}}}catch{toast('rateFail');let k=cache(c);return k.rate>0?{rateToARS:k.rate,provider:k.provider,rateFetchedAt:k.at}:null}}

async function updateFormRate(p){let c=document.getElementById(p+'-currency').value,r=await fetchRateToARS(c);if(r){document.getElementById(p+'-rate').value=r.rateToARS;uiCurrency(p);renderSettings()}}

function uiCurrency(p){let c=document.getElementById(p+'-currency').value,row=document.getElementById(p+'-rate-row'),rate=document.getElementById(p+'-rate'),cap=document.getElementById(p+'-rate-caption');if(c==='ARS'){row.classList.remove('show');rate.value=1;cap.textContent=''}else{row.classList.add('show');let k=cache(c);if(!rate.value&&k.rate)rate.value=k.rate;let r=Number(rate.value)||0;cap.textContent=r>0?'1 '+c+' = '+fmt(r):'Ingresa o actualiza la cotización'}preview(p)}

function preview(p){let a=Number(document.getElementById(p+'-amount').value)||0,c=document.getElementById(p+'-currency').value,r=c==='ARS'?1:Number(document.getElementById(p+'-rate').value)||0;document.getElementById(p+'-preview').innerHTML='Se guardará como: <strong>'+escapeHTML(fmt(a*r))+'</strong>'}

async function saveRateSettings(){meta.settings.usdRateSource=document.getElementById('s-usd-source').value;await writeMeta();renderSettings()}

async function saveManualRate(c){renderSettings(false)}

async function updateAllRates(){if(meta.settings.usdRateSource==='manual')return toast('manualHint');await fetchRateToARS('USD');await fetchRateToARS('RUB');renderSettings();uiCurrency('f');if(editId)uiCurrency('e');toast('Cotizaciones actualizadas')}

async function saveManualRates(){let usd=Number(document.getElementById('s-rate-usd').value),rub=Number(document.getElementById('s-rate-rub').value);if(!(usd>0)||!(rub>0))return toast('rateReq');let at=new Date().toISOString();meta.settings.ratesCache.USD={rateToARS:usd,provider:'manual',fetchedAt:at,updatedAt:at};meta.settings.ratesCache.RUB={rateToARS:rub,provider:'manual',fetchedAt:at,updatedAt:at};let r=await writeMeta();renderSettings();uiCurrency('f');if(editId)uiCurrency('e');if(r.ok&&!r.degraded)toast('ratesSaved')}

function ftime(i){return i?new Date(i).toLocaleString('es-AR'):'—'}

function renderSettings(fill=true){ensureUXControls();document.getElementById('s-usd-source').value=meta.settings.usdRateSource||'blue';let u=meta.settings.ratesCache.USD,r=meta.settings.ratesCache.RUB;document.getElementById('s-usd-cache').textContent=u?.rateToARS?fmt(u.rateToARS):'—';document.getElementById('s-rub-cache').textContent=r?.rateToARS?fmt(r.rateToARS):'—';document.getElementById('s-rate-time').textContent='USD: '+ftime(u?.fetchedAt)+' · RUB: '+ftime(r?.fetchedAt);if(fill){document.getElementById('s-rate-usd').value=u?.rateToARS||'';document.getElementById('s-rate-rub').value=r?.rateToARS||''}}
