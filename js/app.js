function bind(p){['amount','currency','rate'].forEach(n=>document.getElementById(p+'-'+n).addEventListener('input',()=>uiCurrency(p)));document.getElementById(p+'-currency').addEventListener('change',()=>uiCurrency(p))}

(async()=>{await load();if(typeof initSharedMode==='function')await initSharedMode();ensureUXControls();document.getElementById('f-date').value=getLocalDateString();bind('f');bind('e');if(typeof isSharedMode==='function'&&isSharedMode()){syncSharedCategoryDropdowns()}else{setType('expense')}uiCurrency('f');renderAll()})();
