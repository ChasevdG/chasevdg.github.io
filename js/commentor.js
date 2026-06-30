(function () {
  'use strict';

  const SUPABASE_URL = 'https://pqopwrzcximbzbgnvkan.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_i4knI1wJaS002kgZinA2pg_-gurimWG';
  const API          = `${SUPABASE_URL}/rest/v1/comments`;
  const SB           = {
    'apikey':        SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type':  'application/json',
  };
  const AUTHOR_KEY   = 'cm_author';

  let active         = false;
  let currentAuthor  = '';
  let tooltip        = null;
  let pendingSpans   = [];
  let panelTab       = 'open';
  let panelMinimized = false;
  let commentsCache  = [];

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
  async function activate(name) {
    currentAuthor = name;
    localStorage.setItem(AUTHOR_KEY, name);
    active = true;
    panelMinimized = false;
    document.body.classList.add('commentor-mode');
    showBanner();
    applyTabClass();
    renderPanel();
    updateBodyMargin();
    document.dispatchEvent(new CustomEvent('commentor-mode-change', { detail: { active: true } }));
    await fetchComments();
    renderPanel();
    reapplyAll(document.body);
  }

  function deactivate() {
    active = false;
    panelMinimized = false;
    currentAuthor = '';
    commentsCache = [];
    document.body.classList.remove('commentor-mode', 'cm-tab-resolved');
    showBanner();
    removeTooltip();
    closePopup();
    updateBodyMargin();
    const panel = document.getElementById('cm-panel');
    if (panel) panel.remove();
    document.dispatchEvent(new CustomEvent('commentor-mode-change', { detail: { active: false } }));
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

  // ── Error toast ───────────────────────────────────────────────────────
  function showError(msg) {
    let el = document.getElementById('cm-error');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cm-error';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 4000);
  }

  // ── Minimize / restore panel ──────────────────────────────────────────
  function minimizePanel() {
    panelMinimized = true;
    updateBodyMargin();
    const panel = document.getElementById('cm-panel');
    if (!panel) return;
    panel.classList.add('cm-panel-minimized');
    const all  = loadAll();
    const open = all.filter(c => !c.resolved).length;
    const res  = all.filter(c =>  c.resolved).length;
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
  function findTabContext(el) {
    if (!el) return {};
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

  function filePathFor(subTabId) {
    const btn = document.querySelector(`[onclick*="showSubTab('${subTabId}'"]`);
    if (!btn) return null;
    const m = btn.getAttribute('onclick').match(/showSubTab\('([^']+)',\s*'([^']+)'\)/);
    return m ? m[2] : null;
  }

  function isInVisibleTab(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
      if (node.style.display === 'none') return false;
      node = node.parentElement;
    }
    return true;
  }

  async function jumpToComment(c) {
    let span = document.querySelector(`.cm-hl[data-id="${c.id}"]`);

    if (!span || !isInVisibleTab(span)) {
      let tabId    = c.tabId;
      let subTabId = c.subTabId;
      let filePath = c.filePath;

      if (!tabId && span) {
        const tabEl    = span.closest('.tab-content:not(.sub-tab-content)');
        const subTabEl = span.closest('.sub-tab-content');
        if (tabEl)    tabId    = tabEl.id;
        if (subTabEl) { subTabId = subTabEl.id; filePath = filePathFor(subTabId); }
      }

      if (tabId && typeof window.showTab === 'function') window.showTab(tabId);

      if (subTabId && filePath) {
        document.querySelectorAll('.sub-tab-content').forEach(el => el.style.display = 'none');
        history.replaceState(null, '', '#' + (tabId || '') + '/' + subTabId);
        const subTabEl = document.getElementById(subTabId);
        if (subTabEl) {
          try {
            const resp = await fetch(filePath);
            if (resp.ok) {
              subTabEl.innerHTML = await resp.text();
              subTabEl.style.display = 'block';
              if (window.MathJax) await MathJax.typesetPromise([subTabEl]).catch(() => {});
              if (window.bibliography) window.bibliography.init();
              reapplyAll(subTabEl);
            }
          } catch (e) { /* fetch failed, MutationObserver may still recover */ }
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
        <div style="display:flex;gap:2px">
          <button id="cm-panel-refresh" title="Refresh comments">↺</button>
          <button id="cm-panel-minimize" title="Minimize panel">−</button>
        </div>
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
          : shown.map(c => {
              const quote = ((t) => t.length > 70 ? t.slice(0, 70) + '…' : t)(c.text.replace(/\s+/g, ' ').trim());
              const repliesHtml = c.replies.length ? `
                <div class="cm-replies">
                  ${c.replies.map(r => `
                    <div class="cm-reply">
                      <div class="cm-reply-header">
                        <span class="cm-reply-author">${r.author}</span>
                        <span class="cm-reply-time">${formatDate(r.timestamp)}</span>
                      </div>
                      <div class="cm-reply-text">${r.text}</div>
                    </div>`).join('')}
                </div>` : '';
              return `
                <div class="cm-card${c.resolved ? ' cm-card-resolved' : ''}" data-id="${c.id}" title="Click to jump to highlight">
                  <div class="cm-card-header">
                    <span class="cm-card-author">${c.author}</span>
                    <span class="cm-card-time">${formatDate(c.timestamp)}</span>
                  </div>
                  <div class="cm-card-quote">"${quote}"</div>
                  <div class="cm-card-comment">${c.comment}</div>
                  ${repliesHtml}
                  <div class="cm-card-actions">
                    ${c.resolved
                      ? `<button class="cm-card-unresolve" data-id="${c.id}">↩ Unresolve</button>`
                      : `<button class="cm-card-resolve"   data-id="${c.id}">✓ Resolve</button>`}
                    <button class="cm-card-reply" data-id="${c.id}">↩ Reply</button>
                    <button class="cm-card-delete" data-id="${c.id}">Delete</button>
                  </div>
                  <div class="cm-reply-form" data-id="${c.id}" style="display:none">
                    <textarea class="cm-reply-input" placeholder="Write a reply… (Cmd+Enter to save)" rows="2"></textarea>
                    <div class="cm-reply-actions">
                      <button class="cm-reply-submit" data-id="${c.id}">Reply</button>
                      <button class="cm-reply-cancel">Cancel</button>
                    </div>
                  </div>
                </div>`;
            }).join('')}
      </div>`;

    panel.querySelector('#cm-panel-minimize').onclick = minimizePanel;

    panel.querySelector('#cm-panel-refresh').onclick = async () => {
      await fetchComments();
      renderPanel();
      reapplyAll(document.body);
    };

    panel.querySelectorAll('.cm-panel-tab').forEach(btn => {
      btn.onclick = () => { panelTab = btn.dataset.tab; applyTabClass(); renderPanel(); };
    });

    panel.querySelectorAll('.cm-card').forEach(card => {
      card.onclick = e => {
        if (e.target.closest('.cm-card-resolve, .cm-card-unresolve, .cm-card-delete, .cm-card-reply, .cm-reply-form')) return;
        const c = loadAll().find(x => x.id === card.dataset.id);
        if (c) jumpToComment(c);
      };
    });

    panel.querySelectorAll('.cm-card-resolve').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        document.querySelectorAll(`.cm-hl[data-id="${id}"]`).forEach(s => s.classList.add('cm-hl-resolved'));
        commentsCache = commentsCache.map(c => c.id === id ? { ...c, resolved: true } : c);
        renderPanel();
        try { await setResolved(id, true); }
        catch (err) {
          showError('Failed to save — please try again.');
          document.querySelectorAll(`.cm-hl[data-id="${id}"]`).forEach(s => s.classList.remove('cm-hl-resolved'));
          await fetchComments(); renderPanel();
        }
      };
    });

    panel.querySelectorAll('.cm-card-unresolve').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        document.querySelectorAll(`.cm-hl[data-id="${id}"]`).forEach(s => s.classList.remove('cm-hl-resolved'));
        commentsCache = commentsCache.map(c => c.id === id ? { ...c, resolved: false } : c);
        renderPanel();
        try { await setResolved(id, false); }
        catch (err) {
          showError('Failed to save — please try again.');
          document.querySelectorAll(`.cm-hl[data-id="${id}"]`).forEach(s => s.classList.add('cm-hl-resolved'));
          await fetchComments(); renderPanel();
        }
      };
    });

    panel.querySelectorAll('.cm-card-delete').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const removed = commentsCache.find(c => c.id === id);
        document.querySelectorAll(`.cm-hl[data-id="${id}"]`).forEach(s => s.replaceWith(...s.childNodes));
        commentsCache = commentsCache.filter(c => c.id !== id);
        renderPanel();
        try { await deleteComment(id); }
        catch (err) {
          showError('Failed to delete — please try again.');
          if (removed) commentsCache.push(removed);
          await fetchComments(); reapplyAll(document.body); renderPanel();
        }
      };
    });

    panel.querySelectorAll('.cm-card-reply').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const form = panel.querySelector(`.cm-reply-form[data-id="${btn.dataset.id}"]`);
        if (!form) return;
        form.style.display = 'block';
        form.querySelector('.cm-reply-input').focus();
      };
    });

    panel.querySelectorAll('.cm-reply-cancel').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        btn.closest('.cm-reply-form').style.display = 'none';
      };
    });

    panel.querySelectorAll('.cm-reply-submit').forEach(btn => {
      btn.onclick = async e => {
        e.stopPropagation();
        const form = btn.closest('.cm-reply-form');
        const text = form.querySelector('.cm-reply-input').value.trim();
        if (!text) return;
        try { await addReply(btn.dataset.id, text); renderPanel(); }
        catch (err) { showError('Failed to save reply — please try again.'); }
      };
    });

    panel.querySelectorAll('.cm-reply-input').forEach(ta => {
      ta.addEventListener('keydown', e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          ta.closest('.cm-reply-form').querySelector('.cm-reply-submit').click();
        }
        if (e.key === 'Escape') {
          ta.closest('.cm-reply-form').style.display = 'none';
        }
      });
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
    window.getSelection().removeAllRanges();
    const spans = highlightRange(range, 'cm-pending', '', '');
    if (!spans.length) return;
    pendingSpans = spans;

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

  async function submitComment(selectedText) {
    const popup   = document.getElementById('cm-popup');
    const comment = popup ? popup.querySelector('.cm-popup-input').value.trim() : '';
    closePopupEl();
    if (!comment) { cancelPending(); return; }

    const id       = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const ctx      = findTabContext(pendingSpans[0] || null);
    const segments = pendingSpans.map(s => s.textContent);

    pendingSpans.forEach(s => {
      s.className       = 'cm-hl';
      s.dataset.comment = comment;
      s.dataset.id      = id;
    });
    pendingSpans = [];

    panelTab = 'open';
    applyTabClass();
    if (panelMinimized) {
      const panel = document.getElementById('cm-panel');
      if (panel) panel.classList.remove('cm-panel-minimized');
      panelMinimized = false;
    }

    try {
      await saveComment(selectedText, comment, id, ctx, segments);
      renderPanel();
    } catch (err) {
      showError('Failed to save comment — please try again.');
      document.querySelectorAll(`.cm-hl[data-id="${id}"]`).forEach(s => s.replaceWith(...s.childNodes));
    }

    window.getSelection().removeAllRanges();
  }

  function cancelPending() {
    pendingSpans.forEach(s => { if (s.parentNode) s.replaceWith(...s.childNodes); });
    pendingSpans = [];
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
    const entry      = loadAll().find(c => c.id === h.dataset.id);
    const prefix     = (entry && entry.resolved) ? '✓ ' : '';
    const replyCount = (entry && entry.replies.length)
      ? ` (${entry.replies.length} repl${entry.replies.length === 1 ? 'y' : 'ies'})` : '';
    const label      = entry ? `${prefix}${entry.author}: ${entry.comment}${replyCount}` : h.dataset.comment;
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

  // ── Supabase persistence ──────────────────────────────────────────────
  async function fetchComments() {
    try {
      const resp = await fetch(`${API}?select=*&order=created_at.asc`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
        cache: 'no-store',
      });
      if (!resp.ok) throw new Error(resp.status);
      commentsCache = await resp.json();
    } catch {
      commentsCache = [];
    }
  }

  async function saveComment(text, comment, id, ctx = {}, segments = null) {
    const row = {
      id, text, comment,
      author:     currentAuthor,
      resolved:   false,
      timestamp:  new Date().toISOString(),
      tab_id:     ctx.tabId    || null,
      sub_tab_id: ctx.subTabId || null,
      file_path:  ctx.filePath || null,
      segments:   segments     || null,
      replies:    [],
    };
    const resp = await fetch(API, { method: 'POST', headers: SB, body: JSON.stringify(row) });
    if (!resp.ok) throw new Error(await resp.text());
    commentsCache.push(row);
  }

  async function setResolved(id, resolved) {
    const resp = await fetch(`${API}?id=eq.${id}`, {
      method: 'PATCH', headers: SB, body: JSON.stringify({ resolved }),
    });
    if (!resp.ok) throw new Error(await resp.text());
    commentsCache = commentsCache.map(c => c.id === id ? { ...c, resolved } : c);
  }

  async function deleteComment(id) {
    const resp = await fetch(`${API}?id=eq.${id}`, {
      method: 'DELETE', headers: SB,
    });
    if (!resp.ok) throw new Error(await resp.text());
    commentsCache = commentsCache.filter(c => c.id !== id);
  }

  async function addReply(commentId, replyText) {
    const c = commentsCache.find(c => c.id === commentId);
    if (!c) return;
    const newReplies = [...(Array.isArray(c.replies) ? c.replies : []), {
      id:        Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      author:    currentAuthor,
      text:      replyText,
      timestamp: new Date().toISOString(),
    }];
    const resp = await fetch(`${API}?id=eq.${commentId}`, {
      method: 'PATCH', headers: SB, body: JSON.stringify({ replies: newReplies }),
    });
    if (!resp.ok) throw new Error(await resp.text());
    commentsCache = commentsCache.map(c => c.id === commentId ? { ...c, replies: newReplies } : c);
  }

  function loadAll() {
    return commentsCache.map((c, i) => ({
      id:        c.id        || (Date.now() + i).toString(36),
      author:    c.author    || 'Unknown',
      text:      c.text      || '',
      comment:   c.comment   || '',
      resolved:  c.resolved  || false,
      timestamp: c.timestamp || '',
      tabId:     c.tab_id    || null,
      subTabId:  c.sub_tab_id || null,
      filePath:  c.file_path || null,
      segments:  Array.isArray(c.segments) ? c.segments : null,
      replies:   Array.isArray(c.replies)  ? c.replies  : [],
    }));
  }

  // ── Re-apply stored highlights ────────────────────────────────────────
  function reapplyAll(root) {
    loadAll().forEach(({ text, comment, id, resolved, segments }) =>
      restoreInNode(root, text, comment, id, resolved, segments));
  }

  function restoreInNode(root, searchText, comment, id, resolved, segments) {
    if (!searchText || document.querySelector(`.cm-hl[data-id="${id}"]`)) return;

    const filterFn = n =>
      n.parentElement.closest(
        '.cm-hl, .cm-pending, #cm-popup, #cm-banner, #cm-panel, #cm-name-overlay, ' +
        'script, style, mjx-container, .MathJax'
      ) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: filterFn });
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    if (!nodes.length) return;

    const texts    = nodes.map(n => n.textContent);
    const combined = texts.join('');

    const hlClass = 'cm-hl' + (resolved ? ' cm-hl-resolved' : '');

    if (segments && segments.length) {
      let nodeIdx = 0;
      const hits  = [];
      let allFound = true;
      for (const seg of segments) {
        let found = false;
        while (nodeIdx < nodes.length) {
          const idx = nodes[nodeIdx].textContent.indexOf(seg);
          if (idx !== -1) {
            hits.push({ node: nodes[nodeIdx], idx, len: seg.length });
            nodeIdx++;
            found = true;
            break;
          }
          nodeIdx++;
        }
        if (!found) { allFound = false; break; }
      }
      if (allFound) {
        hits.forEach(({ node, idx, len }) => {
          const r = document.createRange();
          r.setStart(node, idx);
          r.setEnd(node, idx + len);
          highlightRange(r, hlClass, comment, id);
        });
        return;
      }
    }

    for (const n of nodes) {
      const idx = n.textContent.indexOf(searchText);
      if (idx === -1) continue;
      const r = document.createRange();
      r.setStart(n, idx);
      r.setEnd(n, idx + searchText.length);
      highlightRange(r, hlClass, comment, id);
      return;
    }

    const idx2 = combined.indexOf(searchText);
    if (idx2 !== -1) {
      const r = rangFromCombined(nodes, texts, idx2, idx2 + searchText.length);
      if (r) { highlightRange(r, hlClass, comment, id); return; }
    }

    const normSearch   = searchText.replace(/\s+/g, ' ').trim();
    const normCombined = combined.replace(/\s+/g, ' ');
    const idx3 = normCombined.indexOf(normSearch);
    if (idx3 !== -1) {
      const origStart = normToOrigPos(combined, idx3);
      const origEnd   = normToOrigPos(combined, idx3 + normSearch.length);
      const r = rangFromCombined(nodes, texts, origStart, origEnd);
      if (r) highlightRange(r, hlClass, comment, id);
    }
  }

  function normToOrigPos(original, normPos) {
    let o = 0, n = 0;
    while (o < original.length && n < normPos) {
      if (/\s/.test(original[o])) {
        while (o < original.length && /\s/.test(original[o])) o++;
        n++;
      } else { o++; n++; }
    }
    return o;
  }

  function rangFromCombined(nodes, texts, startIdx, endIdx) {
    let pos = 0, sNode, sOff, eNode, eOff;
    for (let i = 0; i < nodes.length; i++) {
      const len = texts[i].length;
      if (!sNode && pos + len > startIdx) { sNode = nodes[i]; sOff = startIdx - pos; }
      if  (sNode && pos + len >= endIdx)  { eNode = nodes[i]; eOff = endIdx   - pos; break; }
      pos += len;
    }
    if (!sNode || !eNode) return null;
    const range = document.createRange();
    range.setStart(sNode, sOff);
    range.setEnd(eNode, eOff);
    return range;
  }

  function getTextNodesInRange(range) {
    const SKIP = 'mjx-container, .MathJax, .cm-hl, .cm-pending, ' +
                 '#cm-popup, #cm-banner, #cm-panel, #cm-name-overlay, script, style';
    const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentNode
      : range.commonAncestorContainer;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => {
        const p = n.parentElement;
        if (!p || p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const segments = [];
    let node;
    while ((node = walker.nextNode())) {
      if (!range.intersectsNode(node)) continue;
      const start = range.startContainer === node ? range.startOffset : 0;
      const end   = range.endContainer   === node ? range.endOffset   : node.textContent.length;
      if (start < end) segments.push({ node, start, end });
    }
    return segments;
  }

  function highlightRange(range, className, comment, id) {
    const span = document.createElement('span');
    span.className       = className;
    span.dataset.comment = comment;
    span.dataset.id      = id;
    try { range.surroundContents(span); return [span]; }
    catch { /* cross-block or equation boundary – fall through to multi-span path */ }

    const segments = getTextNodesInRange(range);
    if (!segments.length) return [];
    const created = [];
    for (let i = segments.length - 1; i >= 0; i--) {
      const { node, start, end } = segments[i];
      const r = document.createRange();
      r.setStart(node, start);
      r.setEnd(node, end);
      const s = document.createElement('span');
      s.className       = className;
      s.dataset.comment = comment;
      s.dataset.id      = id;
      try { r.surroundContents(s); created.unshift(s); }
      catch { /* skip un-wrappable segment */ }
    }
    return created;
  }

  const observer = new MutationObserver(mutations => {
    if (!active) return;
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = n.tagName.toLowerCase();
        if (tag.startsWith('mjx-') || n.classList.contains('MathJax')) continue;
        if (n.closest('#cm-panel, #cm-popup, #cm-banner, #cm-name-overlay')) continue;
        reapplyAll(n);
        if (window.MathJax) {
          MathJax.typesetPromise([n]).catch(() => {}).then(() => {
            if (active) reapplyAll(n);
          });
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

})();
