/* ==========================================================================
   SAVANCE UI v1.1 — zachowanie komponentów (zakładki, modal, toast, tabela, upload)
   Wymaga: savance.css. Bez zależności. Inicjalizuje się sam po załadowaniu DOM.

   ZAKŁADKI (w treści i w sidebarze):
     <div class="sv-tabs" data-sv-tabs role="tablist">
       <button class="sv-tab is-active" data-sv-tab="panel-a">A</button>
       <button class="sv-tab" data-sv-tab="panel-b">B</button>
     </div>
     <section class="sv-tabpanel" id="panel-a">…</section>
     <section class="sv-tabpanel" id="panel-b" hidden>…</section>
     Sidebar: <nav data-sv-tabs> z <a class="sv-nav__item" data-sv-tab="page-x">.
     Zdarzenie: document 'sv:tabchange' → e.detail = { id, trigger }.

   MODAL (natywny <dialog class="sv-modal">):
     <button data-sv-open="modal-id">Otwórz</button>
     <dialog class="sv-modal" id="modal-id"> … <button data-sv-close>Zamknij</button></dialog>
     JS: SavanceUI.modal.open('modal-id') / .close('modal-id')
         SavanceUI.modal.show({ title, sub, body: html|Node, size: 'sm'|'lg'|'xl',
                                actions: [{ label, variant: 'primary'|'cream'|'danger'|'', onClick, close: true }] })
         → tworzy modal dynamicznie (np. szczegóły wiersza tabeli), usuwa go po zamknięciu.
     Wiersz tabeli otwierający modal: <tr data-sv-open="modal-id">.

   TOAST:     SavanceUI.toast('Zapisano', 'success' | 'warning' | 'danger' | 'info')
   TABELA:    <th data-sort="num|text|date"> → sortowanie po kliknięciu (automatycznie)
   UPLOAD:    SavanceUI.dropzone(element, function (files) { … })
   ========================================================================== */
