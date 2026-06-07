// Clean TTRPG Hub - Refactored for maintainability with unified explore mode
class TTRPGHub {
  constructor() {
    this.currentWorld = null;
    this.currentMode = 'explore'; // Always explore mode
    this.currentSelectedPanel = 'encyclopedia';
    this.worlds = [];
    this._sheetCache = {};        // Demand-loaded sheet data, keyed by sheet name
    
    this.activeBackgroundWorld = 'neutral';
    this.backgroundVideos = {};

    this._panelIdMap = {
      nations:    'nationsContent',
      species:    'speciesContent',
      deities:    'deitiesContent',
      history:    'historyContent',
      literature: 'literatureContent',
      society:    'societyContent',
      characters: 'charactersContent',
      factions:   'factionsContent',
      bestiary:   'bestiaryContent',
      items:      'itemsContent',
      alchemy:    'alchemyContent',
      locations:  'locationsContent',
      calendar:   'calendarContent'
    };

    this.init();
  }

  async init() {
    await this.fetchCurrentDate();
    await this.loadWorlds();
    this.renderWorlds();
    this._revealWorldCard();
    this._warmCache(['Journal', 'Recaps', 'Calendar']);
    this._initHashRouting();

    Config.log('TTRPG Hub initialized');
  }

  // ========== Data Loading ==========
  async loadWorlds() {
    this.useFallbackWorlds();
  }

  // ========== Current Date ==========
  // Reads the in-world current date from the Settings sheet, falling back to
  // the hardcoded Config.CURRENT_DATE when the sheet is unavailable.
  async fetchCurrentDate() {
    try {
      const url = new URL(Config.APPS_SCRIPT_URL);
      url.searchParams.set('action', 'getDate');
      const data = await this.jsonp(url.toString());
      if (data.success && data.current_date) {
        Config.CURRENT_DATE = data.current_date;
        Config.log('Current date loaded from Settings sheet:', Config.CURRENT_DATE);
      }
    } catch (e) {
      Config.warn('fetchCurrentDate failed, using config default:', e.message);
    }
  }

  // Persists a new in-world current date to the Settings sheet and updates
  // Config.CURRENT_DATE in memory so the rest of the app sees it immediately.
  async setCurrentDate(day, monthIndex, year) {
    const url = new URL(Config.APPS_SCRIPT_URL);
    url.searchParams.set('action', 'setDate');
    url.searchParams.set('payload', JSON.stringify({ day, monthIndex, year }));
    const data = await this.jsonp(url.toString(), 30000);
    if (data.success) {
      Config.CURRENT_DATE = { day, monthIndex, year };
      Config.log('Current date saved:', Config.CURRENT_DATE);
    } else {
      Config.error('setCurrentDate failed:', data.error);
    }
    return data;
  }

  // ========== JSONP Helper ==========
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

  useFallbackWorlds() {
    // Single world - The Breach
    this.worlds = [
      {
        id: 'breach',
        name: 'Beyond the Vale',
        description: 'Saving the world is no easy feat. Saving yourself might be a good place to start.',
        system: 'D&D 5e',
        video_url: 'assets/videos/breach-loopv2.mp4'
      }
    ];
    Config.log('Using fallback worlds:', this.worlds);
    this.renderWorlds();
  }

  // ========== UI Rendering ==========
  renderWorlds() {
    const worldsGrid = document.getElementById('worldsGrid');
    if (!worldsGrid) {
      Config.error('worldsGrid element not found');
      return;
    }

    if (this.worlds.length === 0) {
      worldsGrid.innerHTML = `<div class="world-card loading">Loading worlds...</div>`;
      return;
    }

    // Update the loading card's content instead of replacing it
    const loadingCard = worldsGrid.querySelector('.world-card.loading');
    if (loadingCard && this.worlds.length > 0) {
      const world = this.worlds[0]; // Get first (only) world for Breach
      
      // Update text content of the card
      const worldNameEl = loadingCard.querySelector('.world-name');

      if (worldNameEl) worldNameEl.textContent = world.name;
    }
    
    this.setupCardListeners();
    this.setupWorldBackgrounds();

    Config.log(`Rendered ${this.worlds.length} worlds`);
  }

  // ========== World Theme Management ==========
  applyWorldTheme(worldId) {
    // Remove any existing world theme classes
    document.body.className = document.body.className.replace(/world-\w+/g, '').trim();
    
    // Add the new world theme class
    if (worldId) {
      const themeClass = `world-${worldId}`;
      document.body.classList.add(themeClass);
      Config.log('Applied world theme:', themeClass);
    }
  }

  clearWorldTheme() {
    document.body.className = document.body.className.replace(/world-\w+/g, '').trim();
    Config.log('Cleared world theme');
  }

  // ========== Navigation ==========
  selectWorld(worldId) {
    const alreadyLoaded = this.currentWorld && this.currentWorld.id === worldId;
    this.currentWorld = this.worlds.find(w => w.id === worldId);
    if (this.currentWorld) {
      Config.log('Selected world:', this.currentWorld.name);
      this.applyWorldTheme(worldId);
      if (!this._suppressHashWrite) this._setHash(worldId);
      // Skip full re-init if returning to an already-loaded world
      if (alreadyLoaded) {
        this.setPageVisibility('hub');
      } else {
        this.showWorldHub();
      }
    }
  }

  showWorldSelection() {
    this.setPageVisibility('landing');
    // Keep currentWorld so the card re-entry skips re-init
    this.currentMode = 'explore';
    this.clearWorldTheme();
    this._setHash('');
    // Reset hub back to selection grid for clean re-entry
    this._resetHubToSelection();
  }

  _resetHubToSelection() {
    this.currentSelectedPanel = null;
    const titleText   = document.getElementById('hubTitleText');
    const panelNav    = document.getElementById('hubPanelNav');
    const selection   = document.getElementById('hubSelection');
    const contentArea = document.getElementById('hubContentArea');
    if (titleText)   { titleText.style.display = ''; titleText.style.opacity = '1'; }
    if (panelNav)    panelNav.style.display = 'none';
    if (selection)   { selection.style.display = ''; selection.style.opacity = '1'; }
    if (contentArea) contentArea.style.display = 'none';
  }

  showWorldHub() {
    this.setPageVisibility('hub');

    // Fade-in animation
    const worldHub = document.getElementById('worldHub');
    if (worldHub) {
      worldHub.classList.remove('entering');
      void worldHub.offsetWidth;
      worldHub.classList.add('entering');
    }

    this.currentMode = 'explore';
    this.currentSelectedPanel = null; // Always start at selection grid
    this.initModalHandlers();
    this.initializePanels();
    this.activateWorldBackground(this.currentWorld?.id ?? 'breach');
  }

