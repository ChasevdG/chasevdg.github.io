(function () {
  'use strict';

  const STORAGE_KEY = 'site_comments_v1';
  const AUTHOR_KEY  = 'cm_author';
  let active = false;
  let currentAuthor = '';
  let tooltip = null;
  let pendingSpan = null;
  let panelTab = 'open';
  let panelMinimized = false;

  function applyTabClass() {
    document.body.classList.toggle('cm-tab-resolved', active && panelTab === 'resolved');
  }

  function updateBodyMargin() {
    document.body.style.marginRight = !active ? ''
      : panelMinimized ? '36px'
      : '300px';
  }

  // ── Toggle: Option + Command + E ─────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.altKey && e.metaKey && e.code === 'KeyE') {
      e.preventDefault();
      if (!active) openNamePrompt();
      else deactivate();
    }
  });

  // ── Name prompt modal ─────────────────────────────────────────────────
  function openNamePrompt() {
    const stored = localStorage.getItem(AUTHOR_KEY) || '';
    const overlay = document.createElement('div');
    overlay.id = 'cm-name-overlay';
    overlay.innerHTML = `
      <div id="cm-name-dialog">
        <div class="cm-name-title">Enter Commentor Mode</div>
        <label class="cm-name-label">Your display name</label>
        <input class="cm-name-input" type="text" value="${stored}" placeholder="e.g. Chase">
        <div class="cm-name-actions">
          <button class="cm-name-submit">Enter</button>
          <button class="cm-name-cancel">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('.cm-name-input');
    input.focus();
    input.select();

    overlay.querySelector('.cm-name-submit').onclick = () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      overlay.remove();
      activate(name);
    };
    overlay.querySelector('.cm-name-cancel').onclick = () => overlay.remove();
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  overlay.querySelector('.cm-name-submit').click();
      if (e.key === 'Escape') overlay.remove();
    });
  }

  // ── Activate / deactivate ─────────────────────────────────────────────
  function activate(name) {
    currentAuthor = name;
    localStorage.setItem(AUTHOR_KEY, name);
    active = true;
    panelMinimized = false;
    document.body.classList.add('commentor-mode');
    showBanner();
    applyTabClass();
    renderPanel();
    updateBodyMargin();
    reapplyAll(document.body);
  }

  function deactivate() {
    active = false;
    panelMinimized = false;
    currentAuthor = '';
    document.body.classList.remove('commentor-mode', 'cm-tab-resolved');
    showBanner();
    removeTooltip();
    closePopup();
    updateBodyMargin();
    const panel = document.getElementById('cm-panel');
    if (panel) panel.remove();
  }

  // ── Banner ────────────────────────────────────────────────────────────
  function showBanner() {
    let b = document.getElementById('cm-banner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'cm-banner';
      document.body.appendChild(b);
    }
    b.textContent = active
      ? `Commentor Mode — ${currentAuthor} (⌥⌘E to exit)`
      : 'Commentor Mode OFF';
    b.className = active ? 'active' : '';
    clearTimeout(b._t);
    b.style.opacity = '1';
    if (!active) b._t = setTimeout(() => { b.style.opacity = '0'; }, 1200);
  }

  // ── Minimize / restore panel ──────────────────────────────────────────
  function minimizePanel() {
    panelMinimized = true;
    updateBodyMargin();
    const panel = document.getElementById('cm-panel');
    if (!panel) return;
    panel.classList.add('cm-panel-minimized');
    const all   = loadAll();
    const open  = all.filter(c => !c.resolved).length;
    const res   = all.filter(c =>  c.resolved).length;
    panel.innerHTML = `
      <button id="cm-panel-restore" title="Restore comments panel">
        <span class="cm-panel-restore-label">Comments</span>
        <span class="cm-panel-restore-count">${open} open · ${res} resolved</span>
      </button>`;
    panel.querySelector('#cm-panel-restore').onclick = () => {
      panelMinimized = false;
      panel.classList.remove('cm-panel-minimized');
      renderPanel();
      updateBodyMargin();
    };
  }

  // ── Tab context helpers ───────────────────────────────────────────────
  // Called at comment-creation time to record which tab the text lives in.
  function findTabContext(el) {
    if (!el) return {};
    // Sub-tabs have both 'tab-content' and 'sub-tab-content' classes.
    const subTabEl = el.closest('.sub-tab-content');
    let mainTabEl = null;
    let node = el.parentElement;
    while (node && node !== document.body) {
      if (node.classList.contains('tab-content') && !node.classList.contains('sub-tab-content')) {
        mainTabEl = node;
        break;
      }
      node = node.parentElement;
    }
    const tabId    = mainTabEl ? mainTabEl.id    : null;
    const subTabId = subTabEl  ? subTabEl.id     : null;
    const filePath = subTabId  ? filePathFor(subTabId) : null;
    return { tabId, subTabId, filePath };
  }

  // Look up the fetch URL for a subtab from its onclick attribute.
  function filePathFor(subTabId) {
    const btn = document.querySelector(`[onclick*="showSubTab('${subTabId}'"]`);
    if (!btn) return null;
    const m = btn.getAttribute('onclick').match(/showSubTab\('([^']+)',\s*'([^']+)'\)/);
    return m ? m[2] : null;
  }

  // Returns false if any ancestor has display:none (i.e. inside a hidden tab).
  function isInVisibleTab(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
      if (node.style.display === 'none') return false;
      node = node.parentElement;
    }
    return true;
  }

  // Navigate to the tab (and subtab) that contains a comment's highlight,
  // fetch the subtab content if needed, reapply highlights, then scroll.
  async function jumpToComment(c) {
    let span = document.querySelector(`.cm-hl[data-id="${c.id}"]`);

    // Navigate if: span missing OR span is inside a hidden tab.
    // (reapplyAll restores spans even in hidden tabs, so we must check visibility.)
    if (!span || !isInVisibleTab(span)) {
      let tabId    = c.tabId;
      let subTabId = c.subTabId;
      let filePath = c.filePath;

      // Old comments without stored context: infer from the DOM element if present.
      if (!tabId && span) {
        const tabEl    = span.closest('.tab-content:not(.sub-tab-content)');
        const subTabEl = span.closest('.sub-tab-content');
        if (tabEl)    tabId    = tabEl.id;
        if (subTabEl) { subTabId = subTabEl.id; filePath = filePathFor(subTabId); }
      }

      if (tabId && typeof window.showTab === 'function') window.showTab(tabId);

      if (subTabId && filePath) {
        // Own the fetch directly so we can await it and call reapplyAll
        // synchronously — no polling or MutationObserver race to worry about.
        document.querySelectorAll('.sub-tab-content').forEach(el => el.style.display = 'none');
        history.replaceState(null, '', '#' + (tabId || '') + '/' + subTabId);
        const subTabEl = document.getElementById(subTabId);
        if (subTabEl) {
          try {
            const resp = await fetch(filePath);
            if (resp.ok) {
              const html = await resp.text();
              subTabEl.innerHTML = html;
              subTabEl.style.display = 'block';
              if (window.MathJax) MathJax.typesetPromise();
              if (window.bibliography) window.bibliography.init();
              reapplyAll(subTabEl);
            }
          } catch (e) {
            console.error('commentor: failed to load', filePath, e);
          }
        }
      }

      span = document.querySelector(`.cm-hl[data-id="${c.id}"]`);
    }

    if (!span) return;
    span.scrollIntoView({ behavior: 'smooth', block: 'center' });
    span.classList.remove('cm-hl-pulse');
    void span.offsetWidth;
    span.classList.add('cm-hl-pulse');
    setTimeout(() => span.classList.remove('cm-hl-pulse'), 1200);
  }

  // ── Comments panel ────────────────────────────────────────────────────
  function renderPanel() {
    let panel = document.getElementById('cm-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'cm-panel';
      document.body.appendChild(panel);
    }
    panel.classList.remove('cm-panel-minimized');

    const all      = loadAll();
    const open     = all.filter(c => !c.resolved);
    const resolved = all.filter(c =>  c.resolved);
    const shown    = panelTab === 'open' ? open : resolved;

    panel.innerHTML = `
      <div id="cm-panel-header">
        <span>Comments</span>
        <button id="cm-panel-minimize" title="Minimize panel">−</button>
      </div>
      <div id="cm-panel-tabs">
        <button class="cm-panel-tab ${panelTab === 'open'     ? 'active' : ''}" data-tab="open">
          Open (${open.length})
        </button>
        <button class="cm-panel-tab ${panelTab === 'resolved' ? 'active' : ''}" data-tab="resolved">
          Resolved (${resolved.length})
        </button>
      </div>
      <div id="cm-panel-body">
        ${shown.length === 0
          ? `<div class="cm-panel-empty">${panelTab === 'open'
              ? 'No open comments.<br>Select text to add one.'
              : 'No resolved comments yet.'}</div>`
          : shown.map(c => `
            <div class="cm-card${c.resolved ? ' cm-card-resolved' : ''}" data-id="${c.id}" title="Click to jump to highlight">
              <div class="cm-card-header">
                <span class="cm-card-author">${c.author}</span>
                <span class="cm-card-time">${formatDate(c.timestamp)}</span>
              </div>
              <div class="cm-card-quote">"${c.text.length > 70 ? c.text.slice(0, 70) + '…' : c.text}"</div>
              <div class="cm-card-comment">${c.comment}</div>
              <div class="cm-card-actions">
                ${c.resolved
                  ? `<button class="cm-card-unresolve" data-id="${c.id}">↩ Unresolve</button>`
                  : `<button class="cm-card-resolve"   data-id="${c.id}">✓ Resolve</button>`}
                <button class="cm-card-delete" data-id="${c.id}">Delete</button>
              </div>
            </div>`).join('')}
      </div>`;

    panel.querySelector('#cm-panel-minimize').onclick = minimizePanel;

    panel.querySelectorAll('.cm-panel-tab').forEach(btn => {
      btn.onclick = () => { panelTab = btn.dataset.tab; applyTabClass(); renderPanel(); };
    });

    // Card click → navigate to the right tab then scroll to highlight
    panel.querySelectorAll('.cm-card').forEach(card => {
      card.onclick = e => {
        if (e.target.closest('.cm-card-resolve, .cm-card-unresolve, .cm-card-delete')) return;
        const c = loadAll().find(x => x.id === card.dataset.id);
        if (c) jumpToComment(c);
      };
    });

    panel.querySelectorAll('.cm-card-resolve').forEach(btn => {
      btn.onclick = () => {
        setResolved(btn.dataset.id, true);
        const span = document.querySelector(`.cm-hl[data-id="${btn.dataset.id}"]`);
        if (span) span.classList.add('cm-hl-resolved');
        renderPanel();
      };
    });

    panel.querySelectorAll('.cm-card-unresolve').forEach(btn => {
      btn.onclick = () => {
        setResolved(btn.dataset.id, false);
        const span = document.querySelector(`.cm-hl[data-id="${btn.dataset.id}"]`);
        if (span) span.classList.remove('cm-hl-resolved');
        renderPanel();
      };
    });

    panel.querySelectorAll('.cm-card-delete').forEach(btn => {
      btn.onclick = () => {
        deleteComment(btn.dataset.id);
        const span = document.querySelector(`.cm-hl[data-id="${btn.dataset.id}"]`);
        if (span) span.replaceWith(...span.childNodes);
        renderPanel();
      };
    });

    updateBodyMargin();
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ── Text selection → pending highlight → popup ────────────────────────
  document.addEventListener('mouseup', e => {
    if (!active) return;
    if (e.target.closest('#cm-popup, #cm-panel, #cm-name-overlay')) return;

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (!text) return;

    const range = sel.getRangeAt(0).cloneRange();
    const span  = document.createElement('span');
    span.className = 'cm-pending';
    try { range.surroundContents(span); }
    catch { span.appendChild(range.extractContents()); range.insertNode(span); }
    pendingSpan = span;
    window.getSelection().removeAllRanges();

    openPopup(e.clientX, e.clientY, text);
  });

  function openPopup(cx, cy, text) {
    closePopupEl();
    const popup = document.createElement('div');
    popup.id = 'cm-popup';
    const preview = text.length > 55 ? text.slice(0, 55) + '…' : text;
    popup.innerHTML = `
      <div class="cm-popup-title">
        Add Comment <span class="cm-popup-author">as ${currentAuthor}</span>
      </div>
      <div class="cm-popup-preview">"${preview}"</div>
      <textarea class="cm-popup-input" placeholder="Write a comment… (Cmd+Enter to save)" rows="3"></textarea>
      <div class="cm-popup-actions">
        <button class="cm-popup-submit">Add</button>
        <button class="cm-popup-cancel">Cancel</button>
      </div>`;

    // Insert off-screen first to measure actual rendered dimensions.
    popup.style.left = '-9999px';
    popup.style.top  = '-9999px';
    document.body.appendChild(popup);

    const pr = popup.getBoundingClientRect();
    const vw = window.innerWidth - (active && !panelMinimized ? 304 : 40);
    const vh = window.innerHeight;
    let left = cx + 12;
    let top  = cy + 12;
    if (left + pr.width  > vw - 8) left = cx - pr.width  - 12;
    if (top  + pr.height > vh - 8) top  = cy - pr.height - 12;
    popup.style.left = Math.max(8, left) + 'px';
    popup.style.top  = Math.max(8, top)  + 'px';

    const ta = popup.querySelector('.cm-popup-input');
    ta.focus();
    popup.querySelector('.cm-popup-submit').onclick = () => submitComment(text);
    popup.querySelector('.cm-popup-cancel').onclick  = closePopup;
    ta.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitComment(text);
      if (e.key === 'Escape') closePopup();
    });
  }

  function submitComment(selectedText) {
    const popup   = document.getElementById('cm-popup');
    const comment = popup ? popup.querySelector('.cm-popup-input').value.trim() : '';
    closePopupEl();
    if (!comment) { cancelPending(); return; }

    const id  = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const ctx = findTabContext(pendingSpan);

    pendingSpan.className    = 'cm-hl';
    pendingSpan.dataset.comment = comment;
    pendingSpan.dataset.id   = id;
    pendingSpan = null;

    saveComment(selectedText, comment, id, ctx);
    panelTab = 'open';
    applyTabClass();
    if (panelMinimized) {
      const panel = document.getElementById('cm-panel');
      if (panel) panel.classList.remove('cm-panel-minimized');
      panelMinimized = false;
    }
    renderPanel();
    window.getSelection().removeAllRanges();
  }

  function cancelPending() {
    if (pendingSpan && pendingSpan.parentNode) pendingSpan.replaceWith(...pendingSpan.childNodes);
    pendingSpan = null;
  }

  function closePopupEl() {
    const p = document.getElementById('cm-popup');
    if (p) p.remove();
  }

  function closePopup() {
    cancelPending();
    closePopupEl();
  }

  // ── Tooltip on hover ──────────────────────────────────────────────────
  document.addEventListener('mouseover', e => {
    if (!active) return;
    const h = e.target.closest('.cm-hl');
    if (!h) { removeTooltip(); return; }
    const entry  = loadAll().find(c => c.id === h.dataset.id);
    const prefix = (entry && entry.resolved) ? '✓ ' : '';
    const label  = entry ? `${prefix}${entry.author}: ${entry.comment}` : h.dataset.comment;
    showTooltip(label, e.clientX, e.clientY);
  });

  document.addEventListener('mousemove', e => {
    if (tooltip) moveTooltip(e.clientX, e.clientY);
  });

  function showTooltip(text, cx, cy) {
    removeTooltip();
    tooltip = document.createElement('div');
    tooltip.id = 'cm-tooltip';
    tooltip.textContent = text;
    document.body.appendChild(tooltip);
    moveTooltip(cx, cy);
  }

  function moveTooltip(cx, cy) {
    if (!tooltip) return;
    const tw = tooltip.offsetWidth  || 240;
    const th = tooltip.offsetHeight || 48;
    let x = cx + 16, y = cy - 8;
    if (x + tw > window.innerWidth - 8) x = cx - tw - 16;
    if (y + th > window.innerHeight - 8) y = cy - th - 8;
    tooltip.style.left = x + 'px';
    tooltip.style.top  = y + 'px';
  }

  function removeTooltip() {
    if (tooltip) { tooltip.remove(); tooltip = null; }
  }

  // ── Persistence ───────────────────────────────────────────────────────
  function saveComment(text, comment, id, ctx = {}) {
    const all = loadAll();
    all.push({
      id, text, comment,
      author:    currentAuthor,
      resolved:  false,
      timestamp: new Date().toISOString(),
      tabId:     ctx.tabId    || null,
      subTabId:  ctx.subTabId || null,
      filePath:  ctx.filePath || null,
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  }

  function setResolved(id, resolved) {
    const all = loadAll();
    const c   = all.find(c => c.id === id);
    if (c) c.resolved = resolved;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  }

  function deleteComment(id) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loadAll().filter(c => c.id !== id)));
  }

  function loadAll() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]').map((c, i) => ({
        id:        c.id        || (Date.now() + i).toString(36),
        author:    c.author    || 'Unknown',
        text:      c.text      || '',
        comment:   c.comment   || '',
        resolved:  c.resolved  || false,
        timestamp: c.timestamp || '',
        tabId:     c.tabId     || null,
        subTabId:  c.subTabId  || null,
        filePath:  c.filePath  || null,
      }));
    } catch { return []; }
  }

  // ── Re-apply stored highlights ────────────────────────────────────────
  function reapplyAll(root) {
    loadAll().forEach(({ text, comment, id, resolved }) =>
      restoreInNode(root, text, comment, id, resolved));
  }

  function restoreInNode(root, searchText, comment, id, resolved) {
    if (document.querySelector(`.cm-hl[data-id="${id}"]`)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n =>
        n.parentElement.closest('.cm-hl, .cm-pending, #cm-popup, #cm-banner, #cm-panel, #cm-name-overlay, script, style')
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let node;
    while ((node = walker.nextNode())) {
      const idx = node.textContent.indexOf(searchText);
      if (idx === -1) continue;
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + searchText.length);
      const span = document.createElement('span');
      span.className       = 'cm-hl' + (resolved ? ' cm-hl-resolved' : '');
      span.dataset.comment = comment;
      span.dataset.id      = id;
      try { range.surroundContents(span); }
      catch { span.appendChild(range.extractContents()); range.insertNode(span); }
      return;
    }
  }

  // Re-apply when dynamically fetched subtab content is injected.
  const observer = new MutationObserver(mutations => {
    if (!active) return;
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType === Node.ELEMENT_NODE &&
            !n.closest('#cm-panel, #cm-popup, #cm-banner, #cm-name-overlay')) {
          reapplyAll(n);
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

})();
