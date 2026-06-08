// Sethio Journal
class TTRPGHub {
  constructor() {
    this._sheetCache = {};
    this.init();
  }

  async init() {
    this.initModalHandlers();
    this.initButtons();
    this._initHashRouting();
    Config.log('Journal initialized');
  }

  // ========== Buttons ==========
  initButtons() {
    const journalBtn = document.getElementById('journalBtn');
    if (journalBtn) journalBtn.addEventListener('click', () => this.openJournalModal());
    const galleryBtn = document.getElementById('galleryBtn');
    if (galleryBtn) galleryBtn.addEventListener('click', () => this.openGalleryModal());
  }

  // ========== Global Modal Handlers ==========
  jsonp(url, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const callbackName = 'jsonp_callback_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      
      // Create global callback function FIRST
      window[callbackName] = (data) => {
        // Cleanup
        try {
          document.head.removeChild(script);
        } catch (e) {
          // Script might already be removed
        }
        delete window[callbackName];
        resolve(data);
      };
      
      const script = document.createElement('script');
      
      // Handle script loading errors
      script.onerror = () => {
        try {
          document.head.removeChild(script);
        } catch (e) {
          // Script might already be removed
        }
        delete window[callbackName];
        reject(new Error('JSONP request failed - script load error'));
      };
      
      // Handle timeout — replace with a no-op instead of deleting, so a late-arriving
      // Apps Script response doesn't throw "ReferenceError: jsonp_callback_... is not defined"
      const timeout = setTimeout(() => {
        try {
          document.head.removeChild(script);
        } catch (e) {
          // Script might already be removed
        }
        window[callbackName] = () => {}; // no-op; cleaned up after a grace period
        setTimeout(() => delete window[callbackName], 60000);
        reject(new Error('JSONP request timed out'));
      }, timeoutMs);
      
      // Clear timeout when callback succeeds
      const originalCallback = window[callbackName];
      window[callbackName] = (data) => {
        clearTimeout(timeout);
        originalCallback(data);
      };
      
      // Add callback + cache-bust parameters to URL
      // The _t timestamp prevents the browser from serving a cached <script> response
      const separator = url.includes('?') ? '&' : '?';
      script.src = url + separator + 'callback=' + callbackName + '&_t=' + Date.now();
      
      Config.log('JSONP request:', script.src);
      document.head.appendChild(script);
    });
  }

  // ========== Global Modal Handlers ==========
  initModalHandlers() {
    // Journal modal
    const closeJournalBtn = document.getElementById('closeJournalBtn');
    const journalOverlay  = document.getElementById('journalModalOverlay');
    const journalModal    = document.getElementById('journalModal');
    if (closeJournalBtn && !closeJournalBtn._hubClose) {
      closeJournalBtn.addEventListener('click', () => this.closeJournalModal());
      closeJournalBtn._hubClose = true;
    }
    if (journalOverlay && !journalOverlay._hubOverlay) {
      journalOverlay.addEventListener('click', (e) => {
        if (e.target !== journalOverlay) return;
        if (journalOverlay.querySelector('.recap-char-editor')) return;
        this.closeJournalModal();
      });
      journalOverlay._hubOverlay = true;
    }
    if (journalModal && !journalModal._hubModal) {
      journalModal.addEventListener('click', (e) => e.stopPropagation());
      journalModal._hubModal = true;
    }

    // Gallery modal
    const closeGalleryBtn = document.getElementById('closeGalleryBtn');
    const galleryOverlay  = document.getElementById('galleryModalOverlay');
    const galleryModal    = document.getElementById('galleryModal');
    if (closeGalleryBtn && !closeGalleryBtn._hubClose) {
      closeGalleryBtn.addEventListener('click', () => this.closeGalleryModal());
      closeGalleryBtn._hubClose = true;
    }
    if (galleryOverlay && !galleryOverlay._hubOverlay) {
      galleryOverlay.addEventListener('click', (e) => { if (e.target === galleryOverlay) this.closeGalleryModal(); });
      galleryOverlay._hubOverlay = true;
    }
    if (galleryModal && !galleryModal._hubModal) {
      galleryModal.addEventListener('click', (e) => e.stopPropagation());
      galleryModal._hubModal = true;
    }

    // Escape key
    if (!this._hubEscBound) {
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (document.body.classList.contains('journal-modal-active')) {
          if (document.getElementById('journalModalOverlay')?.querySelector('.recap-char-editor')) return;
          this.closeJournalModal(); return;
        }
        if (document.body.classList.contains('gallery-modal-active')) {
          if (this._galleryLightboxOpen) { this._closeGalleryLightbox(); } else { this.closeGalleryModal(); }
          return;
        }
      });
      this._hubEscBound = true;
    }
  }

  // â”€â”€ Journal modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async openJournalModal() {
    const overlay = document.getElementById('journalModalOverlay');
    const modal   = document.getElementById('journalModal');
    if (!overlay || !modal) return;

    if (!this._suppressHashWrite) this._setHash('journal');
    overlay.classList.add('show');
    modal.classList.add('show');
    document.body.classList.add('journal-modal-active');

    const campaignPanel = document.getElementById('journalTabCampaignLog');

    if (campaignPanel && !campaignPanel.dataset.loaded) {
      await this._loadCampaignPanel(campaignPanel);
    }
  }

  async _loadCampaignPanel(panel) {
    panel.innerHTML = '<div class="recaps-loading">Loading\u2026</div>';
    try {
      const url  = Config.getSheetUrl([Config.SHEETS.RECAPS, Config.SHEETS.COMMENTS]);
      const data = await this.jsonp(url);
      if (!data.success) throw new Error(data.error || 'API error');
      const entries     = (data.data || []).filter(r => r._category === Config.SHEETS.RECAPS);
      const commentRows = (data.data || []).filter(r => r._category === Config.SHEETS.COMMENTS);
      const commentsMap = {};
      for (const c of commentRows) {
        const t  = (c.recap_title || '').trim();
        const ch = (c.character   || '').trim().toLowerCase();
        if (!commentsMap[t]) commentsMap[t] = {};
        if (!commentsMap[t][ch]) commentsMap[t][ch] = [];
        commentsMap[t][ch].push(c);
      }
      panel.innerHTML = this.renderRecapsList(entries, commentsMap);
      panel.dataset.loaded = 'true';
      if (this._recapsAbortController) this._recapsAbortController.abort();
      this._recapsAbortController = new AbortController();
      this._setupRecapsInteractions(panel, this._recapsAbortController.signal);
    } catch (e) {
      panel.innerHTML = '<div class="recaps-loading">Could not load campaign log.</div>';
      Config.warn('Campaign log load error:', e);
    }
  }

  closeJournalModal() {
    document.getElementById('journalModalOverlay')?.classList.remove('show');
    document.getElementById('journalModal')?.classList.remove('show');
    document.body.classList.remove('journal-modal-active');
    if (!this._suppressHashWrite) this._setHash('');
  }

  _esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Converts a small subset of markdown to safe HTML for recap entry display.
  // HTML is escaped first so stored text can never inject markup.
  _renderMarkdown(text) {
    return String(text).split('\n').map(line => {
      let s = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      // Block: headings (must be at line start — rendered as styled spans to avoid global h-tag conflicts)
      if (/^### /.test(s)) return `<strong class="recap-md-h3">${s.slice(4)}</strong>`;
      if (/^## /.test(s))  return `<strong class="recap-md-h2">${s.slice(3)}</strong>`;
      if (/^# /.test(s))   return `<strong class="recap-md-h1">${s.slice(2)}</strong>`;
      // Inline: bold before italic so **x* doesn't misfire
      s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/\*(.+?)\*/g,     '<em>$1</em>');
      s = s.replace(/__(.+?)__/g,     '<u>$1</u>');
      s = s.replace(/~~(.+?)~~/g,     '<del>$1</del>');
      return s;
    }).join('\n');
  }

  // Attaches formatting toolbar events to a recap char editor.
  // Uses mousedown + preventDefault to keep textarea focus during button clicks.
  _attachFmtToolbar(editor, ta) {
    const toolbar = editor.querySelector('.recap-fmt-toolbar');
    if (!toolbar) return;
    toolbar.addEventListener('mousedown', (ev) => {
      const btn = ev.target.closest('.fmt-btn');
      if (!btn) return;
      ev.preventDefault();
      const markers = { bold: '**', italic: '*', underline: '__', strike: '~~' };
      const m = markers[btn.dataset.fmt];
      if (!m) return;
      const start = ta.selectionStart, end = ta.selectionEnd;
      const val   = ta.value;
      const sel   = val.slice(start, end);
      if (sel) {
        ta.value = val.slice(0, start) + m + sel + m + val.slice(end);
        ta.selectionStart = start + m.length;
        ta.selectionEnd   = end   + m.length;
      } else {
        ta.value = val.slice(0, start) + m + m + val.slice(start);
        ta.selectionStart = ta.selectionEnd = start + m.length;
      }
      ta.focus();
    });
    toolbar.querySelector('.fmt-heading-sel')?.addEventListener('change', (ev) => {
      const lvl = ev.target.value;
      ev.target.value = '';
      if (!lvl) return;
      const prefix = { h1: '# ', h2: '## ', h3: '### ' }[lvl];
      const start = ta.selectionStart;
      const val   = ta.value;
      const lineStart  = val.lastIndexOf('\n', start - 1) + 1;
      const lineEndRaw = val.indexOf('\n', start);
      const lineEnd    = lineEndRaw === -1 ? val.length : lineEndRaw;
      const stripped   = val.slice(lineStart, lineEnd).replace(/^#{1,3} /, '');
      const newLine    = prefix + stripped;
      ta.value = val.slice(0, lineStart) + newLine + val.slice(lineEnd);
      ta.selectionStart = ta.selectionEnd = lineStart + newLine.length;
      ta.focus();
    });
  }

  // â”€â”€ Gallery modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async openGalleryModal() {
    const overlay = document.getElementById('galleryModalOverlay');
    const modal   = document.getElementById('galleryModal');
    if (!overlay || !modal) return;

    overlay.classList.add('show');
    modal.classList.add('show');
    document.body.classList.add('gallery-modal-active');

    this._setupGalleryInteractions();

    if (this._galleryItems) {
      this._renderGallery();
      this._loadGalleryData().then(() => this._renderGallery());
    } else {
      await this._loadGalleryData();
      this._renderGallery();
    }
  }

  closeGalleryModal() {
    document.getElementById('galleryModalOverlay')?.classList.remove('show');
    document.getElementById('galleryModal')?.classList.remove('show');
    document.body.classList.remove('gallery-modal-active');
    this._closeGalleryLightbox();
    this._hideGalleryForm();
    this._galleryEditingId = null;
  }

  async _loadGalleryData() {
    const loadMsg = document.getElementById('galleryLoadingMsg');
    const grid    = document.getElementById('galleryGrid');
    if (!this._galleryItems) {
      if (loadMsg) loadMsg.style.display = '';
      if (grid)    grid.style.display = 'none';
    }
    try {
      const url = new URL(Config.APPS_SCRIPT_URL);
      url.searchParams.set('sheets', Config.SHEETS.GALLERY);
      url.searchParams.set('filter_visible', 'false');
      const data = await this.jsonp(url.toString());
      this._galleryItems = data.success ? data.data : [];
    } catch (e) {
      Config.warn('Gallery load error:', e);
      this._galleryItems = this._galleryItems || [];
    }
  }

  _renderGallery() {
    const loadMsg  = document.getElementById('galleryLoadingMsg');
    const grid     = document.getElementById('galleryGrid');
    const emptyMsg = document.getElementById('galleryEmptyMsg');
    if (!grid) return;

    if (loadMsg) loadMsg.style.display = 'none';

    const items = this._galleryItems || [];
    if (items.length === 0) {
      grid.style.display = 'none';
      if (emptyMsg) emptyMsg.style.display = '';
      return;
    }

    if (emptyMsg) emptyMsg.style.display = 'none';
    grid.style.display = '';

    grid.innerHTML = items.map(item => {
      const id     = this._esc(String(item.id || ''));
      const imgUrl = this._esc(String(item.url || ''));
      const title  = this._esc(String(item.title || ''));
      const artist = this._esc(String(item.artist || ''));
      return `<div class="gallery-card" data-id="${id}">
        <img class="gallery-card-img" src="${imgUrl}" alt="${title}" loading="lazy">
        <div class="gallery-card-info">
          ${title  ? `<div class="gallery-card-title">${title}</div>`       : ''}
          ${artist ? `<div class="gallery-card-artist">by ${artist}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  _setupGalleryInteractions() {
    if (this._galleryInteractionsSet) return;
    this._galleryInteractionsSet = true;

    const addBtn = document.getElementById('galleryAddBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        this._galleryEditingId = null;
        this._showGalleryForm();
      });
    }

    const saveBtn   = document.getElementById('galleryFormSaveBtn');
    const cancelBtn = document.getElementById('galleryFormCancelBtn');
    if (saveBtn)   saveBtn.addEventListener('click', () => this._submitGalleryItem());
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      this._hideGalleryForm();
      this._galleryEditingId = null;
    });

    const grid = document.getElementById('galleryGrid');
    if (grid) {
      grid.addEventListener('click', (e) => {
        const card = e.target.closest('.gallery-card');
        if (card) this._openGalleryLightbox(card.dataset.id);
      });
    }

    const backBtn = document.getElementById('galleryLightboxBack');
    if (backBtn) backBtn.addEventListener('click', () => this._closeGalleryLightbox());

    const lbEditBtn = document.getElementById('galleryLightboxEdit');
    if (lbEditBtn) {
      lbEditBtn.addEventListener('click', () => {
        const id = this._galleryLightboxId;
        if (!id) return;
        this._closeGalleryLightbox();
        this._galleryEditingId = id;
        const item = (this._galleryItems || []).find(it => String(it.id) === String(id));
        this._showGalleryForm(item);
      });
    }

    const lbDeleteBtn = document.getElementById('galleryLightboxDelete');
    if (lbDeleteBtn) {
      lbDeleteBtn.addEventListener('click', () => {
        if (this._galleryLightboxId) this._deleteGalleryItem(this._galleryLightboxId);
      });
    }
  }

  _showGalleryForm(prefill = null) {
    const area    = document.getElementById('galleryFormArea');
    const urlEl   = document.getElementById('galleryFormUrl');
    const titleEl = document.getElementById('galleryFormTitle');
    const artEl   = document.getElementById('galleryFormArtist');
    const descEl  = document.getElementById('galleryFormDescription');
    const status  = document.getElementById('galleryFormStatus');
    if (!area) return;

    if (prefill) {
      if (urlEl)   urlEl.value   = prefill.url         || '';
      if (titleEl) titleEl.value = prefill.title       || '';
      if (artEl)   artEl.value   = prefill.artist      || '';
      if (descEl)  descEl.value  = prefill.description || '';
    } else {
      if (urlEl)   urlEl.value   = '';
      if (titleEl) titleEl.value = '';
      if (artEl)   artEl.value   = '';
      if (descEl)  descEl.value  = '';
    }

    if (status) status.textContent = '';
    area.style.display = '';
    urlEl?.focus();
  }

  _hideGalleryForm() {
    const area = document.getElementById('galleryFormArea');
    if (area) area.style.display = 'none';
  }

  async _submitGalleryItem() {
    const urlEl   = document.getElementById('galleryFormUrl');
    const titleEl = document.getElementById('galleryFormTitle');
    const artEl   = document.getElementById('galleryFormArtist');
    const descEl  = document.getElementById('galleryFormDescription');
    const status  = document.getElementById('galleryFormStatus');
    const saveBtn = document.getElementById('galleryFormSaveBtn');

    const imgUrl      = (urlEl?.value   || '').trim();
    const title       = (titleEl?.value || '').trim();
    const artist      = (artEl?.value   || '').trim();
    const description = (descEl?.value  || '').trim();

    if (!imgUrl) {
      if (status) { status.textContent = 'Image URL is required.'; status.style.color = '#eb5757'; }
      return;
    }

    if (saveBtn) saveBtn.disabled = true;
    if (status) { status.textContent = 'Saving…'; status.style.color = '#c9b5e6'; }

    const isEdit = !!this._galleryEditingId;
    const rowId  = isEdit ? this._galleryEditingId : String(Date.now());
    const rowData = { id: rowId, url: imgUrl, title, artist, description };
    const reqUrl = new URL(Config.APPS_SCRIPT_URL);

    try {
      if (isEdit) {
        reqUrl.searchParams.set('action', 'edit');
        reqUrl.searchParams.set('payload', JSON.stringify({ sheet: Config.SHEETS.GALLERY, row: rowData, rowId }));
      } else {
        reqUrl.searchParams.set('action', 'write');
        reqUrl.searchParams.set('payload', JSON.stringify({ sheet: Config.SHEETS.GALLERY, row: rowData }));
      }
      const result = await this.jsonp(reqUrl.toString(), 30000);
      if (!result.success) throw new Error(result.error || 'Apps Script returned failure');

      if (status) { status.textContent = 'Saved!'; status.style.color = '#6fcf97'; }

      if (isEdit) {
        const idx = (this._galleryItems || []).findIndex(it => String(it.id) === String(rowId));
        if (idx !== -1) this._galleryItems[idx] = { ...rowData, _category: Config.SHEETS.GALLERY };
      } else {
        if (!this._galleryItems) this._galleryItems = [];
        this._galleryItems.push({ ...rowData, _category: Config.SHEETS.GALLERY });
      }

      this._galleryEditingId = null;
      setTimeout(() => {
        this._hideGalleryForm();
        this._renderGallery();
      }, 500);

    } catch (err) {
      Config.error('Gallery save error:', err);
      if (status) { status.textContent = 'Network error — check console.'; status.style.color = '#eb5757'; }
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async _deleteGalleryItem(id) {
    if (!confirm('Remove this image from the gallery?')) return;
    const url = new URL(Config.APPS_SCRIPT_URL);
    url.searchParams.set('action', 'delete');
    url.searchParams.set('payload', JSON.stringify({ sheet: Config.SHEETS.GALLERY, id }));
    try {
      const result = await this.jsonp(url.toString(), 30000);
      if (!result.success) throw new Error(result.error || 'Delete failed');
      this._galleryItems = (this._galleryItems || []).filter(it => String(it.id) !== String(id));
      this._closeGalleryLightbox();
      this._renderGallery();
    } catch (err) {
      Config.error('Gallery delete error:', err);
      alert('Could not delete image. Check console for details.');
    }
  }

  _openGalleryLightbox(id) {
    const item = (this._galleryItems || []).find(it => String(it.id) === String(id));
    if (!item) return;

    this._galleryLightboxId   = id;
    this._galleryLightboxOpen = true;

    const lb   = document.getElementById('galleryLightbox');
    const img  = document.getElementById('galleryLightboxImg');
    const info = document.getElementById('galleryLightboxInfo');
    if (!lb) return;

    if (img) { img.src = item.url || ''; img.alt = item.title || ''; }

    if (info) {
      const titleHtml  = item.title       ? `<div class="gallery-lightbox-title">${this._esc(item.title)}</div>` : '';
      const artistHtml = item.artist      ? `<div class="gallery-lightbox-artist">by ${this._esc(item.artist)}</div>` : '';
      const descHtml   = item.description ? `<p class="gallery-lightbox-desc">${this._esc(item.description)}</p>` : '';
      info.innerHTML = titleHtml + artistHtml + descHtml;
    }

    lb.style.display = '';
  }

  _closeGalleryLightbox() {
    this._galleryLightboxOpen = false;
    this._galleryLightboxId   = null;
    const lb  = document.getElementById('galleryLightbox');
    const img = document.getElementById('galleryLightboxImg');
    if (lb)  lb.style.display = 'none';
    if (img) img.src = '';
  }

  renderRecapsList(entries, commentsMap = {}) {
    const WORD_LIMIT  = 60;
    const CHARACTERS  = ['entos', 'nadrius', 'louise', 'casseus'];
    if (!entries || entries.length === 0) {
      return '<div class="recaps-empty">No entries found in the Campaign Log.</div>';
    }
    // Sheet order is oldest-first; reverse so newest appears at the top
    const sorted = [...entries].reverse();
    this._recapEntries = sorted; // stash for edit handler
    const items = sorted.map((entry, i) => {
      const chapter = (entry.chapter || '').trim();
      const title   = (entry.titlename || '').trim();
      const content = (entry.summary  || '').trim();
      const words   = content.split(/\s+/).filter(Boolean);
      const isTruncated = words.length > WORD_LIMIT;
      const preview     = isTruncated ? words.slice(0, WORD_LIMIT).join(' ') + '\u2026' : content;

      const tabBar = `
        <div class="recap-char-tabs">
          <button class="recap-char-tab active" data-char="recap">Summary</button>
          ${CHARACTERS.map(c => `<button class="recap-char-tab" data-char="${c}">${c.charAt(0).toUpperCase() + c.slice(1)}</button>`).join('')}
        </div>`;

      const charPanels = CHARACTERS.map(c => {
        const text = (entry[c] || '').trim();
        const charComments = (commentsMap[title]?.[c] || []);
        const marginsNotes = charComments.map(cm => `
          <div class="margin-note">
            <p class="margin-text">${this._esc(cm.text || '')}<br><span class="margin-sig">— ${this._esc(cm.author || 'Anonymous')}</span></p>
          </div>`).join('');
        const marginsSection = `
          <div class="recap-margins">
            <div class="recap-margins-label">written in the margins…</div>
            <div class="recap-margins-comments" data-recap-title="${this._esc(title)}" data-char="${c}">${marginsNotes}</div>
            <div class="recap-margins-form">
              <textarea class="margin-input-text" placeholder="Leave a note…" rows="2"></textarea>
              <div class="margin-form-row">
                <input class="margin-input-author" type="text" placeholder="— your name" maxlength="40" />
                <button class="margin-submit-btn" data-index="${i}" data-char="${c}">Add Note</button>
              </div>
            </div>
          </div>`;
        return `<div class="recap-panel recap-panel--char" data-panel="${c}" hidden>
          <div class="recap-char-view">
            ${text ? `<p class="recap-char-entry">${this._renderMarkdown(text)}</p>` : `<p class="recap-char-empty">No entry yet.</p>`}<button class="recap-char-edit-btn" data-char="${c}" data-index="${i}" title="Edit entry">&#9998;</button>
          </div>
          ${marginsSection}
        </div>`;
      }).join('');


      return `
        <article class="recap-entry" data-index="${i}">
          <div class="recap-entry-header" role="button" tabindex="0" aria-expanded="false">
            <h2 class="recap-title">${title}</h2>
            ${chapter ? `<span class="recap-tag">${chapter}</span>` : ''}
            <span class="recap-collapse-icon" aria-hidden="true"></span>
          </div>
          <div class="recap-body recap-body--collapsed">
            ${tabBar}
            <div class="recap-panel" data-panel="recap">
              <p class="recap-preview">${preview}</p>
              ${isTruncated ? `<p class="recap-full" hidden>${content}</p>` : ''}
              ${isTruncated ? `<button class="recap-read-more">Read More</button>` : ''}
            </div>
            ${charPanels}
          </div>
        </article>
        <hr class="recap-divider" />`;
    }).join('');
    const newChapterForm = `
      <div class="new-chapter-bar">
        <button class="new-chapter-btn">+ New Chapter</button>
        <form class="new-chapter-form" hidden>
          <input  class="new-chapter-title"   type="text"     placeholder="Chapter title (required)" maxlength="120" />
          <input  class="new-chapter-chapter" type="text"     placeholder="Chapter (optional, e.g. Chapter 1: Early days)" maxlength="120" />
          <textarea class="new-chapter-summary" rows="4"      placeholder="Summary / OOC notes (optional)"></textarea>
          <div class="new-chapter-actions">
            <button type="submit" class="new-chapter-submit">Create Chapter</button>
            <button type="button" class="new-chapter-cancel">Cancel</button>
          </div>
          <span class="new-chapter-error" hidden></span>
        </form>
      </div>`;
    return `<div class="recaps-list">${newChapterForm}${items}</div>`;
  }

  _setupRecapsInteractions(body, signal) {
    body.addEventListener('click', async (e) => {
      // â”€â”€ New chapter toggle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const newChapterBtn = e.target.closest('.new-chapter-btn');
      if (newChapterBtn) {
        const form = body.querySelector('.new-chapter-form');
        const isHidden = form.hidden;
        form.hidden = !isHidden;
        newChapterBtn.textContent = isHidden ? 'âœ• Cancel' : '+ New Chapter';
        if (isHidden) body.querySelector('.new-chapter-title')?.focus();
        return;
      }

      // â”€â”€ New chapter cancel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const newChapterCancel = e.target.closest('.new-chapter-cancel');
      if (newChapterCancel) {
        const form = body.querySelector('.new-chapter-form');
        form.hidden = true;
        form.reset();
        const btn = body.querySelector('.new-chapter-btn');
        if (btn) btn.textContent = '+ New Chapter';
        return;
      }

      // â”€â”€ Edit button â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const editBtn = e.target.closest('.recap-char-edit-btn');
      if (editBtn) {
        const panel   = editBtn.closest('.recap-panel--char');
        const viewEl  = panel.querySelector('.recap-char-view');
        if (panel.querySelector('.recap-char-editor')) return; // already editing
        const char    = editBtn.dataset.char;
        const index   = parseInt(editBtn.dataset.index, 10);
        const current = (this._recapEntries?.[index]?.[char] || '').trim();
        viewEl.style.display = 'none';
        const editor = document.createElement('div');
        editor.className = 'recap-char-editor';
        editor.innerHTML = `
          <div class="recap-fmt-toolbar">
            <button type="button" class="fmt-btn" data-fmt="bold"      title="Bold"><b>B</b></button>
            <button type="button" class="fmt-btn" data-fmt="italic"    title="Italic"><i>I</i></button>
            <button type="button" class="fmt-btn" data-fmt="underline" title="Underline"><u>U</u></button>
            <button type="button" class="fmt-btn" data-fmt="strike"    title="Strikethrough"><s>S</s></button>
            <span class="fmt-sep"></span>
            <select class="fmt-heading-sel" title="Heading style">
              <option value="">Style</option>
              <option value="h1">Heading 1</option>
              <option value="h2">Heading 2</option>
              <option value="h3">Heading 3</option>
            </select>
          </div>
          <textarea class="recap-char-textarea">${this._esc(current)}</textarea>
          <div class="recap-char-editor-actions">
            <button class="recap-char-save-btn">Save</button>
            <button class="recap-char-cancel-btn">Cancel</button>
          </div>`;
        panel.insertBefore(editor, viewEl.nextSibling);
        const ta = editor.querySelector('textarea');
        this._attachFmtToolbar(editor, ta);
        ta.focus();
        return;
      }

      // â”€â”€ Cancel edit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const cancelBtn = e.target.closest('.recap-char-cancel-btn');
      if (cancelBtn) {
        const panel  = cancelBtn.closest('.recap-panel--char');
        const editor = panel.querySelector('.recap-char-editor');
        const viewEl = panel.querySelector('.recap-char-view');
        editor?.remove();
        if (viewEl) viewEl.style.display = '';
        return;
      }

      // â”€â”€ Save edit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const saveBtn = e.target.closest('.recap-char-save-btn');
      if (saveBtn) {
        const panel    = saveBtn.closest('.recap-panel--char');
        const editor   = panel.querySelector('.recap-char-editor');
        const viewEl   = panel.querySelector('.recap-char-view');
        const textarea = editor.querySelector('textarea');
        const char     = panel.dataset.panel;
        const index    = parseInt(panel.closest('.recap-entry').dataset.index, 10);
        const newText  = textarea.value.trim();
        saveBtn.textContent = 'Saving…';
        saveBtn.disabled = true;
        const result = await this._saveRecapCharEntry(index, char, newText);
        if (result?.success) {
          // Update cached entry so re-edits see the latest text
          if (this._recapEntries?.[index]) this._recapEntries[index][char] = newText;
          const textEl = viewEl.querySelector('.recap-char-entry, .recap-char-empty');
          if (textEl) {
            textEl.className = 'recap-char-entry';
            if (newText) { textEl.innerHTML = this._renderMarkdown(newText); } else { textEl.textContent = ''; }
          }
          editor.remove();
          viewEl.style.display = '';
        } else {
          saveBtn.textContent = 'Save';
          saveBtn.disabled = false;
          const err = editor.querySelector('.recap-save-error') || document.createElement('span');
          err.className = 'recap-save-error';
          err.textContent = 'Save failed. Try again.';
          editor.querySelector('.recap-char-editor-actions').appendChild(err);
        }
        return;
      }

      // â”€â”€ Character tab switching â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const charTab = e.target.closest('.recap-char-tab');
      if (charTab) {
        const entry = charTab.closest('.recap-entry');
        const char  = charTab.dataset.char;
        entry.querySelectorAll('.recap-char-tab').forEach(t => t.classList.toggle('active', t.dataset.char === char));
        entry.querySelectorAll('.recap-panel').forEach(p => { p.hidden = p.dataset.panel !== char; });
        const slug = this._slugify(entry.querySelector('.recap-title')?.textContent || '');
        if (slug) {
          const hashChar = (char === 'recap') ? '' : `/${char}`;
          this._setHash(`journal/recap/${slug}${hashChar}`);
        }
        return;
      }

      // â”€â”€ Read more â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const readMoreBtn = e.target.closest('.recap-read-more');
      if (readMoreBtn) {
        const entry   = readMoreBtn.closest('.recap-entry');
        const preview = entry.querySelector('.recap-preview');
        const full    = entry.querySelector('.recap-full');
        if (full && preview) {
          preview.hidden = true;
          full.hidden    = false;
          readMoreBtn.hidden = true;
        }
        return;
      }

      // â”€â”€ Collapse/expand â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const header = e.target.closest('.recap-entry-header');
      if (header) {
        const entry    = header.closest('.recap-entry');
        const bodyEl   = entry.querySelector('.recap-body');
        const expanded = header.getAttribute('aria-expanded') !== 'false';
        header.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        bodyEl.classList.toggle('recap-body--collapsed', expanded);
        if (!expanded) {
          const slug = this._slugify(entry.querySelector('.recap-title')?.textContent || '');
          if (slug) this._setHash(`journal/recap/${slug}`);
        } else {
          this._setHash(`journal`);
        }
      }

      // â”€â”€ Margin note submit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const marginBtn = e.target.closest('.margin-submit-btn');
      if (marginBtn) {
        const panel      = marginBtn.closest('.recap-panel--char');
        const form       = marginBtn.closest('.recap-margins-form');
        const textEl     = form.querySelector('.margin-input-text');
        const authorEl   = form.querySelector('.margin-input-author');
        const text       = textEl.value.trim();
        const author     = authorEl.value.trim() || 'Anonymous';
        const index      = parseInt(marginBtn.dataset.index, 10);
        const char       = marginBtn.dataset.char || '';
        if (!text) { textEl.focus(); return; }
        marginBtn.textContent = 'Adding…';
        marginBtn.disabled = true;
        const result = await this._saveRecapComment(index, text, author, char);
        if (result?.success) {
          const commentsEl = panel.querySelector('.recap-margins-comments');
          const note = document.createElement('div');
          note.className = 'margin-note';
          note.innerHTML = `<p class="margin-text">${this._esc(text)}<br><span class="margin-sig">— ${this._esc(author)}</span></p>`;
          commentsEl.appendChild(note);
          textEl.value   = '';
          authorEl.value = '';
          marginBtn.textContent = 'Add Note';
          marginBtn.disabled = false;
        } else {
          marginBtn.textContent = 'Add Note';
          marginBtn.disabled = false;
          let err = form.querySelector('.margin-error');
          if (!err) { err = document.createElement('span'); err.className = 'margin-error'; form.appendChild(err); }
          err.textContent = 'Could not save. Try again.';
        }
        return;
      }
    }, { signal });
    body.addEventListener('submit', async (e) => {
      if (!e.target.closest('.new-chapter-form')) return;
      e.preventDefault();
      const form    = e.target.closest('.new-chapter-form');
      const title   = form.querySelector('.new-chapter-title').value.trim();
      const chapter = form.querySelector('.new-chapter-chapter').value.trim();
      const content = form.querySelector('.new-chapter-summary').value.trim();
      const errEl   = form.querySelector('.new-chapter-error');
      const submitBtn = form.querySelector('.new-chapter-submit');
      if (!title) {
        errEl.textContent = 'Title is required.';
        errEl.hidden = false;
        form.querySelector('.new-chapter-title').focus();
        return;
      }
      errEl.hidden = true;
      submitBtn.textContent = 'Creating…';
      submitBtn.disabled = true;
      const result = await this._saveNewChapter({ title, chapter, content });
      if (result?.success) {
        // Reload the campaign panel to show the new entry
        const panel = body.closest('#journalTabCampaignLog');
        if (panel) {
          delete panel.dataset.loaded;
          await this._loadCampaignPanel(panel);
        }
      } else {
        submitBtn.textContent = 'Create Chapter';
        submitBtn.disabled = false;
        errEl.textContent = 'Save failed. Try again.';
        errEl.hidden = false;
      }
    }, { signal });

    body.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const header = e.target.closest('.recap-entry-header');
      if (header) { e.preventDefault(); header.click(); }
    }, { signal });
  }

  async _saveRecapCharEntry(index, char, text) {
    try {
      const entry = this._recapEntries?.[index];
      if (!entry) return { success: false, error: 'Entry not found' };
      // Send only the changed field (patch mode) to keep the URL short
      const payload = JSON.stringify({
        sheet: 'Recaps',
        originalName: entry.titlename,
        patch: true,
        row: { [char]: text }
      });
      const url = new URL(Config.APPS_SCRIPT_URL);
      url.searchParams.set('action', 'edit');
      url.searchParams.set('payload', payload);
      return await this.jsonp(url.toString(), 30000);
    } catch (err) {
      Config.error('_saveRecapCharEntry error:', err);
      return { success: false, error: String(err) };
    }
  }

  async _saveNewChapter({ title, chapter, content }) {
    try {
      const row = {
        id:      Date.now().toString(),
        titlename: title,
        chapter,
        summary: content,
        visible: 'TRUE'
      };
      const payload = JSON.stringify({ sheet: 'Recaps', row });
      const url = new URL(Config.APPS_SCRIPT_URL);
      url.searchParams.set('action', 'write');
      url.searchParams.set('payload', payload);
      return await this.jsonp(url.toString(), 30000);
    } catch (err) {
      Config.error('_saveNewChapter error:', err);
      return { success: false, error: String(err) };
    }
  }

  async _saveRecapComment(index, text, author, character = '') {
    try {
      const entry = this._recapEntries?.[index];
      if (!entry) return { success: false, error: 'Entry not found' };
      const row = {
        id:          Date.now().toString(),
        recap_title: entry.titlename || '',
        character,
        author,
        text,
        timestamp:   new Date().toISOString(),
        visible:     'TRUE'
      };
      const payload = JSON.stringify({ sheet: 'Comments', row });
      const url = new URL(Config.APPS_SCRIPT_URL);
      url.searchParams.set('action', 'write');
      url.searchParams.set('payload', payload);
      return await this.jsonp(url.toString(), 30000);
    } catch (err) {
      Config.error('_saveRecapComment error:', err);
      return { success: false, error: String(err) };
    }
  }

  // ========== Data Loading ==========

  // Background-warm the demand cache for specific sheets without blocking the UI.
  _warmCache(sheetNames) {
    this.loadSheets(sheetNames).catch(e => Config.warn('Cache warm failed:', e.message));
  }
  // Fetches one or more sheet names, serving from per-sheet demand cache on revisit.
  // Returns the flat array of row objects, each with a ._category field.
  async loadSheets(sheetNames) {
    try {
      // Serve any already-cached sheets and only fetch the rest.
      const uncached = sheetNames.filter(name => !(name in this._sheetCache));

      if (uncached.length > 0) {
        const url  = Config.getSheetUrl(uncached);
        const data = await this.jsonp(url);
        if (!data.success) {
          Config.error('loadSheets failed:', data.error);
          return [];
        }
        // Populate the demand cache for each fetched sheet.
        uncached.forEach(name => { this._sheetCache[name] = []; });
        (data.data || []).forEach(row => {
          const cat = row._category;
          if (cat && cat in this._sheetCache) this._sheetCache[cat].push(row);
        });
        Config.log('loadSheets fetched and cached:', uncached);
      }

      const rows = sheetNames.flatMap(name => this._sheetCache[name] || []);
      Config.log(`loadSheets served ${rows.length} rows for:`, sheetNames);
      return rows;
    } catch (error) {
      Config.error('loadSheets error:', error);
      return [];
    }
  }
  // ========== Hash Routing ==========

  _slugify(str) {
    return String(str).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  _setHash(hash) {
    history.replaceState(null, '', hash ? '#' + hash : window.location.pathname + window.location.search);
  }

  _initHashRouting() {
    this._suppressHashWrite = false;
    window.addEventListener('hashchange', () => this._restoreFromHash());
    this._restoreFromHash();
  }

  async _restoreFromHash() {
    const raw = window.location.hash.slice(1);
    if (!raw) return;

    const parts = raw.split('/');
    if (parts[0] !== 'journal') return;

    this._suppressHashWrite = true;
    try {
      await this.openJournalModal();
      if (parts[1] === 'recap' && parts[2]) {
        await this._expandRecapBySlug(parts[2], parts[3] || null);
      }
    } finally {
      this._suppressHashWrite = false;
    }
  }

  async _expandRecapBySlug(slug, char) {
    const campaignPanel = document.getElementById('journalTabCampaignLog');
    if (!campaignPanel) return;

    for (const entry of campaignPanel.querySelectorAll('.recap-entry')) {
      const titleEl = entry.querySelector('.recap-title');
      if (!titleEl || this._slugify(titleEl.textContent) !== slug) continue;

      const header = entry.querySelector('.recap-entry-header');
      const body   = entry.querySelector('.recap-body');
      header.setAttribute('aria-expanded', 'true');
      body.classList.remove('recap-body--collapsed');

      if (char && char !== 'recap') {
        entry.querySelectorAll('.recap-char-tab').forEach(t => t.classList.toggle('active', t.dataset.char === char));
        entry.querySelectorAll('.recap-panel').forEach(p => { p.hidden = p.dataset.panel !== char; });
      }

      setTimeout(() => entry.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
      return;
    }
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.hub = new TTRPGHub();
});
