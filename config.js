// config.js - Single source of truth for all configuration
const Config = {
  // Backend — Google Apps Script web app URL (replace with new deployment URL)
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwn-r23lvPAtdoHvnvtFMXbSAbFn-tMvst4PwfAMf8B3UL2svoxtRKYz7Cu-4P3G90p-g/exec',

  // Sheet names in the workbook
  SHEETS: {
    RECAPS:   'Recaps',
    COMMENTS: 'Comments',
    GALLERY:  'Gallery',
  },

  // UI Configuration
  DEBUG_MODE: true, // Set to false for production

  // Build a JSONP URL for one or more sheet names
  getSheetUrl(sheets) {
    const url = new URL(this.APPS_SCRIPT_URL);
    url.searchParams.set('sheets', Array.isArray(sheets) ? sheets.join(',') : sheets);
    return url.toString();
  },

  log(...args)   { if (this.DEBUG_MODE) console.log('[Journal]', ...args); },
  warn(...args)  { if (this.DEBUG_MODE) console.warn('[Journal]', ...args); },
  error(...args) { console.error('[Journal]', ...args); }
};

window.Config = Config;