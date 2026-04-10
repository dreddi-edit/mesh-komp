/* MeshBus — Lightweight event bus for feature modules */
(function(){
  const listeners = {};
  window.MeshBus = {
    on(event, fn) {
      (listeners[event] || (listeners[event] = [])).push(fn);
      return () => { listeners[event] = (listeners[event] || []).filter(f => f !== fn); };
    },
    emit(event, data) {
      (listeners[event] || []).forEach(fn => { try { fn(data); } catch(e) { console.error('[MeshBus]', event, e); } });
    },
    once(event, fn) {
      const off = window.MeshBus.on(event, (data) => { off(); fn(data); });
    }
  };

  /* Expose core state and helpers for feature modules */
  window.MeshState = null;   // set by app-workspace.js
  window.MeshAPI = null;      // set by app-workspace.js
  window.MeshEditor = null;   // set by app-workspace.js
  window.MeshActions = null;  // set by app-workspace.js
})();