  // ========== Global Modal Handlers ==========
  initModalHandlers() {
    // Article modal
    const closeBtn = document.getElementById('closeModalBtn');
    const overlay  = document.getElementById('modalOverlay');
    const modal    = document.getElementById('articleModal');
    if (closeBtn && !closeBtn._hubClose) {
      closeBtn.addEventListener('click', () => this.closeModal());
      closeBtn._hubClose = true;
    }
    if (overlay && !overlay._hubOverlay) {
      overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeModal(); });
      overlay._hubOverlay = true;
    }
    if (modal && !modal._hubModal) {
      modal.addEventListener('click', (e) => e.stopPropagation());
      modal._hubModal = true;
    }

    // Journal modal
    const closeJournalBtn     = document.getElementById('closeJournalBtn');
    const journalOverlay      = document.getElementById('journalModalOverlay');
    const journalModal        = document.getElementById('journalModal');
    if (closeJournalBtn && !closeJournalBtn._hubClose) {
      closeJournalBtn.addEventListener('click', () => this.closeJournalModal());
      closeJournalBtn._hubClose = true;
    }
    if (journalOverlay && !journalOverlay._hubOverlay) {
      journalOverlay.addEventListener('click', (e) => {
        if (e.target !== journalOverlay) return;
        if (journalOverlay.querySelector('.recap-char-editor')) return; // editor open — block
        this.closeJournalModal();
      });
      journalOverlay._hubOverlay = true;
    }
    if (journalModal && !journalModal._hubModal) {
      journalModal.addEventListener('click', (e) => e.stopPropagation());
      journalModal._hubModal = true;
    }

    // Calendar modal
    const closeCalendarBtn    = document.getElementById('closeCalendarBtn');
    const calendarOverlay     = document.getElementById('calendarModalOverlay');
    const calendarModal       = document.getElementById('calendarModal');
    if (closeCalendarBtn && !closeCalendarBtn._hubClose) {
      closeCalendarBtn.addEventListener('click', () => this.closeCalendarModal());
      closeCalendarBtn._hubClose = true;
    }
    if (calendarOverlay && !calendarOverlay._hubOverlay) {
      calendarOverlay.addEventListener('click', (e) => { if (e.target === calendarOverlay) this.closeCalendarModal(); });
      calendarOverlay._hubOverlay = true;
    }
    if (calendarModal && !calendarModal._hubModal) {
      calendarModal.addEventListener('click', (e) => e.stopPropagation());
      calendarModal._hubModal = true;
    }


    // Inventory modal
    const closeInventoryBtn  = document.getElementById('closeInventoryBtn');
    const inventoryOverlay   = document.getElementById('inventoryModalOverlay');
    const inventoryModal     = document.getElementById('inventoryModal');
    if (closeInventoryBtn && !closeInventoryBtn._hubClose) {
      closeInventoryBtn.addEventListener('click', () => this.closeInventoryModal());
      closeInventoryBtn._hubClose = true;
    }
    if (inventoryOverlay && !inventoryOverlay._hubOverlay) {
      inventoryOverlay.addEventListener('click', (e) => { if (e.target === inventoryOverlay) this.closeInventoryModal(); });
      inventoryOverlay._hubOverlay = true;
    }
    if (inventoryModal && !inventoryModal._hubModal) {
      inventoryModal.addEventListener('click', (e) => e.stopPropagation());
      inventoryModal._hubModal = true;
    }

    // Gallery modal
    const closeGalleryBtn  = document.getElementById('closeGalleryBtn');
    const galleryOverlay   = document.getElementById('galleryModalOverlay');
    const galleryModal     = document.getElementById('galleryModal');
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

    // Escape key closes whichever modal is open
    if (!this._hubEscBound) {
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (document.body.classList.contains('modal-active')) {
          if (this._activeArticleViewer?._articleStack?.length > 0) {
            this._activeArticleViewer.closeTopLayer();
          } else {
            this.closeModal();
          }
          return;
        }
        if (document.body.classList.contains('journal-modal-active')) {
          if (document.getElementById('journalModalOverlay')?.querySelector('.recap-char-editor')) return; // editor open — block
          this.closeJournalModal(); return;
        }
        if (document.body.classList.contains('calendar-modal-active')) { this.closeCalendarModal(); return; }
        if (document.body.classList.contains('inventory-modal-active')) { this.closeInventoryModal(); return; }
        if (document.body.classList.contains('gallery-modal-active')) {
          if (this._galleryLightboxOpen) { this._closeGalleryLightbox(); } else { this.closeGalleryModal(); }
          return;
        }
      });
      this._hubEscBound = true;
    }
  }

  closeModal() {
    while (this._activeArticleViewer?._articleStack?.length > 0) {
      this._activeArticleViewer.closeTopLayer();
    }
    const modal   = document.getElementById('articleModal');
    const overlay = document.getElementById('modalOverlay');
    if (modal)   modal.classList.remove('show');
    if (modal)   modal.classList.remove('article-mode');
    if (overlay) overlay.classList.remove('show');
    document.body.classList.remove('modal-active');
    if (this._activeArticleViewer?._arrowKeyHandler) {
      document.removeEventListener('keydown', this._activeArticleViewer._arrowKeyHandler);
      this._activeArticleViewer._arrowKeyHandler = null;
    }
    if (this.atlasViewer) this.atlasViewer._lightboxOpen = false;
    // Revert hash to panel level
    if (this.currentSelectedPanel) this._setHash(`${this.currentWorld?.id}/${this.currentSelectedPanel}`);
  }

  // ── Journal modal (Campaign Log + Leads tabs) ─────────────────
  async openJournalModal() {
    const overlay = document.getElementById('journalModalOverlay');
    const modal   = document.getElementById('journalModal');
    if (!overlay || !modal) return;

    if (!this._suppressHashWrite) this._setHash(`${this.currentWorld?.id}/journal`);
    overlay.classList.add('show');
    modal.classList.add('show');
    document.body.classList.add('journal-modal-active');

    this._setupJournalTabs();

    const campaignPanel = document.getElementById('journalTabCampaignLog');
    const leadsPanel    = document.getElementById('journalTabLeads');

    // Load campaign log tab if not yet populated
    if (campaignPanel && !campaignPanel.dataset.loaded) {
      campaignPanel.innerHTML = '<div class="recaps-loading">Loading\u2026</div>';
      try {
        const [entries, commentRows] = await Promise.all([
          this.loadSheets([Config.SHEETS.RECAPS]),
          this.loadSheets([Config.SHEETS.COMMENTS]).catch(() => [])
        ]);
        const commentsMap = {};
        for (const c of commentRows) {
          const title = (c.recap_title || '').trim();
          const char  = (c.character  || '').trim().toLowerCase();
          if (!commentsMap[title]) commentsMap[title] = {};
          if (!commentsMap[title][char]) commentsMap[title][char] = [];
          commentsMap[title][char].push(c);
        }
        campaignPanel.innerHTML = this.renderRecapsList(entries, commentsMap);
        campaignPanel.dataset.loaded = 'true';
        if (this._recapsAbortController) this._recapsAbortController.abort();
        this._recapsAbortController = new AbortController();
        this._setupRecapsInteractions(campaignPanel, this._recapsAbortController.signal);
      } catch (e) {
        campaignPanel.innerHTML = '<div class="recaps-loading">Could not load campaign log.</div>';
        Config.warn('Campaign log load error:', e);
      }
    }

    // Load leads tab if not yet populated
    if (leadsPanel && !leadsPanel.dataset.loaded) {
      leadsPanel.innerHTML = '<div class="recaps-loading">Loading\u2026</div>';
      if (!this.leadsViewer) {
        this.leadsViewer = new LeadsViewer(this);
        window.leadsViewer = this.leadsViewer;
      }
      try {
        const content = await this.leadsViewer.render();
        leadsPanel.innerHTML = content;
        this.leadsViewer.setupInteractions(leadsPanel);
        if (this.leadsViewer.currentLeads.length > 0) {
          leadsPanel.dataset.loaded = 'true';
        }
      } catch (e) {
        leadsPanel.innerHTML = '<div class="recaps-loading">Could not load leads.</div>';
        Config.warn('Leads load error:', e);
      }
    }
  }

  _setupJournalTabs() {
    const tabs   = document.querySelectorAll('.journal-tab');
    const panels = {
      'campaign-log': document.getElementById('journalTabCampaignLog'),
      'leads':        document.getElementById('journalTabLeads'),
    };
    tabs.forEach(tab => {
      if (tab._jtClick) return;
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        Object.values(panels).forEach(p => p && p.classList.remove('active'));
        tab.classList.add('active');
        const panel = panels[tab.dataset.tab];
        if (panel) panel.classList.add('active');
      });
      tab._jtClick = true;
    });
  }

  closeJournalModal() {
    document.getElementById('journalModalOverlay')?.classList.remove('show');
    document.getElementById('journalModal')?.classList.remove('show');
    document.body.classList.remove('journal-modal-active');
    if (!this._suppressHashWrite) this._setHash(this.currentWorld?.id || '');
  }

  // ── Calendar modal ─────────────────────────────────────────────
  async openCalendarModal() {
    const overlay = document.getElementById('calendarModalOverlay');
    const modal   = document.getElementById('calendarModal');
    const body    = document.getElementById('calendarModalBody');
    if (!overlay || !modal) return;

    // Default to current in-world date on first open
    if (this._calCurrentMonth === undefined) {
      this._calCurrentMonth = Config.CURRENT_DATE.monthIndex;
      this._calCurrentYear  = Config.CURRENT_DATE.year;
    }

    // Load events once; reuse cache on subsequent opens
    if (!this._calEvents) {
      try {
        this._calEvents = await this.loadSheets([Config.SHEETS.CALENDAR]);
      } catch (e) {
        Config.warn('Calendar sheet not available:', e);
        this._calEvents = [];
      }
    }

    if (body) {
      body.innerHTML = this.renderCalendarWidget(this._calEvents, this._calCurrentMonth, this._calCurrentYear);
      this.setupCalendarNavigation(this._calEvents);
    }

    overlay.classList.add('show');
    modal.classList.add('show');
    document.body.classList.add('calendar-modal-active');
  }

  closeCalendarModal() {
    document.getElementById('calendarModalOverlay')?.classList.remove('show');
    document.getElementById('calendarModal')?.classList.remove('show');
    document.body.classList.remove('calendar-modal-active');
  }

  // ── Inventory modal ────────────────────────────────────────────
  async openInventoryModal() {
    const overlay = document.getElementById('inventoryModalOverlay');
    const modal   = document.getElementById('inventoryModal');
    if (!overlay || !modal) return;

    overlay.classList.add('show');
    modal.classList.add('show');
    document.body.classList.add('inventory-modal-active');

    // If we already have cached data, render immediately then refresh in background
    if (this._inventoryItems) {
      this._renderInventory();
      this._setupInventoryInteractions();
      this._loadInventoryData().then(() => this._renderInventory());
    } else {
      await this._loadInventoryData();
      this._renderInventory();
      this._setupInventoryInteractions();
    }
  }

  closeInventoryModal() {
    document.getElementById('inventoryModalOverlay')?.classList.remove('show');
    document.getElementById('inventoryModal')?.classList.remove('show');
    document.body.classList.remove('inventory-modal-active');
    // Reset form state
    this._hideInventoryForm();
    this._invEditingId = null;
  }

  async _loadInventoryData() {
    const loadMsg = document.getElementById('inventoryLoadingMsg');
    const table   = document.getElementById('inventoryTable');
    if (!this._inventoryItems) {
      if (loadMsg) loadMsg.style.display = '';
      if (table)   table.style.display = 'none';
    }

    try {
      // Fetch both sheets in a single request
      const url = new URL(Config.APPS_SCRIPT_URL);
      url.searchParams.set('sheets', `${Config.SHEETS.INVENTORY},${Config.SHEETS.PARTY_FUND}`);
      url.searchParams.set('filter_visible', 'false');
      const data = await this.jsonp(url.toString());
      const rows = data.success ? data.data : [];
      this._inventoryItems = rows.filter(r => r._category === Config.SHEETS.INVENTORY);
      this._partyFund = rows.find(r => r._category === Config.SHEETS.PARTY_FUND) || { drakons: '0', scales: '0' };
    } catch (e) {
      Config.warn('Inventory load error:', e);
      this._inventoryItems = this._inventoryItems || [];
      this._partyFund = this._partyFund || { drakons: '0', scales: '0' };
    }
  }

  _renderInventory() {
    const loadMsg  = document.getElementById('inventoryLoadingMsg');
    const table    = document.getElementById('inventoryTable');
    const emptyMsg = document.getElementById('inventoryEmptyMsg');
    const tbody    = document.getElementById('inventoryTableBody');
    if (!tbody) return;

    // Update fund display
    this._updateFundDisplay();

    // Determine active filter states
    const activeTab  = document.querySelector('.inv-tab.active')?.dataset.category || 'all';
    const activeChar = this._invCharFilter || 'all';

    let items = this._inventoryItems || [];
    if (activeTab !== 'all') items = items.filter(it => (it.category || '') === activeTab);
    if (activeChar !== 'all') items = items.filter(it => (it.character || '') === activeChar);

    // Rebuild character filter chips
    this._renderCharFilter();

    if (loadMsg) loadMsg.style.display = 'none';

    if (items.length === 0) {
      if (table)   table.style.display = 'none';
      if (emptyMsg) emptyMsg.style.display = '';
      return;
    }

    if (emptyMsg) emptyMsg.style.display = 'none';
    if (table)   table.style.display = '';

    // Group by character, then render rows
    const grouped = {};
    items.forEach(it => {
      const char = (it.character || 'Unassigned').trim();
      if (!grouped[char]) grouped[char] = [];
      grouped[char].push(it);
    });

    tbody.innerHTML = Object.keys(grouped).map(char => {
      const rows = grouped[char].map(it => {
        const id       = this._esc(String(it.id || ''));
        const name     = this._esc(String(it.name || ''));
        const category = this._esc(String(it.category || ''));
        const qty      = this._esc(String(it.quantity || '1'));
        const notes    = this._esc(String(it.notes || ''));
        return `<tr class="inv-row" data-id="${id}">
          <td class="inv-col-char inv-char-cell"></td>
          <td class="inv-col-name">${name}</td>
          <td class="inv-col-cat"><span class="inv-category-badge inv-cat-${category.toLowerCase().replace(/\s+/g, '-')}">${category}</span></td>
          <td class="inv-col-qty">${qty}</td>
          <td class="inv-col-notes inv-notes-cell">${notes}</td>
          <td class="inv-col-actions">
            <button class="inv-action-btn inv-edit-btn" data-id="${id}" title="Edit">&#9998;</button>
            <button class="inv-action-btn inv-delete-btn" data-id="${id}" title="Delete">&times;</button>
          </td>
        </tr>`;
      }).join('');

      return `<tr class="inv-char-header-row"><td colspan="6" class="inv-char-header">${this._esc(char)}</td></tr>${rows}`;
    }).join('');
  }

  _renderCharFilter() {
    const container = document.getElementById('inventoryCharFilter');
    if (!container) return;

    // Get unique characters from all items (unfiltered by tab)
    const chars = [...new Set((this._inventoryItems || []).map(it => (it.character || 'Unassigned').trim()))].sort();
    const active = this._invCharFilter || 'all';
    const chips = [
      `<button class="inv-char-chip ${active === 'all' ? 'active' : ''}" data-char="all">All</button>`,
      ...chars.map(c => `<button class="inv-char-chip ${active === c ? 'active' : ''}" data-char="${this._esc(c)}">${this._esc(c)}</button>`)
    ].join('');

    container.innerHTML = chips.length > 28 ? chips : chips; // always show
    // Rebuild character datalist in add form
    this._rebuildCharDatalist();
  }

  _rebuildCharDatalist() {
    const list = document.getElementById('invCharacterList');
    if (!list) return;
    const chars = [...new Set((this._inventoryItems || []).map(it => (it.character || '').trim()))].filter(Boolean).sort();
    list.innerHTML = chars.map(c => `<option value="${this._esc(c)}"></option>`).join('');
  }

  _updateFundDisplay() {
    const fund = this._partyFund || {};
    const drakons = parseInt(fund.drakons, 10) || 0;
    const scales  = parseInt(fund.scales,  10) || 0;
    const dAmt = document.getElementById('fundDrakonsAmt');
    const sAmt = document.getElementById('fundScalesAmt');
    if (dAmt) dAmt.textContent = drakons.toLocaleString();
    if (sAmt) sAmt.textContent = scales.toLocaleString();
  }

  _setupInventoryInteractions() {
    if (this._invInteractionsSet) return;
    this._invInteractionsSet = true;

    // Category tab clicks
    const tabs = document.getElementById('inventoryTabs');
    if (tabs) {
      tabs.addEventListener('click', (e) => {
        const tab = e.target.closest('.inv-tab');
        if (!tab) return;
        tabs.querySelectorAll('.inv-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._renderInventory();
      });
    }

    // Character filter chips
    const charFilter = document.getElementById('inventoryCharFilter');
    if (charFilter) {
      charFilter.addEventListener('click', (e) => {
        const chip = e.target.closest('.inv-char-chip');
        if (!chip) return;
        this._invCharFilter = chip.dataset.char;
        this._renderInventory();
      });
    }

    // Add item button
    const addBtn = document.getElementById('inventoryAddBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        this._invEditingId = null;
        this._showInventoryForm();
      });
    }

    // Form save/cancel
    const saveBtn   = document.getElementById('invFormSaveBtn');
    const cancelBtn = document.getElementById('invFormCancelBtn');
    if (saveBtn)   saveBtn.addEventListener('click',   () => this._submitInventoryItem());
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      this._hideInventoryForm();
      this._invEditingId = null;
    });

    // Table row actions (edit/delete) — delegated
    const tbody = document.getElementById('inventoryTableBody');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const editBtn   = e.target.closest('.inv-edit-btn');
        const deleteBtn = e.target.closest('.inv-delete-btn');
        if (editBtn)   this._startEditInventoryItem(editBtn.dataset.id);
        if (deleteBtn) this._deleteInventoryItem(deleteBtn.dataset.id);
      });
    }

    // Fund edit button
    const fundEditBtn   = document.getElementById('fundEditBtn');
    const fundSaveBtn   = document.getElementById('fundSaveBtn');
    const fundCancelBtn = document.getElementById('fundCancelBtn');
    if (fundEditBtn) {
      fundEditBtn.addEventListener('click', () => this._openFundEditor());
    }
    if (fundSaveBtn)   fundSaveBtn.addEventListener('click',   () => this._saveFund());
    if (fundCancelBtn) fundCancelBtn.addEventListener('click', () => this._closeFundEditor());
  }

  _showInventoryForm(prefill = null) {
    const formRow = document.getElementById('inventoryFormRow');
    if (!formRow) return;

    this._rebuildCharDatalist();

    if (prefill) {
      const charEl = document.getElementById('invFormCharacter');
      if (charEl) charEl.value = prefill.character || '';
      const nameEl = document.getElementById('invFormName');
      const catEl  = document.getElementById('invFormCategory');
      const qtyEl  = document.getElementById('invFormQty');
      const notesEl = document.getElementById('invFormNotes');
      if (nameEl)  nameEl.value  = prefill.name     || '';
      if (catEl)   catEl.value   = prefill.category || 'General';
      if (qtyEl)   qtyEl.value   = prefill.quantity || 1;
      if (notesEl) notesEl.value = prefill.notes    || '';
    } else {
      // Reset form
      const charEl  = document.getElementById('invFormCharacter');
      const nameEl  = document.getElementById('invFormName');
      const qtyEl   = document.getElementById('invFormQty');
      const notesEl = document.getElementById('invFormNotes');
      if (charEl)  charEl.value  = '';
      if (nameEl)  nameEl.value  = '';
      if (qtyEl)   qtyEl.value   = 1;
      if (notesEl) notesEl.value = '';
      const catEl = document.getElementById('invFormCategory');
      if (catEl) catEl.value = 'General';
    }

    const status = document.getElementById('invFormStatus');
    if (status) status.textContent = '';

    formRow.style.display = '';
    document.getElementById('invFormName')?.focus();
  }

  _hideInventoryForm() {
    const formRow = document.getElementById('inventoryFormRow');
    if (formRow) formRow.style.display = 'none';
  }

  _startEditInventoryItem(id) {
    const item = (this._inventoryItems || []).find(it => String(it.id) === String(id));
    if (!item) return;
    this._invEditingId = id;
    this._showInventoryForm(item);
  }

  async _submitInventoryItem() {
    const charSel = document.getElementById('invFormCharacter');
    const nameEl  = document.getElementById('invFormName');
    const catEl   = document.getElementById('invFormCategory');
    const qtyEl   = document.getElementById('invFormQty');
    const notesEl = document.getElementById('invFormNotes');
    const status  = document.getElementById('invFormStatus');
    const saveBtn = document.getElementById('invFormSaveBtn');

    const character = (charSel?.value || '').trim();
    const name      = (nameEl?.value  || '').trim();
    const category  = catEl?.value  || 'General';
    const quantity  = qtyEl?.value  || '1';
    const notes     = notesEl?.value || '';

    if (!name) {
      if (status) { status.textContent = 'Item name is required.'; status.className = 'inv-form-status inv-status-error'; }
      return;
    }
    if (!character) {
      if (status) { status.textContent = 'Character is required.'; status.className = 'inv-form-status inv-status-error'; }
      return;
    }

    if (saveBtn) saveBtn.disabled = true;
    if (status) { status.textContent = 'Saving…'; status.className = 'inv-form-status inv-status-info'; }

    const isEdit = !!this._invEditingId;
    const rowId  = isEdit ? this._invEditingId : String(Date.now());

    const rowData = { id: rowId, character, name, category, quantity, notes };
    const url = new URL(Config.APPS_SCRIPT_URL);

    try {
      if (isEdit) {
        url.searchParams.set('action', 'edit');
        url.searchParams.set('payload', JSON.stringify({ sheet: Config.SHEETS.INVENTORY, row: rowData, rowId }));
      } else {
        url.searchParams.set('action', 'write');
        url.searchParams.set('payload', JSON.stringify({ sheet: Config.SHEETS.INVENTORY, row: rowData }));
      }
      Config.log('Inventory write payload:', JSON.parse(url.searchParams.get('payload')));
      const result = await this.jsonp(url.toString(), 30000);
      Config.log('Inventory write result:', result);
      if (!result.success) throw new Error(result.error || 'Apps Script returned failure');

      if (status) { status.textContent = 'Saved!'; status.className = 'inv-form-status inv-status-success'; }
      if (saveBtn) saveBtn.disabled = false;

      // Update local cache
      if (isEdit) {
        const idx = (this._inventoryItems || []).findIndex(it => String(it.id) === String(rowId));
        if (idx !== -1) this._inventoryItems[idx] = { ...rowData, _category: Config.SHEETS.INVENTORY };
      } else {
        if (!this._inventoryItems) this._inventoryItems = [];
        this._inventoryItems.push({ ...rowData, _category: Config.SHEETS.INVENTORY });
      }

      this._invEditingId = null;
      setTimeout(() => {
        this._hideInventoryForm();
        this._renderInventory();
      }, 500);

    } catch (err) {
      Config.error('Inventory save error:', err);
      if (status) { status.textContent = 'Network error — check console.'; status.className = 'inv-form-status inv-status-error'; }
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async _deleteInventoryItem(id) {
    if (!confirm('Remove this item from the inventory?')) return;
    const url = new URL(Config.APPS_SCRIPT_URL);
    url.searchParams.set('action', 'delete');
    url.searchParams.set('payload', JSON.stringify({ sheet: Config.SHEETS.INVENTORY, id }));
    try {
      const result = await this.jsonp(url.toString(), 30000);
      if (!result.success) throw new Error(result.error || 'Delete failed');
      this._inventoryItems = (this._inventoryItems || []).filter(it => String(it.id) !== String(id));
      this._renderInventory();
    } catch (err) {
      Config.error('Inventory delete error:', err);
      alert('Could not delete item. Check console for details.');
    }
  }

  _openFundEditor() {
    const editor  = document.getElementById('fundEditor');
    const dInput  = document.getElementById('fundDrakonsInput');
    const sInput  = document.getElementById('fundScalesInput');
    const fund    = this._partyFund || {};
    if (dInput) dInput.value = parseInt(fund.drakons, 10) || 0;
    if (sInput) sInput.value = parseInt(fund.scales,  10) || 0;
    const status = document.getElementById('fundSaveStatus');
    if (status) status.textContent = '';
    if (editor) editor.style.display = '';
  }

  _closeFundEditor() {
    const editor = document.getElementById('fundEditor');
    if (editor) editor.style.display = 'none';
  }

  async _saveFund() {
    const dInput  = document.getElementById('fundDrakonsInput');
    const sInput  = document.getElementById('fundScalesInput');
    const status  = document.getElementById('fundSaveStatus');
    const saveBtn = document.getElementById('fundSaveBtn');

    const drakons = String(parseInt(dInput?.value || '0', 10) || 0);
    const scales  = String(parseInt(sInput?.value  || '0', 10) || 0);

    if (saveBtn) saveBtn.disabled = true;
    if (status) { status.textContent = 'Saving…'; status.style.color = '#c9b5e6'; }

    const url = new URL(Config.APPS_SCRIPT_URL);
    const fundExists = this._partyFund && (this._partyFund.drakons !== undefined);

    try {
      if (fundExists && this._partyFund.name) {
        // Edit existing fund row (matched by name='fund')
        url.searchParams.set('action', 'edit');
        url.searchParams.set('payload', JSON.stringify({
          sheet: Config.SHEETS.PARTY_FUND,
          row: { name: 'fund', drakons, scales },
          originalName: 'fund'
        }));
      } else {
        // Write first-time row
        url.searchParams.set('action', 'write');
        url.searchParams.set('payload', JSON.stringify({
          sheet: Config.SHEETS.PARTY_FUND,
          row: { name: 'fund', drakons, scales }
        }));
      }
      const result = await this.jsonp(url.toString(), 30000);
      if (!result.success) throw new Error(result.error || 'Fund save failed');

      this._partyFund = { name: 'fund', drakons, scales };
      this._updateFundDisplay();
      if (status) { status.textContent = 'Saved!'; status.style.color = '#6fcf97'; }
      setTimeout(() => this._closeFundEditor(), 800);
    } catch (err) {
      Config.error('Fund save error:', err);
      if (status) { status.textContent = 'Error saving. Check console.'; status.style.color = '#eb5757'; }
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
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

  // ── Gallery modal ─────────────────────────────────────────────
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
    const CHARACTERS  = ['ash', 'missy', 'salwyck', 'toby', 'zilrion'];
    if (!entries || entries.length === 0) {
      return '<div class="recaps-empty">No entries found in the Campaign Log.</div>';
    }
    // Sheet order is oldest-first; reverse so newest appears at the top
    const sorted = [...entries].reverse();
    this._recapEntries = sorted; // stash for edit handler
    const items = sorted.map((entry, i) => {
      const tag     = (entry.tag     || '').trim();
      const title   = (entry.title   || '').trim();
      const content = (entry.content || '').trim();
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
            ${tag ? `<span class="recap-tag">${tag}</span>` : ''}
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
          <input  class="new-chapter-tag"     type="text"     placeholder="Tag (optional, e.g. Session 12)" maxlength="60" />
          <textarea class="new-chapter-content" rows="4"     placeholder="Summary / OOC notes (optional)"></textarea>
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
      // ── New chapter toggle ──────────────────────────────────────
      const newChapterBtn = e.target.closest('.new-chapter-btn');
      if (newChapterBtn) {
        const form = body.querySelector('.new-chapter-form');
        const isHidden = form.hidden;
        form.hidden = !isHidden;
        newChapterBtn.textContent = isHidden ? '✕ Cancel' : '+ New Chapter';
        if (isHidden) body.querySelector('.new-chapter-title')?.focus();
        return;
      }

      // ── New chapter cancel ─────────────────────────────────────
      const newChapterCancel = e.target.closest('.new-chapter-cancel');
      if (newChapterCancel) {
        const form = body.querySelector('.new-chapter-form');
        form.hidden = true;
        form.reset();
        const btn = body.querySelector('.new-chapter-btn');
        if (btn) btn.textContent = '+ New Chapter';
        return;
      }

      // ── Edit button ────────────────────────────────────────────
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

      // ── Cancel edit ────────────────────────────────────────────
      const cancelBtn = e.target.closest('.recap-char-cancel-btn');
      if (cancelBtn) {
        const panel  = cancelBtn.closest('.recap-panel--char');
        const editor = panel.querySelector('.recap-char-editor');
        const viewEl = panel.querySelector('.recap-char-view');
        editor?.remove();
        if (viewEl) viewEl.style.display = '';
        return;
      }

      // ── Save edit ──────────────────────────────────────────────
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

      // ── Character tab switching ────────────────────────────────
      const charTab = e.target.closest('.recap-char-tab');
      if (charTab) {
        const entry = charTab.closest('.recap-entry');
        const char  = charTab.dataset.char;
        entry.querySelectorAll('.recap-char-tab').forEach(t => t.classList.toggle('active', t.dataset.char === char));
        entry.querySelectorAll('.recap-panel').forEach(p => { p.hidden = p.dataset.panel !== char; });
        const slug = this._slugify(entry.querySelector('.recap-title')?.textContent || '');
        if (slug) {
          const hashChar = (char === 'recap') ? '' : `/${char}`;
          this._setHash(`${this.currentWorld?.id}/journal/recap/${slug}${hashChar}`);
        }
        return;
      }

      // ── Read more ──────────────────────────────────────────────
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

      // ── Collapse/expand ────────────────────────────────────────
      const header = e.target.closest('.recap-entry-header');
      if (header) {
        const entry    = header.closest('.recap-entry');
        const bodyEl   = entry.querySelector('.recap-body');
        const expanded = header.getAttribute('aria-expanded') !== 'false';
        header.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        bodyEl.classList.toggle('recap-body--collapsed', expanded);
        if (!expanded) {
          const slug = this._slugify(entry.querySelector('.recap-title')?.textContent || '');
          if (slug) this._setHash(`${this.currentWorld?.id}/journal/recap/${slug}`);
        } else {
          this._setHash(`${this.currentWorld?.id}/journal`);
        }
      }

      // ── Margin note submit ─────────────────────────────────────
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
      const tag     = form.querySelector('.new-chapter-tag').value.trim();
      const content = form.querySelector('.new-chapter-content').value.trim();
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
      const result = await this._saveNewChapter({ title, tag, content });
      if (result?.success) {
        // Reload the campaign panel to show the new entry
        const panel = body.closest('#journalTabCampaignLog');
        if (panel) {
          delete panel.dataset.loaded;
          panel.innerHTML = '<div class="recaps-loading">Loading…</div>';
          try {
            delete this._sheetCache[Config.SHEETS.RECAPS];
            delete this._sheetCache[Config.SHEETS.COMMENTS];
            const [entries, commentRows] = await Promise.all([
              this.loadSheets([Config.SHEETS.RECAPS]),
              this.loadSheets([Config.SHEETS.COMMENTS]).catch(() => [])
            ]);
            const commentsMap = {};
            for (const c of commentRows) {
              const t = (c.recap_title || '').trim();
              const ch = (c.character || '').trim().toLowerCase();
              if (!commentsMap[t]) commentsMap[t] = {};
              if (!commentsMap[t][ch]) commentsMap[t][ch] = [];
              commentsMap[t][ch].push(c);
            }
            panel.innerHTML = this.renderRecapsList(entries, commentsMap);
            panel.dataset.loaded = 'true';
            if (this._recapsAbortController) this._recapsAbortController.abort();
            this._recapsAbortController = new AbortController();
            this._setupRecapsInteractions(panel, this._recapsAbortController.signal);
          } catch (err) {
            panel.innerHTML = '<div class="recaps-loading">Could not reload.</div>';
          }
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
        originalName: entry.title,
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

  async _saveNewChapter({ title, tag, content }) {
    try {
      const row = {
        id:      Date.now().toString(),
        title,
        tag,
        content,
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
        recap_title: entry.title || '',
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

  renderCalendarWidget(events = [], monthIndex = 1, year = 1344) {
    const MONTHS = [
      { name: 'Thawmarch',   desc: 'The heavy snow retreats grudgingly, inch by inch, leaving behind mud, dead grass, and the things that didn\'t survive.' },
      { name: 'Mossdew',     desc: 'Color returns in wet, cautious increments, and the air carries the relief of people who weren\'t sure it ever would.' },
      { name: 'Springcrest', desc: 'The Breach tips into warmth and stays there, long days spilling over into longer evenings that nobody wants to end.' },
      { name: 'Eventide',    desc: 'The sun is at its fullest and the days burn long and generous before the slow turn begins.' },
      { name: 'Sunwake',     desc: 'The light starts pulling back as green wilts away, and the air tells tales of the cold to come.' },
      { name: 'Duskbreak',   desc: 'The warmth slumbers in stages: first the evenings, then the mornings. All prepare for the following stillness.' },
      { name: 'Stillwatch',  desc: 'Winter arrives without bargain, settling over everything like a judgment. The world goes still, dead, and cold.' },
    ];

    const DAYS_PER_WEEK   = 10;
    const WEEKS_PER_MONTH = 5;
    const TODAY_MONTH = Config.CURRENT_DATE.monthIndex;
    const TODAY_DAY   = Config.CURRENT_DATE.day;
    const TODAY_YEAR  = Config.CURRENT_DATE.year;

    const month = MONTHS[monthIndex];

    // Build event lookup keyed by day number for this month/year
    const eventMap = {};
    events.forEach(ev => {
      const evDay = parseInt(ev.day, 10);
      if (isNaN(evDay)) return;
      const evMonthRaw = (ev.month || '').trim();
      const matchName  = evMonthRaw.toLowerCase() === month.name.toLowerCase();
      const matchIdx   = parseInt(evMonthRaw, 10) === (monthIndex + 1);
      if (!matchName && !matchIdx) return;
      if (ev.year && parseInt(ev.year, 10) !== year) return;
      if (!eventMap[evDay]) eventMap[evDay] = [];
      eventMap[evDay].push({ title: ev.name || '', summary: ev.summary || '', article: ev.article || (String(ev.content || '').trim() ? ev.name || '' : '') });
    });

    const colHeaders = Array.from({ length: DAYS_PER_WEEK }, (_, i) =>
      `<th>${i + 1}</th>`
    ).join('');

    let rows = '';
    for (let week = 0; week < WEEKS_PER_MONTH; week++) {
      let cells = '';
      for (let col = 0; col < DAYS_PER_WEEK; col++) {
        const day = week * DAYS_PER_WEEK + col + 1;
        const isToday  = monthIndex === TODAY_MONTH && day === TODAY_DAY && year === TODAY_YEAR;
        const dayEvents = eventMap[day] || [];

        let dotsHtml = '';
        if (dayEvents.length) {
          dotsHtml = dayEvents.map(() => `<span class="cal-event-dot"></span>`).join('');
        }
        const evData = dayEvents.length ? ` data-cal-events='${JSON.stringify(dayEvents).replace(/'/g, '&#39;')}'` : '';

        cells += `<td class="cal-day${isToday ? ' cal-today' : ''}${dayEvents.length ? ' has-events' : ''}" data-day="${day}"${evData}><span class="cal-day-num">${day}</span>${dotsHtml}</td>`;
      }
      rows += `<tr>${cells}</tr>`;
    }

    const tabs = MONTHS.map((m, i) => `
      <button class="cal-month-tab${i === monthIndex ? ' active' : ''}" data-month="${i}" data-year="${year}">${m.name}</button>
    `).join('');

    return `
      <div class="calendar-widget">
        <div class="cal-month-meta">
          <span class="cal-year-label">${year}</span>
        </div>
        <div class="cal-tabs-row">${tabs}</div>
        <div class="cal-month-meta cal-month-desc-row">
          <p class="cal-month-desc">${month.desc}</p>
        </div>
        <div class="cal-current-date-bar">
          <span class="cal-current-date-label">Current Date</span>
          <select id="_calSetDay" class="cal-date-select">${Array.from({length:50},(_,i)=>`<option value="${i+1}"${i+1===TODAY_DAY?' selected':''}>${i+1}</option>`).join('')}</select>
          <select id="_calSetMonth" class="cal-date-select">${MONTHS.map((m,i)=>`<option value="${i}"${i===TODAY_MONTH?' selected':''}>${m.name}</option>`).join('')}</select>
          <select id="_calSetYear" class="cal-date-select">
            ${Array.from({length:21},(_,i)=>1344-10+i).map(y=>`<option value="${y}"${y===TODAY_YEAR?' selected':''}>${y}</option>`).join('')}
          </select>
          <button id="_calSetDateBtn" class="cal-set-date-btn">Set</button>
        </div>
        <div class="cal-grid-panel" id="_calGridPanel">
          <table class="calendar-table">
            <thead><tr>${colHeaders}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  setupCalendarNavigation(events) {
    const body = document.getElementById('calendarModalBody');
    if (!body) return;

    // Shared fixed tooltip element — created once on the document body
    let tip = document.getElementById('_calFloatTooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = '_calFloatTooltip';
      document.body.appendChild(tip);
      // Keep tooltip open while mouse moves into it
      tip.addEventListener('mouseenter', () => clearTimeout(tip._hideTimer));
      tip.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
      // Read more click
      tip.addEventListener('click', (e) => {
        const btn = e.target.closest('.cal-tooltip-readmore');
        if (btn) {
          tip.style.display = 'none';
          this.openCalendarLinkedArticle(btn.dataset.article);
        }
      });
    }

    const showTip = (cell) => {
      let evList;
      try { evList = JSON.parse(cell.dataset.calEvents || '[]'); } catch { return; }
      if (!evList.length) return;
      tip.innerHTML = evList.map(ev => `
        <div class="cal-tooltip-entry">
          <strong>${ev.title}</strong>
          ${ev.summary ? `<span>${ev.summary}</span>` : ''}
          ${ev.article ? `<button class="cal-tooltip-readmore" data-article="${ev.article}">Read more →</button>` : ''}
        </div>`).join('');
      // Show offscreen first to measure
      tip.style.visibility = 'hidden';
      tip.style.display    = 'block';
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      const rect = cell.getBoundingClientRect();
      // Prefer above; fall back to below if not enough room
      let top = rect.top - th - 8;
      if (top < 8) top = rect.bottom + 8;
      // Horizontally center over cell, clamped to viewport
      let left = rect.left + rect.width / 2 - tw / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
      tip.style.top        = top + 'px';
      tip.style.left       = left + 'px';
      tip.style.visibility = 'visible';
    };

    const scheduleHideTip = () => {
      tip._hideTimer = setTimeout(() => { tip.style.display = 'none'; }, 120);
    };

    // Delegated hover on the body — re-applied each render so stale cells don't accumulate handlers
    if (body._calTipEnter) body.removeEventListener('mouseenter', body._calTipEnter, true);
    if (body._calTipLeave) body.removeEventListener('mouseleave', body._calTipLeave, true);
    body._calTipEnter = (e) => {
      const cell = e.target.closest('td.has-events');
      if (cell) { clearTimeout(tip._hideTimer); showTip(cell); }
    };
    body._calTipLeave = (e) => { if (e.target.closest('td.has-events')) scheduleHideTip(); };
    body.addEventListener('mouseenter', body._calTipEnter, true);
    body.addEventListener('mouseleave', body._calTipLeave, true);

    // Hide tooltip when modal closes
    const overlay = document.getElementById('calendarModalOverlay');
    if (overlay && !overlay._calTipHide) {
      overlay._calTipHide = true;
      overlay.addEventListener('click', () => { tip.style.display = 'none'; });
    }
    const closeBtn = document.getElementById('closeCalendarBtn');
    if (closeBtn && !closeBtn._calTipHide) {
      closeBtn._calTipHide = true;
      closeBtn.addEventListener('click', () => { tip.style.display = 'none'; });
    }

    // Click a day cell to set it as today's in-world date
    if (body._calDayClick) body.removeEventListener('click', body._calDayClick);

    // "Set" button — save the current date dropdowns to the Settings sheet
    const setBtn = document.getElementById('_calSetDateBtn');
    if (setBtn && !setBtn._calSet) {
      setBtn._calSet = true;
      setBtn.addEventListener('click', () => {
        const day        = parseInt(document.getElementById('_calSetDay').value, 10);
        const monthIndex = parseInt(document.getElementById('_calSetMonth').value, 10);
        const year       = parseInt(document.getElementById('_calSetYear').value, 10);
        setBtn.disabled = true;
        setBtn.textContent = '…';
        this.setCurrentDate(day, monthIndex, year).then(result => {
          setBtn.disabled = false;
          if (result.success) {
            setBtn.textContent = '✓';
            // Re-render so the today highlight updates
            const calBody = document.getElementById('calendarModalBody');
            if (calBody) {
              calBody.innerHTML = this.renderCalendarWidget(this._calEvents, this._calCurrentMonth, this._calCurrentYear);
              this.setupCalendarNavigation(this._calEvents);
            }
          } else {
            setBtn.textContent = '!';
            setTimeout(() => { setBtn.textContent = 'Set'; }, 2000);
          }
        });
      });
    }

    body.querySelectorAll('.cal-month-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const month = parseInt(tab.dataset.month, 10);
        const year  = parseInt(tab.dataset.year, 10);
        if (month === this._calCurrentMonth && year === this._calCurrentYear) return;

        const panel   = document.getElementById('_calGridPanel');
        const descRow = body.querySelector('.cal-month-desc-row');

        // Update active tab immediately
        body.querySelectorAll('.cal-month-tab').forEach(t => t.classList.toggle('active', t === tab));

        const fadeOut = panel ? panel : null;
        if (fadeOut)  fadeOut.classList.add('fading');
        if (descRow)  descRow.classList.add('fading');

        setTimeout(() => {
          this._calCurrentMonth = month;
          this._calCurrentYear  = year;
          // Re-render only the inner content, keeping the tabs intact
          const MONTHS = [
            { name: 'Thawmarch', desc: 'The heavy snow retreats grudgingly, inch by inch, leaving behind mud, dead grass, and the things that didn\'t survive.' },
            { name: 'Mossdew', desc: 'Color returns in wet, cautious increments, and the air carries the relief of people who weren\'t sure it ever would.' },
            { name: 'Springcrest', desc: 'The Breach tips into warmth and stays there, long days spilling over into longer evenings that nobody wants to end.' },
            { name: 'Eventide', desc: 'The sun is at its fullest and the days burn long and generous before the slow turn begins.' },
            { name: 'Sunwake', desc: 'The light starts pulling back as green wilts away, and the air tells tales of the cold to come.' },
            { name: 'Duskbreak', desc: 'The warmth slumbers in stages: first the evenings, then the mornings. All prepare for the following stillness.' },
            { name: 'Stillwatch', desc: 'Winter arrives without bargain, settling over everything like a judgment. The world goes still, dead, and cold.' },
          ];
          const m = MONTHS[month];
          const TODAY_MONTH = Config.CURRENT_DATE.monthIndex;
          const TODAY_DAY   = Config.CURRENT_DATE.day;
          const TODAY_YEAR  = Config.CURRENT_DATE.year;

          const eventMap = {};
          events.forEach(ev => {
            const evDay = parseInt(ev.day, 10);
            if (isNaN(evDay)) return;
            const evMonthRaw = (ev.month || '').trim();
            if (evMonthRaw.toLowerCase() !== m.name.toLowerCase() && parseInt(evMonthRaw, 10) !== (month + 1)) return;
            if (ev.year && parseInt(ev.year, 10) !== year) return;
            if (!eventMap[evDay]) eventMap[evDay] = [];
            eventMap[evDay].push({ title: ev.name || '', summary: ev.summary || '', article: ev.article || (String(ev.content || '').trim() ? ev.name || '' : '') });
          });

          const colHeaders = Array.from({ length: 10 }, (_, i) => `<th>${i + 1}</th>`).join('');
          let rows = '';
          for (let week = 0; week < 5; week++) {
            let cells = '';
            for (let col = 0; col < 10; col++) {
              const day = week * 10 + col + 1;
              const isToday  = month === TODAY_MONTH && day === TODAY_DAY && year === TODAY_YEAR;
              const dayEvents = eventMap[day] || [];
              let dotsHtml = dayEvents.map(() => `<span class="cal-event-dot"></span>`).join('');
              const evData = dayEvents.length ? ` data-cal-events='${JSON.stringify(dayEvents).replace(/'/g, '&#39;')}'` : '';
              cells += `<td class="cal-day${isToday ? ' cal-today' : ''}${dayEvents.length ? ' has-events' : ''}" data-day="${day}"${evData}><span class="cal-day-num">${day}</span>${dotsHtml}</td>`;
            }
            rows += `<tr>${cells}</tr>`;
          }

          if (descRow) {
            descRow.innerHTML = `<p class="cal-month-desc">${m.desc}</p>`;
            descRow.classList.remove('fading');
          }
          const newPanel = document.getElementById('_calGridPanel');
          if (newPanel) {
            newPanel.innerHTML = `<table class="calendar-table"><thead><tr>${colHeaders}</tr></thead><tbody>${rows}</tbody></table>`;
            newPanel.classList.remove('fading');
          }
        }, 180);
      });
    });
  }

  async openCalendarLinkedArticle(articleName) {
    // Reuse the Calendar panel viewer if it's already loaded — same sheet, same cache.
    // Fall back to a dedicated single-sheet viewer if the panel hasn't been opened yet.
    // Restricting to Calendar only ensures we always hit the prefetch cache and never
    // trigger a slow cross-sheet JSONP request.
    let viewer = this._viewer_calendar;
    if (!viewer || viewer.currentArticles.length === 0) {
      if (!this._viewer_calArticles) {
        this._viewer_calArticles = new ArticleViewer(this, [Config.SHEETS.CALENDAR], Config.SHEETS.CALENDAR);
      }
      viewer = this._viewer_calArticles;
      if (viewer.currentArticles.length === 0) {
        await viewer.loadArticleData();
      }
    }
    const nameLower = articleName.toLowerCase();
    const article = viewer.currentArticles.find(
      a => (a.name || '').toLowerCase() === nameLower
    );
    if (article) {
      viewer.openArticle(article._uid, article._category);
    } else {
      Config.warn('Calendar: linked article not found:', articleName);
    }
  }

  setPageVisibility(activePage) {
    const landing = document.querySelector('.landing-screen');
    const hub     = document.getElementById('worldHub');
    if (landing) landing.style.display = activePage === 'landing' ? 'block' : 'none';
    // world-hub uses flex layout — must not use 'block'
    if (hub) hub.style.display = activePage === 'hub' ? 'flex' : 'none';
    // hub-active class is a :has() fallback for browsers (e.g. older Safari) that
    // don't reliably support complex :has() selectors
    document.body.classList.toggle('hub-active', activePage === 'hub');
  }

  // ========== Panel Management ==========
  async initializePanels() {
    // Tile click listeners
    document.querySelectorAll('.hub-tile').forEach(tile => {
      if (tile._tileClick) return; // prevent duplicate bindings on re-entry
      tile.addEventListener('click', () => this.selectPanel(tile.dataset.panel));
      tile._tileClick = true;
    });

    // Back-to-hub button
    const backBtn = document.getElementById('hubBackBtn');
    if (backBtn && !backBtn._backClick) {
      backBtn.addEventListener('click', () => this.showHubSelection());
      backBtn._backClick = true;
    }

    // Journal / Calendar header buttons
    const journalBtn  = document.getElementById('journalBtn');
    const calendarBtn = document.getElementById('calendarBtn');
    if (journalBtn && !journalBtn._jClick) {
      journalBtn.addEventListener('click', () => this.openJournalModal());
      journalBtn._jClick = true;
    }
    if (calendarBtn && !calendarBtn._cClick) {
      calendarBtn.addEventListener('click', () => this.openCalendarModal());
      calendarBtn._cClick = true;
    }
    const inventoryBtn = document.getElementById('inventoryBtn');
    if (inventoryBtn && !inventoryBtn._iClick) {
      inventoryBtn.addEventListener('click', () => this.openInventoryModal());
      inventoryBtn._iClick = true;
    }
    const galleryBtn = document.getElementById('galleryBtn');
    if (galleryBtn && !galleryBtn._gClick) {
      galleryBtn.addEventListener('click', () => this.openGalleryModal());
      galleryBtn._gClick = true;
    }

    this.currentSelectedPanel = null;
  }

  showHubSelection() {
    this.currentSelectedPanel = null;
    const titleText   = document.getElementById('hubTitleText');
    const panelNav    = document.getElementById('hubPanelNav');
    const selection   = document.getElementById('hubSelection');
    const contentArea = document.getElementById('hubContentArea');
    const mainArea    = document.getElementById('hubMainArea');

    // Fade out content area
    if (contentArea && contentArea.style.display !== 'none') {
      contentArea.style.transition = 'opacity 0.2s ease';
      contentArea.style.opacity = '0';
      setTimeout(() => {
        contentArea.style.display = 'none';
        contentArea.style.opacity = '1';
        // Fade selection back in
        if (selection) {
          selection.style.display = '';
          selection.style.opacity = '0';
          requestAnimationFrame(() => {
            selection.style.transition = 'opacity 0.3s ease';
            selection.style.opacity = '1';
          });
        }
      }, 220);
    } else if (selection) {
      selection.style.display = '';
      selection.style.opacity = '1';
    }

    if (titleText) { titleText.style.display = ''; }
    if (panelNav)  { panelNav.style.display = 'none'; }
    if (mainArea)  { mainArea.scrollTop = 0; }
  }

  async selectPanel(panelName) {
    this.currentSelectedPanel = panelName;
    if (!this._suppressHashWrite) this._setHash(`${this.currentWorld?.id}/${panelName}`);

    // Update header nav
    const titleText        = document.getElementById('hubTitleText');
    const panelNav         = document.getElementById('hubPanelNav');
    const activePanelTitle = document.getElementById('hubActivePanelTitle');
    if (titleText)        titleText.style.display = 'none';
    if (panelNav)         panelNav.style.display = 'flex';
    if (activePanelTitle) activePanelTitle.textContent =
      panelName.charAt(0).toUpperCase() + panelName.slice(1);

    const selection   = document.getElementById('hubSelection');
    const contentArea = document.getElementById('hubContentArea');
    const mainArea    = document.getElementById('hubMainArea');

    // Fade out selection grid
    if (selection && selection.style.display !== 'none') {
      selection.style.transition = 'opacity 0.2s ease';
      selection.style.opacity = '0';
      await new Promise(r => setTimeout(r, 220));
      selection.style.display = 'none';
      selection.style.opacity = '1';
    }

    // Show content area, hide all panel slots, then reveal the right one
    if (contentArea) {
      contentArea.style.display = 'block';
      contentArea.querySelectorAll('.panel-content').forEach(el => {
        el.style.display = 'none';
      });
    }

    const idMap = {
      nations:    'nationsContent',
      species:    'speciesContent',
      deities:    'deitiesContent',
      history:    'historyContent',
      literature: 'literatureContent',
      society:    'societyContent',
      characters: 'charactersContent',
      factions:   'factionsContent',
      bestiary:   'bestiaryContent',
      items:      'itemsContent',
      alchemy:    'alchemyContent',
      locations:  'locationsContent',
      calendar:   'calendarContent'
    };
    const contentEl = document.getElementById(idMap[panelName]);
    if (contentEl) {
      contentEl.style.display = 'block';
      contentEl.style.opacity = '0';
      if (mainArea) mainArea.scrollTop = 0;
      // Show skeleton immediately so there's feedback during async load
      if (contentEl.dataset.loaded !== 'true') {
        contentEl.innerHTML = `
          <div class="article-viewer">
            <div class="article-filters">
              <div class="filter-group">
                <input type="text" id="articleSearch" placeholder="Search articles..." value="" disabled>
              </div>
              <div class="filter-group">
                <select id="tagFilter" disabled><option value="">All Tags</option></select>
              </div>
              <button id="clearFilters" class="clear-btn" disabled>Clear All</button>
            </div>
            <div id="articlesGridContainer">
              <div class="panel-skeleton">
                ${Array.from({length: 12}).map(() => '<div class="skeleton-card"></div>').join('')}
              </div>
            </div>
          </div>`;
      }
      requestAnimationFrame(() => {
        contentEl.style.transition = 'opacity 0.4s ease';
        contentEl.style.opacity = '1';
      });
    }

    await this.loadPanelContent(panelName);
  }

  // Fade out current content, swap HTML, fade back in.
  // Pass markLoaded=false to skip the permanent cache flag (e.g. empty state).
  async _fadeInContent(contentEl, html, markLoaded = true) {
    const existingGrid = contentEl.querySelector('#articlesGridContainer');
    if (existingGrid) {
      // Skeleton is showing — fade only the grid, leave the filter bar untouched
      existingGrid.style.transition = 'opacity 0.2s ease';
      existingGrid.style.opacity    = '0';
      await new Promise(r => setTimeout(r, 220));
      contentEl.innerHTML = html;
      if (markLoaded) contentEl.dataset.loaded = 'true';
      const newGrid = contentEl.querySelector('#articlesGridContainer');
      if (newGrid) {
        newGrid.style.opacity = '0';
        requestAnimationFrame(() => {
          newGrid.style.transition = 'opacity 0.4s ease';
          newGrid.style.opacity    = '1';
        });
      }
    } else {
      // No skeleton yet — fade the whole panel (initial entry)
      contentEl.style.transition = 'opacity 0.2s ease';
      contentEl.style.opacity    = '0';
      await new Promise(r => setTimeout(r, 220));
      contentEl.innerHTML        = html;
      if (markLoaded) contentEl.dataset.loaded = 'true';
      requestAnimationFrame(() => {
        contentEl.style.transition = 'opacity 0.4s ease';
        contentEl.style.opacity    = '1';
      });
    }
  }

  async loadPanelContent(panelName) {
    const contentEl = document.getElementById(this._panelIdMap[panelName]);
    if (!contentEl || contentEl.dataset.loaded === 'true') return;

    // Sheet name matches panel name with capital first letter (Nations, Species, etc.)
    const sheetName = panelName.charAt(0).toUpperCase() + panelName.slice(1);
    const sheetNames = panelName === 'society' ? ['Society', 'Technology'] : [sheetName];
    const viewerKey = `_viewer_${panelName}`;

    try {
      if (!this[viewerKey]) {
        this[viewerKey] = new ArticleViewer(this, sheetNames, sheetName);
        if (panelName === 'locations') {
          this[viewerKey].tagGrouped = true;
        }
        Config.log(`Created ArticleViewer for ${panelName}`);
      }
      const viewer  = this[viewerKey];
      const content = await viewer.renderReadMode(this.currentWorld?.id);
      await this._fadeInContent(contentEl, content, viewer.currentArticles.length > 0);
      viewer._container = contentEl;
      viewer.setupEventListeners();
    } catch (error) {
      await this._fadeInContent(contentEl, `<div class="error">Error loading ${panelName}: ${error.message}</div>`);
      Config.error(`Error loading ${panelName}:`, error);
    }
  }

  // ========== Data Loading ==========

  // Background-warm the demand cache for specific sheets without blocking the UI.
  _warmCache(sheetNames) {
    this.loadSheets(sheetNames).catch(e => Config.warn('Cache warm failed:', e.message));
  }

  // Remove the loading state from the world card and animate it in.
  _revealWorldCard() {
    const loadingCard = document.querySelector('.world-card.loading');
    if (!loadingCard) return; // Already revealed or not present
    // Write real description just before revealing so it's in place when the overlay fades in
    const world = this.worlds[0];
    if (world) {
      const descriptionEl = loadingCard.querySelector('.world-description');
      if (descriptionEl) descriptionEl.textContent = world.description;
    }
    loadingCard.removeAttribute('data-loading');
    loadingCard.classList.remove('loading');
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

  // ========== Utility Methods ==========
  setupCardListeners() {
    const worldCards = document.querySelectorAll('.world-card');
    Config.log(`Setting up listeners for ${worldCards.length} world cards`);
    
    worldCards.forEach(card => {
      const worldId = card.dataset.worldId;
      
      // Handle click to select world
      card.addEventListener('click', () => {
        Config.log(`World card clicked: ${worldId}`);
        this.selectWorld(worldId);
      });

      // Play card's embedded video on hover
      const video = card.querySelector('.world-video');
      if (video) {
        card.addEventListener('mouseenter', () => {
          video.play().catch(e => Config.log('Card video play prevented:', e));
        });
        card.addEventListener('mouseleave', () => {
          video.pause();
          video.currentTime = 0;
        });
      }
    });
  }

  setupWorldBackgrounds() {
    this.backgroundVideos = {
      neutral: document.getElementById('bgVideo-neutral'),
      breach: document.getElementById('bgVideo-breach')
    };

    Config.log('Background videos cached:', this.backgroundVideos);

    // Neutral is already marked active in HTML and autoplays
    if (this.backgroundVideos.neutral) {
      Config.log('Attempting to play neutral background video...');
      this.backgroundVideos.neutral.play()
        .then(() => Config.log('Neutral background video playing'))
        .catch(e => Config.error('Neutral bg autoplay blocked:', e));
    } else {
      Config.error('Neutral background video element not found');
    }

    // Attach hover listeners to world cards - NOW they exist
    const worldCards = document.querySelectorAll('.world-card');
    Config.log(`Found ${worldCards.length} world cards for background hover`);
    
    worldCards.forEach(card => {
      const worldId = card.dataset.worldId;
      Config.log(`Attaching background hover listeners to card: ${worldId}`);
      
      card.addEventListener('mouseenter', () => {
        Config.log(`Mouse entered ${worldId} card - switching background`);
        this.activateWorldBackground(worldId);
      });
      
      card.addEventListener('mouseleave', () => {
        // Only revert to neutral if no world is currently selected
        if (!this.currentWorld) {
          Config.log(`Mouse left ${worldId} card - returning to neutral background`);
          this.activateWorldBackground('neutral');
        } else {
          Config.log(`Mouse left ${worldId} card, but world is selected - keeping ${worldId} background`);
        }
      });
    });
  }

  activateWorldBackground(worldId) {
    Config.log(`Activating background for: ${worldId}`);
    Config.log(`Current activeBackgroundWorld: ${this.activeBackgroundWorld}`);
    Config.log(`backgroundVideos keys:`, Object.keys(this.backgroundVideos));
    
    if (this.activeBackgroundWorld === worldId) {
      Config.log(`${worldId} already active, skipping`);
      return;
    }
    
    // Deactivate current - IMPORTANT: pause the video too
    if (this.backgroundVideos[this.activeBackgroundWorld]) {
      Config.log(`Deactivating ${this.activeBackgroundWorld}`);
      const currentVideo = this.backgroundVideos[this.activeBackgroundWorld];
      currentVideo.classList.remove('active');
      currentVideo.style.opacity = '0'; // Force opacity immediately
      currentVideo.pause();
      Config.log(`Deactivated, opacity set to 0`);
    }
    
    // Activate new
    if (this.backgroundVideos[worldId]) {
      Config.log(`Activating ${worldId}, adding .active class and setting opacity`);
      const newVideo = this.backgroundVideos[worldId];
      newVideo.classList.add('active');
      newVideo.style.opacity = '1'; // Force opacity immediately
      newVideo.currentTime = 0;
      newVideo.play()
        .then(() => Config.log(`${worldId} video playing, opacity at 1`))
        .catch(e => Config.error(`${worldId} video play blocked:`, e));
    } else {
      Config.error(`No background video found for ${worldId}`);
      Config.error(`Available videos:`, this.backgroundVideos);
    }
    
    this.activeBackgroundWorld = worldId;
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
    const worldId = parts[0];
    if (!worldId) return;

    const world = this.worlds.find(w => w.id === worldId);
    if (!world) return;

    this._suppressHashWrite = true;
    try {
      this.selectWorld(worldId);

      const section = parts[1];
      if (!section) return;

      if (section === 'journal') {
        await this.openJournalModal();
        if (parts[2] === 'recap' && parts[3]) {
          await this._expandRecapBySlug(parts[3], parts[4] || null);
        }
      } else {
        await this.selectPanel(section);
        if (parts[2]) await this._openArticleBySlug(section, parts[2]);
      }
    } finally {
      this._suppressHashWrite = false;
    }
  }

  async _openArticleBySlug(panelName, slug) {
    const viewer = this[`_viewer_${panelName}`];
    if (!viewer) return;
    const article = viewer.currentArticles.find(a => this._slugify(a.name || '') === slug);
    if (!article) return;
    viewer.openArticle(article._uid, article._category);
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