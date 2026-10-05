/* Read-only DOM collector. Execute only via the authorized browser's evaluate API. */
function capturePage(config) {
  const cfg = config || {};
  const url = document.URL;
  if (/\/cms\/system\/login(?:[/?#]|$)/i.test(url) || Array.from(document.querySelectorAll('input[type="password"]')).some(e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden')) {
    return {version: 1, url, status: 'login_required', title: '', text: '', links: [], media: [], review: []};
  }
  if (!cfg.rootSelector) throw Error('rootSelector must be confirmed against the visible page');
  const excluded = cfg.excludeSelectors || [];
  const skip = e => ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName)
    || excluded.some(s => e.matches(s));
  const visible = e => {
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (n.hidden || s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') return false;
    }
    return true;
  };
  const roots = Array.from(document.querySelectorAll(cfg.rootSelector)).filter(e =>
    !e.parentElement?.closest(cfg.rootSelector));
  if (!roots.length) return {version: 1, url, status: 'missing_content', title: '', text: '', links: [], media: [], review: []};
  const tidy = s => s.replace(/\r\n?/g, '\n').replace(/[\t ]*\n[\t ]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const read = (n, pre = false) => {
    if (n.nodeType === 3) return pre ? n.textContent : n.textContent.replace(/[\t\r\n ]+/g, ' ');
    if (n.nodeType !== 1 || skip(n) || !visible(n)) return '';
    const tag = n.tagName;
    if (tag === 'BR') return '\n';
    if (tag === 'IFRAME' || tag === 'VIDEO' || tag === 'AUDIO') return '';
    if (tag === 'IMG') return ''; // alt/title are metadata, never OCR.
    if (tag === 'DETAILS' && !n.hasAttribute('open')) return Array.from(n.children).filter(c => c.tagName === 'SUMMARY').map(c => read(c, pre)).join('');
    const t = Array.from(n.childNodes).map(c => read(c, pre || tag === 'PRE')).join('');
    if (tag === 'TD' || tag === 'TH') return t.trim() + '\t';
    if (tag === 'TR') return t.replace(/\t$/, '') + '\n';
    if (tag === 'LI') {
      const list = n.parentElement;
      const siblings = Array.from(list.children).filter(e => e.tagName === 'LI');
      let number = Number(list.getAttribute('start') || (list.hasAttribute('reversed') ? siblings.length : 1));
      for (const item of siblings) {
        if (item.hasAttribute('value')) number = Number(item.getAttribute('value'));
        if (item === n) break;
        number += list.hasAttribute('reversed') ? -1 : 1;
      }
      return '\n' + (list.tagName === 'OL' ? number + '. ' : '• ') + t.trim() + '\n';
    }
    if (/^(P|DIV|SECTION|ARTICLE|H[1-6]|UL|OL|BLOCKQUOTE|TABLE|PRE|FIGURE|FIGCAPTION)$/.test(tag)) return '\n\n' + t + '\n\n';
    return t;
  };
  const titleNodes = cfg.titleSelector ? Array.from(document.querySelectorAll(cfg.titleSelector)).filter(visible) : [];
  const review = [];
  if (titleNodes.length !== 1) review.push({type: 'title_count', count: titleNodes.length});
  const title = titleNodes.length === 1 ? tidy(read(titleNodes[0])) : '';
  const blocks = roots.map((e, i) => ({index: i, selector: e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + String(e.className).replace(/\s+/g, '.'), text: tidy(read(e))}));
  const media = [], links = [], frames = [], unlinked = [];
  const all = roots.flatMap(e => [e, ...e.querySelectorAll('*')]);
  const abs = s => { try { return new URL(s, url).href; } catch { return s; } };
  const srcsets = s => (s || '').split(',').map(x => x.trim()).filter(Boolean).map(x => {
    const match = x.match(/^(.*?)(?:\s+(\d+(?:\.\d+)?[wx]))?$/);
    return {url: abs(match[1]), descriptor: match[2] || ''};
  });
  for (const e of all) {
    if (skip(e) || excluded.some(s => e.closest(s))) continue;
    const isVisible = visible(e);
    const clickTarget = cfg.entrySelector && e.matches(cfg.entrySelector) && !e.querySelector('a[href]')
      ? (e.getAttribute('onclick') || '').match(/^\s*(?:window\.)?location\.href\s*=\s*(['"])(.*?)\1\s*;?\s*$/) : null;
    if ((e.tagName === 'A' && e.getAttribute('href')) || clickTarget) {
      const label = cfg.linkTitleSelector ? e.querySelector(cfg.linkTitleSelector) : null;
      links.push({url: abs(clickTarget ? clickTarget[2] : e.getAttribute('href')), title: tidy(read(label || e)), visible: isVisible});
    }
    if (cfg.entrySelector && e.matches(cfg.entrySelector) && !e.querySelector('a[href]') && !clickTarget) unlinked.push({index:unlinked.length, title:tidy(read(e)), reference:e.getAttribute('data-lesson-id') || '', status:'needs_manual_check'});
    if (e.tagName === 'IMG') {
      const candidates = [];
      for (const attr of ['src', 'data-src', 'data-original', 'data-lazy-src']) {
        const value = e.getAttribute(attr);
        if (value) candidates.push({url: abs(value), via: attr});
      }
      if (e.currentSrc) candidates.push({url: e.currentSrc, via: 'currentSrc'});
      for (const attr of ['srcset', 'data-srcset']) candidates.push(...srcsets(e.getAttribute(attr)).map(c => ({...c, via: attr})));
      const picture = e.closest('picture');
      if (picture) for (const source of picture.querySelectorAll('source')) candidates.push(...srcsets(source.getAttribute('srcset')).map(c => ({...c, via: 'picture'})));
      const link = e.closest('a[href]');
      media.push({index: media.length, kind: 'image', visible: isVisible, alt: e.getAttribute('alt') || '', title: e.getAttribute('title') || '',
        candidates, linkedUrl: link ? abs(link.getAttribute('href')) : '', width: e.naturalWidth || 0, height: e.naturalHeight || 0});
    }
    const background = getComputedStyle(e).backgroundImage;
    const bg = Array.from((background || '').matchAll(/url\(["']?(.*?)["']?\)/g)).map(m => ({url: abs(m[1]), via: 'css'}));
    if (bg.length) media.push({index: media.length, kind: 'background', visible: isVisible, candidates: bg, alt: '', title: ''});
    if (e.tagName === 'IFRAME') {
      const raw = e.getAttribute('src');
      let location = '';
      try { const u = new URL(raw || '', url); location = u.origin + u.pathname; } catch {}
      frames.push({index: frames.length, location, visible: isVisible}); // Never retain signed player queries.
    }
    if (isVisible && (e.matches('details:not([open])') || e.getAttribute('aria-expanded') === 'false')) review.push({type: 'collapsed', label: tidy(read(e)).slice(0,200)});
    if (isVisible && ['CANVAS', 'SVG', 'OBJECT', 'EMBED'].includes(e.tagName)) review.push({type: 'non_html_visual', tag: e.tagName});
  }
  if (frames.length) review.push({type: 'frames', count: frames.length});
  const pagination = cfg.paginationSelector ? Array.from(document.querySelectorAll(cfg.paginationSelector)).filter(visible).map(e => ({url: abs(e.getAttribute('href') || ''), title: tidy(read(e))})) : [];
  if (unlinked.length) review.push({type:'unlinked_entries',count:unlinked.length});
  return {version: 1, url, status: 'captured', title, text: blocks.map(b => b.text).filter(Boolean).join('\n\n'), blocks, links, media, frames, pagination, unlinked, review};
}

export default capturePage;
