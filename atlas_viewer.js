// atlas_viewer.js - Image gallery viewer for the Atlas panel
class AtlasViewer {
  constructor(hub) {
    this.hub = hub;
    this.maps = [];
    this.currentIndex = 0;
    this._lightboxOpen = false;
    this._escBound = false;
  }

  async loadMapData() {
    const rows = await this.hub.loadSheets(['Locations', 'Maps']);
    this.maps = rows;
    Config.log(`Atlas: loaded ${this.maps.length} entries`);
  }

  async renderAtlasMode(worldId) {
    await this.loadMapData();

    if (this.maps.length === 0) {
      return `
        <div class="atlas-viewer">
          <div class="atlas-empty">
            <div class="empty-icon">🗺️</div>
            <h3>No Maps Available</h3>
            <p>This world doesn't have any maps published yet.</p>
          </div>
        </div>
      `;
    }

    // Group entries by their primary tag
    const groups = new Map();
    this.maps.forEach((map, i) => {
      const primaryTag = (map.tags || '').split(',')[0].trim() || 'Other';
      const label = primaryTag.charAt(0).toUpperCase() + primaryTag.slice(1);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push({ map, i });
    });

    const sectionsHtml = [...groups.entries()].map(([label, entries]) => `
      <div class="atlas-section">
        <div class="atlas-section-header">
          <span class="atlas-section-title">${label}</span>
        </div>
        <div class="atlas-grid">
          ${entries.map(({ map, i }) => this.renderMapTile(map, i)).join('')}
        </div>
      </div>
    `).join('');

    return `
      <div class="atlas-viewer">
        ${sectionsHtml}
      </div>
    `;
  }

  renderMapTile(map, index) {
    const hasImage = map.image_url && map.image_url.trim();
    return `
      <div class="atlas-tile" data-atlas-index="${index}">
        ${hasImage
          ? `<img src="${map.image_url}" alt="${map.name}" loading="lazy" class="atlas-tile-img">`
          : `<div class="atlas-tile-placeholder"></div>`
        }
        <div class="atlas-tile-label">
          <span class="atlas-tile-title">${map.name}</span>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    document.querySelectorAll('.atlas-tile').forEach(tile => {
      if (tile._atlasBound) return;
      tile.addEventListener('click', () => {
        this.openLightbox(parseInt(tile.dataset.atlasIndex));
      });
      tile._atlasBound = true;
    });

    // Global keyboard navigation — bound once per instance
    if (!this._escBound) {
      document.addEventListener('keydown', (e) => {
        if (!this._lightboxOpen) return;
        if (e.key === 'ArrowLeft')  { e.preventDefault(); this.stepLightbox(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); this.stepLightbox(1); }
        if (e.key === 'Escape')     { this.closeLightbox(); }
      });
      this._escBound = true;
    }
  }

  openLightbox(index) {
    this.currentIndex = index;
    this._lightboxOpen = true;

    const map = this.maps[index];
    const modal   = document.getElementById('articleModal');
    const overlay = document.getElementById('modalOverlay');
    const title   = document.getElementById('modalTitle');
    const body    = document.getElementById('modalBody');
    if (!modal || !overlay) return;

    title.textContent = map.name;
    body.innerHTML = this.renderLightboxContent(map, index);

    overlay.classList.add('show');
    modal.classList.add('show');
    document.body.classList.add('modal-active');

    this._bindLightboxNav(body);

    // Bind close button — use atlas-specific flag so we don't re-bind on nav steps
    const closeBtn = document.getElementById('closeModalBtn');
    if (closeBtn && !closeBtn._atlasBoundClose) {
      closeBtn.addEventListener('click', () => this.closeLightbox());
      closeBtn._atlasBoundClose = true;
    }

    // Bind overlay click — only when atlas opened the modal
    if (!overlay._atlasBoundOverlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay && this._lightboxOpen) this.closeLightbox();
      });
      overlay._atlasBoundOverlay = true;
    }
  }

  renderLightboxContent(map, index) {
    const hasImage = map.image_url && map.image_url.trim();
    return `
      <div class="atlas-lightbox">
        ${hasImage ? `<img src="${map.image_url}" alt="${map.name}" class="atlas-lightbox-img">` : ''}
        ${map.summary ? `<p class="atlas-lightbox-caption">${map.summary}</p>` : ''}
        ${this.maps.length > 1 ? `
          <div class="atlas-lightbox-nav">
            <button class="atlas-nav-btn atlas-prev" ${index === 0 ? 'disabled' : ''}>‹</button>
            <span class="atlas-counter">${index + 1} / ${this.maps.length}</span>
            <button class="atlas-nav-btn atlas-next" ${index === this.maps.length - 1 ? 'disabled' : ''}>›</button>
          </div>` : ''}
      </div>
    `;
  }

  _bindLightboxNav(body) {
    body.querySelector('.atlas-prev')?.addEventListener('click', () => this.stepLightbox(-1));
    body.querySelector('.atlas-next')?.addEventListener('click', () => this.stepLightbox(1));
  }

  stepLightbox(direction) {
    const newIndex = this.currentIndex + direction;
    if (newIndex < 0 || newIndex >= this.maps.length) return;
    this.currentIndex = newIndex;

    const title = document.getElementById('modalTitle');
    const body  = document.getElementById('modalBody');
    const map   = this.maps[newIndex];

    if (title) title.textContent = map.name;
    if (body) {
      body.innerHTML = this.renderLightboxContent(map, newIndex);
      this._bindLightboxNav(body);
    }
  }

  closeLightbox() {
    this._lightboxOpen = false;
    const modal   = document.getElementById('articleModal');
    const overlay = document.getElementById('modalOverlay');
    if (modal)   modal.classList.remove('show');
    if (overlay) overlay.classList.remove('show');
    document.body.classList.remove('modal-active');
  }
}

window.AtlasViewer = AtlasViewer;
