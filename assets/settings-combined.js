/* ============================================================
   MESH Settings — combined SPA router
   Handles: hash-based section routing, sidebar info toggling,
   and re-initialisation of guarded page-specific functions
   (initExpireSessions, initConnectAccounts, initAiSettingsPage,
   initBilling) that settings.js guards behind data-settings-page.

   Load order: <script defer src="settings.js"> THEN
               <script defer src="settings-combined.js">

   The defer guarantee means settings.js's script body executes
   before this file's script body, so all globals (initBilling etc.)
   are defined. HOWEVER, settings.js's DOMContentLoaded handler is
   async (it awaits preloadUserStoreCache), so applyStandaloneNavigation
   may fire AFTER our sync DOMContentLoaded handler runs. We therefore
   re-apply nav hrefs on window.load as well, which fires only after
   all async DOMContentLoaded handlers have fully resolved.
   ============================================================ */

(function () {
  'use strict';

  var SECTIONS = ['account', 'security', 'billing', 'api-keys', 'appearance', 'ai'];

  var SECTION_TITLES = {
    account:    'Settings: Account | Mesh',
    security:   'Settings: Security | Mesh',
    billing:    'Settings: Billing | Mesh',
    'api-keys': 'Settings: API Keys | Mesh',
    appearance: 'Settings: Appearance | Mesh',
    ai:         'Settings: AI & Models | Mesh',
  };

  /** Return the section ID indicated by the current URL hash, or 'account'. */
  function getCurrentSection() {
    var hash = window.location.hash.replace('#', '');
    return SECTIONS.indexOf(hash) !== -1 ? hash : 'account';
  }

  /**
   * Show the requested section and hide all others.
   * Updates body.dataset.settingsPage, nav active state, URL hash, and title.
   * Does NOT touch html.dataset.theme — theme is owned by settings.js and
   * the early inline script in <head>.
   */
  function showSection(sectionId) {
    document.body.dataset.settingsPage = sectionId;

    document.querySelectorAll('section[data-settings-section]').forEach(function (el) {
      el.hidden = el.dataset.settingsSection !== sectionId;
    });

    document.querySelectorAll('[data-settings-sidebar-info]').forEach(function (el) {
      el.hidden = el.dataset.settingsSidebarInfo !== sectionId;
    });

    document.querySelectorAll('.settings-nav a[data-settings-section]').forEach(function (a) {
      a.classList.toggle('active', a.dataset.settingsSection === sectionId);
    });

    history.replaceState(null, '', '#' + sectionId);
    document.title = SECTION_TITLES[sectionId] || 'Settings | Mesh';
  }

  /**
   * Fix nav link hrefs to use hash-based navigation.
   *
   * applyStandaloneNavigation() in settings.js (which runs async, after
   * preloadUserStoreCache resolves) overwrites nav hrefs to full page URLs
   * such as /settings?returnTo=/app#account. The click handlers added by
   * bindNavClicks() call e.preventDefault(), so navigation still works, but
   * we also fix the visible href for right-click / accessibility.
   *
   * This is called from both DOMContentLoaded and window.load to cover both
   * the case where our handler runs first (sync gap during async await) and
   * the case where applyStandaloneNavigation runs first.
   */
  function fixNavHrefs() {
    document.querySelectorAll('.settings-nav a[data-settings-section]').forEach(function (a) {
      a.setAttribute('href', '#' + a.dataset.settingsSection);
    });
  }

  /** Bind click handlers to sidebar nav items. */
  function bindNavClicks() {
    document.querySelectorAll('.settings-nav a[data-settings-section]').forEach(function (a) {
      // Use a flag to avoid double-binding if called multiple times.
      if (a.dataset.spabound) return;
      a.dataset.spabound = '1';
      a.addEventListener('click', function (e) {
        e.preventDefault();
        showSection(a.dataset.settingsSection);
      });
    });
  }

  /**
   * Run the guarded init functions from settings.js for sections that
   * settings.js skipped because body.dataset.settingsPage was "account"
   * at DOMContentLoaded time.
   *
   * Each guarded function checks: if (body.dataset.settingsPage !== "X") return;
   * Temporarily setting the page attribute makes the guard pass exactly once.
   * No double-binding occurs because each guard only allows one pass per value.
   *
   * Note: initConnectAccounts (account) and initAppearance (no guard) are
   * already handled by settings.js's own DOMContentLoaded — we skip them here.
   */
  function initAllSections() {
    var GUARDED = [
      ['security', 'initExpireSessions'],
      ['billing',  'initBilling'],
      ['ai',       'initAiSettingsPage'],
    ];

    GUARDED.forEach(function (pair) {
      var section = pair[0];
      var fnName  = pair[1];
      if (typeof window[fnName] !== 'function') return;
      document.body.dataset.settingsPage = section;
      window[fnName]();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    fixNavHrefs();
    bindNavClicks();
    initAllSections();

    // Re-apply theme in case initAllSections left settingsPage in a stale state.
    // applySettingsTheme is defined by settings.js (already executed as defer).
    if (typeof applySettingsTheme === 'function') applySettingsTheme();

    showSection(getCurrentSection());
  });

  // window.load fires after all async DOMContentLoaded handlers have resolved,
  // including settings.js's async handler which calls applyStandaloneNavigation.
  // Re-fix hrefs and re-bind any nav items that were added after DOMContentLoaded.
  window.addEventListener('load', function () {
    fixNavHrefs();
    bindNavClicks();
    // Ensure the displayed section matches the URL hash (no change if already correct).
    showSection(getCurrentSection());
  });

  window.addEventListener('hashchange', function () {
    showSection(getCurrentSection());
  });
})();
