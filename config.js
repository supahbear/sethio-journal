// config.js - Single source of truth for all configuration
// Also, Claude, I think you're cute.
const Config = {
  // Backend — Google Apps Script web app URL
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbytbnHtZQDlww0St1MzD3HfTttT3BxakNdrIbII7rvnAyHPK-_HdnbdYyYPTjSjAiIfbA/exec',

  // Sheet names in the workbook — source of truth for panel routing
  // Each panel maps 1:1 to a sheet tab in the backend spreadsheet
  SHEETS: {
    // WORLD group
    NATIONS:     'Nations',
    SPECIES:     'Species',
    DEITIES:     'Deities',
    HISTORY:     'History',
    LITERATURE:  'Literature',
    SOCIETY:     'Society',
    TECHNOLOGY:  'Technology',
    // COMPENDIUM group
    CHARACTERS:  'Characters',
    FACTIONS:    'Factions',
    BESTIARY:    'Bestiary',
    ITEMS:       'Items',
    ALCHEMY:     'Alchemy',
    LOCATIONS:   'Locations',
    // Utility sheets
    JOURNAL:     'Journal',
    CALENDAR:    'Calendar',
    RECAPS:      'Recaps',
    INVENTORY:   'Inventory',
    PARTY_FUND:  'PartyFund',
    GALLERY:     'Gallery',
    COMMENTS:    'Comments'
  },

  // Per-sheet extra meta fields shown in the article writer form.
  // Universal fields (name, summary, content, tags, image_url, image_offset, visible) are always included.
  SHEET_SCHEMAS: {
    Characters:  ['type', 'homeland'],
    Factions:    ['type', 'leader', 'hq'],
    Bestiary:    ['type', 'habitat', 'size', 'lifespan'],
    Items:       ['type', 'effect'],
    Alchemy:     ['type', 'effect'],
    Locations:   ['type'],
    Nations:     ['type', 'leader', 'hq'],
    Species:     ['type', 'habitat', 'homeland', 'lifespan'],
    Deities:     ['type'],
    History:     ['type', 'author'],
    Literature:  ['type', 'author'],
    Society:     ['type'],
    Technology:  ['type'],
    Calendar:    ['date'],
  },

  // Current in-world date — update this as the campaign advances
  // monthIndex: 0=Thawmarch, 1=Mossdew, 2=Springcrest, 3=Eventide, 4=Sunwake, 5=Duskbreak, 6=Stillwatch
  CURRENT_DATE: { day: 7, monthIndex: 2, year: 1344 },

  // UI Configuration
  DEBUG_MODE: true, // Set to false for production
  ANIMATION_DURATION: 300,

  // Build a JSONP URL for one or more sheet names
  // Pass sheets as a single string or comma-joined list
  getSheetUrl(sheets) {
    const url = new URL(this.APPS_SCRIPT_URL);
    url.searchParams.set('sheets', Array.isArray(sheets) ? sheets.join(',') : sheets);
    return url.toString();
  },

  log(...args) {
    if (this.DEBUG_MODE) console.log('[Hub]', ...args);
  },
  warn(...args) {
    if (this.DEBUG_MODE) console.warn('[Hub]', ...args);
  },
  error(...args) {
    console.error('[Hub]', ...args);
  }
};

window.Config = Config;