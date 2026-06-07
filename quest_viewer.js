// quest_viewer.js — Leads viewer: a simplified "where next?" list
// Grouped by tag (category header), each entry has a name (h3) and content.
class LeadsViewer {
  constructor(hub) {
    this.hub = hub;
    this.currentLeads = [];
  }

  async loadLeadsData() {
    try {
      const rows = await this.hub.loadSheets(['Journal']);
      this.currentLeads = rows;
      Config.log(`LeadsViewer loaded ${rows.length} leads`);
      return rows;
    } catch (error) {
      Config.error('Failed to load leads data:', error);
      this.currentLeads = [];
      return [];
    }
  }

  async render() {
    await this.loadLeadsData();
    return this._buildPanel();
  }

  _buildPanel() {
    const listHtml = this.currentLeads.length > 0
      ? this.renderLeadsList()
      : `<div class="leads-empty">No leads recorded yet.</div>`;

    return `
      <div class="leads-panel-header">
        <button class="leads-add-btn" title="Add lead">&#9998;</button>
      </div>
      <div class="leads-add-form" hidden>
        <div class="leads-form-row">
          <input class="leads-form-input" placeholder="Tag / category" data-field="tag" />
          <input class="leads-form-input" placeholder="Name" data-field="name" />
        </div>
        <textarea class="leads-form-textarea" placeholder="Details…" data-field="content"></textarea>
        <div class="leads-form-actions">
          <button class="leads-form-save-btn">Save</button>
          <button class="leads-form-cancel-btn">Cancel</button>
          <span class="leads-form-status"></span>
        </div>
      </div>
      ${listHtml}`;
  }

  renderLeadsList() {
    // Group by tag, preserving insertion order
    const grouped = {};
    const untagged = [];

    this.currentLeads.forEach(lead => {
      const tag = (lead.tag || lead.tags || '').trim();
      if (tag) {
        if (!grouped[tag]) grouped[tag] = [];
        grouped[tag].push(lead);
      } else {
        untagged.push(lead);
      }
    });

    let html = '<div class="leads-list">';

    Object.entries(grouped).forEach(([tag, leads]) => {
      html += `<div class="leads-category">
        <h2 class="leads-category-header">${this._esc(tag)}</h2>
        <ul class="leads-group">
          ${leads.map(lead => this.renderLead(lead)).join('')}
        </ul>
      </div>`;
    });

    if (untagged.length > 0) {
      html += `<div class="leads-category">
        <ul class="leads-group">
          ${untagged.map(lead => this.renderLead(lead)).join('')}
        </ul>
      </div>`;
    }

    html += '</div>';
    return html;
  }

  renderLead(lead) {
    const name    = (lead.name    || '').trim();
    const content = (lead.content || '').trim();
    return `<li class="lead-entry">
      ${name    ? `<h3 class="lead-name">${this._esc(name)}</h3>` : ''}
      ${content ? `<p class="lead-content">${this._esc(content)}</p>` : ''}
    </li>`;
  }

  setupInteractions(container) {
    const addBtn    = container.querySelector('.leads-add-btn');
    const form      = container.querySelector('.leads-add-form');
    const cancelBtn = container.querySelector('.leads-form-cancel-btn');
    const saveBtn   = container.querySelector('.leads-form-save-btn');
    const status    = container.querySelector('.leads-form-status');

    if (addBtn && form) {
      addBtn.addEventListener('click', () => {
        form.hidden = !form.hidden;
        if (!form.hidden) form.querySelector('[data-field="tag"]')?.focus();
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        form.hidden = true;
        form.querySelectorAll('[data-field]').forEach(el => { el.value = ''; });
        if (status) status.textContent = '';
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const tag     = form.querySelector('[data-field="tag"]').value.trim();
        const name    = form.querySelector('[data-field="name"]').value.trim();
        const content = form.querySelector('[data-field="content"]').value.trim();

        if (!name) { status.textContent = 'Name is required.'; return; }

        saveBtn.disabled = true;
        status.textContent = 'Saving\u2026';

        try {
          await this._saveLead({ tag, name, content });
          await this.loadLeadsData();

          // Replace the leads list in the DOM without re-mounting the form
          const newListHtml = this.currentLeads.length > 0
            ? this.renderLeadsList()
            : `<div class="leads-empty">No leads recorded yet.</div>`;

          const existing = container.querySelector('.leads-list, .leads-empty');
          if (existing) {
            existing.outerHTML = newListHtml;
          } else {
            container.insertAdjacentHTML('beforeend', newListHtml);
          }

          form.querySelectorAll('[data-field]').forEach(el => { el.value = ''; });
          form.hidden = true;
          status.textContent = '';
        } catch (err) {
          status.textContent = 'Save failed. Try again.';
          Config.error('Lead save error:', err);
        } finally {
          saveBtn.disabled = false;
        }
      });
    }
  }

  async _saveLead(rowData) {
    const url = new URL(Config.APPS_SCRIPT_URL);
    url.searchParams.set('action', 'write');
    url.searchParams.set('payload', JSON.stringify({ sheet: 'Journal', row: rowData }));
    const result = await this.hub.jsonp(url.toString());
    if (!result.success) throw new Error(result.error || 'Write failed');
    return result;
  }

  _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

// Keep old name aliased for any lingering references
window.LeadsViewer = LeadsViewer;
window.QuestViewer = LeadsViewer;