(function (global) {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ---------- Zakładki ---------- */
  function activateTab(trigger) {
    var group = trigger.closest('[data-sv-tabs]');
    if (!group) return;
    $all('[data-sv-tab]', group).forEach(function (t) {
      var on = t === trigger, panel = document.getElementById(t.getAttribute('data-sv-tab'));
      t.classList.toggle('is-active', on);
      if (t.getAttribute('role') === 'tab' || t.classList.contains('sv-tab')) t.setAttribute('aria-selected', on ? 'true' : 'false');
      if (t.classList.contains('sv-nav__item')) { if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); }
      if (panel) panel.hidden = !on;
    });
    document.dispatchEvent(new CustomEvent('sv:tabchange', { detail: { id: trigger.getAttribute('data-sv-tab'), trigger: trigger } }));
  }
  function initTabs(root) {
    $all('[data-sv-tabs]', root).forEach(function (group) {
      var tabs = $all('[data-sv-tab]', group);
      tabs.forEach(function (t) { if (t.classList.contains('sv-tab')) t.setAttribute('role', 'tab'); });
      var active = tabs.filter(function (t) { return t.classList.contains('is-active'); })[0] || tabs[0];
      if (active) activateTab(active);
      group.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var i = tabs.indexOf(document.activeElement); if (i < 0) return;
        var next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus(); activateTab(next); e.preventDefault();
      });
    });
  }

  /* ---------- Modal ---------- */
  var modal = {
    open: function (id) {
      var d = typeof id === 'string' ? document.getElementById(id) : id;
      if (!d) return;
      if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
      return d;
    },
    close: function (id) {
      var d = typeof id === 'string' ? document.getElementById(id) : id;
      if (!d) return;
      if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
    },
    show: function (o) {
      var d = document.createElement('dialog');
      d.className = 'sv-modal' + (o.size ? ' sv-modal--' + o.size : '');
      d.innerHTML =
        '<header class="sv-modal__head"><div><h2 class="sv-modal__title"></h2>' + (o.sub ? '<p class="sv-modal__sub"></p>' : '') + '</div>' +
        '<button class="sv-btn sv-icon-btn sv-modal__close" type="button" data-sv-close aria-label="Zamknij">✕</button></header>' +
        '<div class="sv-modal__body"></div>' + (o.actions && o.actions.length ? '<footer class="sv-modal__foot"></footer>' : '');
      $('.sv-modal__title', d).textContent = o.title || '';
      if (o.sub) $('.sv-modal__sub', d).textContent = o.sub;
      var body = $('.sv-modal__body', d);
      if (typeof o.body === 'string') body.innerHTML = o.body; else if (o.body) body.appendChild(o.body);
      (o.actions || []).forEach(function (a) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'sv-btn' + (a.variant ? ' sv-btn--' + a.variant : ''); b.textContent = a.label;
        b.addEventListener('click', function () { if (a.onClick) a.onClick(d); if (a.close !== false) modal.close(d); });
        $('.sv-modal__foot', d).appendChild(b);
      });
      (document.querySelector('.sv-body') || document.body).appendChild(d);
      d.addEventListener('close', function () { d.remove(); if (o.onClose) o.onClose(); });
      modal.open(d);
      if (o.onOpen) o.onOpen(d, body);
      return d;
    }
  };
  document.addEventListener('click', function (e) {
    var opener = e.target.closest('[data-sv-open]');
    if (opener) { e.preventDefault(); modal.open(opener.getAttribute('data-sv-open')); return; }
    var closer = e.target.closest('[data-sv-close]');
    if (closer) { var d = closer.closest('dialog'); if (d) modal.close(d); return; }
    var tab = e.target.closest('[data-sv-tab]');
    if (tab && tab.closest('[data-sv-tabs]')) { e.preventDefault(); activateTab(tab); return; }
    // klik w tło modala zamyka go
    if (e.target.tagName === 'DIALOG' && e.target.classList.contains('sv-modal')) {
      var r = e.target.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) modal.close(e.target);
    }
  });

  /* ---------- Toast ---------- */
  function toast(msg, type, ms) {
    var box = $('.sv-toasts');
    if (!box) { box = document.createElement('div'); box.className = 'sv-toasts'; box.setAttribute('aria-live', 'polite'); (document.querySelector('.sv-body') || document.body).appendChild(box); }
    var t = document.createElement('div');
    t.className = 'sv-toast' + (type ? ' sv-toast--' + type : ''); t.textContent = msg;
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 3200);
  }

  /* ---------- Sortowanie tabel ---------- */
  function parseVal(txt, type) {
    txt = (txt || '').trim();
    if (type === 'num') { var n = parseFloat(txt.replace(/\s| /g, '').replace(/[^0-9,.\-]/g, '').replace(',', '.')); return isNaN(n) ? -Infinity : n; }
    if (type === 'date') { var t = Date.parse(txt.replace(/(\d{2})\.(\d{2})\.(\d{4})/, '$3-$2-$1')); return isNaN(t) ? 0 : t; }
    return txt.toLowerCase();
  }
  function initTables(root) {
    $all('.sv-table th[data-sort]', root).forEach(function (th) {
      if (th._svSort) return; th._svSort = true; th.tabIndex = 0;
      function sort() {
        var table = th.closest('table'), tbody = table.tBodies[0], idx = Array.prototype.indexOf.call(th.parentNode.children, th);
        var dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending', type = th.getAttribute('data-sort');
        $all('th[aria-sort]', table).forEach(function (o) { o.removeAttribute('aria-sort'); });
        th.setAttribute('aria-sort', dir);
        var rows = Array.prototype.slice.call(tbody.rows);
        rows.sort(function (a, b) {
          var x = parseVal(a.cells[idx] && a.cells[idx].textContent, type), y = parseVal(b.cells[idx] && b.cells[idx].textContent, type);
          return (x > y ? 1 : x < y ? -1 : 0) * (dir === 'ascending' ? 1 : -1);
        });
        rows.forEach(function (r) { tbody.appendChild(r); });
      }
      th.addEventListener('click', sort);
      th.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); } });
    });
  }

  /* ---------- Upload (dropzone) ---------- */
  function dropzone(zone, onFiles) {
    var input = $('input[type="file"]', zone);
    ['dragenter', 'dragover'].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('is-dragover'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('is-dragover'); }); });
    zone.addEventListener('drop', function (e) { if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files); });
    if (input) input.addEventListener('change', function () { if (input.files.length) onFiles(input.files); input.value = ''; });
  }

  function init(root) { initTabs(root); initTables(root); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(document); });
  else init(document);

  global.SavanceUI = { init: init, tabs: { activate: activateTab }, modal: modal, toast: toast, dropzone: dropzone, initTables: initTables };
})(window);
