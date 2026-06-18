/*
 * Bibliography renderer — parses a BibTeX file and renders it into the page.
 *
 * Usage (in any HTML content file):
 *   <div data-bib="path/to/refs.bib"></div>
 *   <script src="js/bibliography.js"></script>
 *
 * Inline citations:
 *   <cite data-ref="citekey"></cite>
 *
 * Citations are numbered in order of first appearance. Clicking them jumps
 * to the entry in the bibliography. The path in data-bib is relative to the
 * page that includes it.
 */
(function () {

  // ── Parser ────────────────────────────────────────────────────────────────

  function parseBibtex(src) {
    const entries = [];
    let i = 0;

    while (i < src.length) {
      const at = src.indexOf('@', i);
      if (at === -1) break;
      i = at + 1;

      const typeMatch = src.slice(i).match(/^(\w+)\s*\{/);
      if (!typeMatch) continue;
      const type = typeMatch[1].toLowerCase();
      i += typeMatch[0].length;

      const body = readBalanced(src, i);
      if (body === null) break;
      i += body.length + 1;

      if (type === 'string' || type === 'preamble' || type === 'comment') continue;

      const commaIdx = body.indexOf(',');
      if (commaIdx === -1) continue;
      const key = body.slice(0, commaIdx).trim();
      const fields = parseFields(body.slice(commaIdx + 1));
      entries.push({ type, key, ...fields });
    }

    return entries;
  }

  function readBalanced(src, start) {
    let depth = 1, j = start;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      if (depth > 0) j++;
    }
    return depth === 0 ? src.slice(start, j) : null;
  }

  function parseFields(text) {
    const fields = {};
    let i = 0;
    while (i < text.length) {
      const nameMatch = text.slice(i).match(/^\s*(\w+)\s*=\s*/);
      if (!nameMatch) break;
      i += nameMatch[0].length;
      const name = nameMatch[1].toLowerCase();

      let value = '';
      if (text[i] === '{') {
        i++;
        const inner = readBalanced(text, i);
        if (inner === null) break;
        value = inner;
        i += inner.length + 1;
      } else if (text[i] === '"') {
        i++;
        const end = text.indexOf('"', i);
        if (end === -1) break;
        value = text.slice(i, end);
        i = end + 1;
      } else {
        const numMatch = text.slice(i).match(/^(\d+)/);
        if (numMatch) { value = numMatch[1]; i += numMatch[0].length; }
        else { i++; continue; }
      }

      fields[name] = cleanLatex(value.trim());
      const sep = text.slice(i).match(/^\s*,\s*/);
      if (sep) i += sep[0].length;
    }
    return fields;
  }

  // ── LaTeX cleanup ─────────────────────────────────────────────────────────

  const ACCENT_NAMED = {
    v: {c:'č',C:'Č',s:'š',S:'Š',z:'ž',Z:'Ž',r:'ř',R:'Ř',n:'ň',N:'Ň',d:'ď',D:'Ď',t:'ť',T:'Ť'},
    c: {c:'ç',C:'Ç',s:'ş',S:'Ş'},
    u: {a:'ă',A:'Ă',e:'ĕ',E:'Ĕ',o:'ŏ',O:'Ŏ',u:'ŭ',U:'Ŭ'},
    H: {o:'ő',O:'Ő',u:'ű',U:'Ű'},
    k: {a:'ą',A:'Ą',e:'ę',E:'Ę'},
    r: {a:'å',A:'Å'},
  };
  const ACCENT_PUNCT = {
    '"': {a:'ä',A:'Ä',e:'ë',E:'Ë',i:'ï',I:'Ï',o:'ö',O:'Ö',u:'ü',U:'Ü',y:'ÿ',Y:'Ÿ'},
    "'": {a:'á',A:'Á',e:'é',E:'É',i:'í',I:'Í',o:'ó',O:'Ó',u:'ú',U:'Ú',y:'ý',Y:'Ý',
           c:'ć',C:'Ć',n:'ń',N:'Ń',s:'ś',S:'Ś',z:'ź',Z:'Ź'},
    '`': {a:'à',A:'À',e:'è',E:'È',i:'ì',I:'Ì',o:'ò',O:'Ò',u:'ù',U:'Ù'},
    '^': {a:'â',A:'Â',e:'ê',E:'Ê',i:'î',I:'Î',o:'ô',O:'Ô',u:'û',U:'Û'},
    '~': {a:'ã',A:'Ã',n:'ñ',N:'Ñ',o:'õ',O:'Õ'},
    '=': {a:'ā',A:'Ā',e:'ē',E:'Ē',i:'ī',I:'Ī',o:'ō',O:'Ō',u:'ū',U:'Ū'},
  };
  const SPECIAL = {ss:'ß',ae:'æ',AE:'Æ',oe:'œ',OE:'Œ',aa:'å',AA:'Å',o:'ø',O:'Ø',l:'ł',L:'Ł'};

  function cleanLatex(s) {
    // Named accents: \v{c} → č
    s = s.replace(/\\([a-zA-Z]+)\{([a-zA-Z])\}/g, (_, cmd, ch) =>
      (ACCENT_NAMED[cmd] && ACCENT_NAMED[cmd][ch]) || ch);
    // Punctuation accents: \"u → ü  (braces like {\"u} are handled by step 4)
    s = s.replace(/\\(["'`^~=])([a-zA-Z])/g, (_, acc, ch) =>
      (ACCENT_PUNCT[acc] && ACCENT_PUNCT[acc][ch]) || ch);
    // Special commands: \ss → ß, \o → ø
    s = s.replace(/\\([a-zA-Z]+)/g, (_, cmd) => SPECIAL[cmd] !== undefined ? SPECIAL[cmd] : '');
    // Strip remaining braces
    s = s.replace(/\{([^{}]*)\}/g, '$1');
    return s.replace(/---/g, '—').replace(/--/g, '–').replace(/~/g, ' ').trim();
  }

  function formatAuthors(str) {
    if (!str) return '';
    return str.split(/\s+and\s+/i).map(a => {
      a = a.trim();
      const parts = a.split(',');
      return parts.length >= 2 ? parts[1].trim() + ' ' + parts[0].trim() : a;
    }).join(', ');
  }

  // ── Citation numbering ────────────────────────────────────────────────────

  function getEntryUrl(e) {
    // Explicit fields take priority
    const arxivId = e.arxiv || e.eprint;
    if (arxivId) return `https://arxiv.org/abs/${arxivId}`;
    if (e.doi)   return `https://doi.org/${e.doi}`;
    if (e.url)   return e.url;
    // Fall back to extracting an arXiv ID from the journal/howpublished field
    // e.g. journal = {arXiv preprint arXiv:2410.06205}
    const journalLike = e.journal || e.howpublished || '';
    const m = journalLike.match(/arXiv[:\s]+(\d{4}\.\d{4,5}(?:v\d+)?)/i);
    if (m) return `https://arxiv.org/abs/${m[1]}`;
    return null;
  }

  function buildCitationOrder() {
    const order = new Map();
    document.querySelectorAll('cite[data-ref]').forEach(el => {
      const key = el.getAttribute('data-ref');
      if (!order.has(key)) order.set(key, order.size + 1);
    });
    return order;
  }

  function renderInlineCitations(citationOrder, entryMap) {
    document.querySelectorAll('cite[data-ref]').forEach(el => {
      const key = el.getAttribute('data-ref');
      const num = citationOrder.get(key);
      const entry = entryMap[key];
      const url = entry ? getEntryUrl(entry) : null;
      const a = document.createElement('a');
      a.className = 'bib-cite';
      a.textContent = num !== undefined ? `[${num}]` : '[?]';
      if (url) { a.href = url; a.target = '_blank'; }
      else     { a.href = `#bib-${key}`; }
      el.replaceWith(a);
    });
  }

  // ── Renderer ──────────────────────────────────────────────────────────────

  function renderEntry(e, num) {
    const authors = formatAuthors(e.author);
    const year = e.year || '';
    const title = e.title || 'Untitled';

    let venue = '';
    if (e.journal)        venue = `<em>${e.journal}</em>`;
    else if (e.booktitle) venue = `<em>${e.booktitle}</em>`;
    else if (e.school)    venue = `<em>${e.school}</em>`;
    else if (e.institution) venue = `<em>${e.institution}</em>`;

    const vol     = e.volume ? e.volume : '';
    const numStr  = e.number ? `(${e.number})` : '';
    const pages   = e.pages  ? `:${e.pages.replace('--', '–')}` : '';
    const volInfo = vol ? ` ${vol}${numStr}${pages}` : '';
    const yearPart = venue && year ? `, ${year}` : year;

    const links = [];
    if (e.doi)
      links.push(`<a class="bib-badge" href="https://doi.org/${e.doi}" target="_blank">DOI</a>`);
    const arxivId = e.arxiv || e.eprint;
    if (arxivId)
      links.push(`<a class="bib-badge" href="https://arxiv.org/abs/${arxivId}" target="_blank">arXiv</a>`);
    if (e.url && !e.doi)
      links.push(`<a class="bib-badge" href="${e.url}" target="_blank">PDF</a>`);

    const url = getEntryUrl(e);
    const numTag = num !== undefined
      ? (url
          ? `<a class="bib-num" href="${url}" target="_blank">[${num}]</a>`
          : `<span class="bib-num">[${num}]</span>`)
      : '';
    const titleLine = num !== undefined
      ? `<div class="bib-header">${numTag}<span class="bib-title">${title}</span></div>`
      : `<span class="bib-title">${title}</span>`;

    return `<li class="bib-entry" id="bib-${e.key}">
      ${titleLine}
      ${authors ? `<span class="bib-authors">${authors}</span>` : ''}
      <span class="bib-venue">${venue}${volInfo}${yearPart}</span>
      ${links.length ? `<span class="bib-links">${links.join('')}</span>` : ''}
    </li>`;
  }

  function render(container, entries, citationOrder) {
    const byKey = Object.fromEntries(entries.map(e => [e.key, e]));

    const cited = [];
    citationOrder.forEach((num, key) => {
      if (byKey[key]) cited.push({ entry: byKey[key], num });
    });

    if (!cited.length) {
      container.innerHTML = '<p class="bib-empty">No entries found.</p>';
      return;
    }

    container.innerHTML = `<ul class="bibliography">${cited.map(({ entry, num }) => renderEntry(entry, num)).join('')}</ul>`;
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async function init() {
    const containers = Array.from(document.querySelectorAll('[data-bib]'));
    if (!containers.length) return;

    containers.forEach(c => { c.innerHTML = '<p class="bib-loading">Loading bibliography…</p>'; });

    // Fetch all bib files first so inline citations can link directly to papers
    const results = await Promise.all(containers.map(async container => {
      try {
        const r = await fetch(container.getAttribute('data-bib'));
        if (!r.ok) throw new Error(r.status);
        return { container, entries: parseBibtex(await r.text()) };
      } catch {
        container.innerHTML = `<p class="bib-error">Could not load <code>${container.getAttribute('data-bib')}</code>.</p>`;
        return { container, entries: [] };
      }
    }));

    const entryMap = {};
    results.forEach(({ entries }) => entries.forEach(e => { entryMap[e.key] = e; }));

    const citationOrder = buildCitationOrder();
    renderInlineCitations(citationOrder, entryMap);

    results.forEach(({ container, entries }) => {
      if (entries.length) render(container, entries, citationOrder);
    });
  }

  // Expose so index.html can call after dynamic content loads
  window.bibliography = { init };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
