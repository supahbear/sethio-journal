// article-viewer.js - Redesigned for overlay card system with unified explore mode safety
class ArticleViewer {
  // allowedSheets: array of sheet names this viewer may display, e.g. ['Characters','Factions','Religion']
  // defaultSheet:  the sheet that is selected by default, e.g. 'Characters'
  constructor(hub, allowedSheets = ['Characters'], defaultSheet = null) {
    this.hub = hub;
    this.allowedSheets = Array.isArray(allowedSheets) ? allowedSheets : [allowedSheets];
    this.defaultSheet = defaultSheet || this.allowedSheets[0];
    this.currentArticles = [];
    this.currentFilters = {
      category: '',
      tag: '',
      search: ''
    };
    // Prevent duplicate bindings on re-render
    this._filtersBound = false;
    this._modalBound = false;
    this._hasInitialized = false;
    this._articleStack = [];
    this.tagGrouped = false; // When true, renders articles grouped by tag (used for Locations)
  }

  async loadArticleData() {
    try {
      const rows = await this.hub.loadSheets(this.allowedSheets);
      // Assign a stable unique ID to every article by position so lookups
      // are never confused by _rowIndex collisions or missing values.
      rows.forEach((row, i) => {
        row._uid = String(i);
      });
      this.currentArticles = rows;

      if (!this._hasInitialized) {
        this.currentFilters.category = this.defaultSheet;
        this._hasInitialized = true;
        Config.log(`ArticleViewer default sheet: ${this.defaultSheet}`);
      }

      Config.log(`ArticleViewer loaded ${rows.length} rows from sheets:`, this.allowedSheets);
      return rows;
    } catch (error) {
      Config.error('Failed to load article data:', error);
      return [];
    }
  }

  async renderReadMode(worldId) {
    // RESET: Allow re-initialization each time we render Articles view
    this._hasInitialized = false;
    
    // Load data FIRST, which sets the default category
    await this.loadArticleData();

    if (this.currentArticles.length === 0) {
      // Still render wrapper so refresh logic stays stable
      return `
        <div class="article-viewer">
          ${this.renderFilters()}
          <div id="articlesGridContainer">
            ${this.renderEmptyState()}
          </div>
        </div>
      `;
    }

    // Check if HTML modals exist - no need to inject if already there
    if (!this.checkModalExists()) {
      Config.warn('Article modal not found in HTML - functionality may be limited');
    }

    // NOW render with the correct filter already set
    return `
      <div class="article-viewer">
        ${this.renderFilters()}
        <div id="articlesGridContainer">
          ${this.renderArticleGrid()}
        </div>
      </div>
    `;
  }

  checkModalExists() {
    const overlay = document.getElementById('modalOverlay');
    const modal = document.getElementById('articleModal');
    return !!(overlay && modal);
  }

  renderEmptyState() {
    return `
      <div class="empty-state">
        <div class="empty-icon">📚</div>
        <h3>Nothing Here Yet</h3>
        <p>No articles have been published in this section yet.</p>
      </div>
    `;
  }

  renderFilters() {
    const multiSheet = this.allowedSheets.length > 1;

    // Only get tags from articles in the current sheet filter (or all if no filter)
    const articlesInCurrentCategory = this.currentFilters.category
      ? this.currentArticles.filter(article => article._category === this.currentFilters.category)
      : this.currentArticles;

    const allTags = [...new Set(
      articlesInCurrentCategory
        .flatMap(article => (article.tags || '').split(','))
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0)
    )].sort();

    const tagOptions = allTags
      .map(tag => `<option value="${tag}">${tag}</option>`)
      .join('');

    const categoryOptions = multiSheet
      ? this.allowedSheets
          .map(sheet => `<option value="${sheet}" ${this.currentFilters.category === sheet ? 'selected' : ''}>${sheet}</option>`)
          .join('')
      : '';

