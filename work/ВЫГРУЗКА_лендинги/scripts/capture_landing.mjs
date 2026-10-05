/* Read-only DOM collector; run through the authorized browser evaluate API. */
export default function captureLanding(config = {}) {
  if (!config.rootSelector) throw Error('Confirm the content rootSelector first');
  const url = document.URL, roots = Array.from(document.querySelectorAll(config.rootSelector)).filter(e => !e.parentElement?.closest(config.rootSelector));
  const exclude = config.excludeSelectors || [];
  const ignored = e => ['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','TEXTAREA','INPUT','SELECT','SVG','CANVAS','IFRAME','VIDEO','AUDIO'].includes(e.tagName) || exclude.some(s => e.matches(s));
  const shown = e => {
    for (let n=e; n && n.nodeType===1; n=n.parentElement) {
      const style=getComputedStyle(n);
      if (n.hidden || style.display==='none' || style.visibility==='hidden' || style.visibility==='collapse' || n.getAttribute('aria-hidden')==='true') return false;
      if (style.maxHeight==='0px' && ['hidden','clip'].includes(style.overflowY))return false;
      if (n.tagName==='DETAILS' && !n.hasAttribute('open') && e!==n && !Array.from(n.children).filter(c=>c.tagName==='SUMMARY').some(c=>c===e || c.contains(e))) return false;
    }
    return true;
  };
  const tidy = s => s.replace(/\r\n?/g,'\n').replace(/[ \t]*\n[ \t]*/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  const path = e => {
    const parts=[];
    for(let n=e;n && n.nodeType===1;n=n.parentElement) {
      if(n.id) {parts.unshift('#'+n.id);break;}
      parts.unshift(n.tagName.toLowerCase()+':nth-child('+(Array.from(n.parentElement?.children || []).indexOf(n)+1)+')');
    }
    return parts.join(' > ');
  };
  const absolute = s => {try {return new URL(s,url).href;}catch{return '';}};
  const textOf = n => {
    if(n.nodeType===3) return n.textContent.replace(/[\t\r\n ]+/g,' ');
    if(n.nodeType!==1 || ignored(n) || !shown(n) || n.tagName==='IMG') return '';
    if(n.tagName==='BR') return '\n';
    if(n.tagName==='DETAILS' && !n.hasAttribute('open')) return Array.from(n.children).filter(c=>c.tagName==='SUMMARY').map(textOf).join('');
    const text=Array.from(n.childNodes).map(textOf).join('');
    if(n.tagName==='TD' || n.tagName==='TH') return text.trim()+'\t';
    if(n.tagName==='TR') return text.replace(/\t$/,'')+'\n';
    if(n.tagName==='LI') {
      const list=n.parentElement, items=Array.from(list.children).filter(e=>e.tagName==='LI');
      let number=Number(list.getAttribute('start') || (list.hasAttribute('reversed') ? items.length : 1));
      for(const item of items) {if(item.hasAttribute('value'))number=Number(item.getAttribute('value'));if(item===n)break;number+=list.hasAttribute('reversed')?-1:1;}
      const marker=list.tagName==='OL'?number+'. ':/^[•✓—-]/.test(text.trim())?'':'• ';
      return '\n'+marker+text.trim()+'\n';
    }
    return /^(P|DIV|SECTION|ARTICLE|H[1-6]|UL|OL|BLOCKQUOTE|TABLE|FIGURE|FIGCAPTION)$/.test(n.tagName)?'\n\n'+text+'\n\n':text;
  };
  const unitTag = /^(H[1-6]|P|UL|OL|TABLE|BLOCKQUOTE|BUTTON|LABEL|SUMMARY|PRE)$/;
  const blockish = e => e.nodeType===1 && (/^(DIV|SECTION|ARTICLE|HEADER|FOOTER|NAV|MAIN|FORM|DL|DT|DD|FIGURE)$/.test(e.tagName) || unitTag.test(e.tagName));
  const blocks=[], media=[], review=[], controls=[], frames=[];
  const all=roots.flatMap(e=>[e,...e.querySelectorAll('*')]);
  const nodeOrder=new Map();let nextOrder=0;
  function indexNodes(n){nodeOrder.set(n,nextOrder++);for(const c of n.childNodes)indexNodes(c);}
  roots.forEach(indexNodes);
  const annotations = e => Array.from(e.querySelectorAll('*')).concat(e).filter(n => {
    const style=getComputedStyle(n);return style.textDecorationLine?.includes('line-through') || n.getAttribute('aria-disabled')==='true' || n.hasAttribute('disabled');
  }).map(n=>({text:tidy(textOf(n)),struck:getComputedStyle(n).textDecorationLine?.includes('line-through') || false,disabled:n.getAttribute('aria-disabled')==='true' || n.hasAttribute('disabled')}));
  function emit(e, text, suffix='',position=nodeOrder.get(e)) {
    text=tidy(text);if(!text)return;
    if(/^[\s•✓✔✕×❮❯☰→↓↔|]+$/u.test(text)){text=e.getAttribute('aria-label') || e.getAttribute('title') || '';if(!text)return;}
    const group=config.technicalGroupSelector?e.closest(config.technicalGroupSelector):null;
    const cloneGroup=config.cloneSelector?e.closest(config.cloneSelector):null;
    const section=e.closest('section[id],article[id],nav,header,footer');
    const tariff=config.tariffSelector?e.closest(config.tariffSelector):null;
    const price=config.priceSelector && (e.matches(config.priceSelector) || e.closest(config.priceSelector));
    const record={anchor:(config.scopeId || 'page')+'|'+path(e)+suffix, order:blocks.length, domOrder:position,text,
      type:price?'price':e.tagName.toLowerCase(),section:section?.id || section?.tagName.toLowerCase() || '',
      tariff:tariff?path(tariff):'', technicalGroup:group?path(group):'',clone:!!cloneGroup,annotations:annotations(e)};
    blocks.push(record);
  }
  function walk(e) {
    if(e.nodeType!==1 || ignored(e) || !shown(e))return;
    if(unitTag.test(e.tagName)) {emit(e,e.tagName==='PRE'?e.innerText:textOf(e));return;}
    if(e.tagName==='DETAILS' && !e.hasAttribute('open')) {for(const n of e.children)if(n.tagName==='SUMMARY')walk(n);return;}
    if(!Array.from(e.children).some(blockish)) {emit(e,textOf(e));return;}
    let pending='',number=0,firstNode=null;
    const flush=()=>{if(pending.trim())emit(e,pending,'|inline'+number++,nodeOrder.get(firstNode));pending='';firstNode=null;};
    for(const node of e.childNodes) {
      if(blockish(node)) {flush();walk(node);} else if(node.nodeType===1 && node.querySelector('div,p,ul,ol,table,button,label')) {flush();walk(node);} else {const text=textOf(node);if(text.trim() && !firstNode)firstNode=node;pending+=text;}
    }
    flush();
  }
  for(const root of roots)walk(root);
  const srcset = raw => (raw || '').split(',').map(s=>s.trim()).filter(Boolean).map(s=>{
    const match=s.match(/^(.*?)(?:\s+(\d+(?:\.\d+)?[wx]))?$/);return {url:absolute(match[1]),descriptor:match[2] || ''};
  });
  for(const e of all) {
    if(exclude.some(s=>e.closest(s)) || ['SCRIPT','STYLE','NOSCRIPT','TEMPLATE'].includes(e.tagName))continue;
    const position=path(e), section=e.closest('section[id],article[id]');
    const category=config.reviewSelector && e.closest(config.reviewSelector)?'review':'candidate';
    if(e.tagName==='IMG') {
      const candidates=[];
      for(const attr of ['data-original','data-src','data-lazy-src','src'])if(e.getAttribute(attr))candidates.push({url:absolute(e.getAttribute(attr)),via:attr});
      if(e.currentSrc)candidates.push({url:e.currentSrc,via:'currentSrc'});
      for(const attr of ['srcset','data-srcset'])candidates.push(...srcset(e.getAttribute(attr)).map(c=>({...c,via:attr})));
      for(const source of e.closest('picture')?.querySelectorAll('source') || [])candidates.push(...srcset(source.getAttribute('srcset')).map(c=>({...c,via:'picture'})));
      const a=e.closest('a[href]'), linkedUrl=a?absolute(a.getAttribute('href')):'';
      media.push({anchor:position,order:nodeOrder.get(e),kind:'image',category,section:section?.id || '',visible:shown(e),
        clone:!!(config.cloneSelector && e.closest(config.cloneSelector)),alt:e.getAttribute('alt') || '',
        candidates:candidates.filter(c=>c.url),linkedUrl,width:e.naturalWidth || 0,height:e.naturalHeight || 0});
    }
    const background=getComputedStyle(e).backgroundImage;
    const bg=Array.from((background || '').matchAll(/url\(["']?(.*?)["']?\)/g)).map(m=>({url:absolute(m[1]),via:'css'})).filter(c=>c.url);
    if(bg.length)media.push({anchor:position,order:nodeOrder.get(e),kind:'background',category,section:section?.id || '',visible:shown(e),candidates:bg});
    if(e.tagName==='IFRAME') {
      let location='';try {const u=new URL(e.getAttribute('src') || '',url);location=u.origin+u.pathname;}catch{}
      frames.push({anchor:position,location,visible:shown(e)});
    }
    if(shown(e) && (e.matches('details:not([open])') || e.getAttribute('aria-expanded')==='false'))review.push({type:'collapsed',anchor:position,label:tidy(textOf(e)).slice(0,160)});
    if(config.disclosureSelector && e.matches(config.disclosureSelector))controls.push({anchor:position,label:tidy(textOf(e)).slice(0,160),expanded:e.getAttribute('aria-expanded')});
    if(config.hiddenContentSelector && e.matches(config.hiddenContentSelector) && !shown(e))review.push({type:'hidden_content',anchor:position});
    if(e.tagName==='INPUT' && !['hidden','password','checkbox','radio','file'].includes(e.type)) {
      if(shown(e) && e.getAttribute('placeholder'))emit(e,e.getAttribute('placeholder'),'|placeholder');
      if(shown(e) && ['submit','button','reset'].includes(e.type) && e.getAttribute('value'))emit(e,e.getAttribute('value'),'|label');
    }
    if(e.tagName==='SELECT' && shown(e))for(const option of e.options)emit(e,option.text,'|option'+option.index);
  }
  if(frames.length)review.push({type:'frames',count:frames.length});
  if(blocks.some(b=>b.annotations.length))review.push({type:'visual_meaning',count:blocks.filter(b=>b.annotations.length).length});
  blocks.sort((a,b)=>a.domOrder-b.domOrder);blocks.forEach((b,i)=>b.order=i);
  const password=Array.from(document.querySelectorAll('input[type="password"]')).some(e=>shown(e) && e.getClientRects().length);
  return {version:1,url,title:document.title,status:roots.length?'captured':'missing_content',blocks,media,frames,controls,review,
    loginVisible:password,rootCount:roots.length};
}