    return `
      <div class="article-filters">
        <div class="filter-group">
          <input type="text" 
                 id="articleSearch" 
                 placeholder="Search articles..." 
                 value="${this.currentFilters.search}">
        </div>
        ${multiSheet ? `
        <div class="filter-group">
          <select id="categoryFilter">
            <option value="">All Categories</option>
            ${categoryOptions}
          </select>
        </div>` : ''}
        <div class="filter-group">
          <select id="tagFilter">
            <option value="">All Tags</option>
            ${tagOptions}
          </select>
        </div>
        <button id="writeArticleBtn" class="write-btn">+ New</button>
      </div>
    `;
  }

  renderArticleCard(article) {
    const tags = (article.tags || '').split(',').map(t => t.trim()).filter(t => t);
    const primaryTag = tags[0] || 'default';
    const cssTag = primaryTag.toLowerCase().replace(/[^a-z0-9]/g, '');
    const hasImage = article.image_url && article.image_url.trim();
    const backgroundImage = hasImage ?
      `<img src="${article.image_url}" class="card-background" alt="${article.name}" loading="lazy">` :
      `<div class="card-background-placeholder"></div>`;

    return `
      <div class="article-card tag-${cssTag}" data-article-id="${article._uid}" data-article-category="${article._category}">
        ${backgroundImage}
        <div class="card-overlay">
          <h4 class="card-title">${article.name}</h4>
          <p class="card-summary">${article.summary || 'No summary available'}</p>
        </div>
      </div>
    `;
  }

  renderArticleGrid() {
    if (this.tagGrouped) return this.renderTagGroupedGrid();

    const filteredArticles = this.filterArticles();
    
    if (filteredArticles.length === 0) {
      // Keep empty-state compact; wrapper remains stable
      return `
        <div class="no-results">
          <p>No articles match your current filters.</p>
          <button id="noResultsClearBtn">Clear Filters</button>
        </div>
      `;
    }

    // Sort articles
    const sortedArticles = this.sortArticles(filteredArticles);
    const articleCards = sortedArticles.map(article => this.renderArticleCard(article)).join('');

    return `
      <div class="articles-grid">
        ${articleCards}
      </div>
    `;
  }

  renderTagGroupedGrid() {
    const filteredArticles = this.filterArticles();

    if (filteredArticles.length === 0) {
      return `
        <div class="no-results">
          <p>No articles match your current filters.</p>
          <button id="noResultsClearBtn">Clear Filters</button>
        </div>
      `;
    }

    // Build map of tag label → articles; articles appear under every tag they carry
    const groups = new Map();
    filteredArticles.forEach(article => {
      const tags = (article.tags || '').split(',').map(t => t.trim()).filter(Boolean);
      const usedTags = tags.length ? tags : ['Other'];
      usedTags.forEach(tag => {
        const label = tag.charAt(0).toUpperCase() + tag.slice(1);
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(article);
      });
    });

    // Sort groups alphabetically; 'Other' always last
    const sortedGroups = [...groups.entries()].sort(([a], [b]) => {
      if (a === 'Other') return 1;
      if (b === 'Other') return -1;
      return a.localeCompare(b);
    });

    const sectionsHtml = sortedGroups.map(([label, articles]) => {
      const sorted = [...articles].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      return `
        <div class="tag-group-section">
          <h3 class="tag-group-header">${label}</h3>
          <div class="articles-grid articles-grid--compact">
            ${sorted.map(article => this.renderArticleCard(article)).join('')}
          </div>
        </div>`;
    }).join('');

    return `<div class="tag-grouped-view">${sectionsHtml}</div>`;
  }

  sortArticles(articles) {
    if (!this.currentFilters.category) {
      // Group by sheet order, then alphabetical within each sheet
      return articles.sort((a, b) => {
        const idxA = this.allowedSheets.indexOf(a._category);
        const idxB = this.allowedSheets.indexOf(b._category);
        if (idxA !== idxB) return idxA - idxB;
        return (a.name || '').localeCompare(b.name || '');
      });
    } else {
      return articles.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
  }

  filterArticles() {
    return this.currentArticles.filter(article => {
      if (this.currentFilters.category && article._category !== this.currentFilters.category) {
        return false;
      }

      if (this.currentFilters.search) {
        const searchTerm = this.currentFilters.search.toLowerCase();
        const searchableText = `${article.name} ${article.summary || ''} ${article.content || ''}`.toLowerCase();
        if (!searchableText.includes(searchTerm)) return false;
      }

      if (this.currentFilters.tag) {
        const articleTags = (article.tags || '').split(',').map(t => t.trim().toLowerCase());
        if (!articleTags.includes(this.currentFilters.tag.toLowerCase())) return false;
      }

      return true;
    });
  }

  setupEventListeners() {
    // Bind filter controls once
    if (!this._filtersBound) {
      const root = this._container || document;

      // Search input
      const searchInput = root.querySelector('#articleSearch');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          this.currentFilters.search = e.target.value;
          this.refreshArticleGrid();
        });
      }

      // Category filter
      const categoryFilter = root.querySelector('#categoryFilter');
      if (categoryFilter) {
        categoryFilter.addEventListener('change', (e) => {
          this.currentFilters.category = e.target.value;
          this.currentFilters.tag = ''; // Clear tag filter when category changes
          this.refreshFilters(); // Refresh filters to update tag dropdown
          this.refreshArticleGrid();
        });
      }

      // Tag filter
      const tagFilter = root.querySelector('#tagFilter');
      if (tagFilter) {
        tagFilter.addEventListener('change', (e) => {
          this.currentFilters.tag = e.target.value;
          this.refreshArticleGrid();
        });
      }

      // Clear filters
      const clearFilters = root.querySelector('#clearFilters');
      if (clearFilters) {
        clearFilters.addEventListener('click', () => this.clearFilters());
      }

      // Open article writer
      const writeArticleBtn = root.querySelector('#writeArticleBtn');
      if (writeArticleBtn) {
        writeArticleBtn.addEventListener('click', () => this.openWriter());
      }

      this._filtersBound = true;
    }

    // Bind article cards each refresh
    this.bindArticleCardClicks();

    // Bind the no-results clear button if present (re-checked each refresh)
    const root = this._container || document;
    const noResultsClearBtn = root.querySelector('#noResultsClearBtn');
    if (noResultsClearBtn && !noResultsClearBtn._bound) {
      noResultsClearBtn.addEventListener('click', () => this.clearFilters());
      noResultsClearBtn._bound = true;
    }
  }

  bindArticleCardClicks() {
    const root = this._container || document;
    root.querySelectorAll('.article-card').forEach(card => {
      // Avoid duplicate handlers
      if (card._boundClick) return;
      card.addEventListener('click', (e) => {
        if (!document.body.classList.contains('modal-active')) {
          const articleId = e.currentTarget.dataset.articleId;
          const articleCategory = e.currentTarget.dataset.articleCategory;
          this.openArticle(articleId, articleCategory);
        }
      });
      card._boundClick = true;
    });
  }

  refreshFilters() {
    // Refresh the entire filter bar (to update tag dropdown based on category)
    const root = this._container || document;
    const filtersContainer = root.querySelector('.article-filters');
    if (filtersContainer) {
      const parent = filtersContainer.parentElement;
      const newFilters = this.renderFilters();
      filtersContainer.outerHTML = newFilters;
      
      // Re-bind filter listeners since we replaced the DOM
      this._filtersBound = false;
      this.setupEventListeners();
    }
  }

  refreshArticleGrid() {
    const root = this._container || document;
    const container = root.querySelector('#articlesGridContainer');
    if (container) {
      // Replace inner content only (keeps a stable mount point)
      container.innerHTML = this.renderArticleGrid();
      // Rebind cards and the no-results clear button
      this.bindArticleCardClicks();
      const noResultsClearBtn = root.querySelector('#noResultsClearBtn');
      if (noResultsClearBtn && !noResultsClearBtn._bound) {
        noResultsClearBtn.addEventListener('click', () => this.clearFilters());
        noResultsClearBtn._bound = true;
      }
    } else {
      Config.error('articlesGridContainer not found for refresh');
    }
  }

  clearFilters() {
    this.currentFilters = {
      category: this.defaultSheet,
      tag: '',
      search: ''
    };
    const root = this._container || document;
    const searchInput = root.querySelector('#articleSearch');
    const categoryFilter = root.querySelector('#categoryFilter');
    const tagFilter = root.querySelector('#tagFilter');
    if (searchInput) searchInput.value = '';
    if (categoryFilter) categoryFilter.value = this.defaultSheet;
    if (tagFilter) tagFilter.value = '';
    Config.log('Filters cleared, reset to default sheet:', this.defaultSheet);
    this.refreshArticleGrid();
  }

  openArticle(articleId, articleCategory) {
    const article = this.currentArticles.find(a => a._uid === articleId);
    if (!article) return;

    const modal   = document.getElementById('articleModal');
    const overlay = document.getElementById('modalOverlay');
    const title   = document.getElementById('modalTitle');
    const content = document.getElementById('modalBody');

    if (!modal || !overlay) {
      Config.error('Article modal elements not found in HTML');
      return;
    }

    modal.classList.add('article-mode');
    if (title) title.textContent = article.name;

    // Show the modal BEFORE filling content so paginateContent can
    // measure pagesContainer.clientHeight with the correct layout.
    overlay.classList.add('show');
    modal.classList.add('show');
    document.body.classList.add('modal-active');
    if (this.hub) this.hub._activeArticleViewer = this;

    // Wire Edit button for this article
    this._currentModalArticle = article;
    const editBtn = document.getElementById('editArticleBtn');
    if (editBtn) {
      editBtn.onclick = () => {
        // Close modal first, then open writer pre-filled
        const closeBtn = document.getElementById('closeModalBtn');
        if (closeBtn) closeBtn.click();
        this.openWriter(this._currentModalArticle);
      };
    }

    if (content) this._fillArticleContent(article, content, 0);

    // Update URL hash so the link can be shared / restored
    if (this.hub && !this.hub._suppressHashWrite) {
      const worldId   = this.hub.currentWorld?.id || 'breach';
      const cat       = article._category || '';
      const panelName = cat === 'Technology' ? 'society' : cat.toLowerCase();
      const slug      = this.hub._slugify(article.name || '');
      if (panelName && slug) this.hub._setHash(`${worldId}/${panelName}/${slug}`);
    }

    Config.log('Article modal opened:', article.name);
  }

  _fillArticleContent(article, bodyEl, arrowDepth = 0) {
    const htmlContent = this.markdownToHtml(article.content || 'No content available');

    const _getField = (obj, key) => {
      const lk = key.toLowerCase();
      const match = Object.keys(obj).find(k => k.toLowerCase() === lk);
      return match ? String(obj[match]).trim() : '';
    };
    const typeField     = _getField(article, 'type');
    const effectField   = _getField(article, 'effect');
    const habitatField  = _getField(article, 'habitat');
    const sizeField     = _getField(article, 'size');
    const homelandField = _getField(article, 'homeland');
    const lifespanField = _getField(article, 'lifespan');
    const authorField   = _getField(article, 'author');
    const leaderField   = _getField(article, 'leader');
    const hqField       = _getField(article, 'hq');
    const dateField     = _getField(article, 'date');
    const metaHtml = (typeField || effectField || habitatField || sizeField || homelandField || lifespanField || authorField || leaderField || hqField || dateField) ? `
      <div class="article-modal-meta">
        ${dateField     ? `<div class="article-meta-item"><span class="article-meta-label">Date</span><span class="article-meta-value">${dateField}</span></div>` : ''}
        ${typeField     ? `<div class="article-meta-item"><span class="article-meta-label">Type</span><span class="article-meta-value">${typeField}</span></div>` : ''}
        ${authorField   ? `<div class="article-meta-item"><span class="article-meta-label">Author</span><span class="article-meta-value">${authorField}</span></div>` : ''}
        ${leaderField   ? `<div class="article-meta-item"><span class="article-meta-label">Leader</span><span class="article-meta-value">${leaderField}</span></div>` : ''}
        ${hqField       ? `<div class="article-meta-item"><span class="article-meta-label">HQ</span><span class="article-meta-value">${hqField}</span></div>` : ''}
        ${sizeField     ? `<div class="article-meta-item"><span class="article-meta-label">Size</span><span class="article-meta-value">${sizeField}</span></div>` : ''}
        ${habitatField  ? `<div class="article-meta-item"><span class="article-meta-label">Habitat</span><span class="article-meta-value">${habitatField}</span></div>` : ''}
        ${effectField   ? `<div class="article-meta-item"><span class="article-meta-label">Effect</span><span class="article-meta-value">${effectField}</span></div>` : ''}
        ${homelandField ? `<div class="article-meta-item"><span class="article-meta-label">Homeland</span><span class="article-meta-value">${homelandField}</span></div>` : ''}
        ${lifespanField ? `<div class="article-meta-item"><span class="article-meta-label">Lifespan</span><span class="article-meta-value">${lifespanField}</span></div>` : ''}
      </div>
      <hr class="article-modal-meta-divider">` : '';

    // ── Phase 1: render the shell so the text column is in the DOM ──────────
    bodyEl.innerHTML = `
      <div class="article-modal-columns">
        <div class="article-modal-image-col">
          ${this.renderImageColumn(article, '')}
        </div>
        <div class="article-modal-text-col">
          <h1 class="article-modal-title">${article.name}</h1>
          ${metaHtml}
          <div class="article-pages-container"></div>
        </div>
      </div>
      <div class="article-nav-mount"></div>
    `;

    // ── Phase 2: measure in the real text column, build pages ───────────────
    const pagesContainer = bodyEl.querySelector('.article-pages-container');
    const navMount       = bodyEl.querySelector('.article-nav-mount');

    // Pre-render a nav placeholder BEFORE measuring so that its height is
    // already subtracted from pagesCtr.clientHeight when paginateContent runs.
    if (navMount) {
      navMount.innerHTML = this.renderArticleNavigation(2);
    }

    const pages = this.paginateContent(htmlContent, pagesContainer);
    if (pagesContainer) {
      pagesContainer.innerHTML = this.renderArticlePages(pages);
    }
    if (navMount) {
      navMount.innerHTML = pages.length > 1 ? this.renderArticleNavigation(pages.length) : '';
    }
    let arrowHandler = null;
    if (pages.length > 1) {
      arrowHandler = this.setupArticlePagination(pages.length, bodyEl, arrowDepth);
    }

    const imageUrls = this.parseImageUrls(article.image_url);
    if (imageUrls.length > 1) {
      this.setupImageSlideshow(bodyEl);
    }
    this.bindArticleLinks(bodyEl);
    return arrowHandler;
  }

  paginateContent(htmlContent, pagesCtrEl) {
    const pagesCtr = pagesCtrEl;
    if (!pagesCtr) return [htmlContent];

    // Lock the container to its current flex-allocated height so it doesn't
    // resize as we inject content during measurement.
    const containerH = pagesCtr.clientHeight > 0 ? pagesCtr.clientHeight : 600;
    pagesCtr.style.height = containerH + 'px';
    // Small buffer for sub-pixel rounding only — font/layout is now exact.
    const PAGE_HEIGHT = containerH - 4;

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent;
    const elements = Array.from(tempDiv.children);
    if (!elements.length) return [htmlContent];

    // Measure inside an actual .article-page in the real container so every
    // CSS property (font, line-height, padding, box-sizing) is inherited
    // exactly as it will be during the final render. This eliminates the
    // staging-div font-metric mismatch that caused persistent last-line clipping.
    const probe = document.createElement('div');
    probe.className = 'article-page active';
    // Override only the layout constraints that would prevent accurate measurement:
    // height:auto  → scrollHeight = true content height (not parent height)
    // overflow:visible → belt-and-suspenders for accurate scrollHeight
    probe.style.cssText = 'height:auto;overflow:visible;position:relative;opacity:1;';
    pagesCtr.appendChild(probe);

    const measure = (html) => { probe.innerHTML = html; return probe.scrollHeight; };

    const pages  = [];
    let pageHtml = [];

    for (let i = 0; i < elements.length; i++) {
      const el    = elements[i];
      const isHdr = /^H[1-3]$/.test(el.tagName);

      // Orphan guard: never leave a header at the bottom of a page.
      // Scan past any consecutive headers to find the first body-text element,
      // then check whether all headers in this run + that body text fit together.
      // If not, push the current page and start the new page with the ENTIRE
      // header run so no header gets stranded alone.
      if (isHdr && pageHtml.length > 0) {
        let j = i + 1;
        while (j < elements.length && /^H[1-3]$/.test(elements[j].tagName)) j++;
        if (j < elements.length) {
          const headerRun = elements.slice(i, j).map(e => e.outerHTML);
          const firstBody = elements[j].outerHTML;
          if (measure([...pageHtml, ...headerRun, firstBody].join('')) > PAGE_HEIGHT) {
            pages.push(pageHtml.join(''));
            pageHtml = [...headerRun]; // seed new page with ALL headers in the run
            i = j - 1;                // loop i++ will land on the body element next
            continue;
          }
        }
      }

      const withEl = measure([...pageHtml, el.outerHTML].join(''));

      if (withEl <= PAGE_HEIGHT) {
        pageHtml.push(el.outerHTML);
      } else if (el.tagName === 'P' && pageHtml.length > 0) {
        // Binary-search: most words of this paragraph that still fit.
        const words = (el.textContent || '').split(' ');
        let lo = 1, hi = words.length - 1, bestSplit = 0;
        while (lo <= hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (measure([...pageHtml, `<p>${words.slice(0, mid).join(' ')}</p>`].join('')) <= PAGE_HEIGHT) {
            bestSplit = mid; lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
        if (bestSplit > 0) {
          pageHtml.push(`<p>${words.slice(0, bestSplit).join(' ')}</p>`);
          pages.push(pageHtml.join(''));
          const rest = words.slice(bestSplit).join(' ').trim();
          pageHtml = rest ? [`<p>${rest}</p>`] : [];
        } else {
          pages.push(pageHtml.join(''));
          pageHtml = [el.outerHTML];
        }
      } else {
        if (pageHtml.length > 0) pages.push(pageHtml.join(''));
        pageHtml = [el.outerHTML];
      }
    }

    if (pageHtml.length > 0) pages.push(pageHtml.join(''));
    probe.remove();
    return pages.length ? pages : [htmlContent];
  }

  // Render pages HTML
  renderArticlePages(pages) {
    return pages.map((pageContent, index) => `
      <div class="article-page ${index === 0 ? 'active' : ''}" data-page="${index}">
        ${pageContent}
      </div>
    `).join('');
  }

  // Render navigation controls
  renderArticleNavigation(totalPages) {
    const dots = Array.from({ length: totalPages }, (_, i) => 
      `<button class="article-dot ${i === 0 ? 'active' : ''}" data-page="${i}"></button>`
    ).join('');
    
    return `
      <div class="article-navigation">
        <button class="article-nav-btn article-prev" disabled>‹</button>
        <div class="article-dots">${dots}</div>
        <button class="article-nav-btn article-next" ${totalPages <= 1 ? 'disabled' : ''}>›</button>
      </div>
    `;
  }

  // Setup pagination event listeners
  setupArticlePagination(totalPages, containerEl, arrowDepth = 0) {
    let currentPage = 0;

    const updatePage = (newPage) => {
      if (newPage < 0 || newPage >= totalPages) return;
      const pages = containerEl.querySelectorAll('.article-page');
      const dots  = containerEl.querySelectorAll('.article-dot');
      pages[currentPage]?.classList.remove('active');
      dots[currentPage]?.classList.remove('active');
      currentPage = newPage;
      pages[currentPage]?.classList.add('active');
      dots[currentPage]?.classList.add('active');
      // Scroll active dot into view (handles overflow on mobile)
      dots[currentPage]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      // Reset page scroll to top on each page change
      containerEl.querySelector('.article-pages-container')?.scrollTo({ top: 0 });
      const prevBtn = containerEl.querySelector('.article-prev');
      const nextBtn = containerEl.querySelector('.article-next');
      if (prevBtn) prevBtn.disabled = currentPage === 0;
      if (nextBtn) nextBtn.disabled = currentPage === totalPages - 1;
    };

    containerEl.querySelector('.article-prev')?.addEventListener('click', () => updatePage(currentPage - 1));
    containerEl.querySelector('.article-next')?.addEventListener('click', () => updatePage(currentPage + 1));
    containerEl.querySelectorAll('.article-dot').forEach(dot => {
      dot.addEventListener('click', (e) => updatePage(parseInt(e.target.dataset.page)));
    });

    // Arrow key navigation — only fires for the currently active stack depth
    const arrowKeyHandler = (e) => {
      if (!document.body.classList.contains('modal-active')) return;
      if ((this._articleStack?.length ?? 0) !== arrowDepth) return;
      if (e.key === 'ArrowLeft')       { e.preventDefault(); updatePage(currentPage - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); updatePage(currentPage + 1); }
    };

    document.addEventListener('keydown', arrowKeyHandler);
    if (arrowDepth === 0) this._arrowKeyHandler = arrowKeyHandler;
    return arrowKeyHandler;
  }

  // Parse image_offset cell value into a CSS object-position X value.
  // Accepts: L20PX / L20 / L10% → shift left; R20PX / R20 / R10% → shift right.
  // Returns a full object-position string, e.g. "calc(50% - 20px) center".
  parseImageOffset(offsetVal) {
    if (!offsetVal || !offsetVal.trim()) return null;
    const m = offsetVal.trim().match(/^([LRlr])(\d+(?:\.\d+)?)(px|%)?$/i);
    if (!m) return null;
    const dir = m[1].toUpperCase();
    const amount = m[2];
    const unit = m[3] ? m[3].toLowerCase() : 'px';
    const sign = dir === 'L' ? '-' : '+';
    return `calc(50% ${sign} ${amount}${unit}) center`;
  }

  // Parse a potentially multi-URL image_url cell (comma or newline separated)
  parseImageUrls(imageUrl) {
    if (!imageUrl || !imageUrl.trim()) return [];
    return imageUrl.split(/[\n,]/).map(u => u.trim()).filter(u => u.length > 0);
  }

  // Parse per-image offsets from a comma-separated string.
  // Each entry maps 1:1 by position to image_url entries.
  // Use X to explicitly skip a slot: "L20, X, R40" → image 1 shifted, image 2 unchanged, image 3 shifted.
  // Every image position should have a corresponding entry — X is the only intentional skip.
  parseImageOffsets(offsetCell, imageCount) {
    const entries = offsetCell
      ? offsetCell.split(',').map(s => s.trim())
      : [];
    return Array.from({ length: imageCount }, (_, i) => {
      const raw = entries[i] || '';
      if (!raw || /^x$/i.test(raw)) return null;
      return this.parseImageOffset(raw);
    });
  }

  // Render the image column interior: single img, slideshow, or just summary
  renderImageColumn(article, summaryHtml) {
    const urls = this.parseImageUrls(article.image_url);
    if (urls.length === 0) {
      return summaryHtml;
    }
    if (urls.length === 1) {
      const objPos = this.parseImageOffset(article.image_offset);
      const posStyle = objPos ? ` style="object-position: ${objPos}"` : '';
      return `<img src="${urls[0]}" class="article-image" alt="${article.name}" loading="lazy"${posStyle}>${summaryHtml}`;
    }
    // Multiple images → per-image offsets
    const offsets = this.parseImageOffsets(article.image_offset, urls.length);
    const slides = urls.map((url, i) => {
      const posStyle = offsets[i] ? ` style="object-position: ${offsets[i]}"` : '';
      return `<img src="${url}" class="slideshow-img${i === 0 ? ' active' : ''}" alt="${article.name} image ${i + 1}" loading="lazy" data-slide="${i}"${posStyle}>`;
    }).join('');
    const dots = urls.map((_, i) =>
      `<button class="image-dot${i === 0 ? ' active' : ''}" data-slide="${i}" aria-label="Image ${i + 1}"></button>`
    ).join('');
    return `
      <div class="article-image-slideshow">
        ${slides}
        <div class="image-slide-dots">${dots}</div>
      </div>
      ${summaryHtml}`;
  }

  // Bind click events for image slideshow dots
  setupImageSlideshow(containerEl = document) {
    const dots = containerEl.querySelectorAll('.image-dot');
    if (!dots.length) return;
    dots.forEach(dot => {
      dot.addEventListener('click', (e) => {
        const targetSlide = parseInt(e.currentTarget.dataset.slide);
        containerEl.querySelectorAll('.slideshow-img').forEach((img, i) => {
          img.classList.toggle('active', i === targetSlide);
        });
        dots.forEach((d, i) => d.classList.toggle('active', i === targetSlide));
      });
    });
  }

  bindArticleLinks(container) {
    // Use event delegation on the container so links work regardless of when
    // they were inserted (pagination, lazy rendering, etc.).
    // Guard prevents duplicate listeners when the same container is reused.
    if (container._linkDelegBound) return;
    container._linkDelegBound = true;
    container.addEventListener('click', (e) => {
      const link = e.target.closest('.article-link');
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      this.openArticleByName(link.dataset.article);
    });
  }

  openArticleByName(name) {
    const cleanName = name.replace(/\s+/g, ' ').trim();
    const nameLower = cleanName.toLowerCase();

    // Search own loaded articles first
    let article = this.currentArticles.find(a => (a.name || '').trim().toLowerCase() === nameLower);

    // Fall back to the hub's global sheet cache so links can cross sheet boundaries
    if (!article && this.hub?._sheetCache) {
      for (const rows of Object.values(this.hub._sheetCache)) {
        const found = rows.find(a => (a.name || '').trim().toLowerCase() === nameLower);
        if (found) { article = found; break; }
      }
    }

    // Article not found in any cached sheet — try loading all article sheets
    // then retry. This handles cross-sheet links when the target sheet hasn't
    // been visited yet in the current session.
    if (!article && this.hub) {
      this._loadAllAndOpenByName(cleanName);
      return;
    }

    if (!article) {
      Config.warn('article-link: no article found with name:', cleanName);
      return;
    }

    this._openArticleObject(article);
  }

  // Fallback: load all article sheets and retry opening by name.
  // Called when the target article isn't found in any cached sheet.
  async _loadAllAndOpenByName(name) {
    const allArticleSheets = [
      'Nations', 'Species', 'Deities', 'History', 'Literature', 'Society',
      'Technology', 'Characters', 'Factions', 'Bestiary', 'Items', 'Alchemy', 'Locations'
    ];

    // Show a small loading indicator while fetching from the backend
    let indicator = document.querySelector('.article-fetch-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'article-fetch-indicator';
      indicator.textContent = 'Loading article…';
      document.body.appendChild(indicator);
    }
    requestAnimationFrame(() => indicator.classList.add('show'));

    try {
      await this.hub.loadSheets(allArticleSheets);
    } catch (e) {
      Config.error('article-link: failed to load sheets for cross-sheet lookup:', e.message);
    } finally {
      indicator.classList.remove('show');
    }

    const nameLower = name.replace(/\s+/g, ' ').trim().toLowerCase();
    let article = null;
    for (const rows of Object.values(this.hub._sheetCache)) {
      const found = rows.find(a => (a.name || '').replace(/\s+/g, ' ').trim().toLowerCase() === nameLower);
      if (found) { article = found; break; }
    }
    if (!article) {
      Config.warn('article-link: no article found with name:', name);
      return;
    }
    // Open directly — we already have the article object, no need to re-search
    this._openArticleObject(article);
  }

  // Open an article object directly, bypassing the name lookup.
  _openArticleObject(article) {
    const layerDepth = this._articleStack.length + 1;
    const zBase      = 10200 + (layerDepth - 1) * 20;

    const layerOverlay = document.createElement('div');
    layerOverlay.className = 'article-layer-wrap';
    layerOverlay.style.zIndex = String(zBase);

    const modalEl = document.createElement('div');
    modalEl.className = 'article-modal article-mode article-modal-layer';
    modalEl.style.zIndex = String(zBase + 10);
    modalEl.innerHTML = `
      <div class="modal-content">
        <button class="close-btn article-layer-close">&times;</button>
        <div class="modal-header"><h1>${article.name}</h1></div>
        <div class="modal-body"></div>
      </div>
    `;

    document.body.appendChild(layerOverlay);
    document.body.appendChild(modalEl);

    const bodyEl = modalEl.querySelector('.modal-body');
    modalEl.querySelector('.article-layer-close').addEventListener('click', () => this.closeTopLayer());
    layerOverlay.addEventListener('click', () => this.closeTopLayer());
    modalEl.addEventListener('click', (e) => e.stopPropagation());

    this._articleStack.push({ layerOverlay, modalEl, arrowHandler: null });

    requestAnimationFrame(() => {
      layerOverlay.classList.add('show');
      modalEl.classList.add('show');
      const entry = this._articleStack.find(e => e.modalEl === modalEl);
      if (entry) {
        entry.arrowHandler = this._fillArticleContent(article, bodyEl, layerDepth);
      }
    });

    Config.log('Article layer opened:', article.name, '(depth:', layerDepth, ')');
  }

  closeTopLayer() {
    const entry = this._articleStack.pop();
    if (!entry) return;
    if (entry.arrowHandler) {
      document.removeEventListener('keydown', entry.arrowHandler);
    }
    // Fade out, then remove from DOM once transition completes
    entry.layerOverlay.classList.remove('show');
    entry.modalEl.classList.remove('show');
    entry.modalEl.addEventListener('transitionend', () => {
      entry.layerOverlay.remove();
      entry.modalEl.remove();
    }, { once: true });
    Config.log('Article layer closing, stack depth:', this._articleStack.length);
  }

  closeModal() {
    // Delegate to hub so all cleanup (arrow key handler, atlas lightbox state) fires in one place.
    if (this.hub) {
      this.hub.closeModal();
    }
  }

  // ── Article Writer ───────────────────────────────────────────────────────

  openWriter(prefill = null) {
    // Immediately remove any stuck/previous panel — don't rely on transitionend
    const existing = document.getElementById('articleWriterOverlay');
    if (existing) existing.remove();
    if (this._writerEscHandler) {
      document.removeEventListener('keydown', this._writerEscHandler);
      this._writerEscHandler = null;
    }

    const overlay = document.createElement('div');
    overlay.className = 'article-writer-overlay';
    overlay.id = 'articleWriterOverlay';

    const panel = document.createElement('div');
    panel.className = 'article-writer-panel';
    panel.innerHTML = this._renderWriterForm(prefill);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add('show'));

    // Escape key
    this._writerEscHandler = (e) => { if (e.key === 'Escape') this.closeWriter(); };
    document.addEventListener('keydown', this._writerEscHandler);

    // Sheet selector → rebuild dynamic fields (new-article mode only; locked in edit mode)
    const sheetSelect = panel.querySelector('#writerSheetSelect');
    const dynamicEl   = panel.querySelector('.writer-dynamic-fields');
    if (sheetSelect && dynamicEl && !prefill) {
      sheetSelect.addEventListener('change', () => {
        dynamicEl.innerHTML = this._buildWriterFields(sheetSelect.value);
      });
    }

    panel.querySelector('.writer-close')
      ?.addEventListener('click', () => this.closeWriter());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeWriter(); });
    panel.querySelector('.writer-cancel-btn')
      ?.addEventListener('click', () => this.closeWriter());
    panel.querySelector('.writer-submit-btn')
      ?.addEventListener('click', () => this._handleWriterSubmit(panel, prefill));
  }

  _renderWriterForm(prefill = null) {
    const isEdit       = !!prefill;
    const multiSheet   = this.allowedSheets.length > 1;
    const defaultSheet = isEdit
      ? (prefill._category || this.currentFilters.category || this.defaultSheet)
      : (this.currentFilters.category || this.defaultSheet);
    const sheetOptions = this.allowedSheets
      .map(s => `<option value="${s}" ${s === defaultSheet ? 'selected' : ''}>${s}</option>`)
      .join('');

    // Helper: get a field value from prefill, falling back to ''
    const pre = (key) => isEdit ? (String(prefill[key] || '').replace(/"/g, '&quot;')) : '';
    const preVis = isEdit ? (String(prefill.visible || 'TRUE').toUpperCase() === 'FALSE' ? 'FALSE' : 'TRUE') : 'TRUE';

    return `
      <div class="writer-header">
        <h2 class="writer-title">${isEdit ? 'Edit Article' : 'New Article'}</h2>
        <button class="writer-close">&times;</button>
      </div>
      <div class="writer-body">
        <form class="writer-form" id="articleWriterForm" novalidate>
          ${(isEdit || !multiSheet) ? `<input type="hidden" id="writerSheetSelect" value="${defaultSheet}">` : `
          <div class="writer-field">
            <label class="writer-label">Sheet / Category</label>
            <select id="writerSheetSelect" class="writer-select">
              ${sheetOptions}
            </select>
          </div>`}
          <div class="writer-field">
            <label class="writer-label">Name <span class="writer-required">*</span></label>
            <input type="text" name="name" class="writer-input" placeholder="Article name" autocomplete="off" value="${pre('name')}">
          </div>
          <div class="writer-field">
            <label class="writer-label">Summary</label>
            <textarea name="summary" class="writer-textarea writer-summary" placeholder="Short summary or description…">${pre('summary')}</textarea>
          </div>
          <div class="writer-dynamic-fields">
            ${this._buildWriterFields(defaultSheet, prefill)}
          </div>
          <div class="writer-field">
            <label class="writer-label">Content <span class="writer-hint">(Markdown: ## headings, **bold**, *italic*, [[article links]])</span></label>
            <textarea name="content" class="writer-textarea writer-content" placeholder="Article body…">${pre('content')}</textarea>
          </div>
          <div class="writer-field">
            <label class="writer-label">Tags <span class="writer-hint">(comma-separated)</span></label>
            <input type="text" name="tags" class="writer-input" placeholder="Knight, Human, Protagonist" value="${pre('tags')}">
          </div>
          <div class="writer-field">
            <label class="writer-label">Image URL</label>
            <input type="text" name="image_url" class="writer-input" placeholder="https://…" value="${pre('image_url')}">
          </div>
          <div class="writer-field writer-field-row">
            <div class="writer-field">
              <label class="writer-label">Image Offset <span class="writer-hint">(e.g. L20, R15%)</span></label>
              <input type="text" name="image_offset" class="writer-input" placeholder="L20" value="${pre('image_offset')}">
            </div>
            <div class="writer-field">
              <label class="writer-label">Visible</label>
              <select name="visible" class="writer-select">
                <option value="TRUE" ${preVis === 'TRUE' ? 'selected' : ''}>TRUE</option>
                <option value="FALSE" ${preVis === 'FALSE' ? 'selected' : ''}>FALSE</option>
              </select>
            </div>
          </div>
        </form>
      </div>
      <div class="writer-footer" data-edit="${isEdit}">
        <div class="writer-status" id="writerStatus"></div>
        <div class="writer-actions">
          <button class="writer-cancel-btn">Cancel</button>
          <button class="writer-submit-btn">${isEdit ? 'Save Changes' : 'Publish'}</button>
        </div>
      </div>
    `;
  }

  _buildWriterFields(sheetName, prefill = null) {
    const extras = (Config.SHEET_SCHEMAS && Config.SHEET_SCHEMAS[sheetName]) || [];
    if (!extras.length) return '';
    const label = f => f.charAt(0).toUpperCase() + f.slice(1);
    return extras.map(f => {
      const val = prefill ? String(prefill[f] || '').replace(/"/g, '&quot;') : '';
      return `
      <div class="writer-field">
        <label class="writer-label">${label(f)}</label>
        <input type="text" name="${f}" class="writer-input" placeholder="${label(f)}…" value="${val}">
      </div>
    `;
    }).join('');
  }

  async _handleWriterSubmit(panelEl, prefill = null) {
    const form   = panelEl.querySelector('#articleWriterForm');
    const status = panelEl.querySelector('#writerStatus');
    const submit = panelEl.querySelector('.writer-submit-btn');
    if (!form) return;

    const isEdit    = !!prefill;
    const sheetName = panelEl.querySelector('#writerSheetSelect')?.value || this.defaultSheet;
    const nameVal   = (form.querySelector('[name="name"]')?.value || '').trim();

    if (!nameVal) {
      status.textContent = 'Name is required.';
      status.className   = 'writer-status writer-status-error';
      return;
    }

    const rowData = {};
    form.querySelectorAll('[name]').forEach(el => {
      const key = el.getAttribute('name');
      if (key) rowData[key] = el.value;
    });

    // Guard against URL length overflow (JSONP GET has ~6000 char practical limit)
    const payloadLength = JSON.stringify({ sheet: sheetName, row: rowData }).length;
    if (payloadLength > 5500) {
      status.textContent = `Content too long (${payloadLength} chars). Shorten the article body and try again.`;
      status.className   = 'writer-status writer-status-error';
      return;
    }

    submit.disabled    = true;
    status.textContent = isEdit ? 'Saving…' : 'Publishing…';
    status.className   = 'writer-status writer-status-info';

    const originalName = isEdit ? (prefill.name || '') : null;
    await this._submitArticle(sheetName, rowData, status, submit, isEdit, originalName);
  }

  async _submitArticle(sheetName, rowData, statusEl, submitBtn, isEdit = false, originalName = null) {
    try {
      // Write/edit via JSONP GET — same mechanism used for reads.
      const writeUrl = new URL(Config.APPS_SCRIPT_URL);
      writeUrl.searchParams.set('action', isEdit ? 'edit' : 'write');
      const payloadObj = isEdit
        ? { sheet: sheetName, row: rowData, originalName }
        : { sheet: sheetName, row: rowData };
      writeUrl.searchParams.set('payload', JSON.stringify(payloadObj));
      const result = await this.hub.jsonp(writeUrl.toString());

      if (!result.success) {
        throw new Error(result.error || 'Apps Script returned failure');
      }

      // Bust the cache so the next loadSheets() fetches fresh data.
      if (this.hub) {
        this.hub._sheetCache    = {};
        this.hub._sheetPrefetch = null;
      }

      if (statusEl) {
        statusEl.textContent = 'Written — reloading…';
        statusEl.className   = 'writer-status writer-status-info';
      }

      this._hasInitialized = false;
      await this.loadArticleData();
      this.refreshArticleGrid();

      if (statusEl) {
        statusEl.textContent = 'Done!';
        statusEl.className   = 'writer-status writer-status-success';
      }

      setTimeout(() => this.closeWriter(), 700);

    } catch (err) {
      Config.error('_submitArticle error:', err);
      if (statusEl) {
        statusEl.textContent = 'Network error — check console.';
        statusEl.className   = 'writer-status writer-status-error';
      }
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  closeWriter() {
    if (this._writerEscHandler) {
      document.removeEventListener('keydown', this._writerEscHandler);
      this._writerEscHandler = null;
    }
    const overlay = document.getElementById('articleWriterOverlay');
    if (!overlay) return;
    overlay.classList.remove('show');
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
    // Safety fallback: if transitionend doesn't fire (e.g. no transition active), remove after delay
    setTimeout(() => { if (overlay.isConnected) overlay.remove(); }, 400);
  }

  markdownToHtml(markdown) {
    if (!markdown) return 'No content available';
    
    // Basic markdown conversion - you might want a proper library later
    return markdown
      .replace(/\[\[([^\]]+)\]\]/g, (_, raw) => { const n = raw.replace(/\s+/g, ' ').trim(); return `<a class="article-link" data-article="${n}">${n}</a>`; })
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^(.*)/, '<p>$1</p>')
      // Strip artifacts that create phantom spacing around headings:
      // <br> immediately before/after a heading tag
      .replace(/<br>(<h[1-3]>)/g, '$1')
      .replace(/(<\/h[1-3]>)<br>/g, '$1')
      // Opening <p> wrapping a heading (browser auto-closes it, leaving empty <p>)
      .replace(/<p>(<h[1-3]>)/g, '$1')
      // </p><p> paragraph break landing right before a heading
      .replace(/<\/p><p>(<h[1-3]>)/g, '$1')
      // </p><p> paragraph break landing right after a heading close — keep the <p> for the following text
      .replace(/(<\/h[1-3]>)<\/p><p>/g, '$1<p>')
      // Stray </p> immediately after a heading close
      .replace(/(<\/h[1-3]>)<\/p>/g, '$1')
      // Any empty paragraphs left over
      .replace(/<p><\/p>/g, '');
  }

}

// Export for use in main hub
window.ArticleViewer = ArticleViewer;