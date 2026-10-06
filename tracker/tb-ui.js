/* ==========================================================================
   TB UI v1.0 — zachowanie interfejsu trackera. Bez zależności.

   TBUI.init(root)                     — zakładki i delegaty (woła się raz z boot)
   TBUI.tabs.activate(triggerEl)
   TBUI.modal.open(id|el) / .close(id|el)
   TBUI.modal.show({title, sub, body, size, actions, onOpen, onClose}) → dialogEl
   TBUI.confirm({title, text, confirmLabel, tone}) → Promise<boolean>
   TBUI.drawer.show({title, sub, body, actions, onOpen, onClose}) → {el, close}
   TBUI.toast(msg, tone, ms)           — tone: '' | 'success' | 'warning' | 'danger'
   TBUI.dropzone(zoneEl, onFiles)
   TBUI.menu.provider(name, fn)        — fn(event, hostEl) → items | null
   TBUI.menu.open(x, y, items)
   TBUI.menu.close()

   Zakładki są deklaratywne: [data-tb-tabs] jako grupa, [data-tb-tab="idPanelu"]
   jako przełącznik. Delegat klików siedzi na document, więc zakładki dodane
   dynamicznie działają bez ponownej inicjalizacji.

   Menu kontekstowe: JEDEN listener contextmenu na document. preventDefault
   leci WYŁĄCZNIE wewnątrz [data-tb-ctx], więc poza tabelą użytkownik ma
   normalne menu przeglądarki.
   ========================================================================== */
(function (global) {
  'use strict';

  var doc = document;

  function $(sel, root) { return (root || doc).querySelector(sel); }
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function bodyRoot() { return $('.tb-body') || doc.body; }

  /* ------------------------------------------------------------ zakładki */

  function activateTab(trigger) {
    if (!trigger) return;
    var group = trigger.closest('[data-tb-tabs]');
    if (!group) return;
    var id = trigger.getAttribute('data-tb-tab');
    var all = group.querySelectorAll('[data-tb-tab]');
    for (var i = 0; i < all.length; i++) {
      var t = all[i], on = t === trigger;
      t.classList.toggle('is-active', on);
      t.classList.toggle('active', on);          // .tab.active z motywów
      if (t.classList.contains('tab') || t.getAttribute('role') === 'tab') {
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      }
      if (t.closest('.tb-nav')) {
        if (on) t.setAttribute('aria-current', 'page');
        else t.removeAttribute('aria-current');
      }
      var panel = doc.getElementById(t.getAttribute('data-tb-tab'));
      if (panel) panel.hidden = !on;
    }
    doc.dispatchEvent(new CustomEvent('tb:tabchange', { detail: { id: id, trigger: trigger } }));
  }

  function initTabs(root) {
    var groups = (root || doc).querySelectorAll('[data-tb-tabs]');
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      if (group._tbTabs) continue;            // idempotentne
      group._tbTabs = true;
      var tabs = group.querySelectorAll('[data-tb-tab]');
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].classList.contains('tab')) tabs[i].setAttribute('role', 'tab');
      }
      group.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var list = [].slice.call(this.querySelectorAll('[data-tb-tab]'));
        var cur = list.indexOf(doc.activeElement);
        if (cur < 0) return;
        e.preventDefault();
        var next = list[(cur + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length];
        next.focus();
        activateTab(next);
      });
      var active = group.querySelector('[data-tb-tab].is-active') || tabs[0];
      if (active) activateTab(active);
    }
  }

  doc.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-tb-tab]') : null;
    if (t) { e.preventDefault(); activateTab(t); }
  });

  /* ------------------------------------------------------------ modal */

  function resolveDialog(x) {
    return typeof x === 'string' ? doc.getElementById(x) : x;
  }
  function openModal(x) {
    var d = resolveDialog(x);
    if (!d) return null;
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
    return d;
  }
  function closeModal(x) {
    var d = resolveDialog(x);
    if (!d) return;
    if (d.close) d.close(); else d.removeAttribute('open');
  }

  doc.addEventListener('click', function (e) {
    var o = e.target.closest ? e.target.closest('[data-tb-open]') : null;
    if (o) { e.preventDefault(); openModal(o.getAttribute('data-tb-open')); return; }
    var c = e.target.closest ? e.target.closest('[data-tb-close]') : null;
    if (c) {
      e.preventDefault();
      var d = c.closest('dialog');
      if (d) closeModal(d);
      else if (c.closest('.tb-drawer')) closeDrawer();
      return;
    }
    // klik w tło dialogu zamyka
    if (e.target.tagName === 'DIALOG' && e.target.classList.contains('tb-modal')) {
      var r = e.target.getBoundingClientRect();
      var inside = e.clientX >= r.left && e.clientX <= r.right &&
                   e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) closeModal(e.target);
    }
  });

  function buildActions(container, actions, closeFn) {
    (actions || []).forEach(function (a) {
      var b = el('button', 'btn' + (a.variant ? ' btn-' + a.variant : ''), a.label);
      b.type = 'button';
      if (a.autofocus) b.setAttribute('data-tb-autofocus', '');
      b.addEventListener('click', function () {
        var keep = a.onClick && a.onClick() === false;
        if (a.close !== false && !keep) closeFn();
      });
      container.appendChild(b);
    });
  }

  function showModal(o) {
    o = o || {};
    var d = el('dialog', 'tb-modal' + (o.size ? ' tb-modal-' + o.size : ''));
    var head = el('div', 'tb-modal-head');
    var titles = el('div');
    titles.appendChild(el('h2', 'tb-modal-title', o.title || ''));
    if (o.sub) titles.appendChild(el('p', 'tb-modal-sub', o.sub));
    head.appendChild(titles);
    var x = el('button', 'tb-modal-close', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.setAttribute('data-tb-close', '');
    head.appendChild(x);

    var body = el('div', 'tb-modal-body');
    if (typeof o.body === 'string') body.innerHTML = o.body;
    else if (o.body) body.appendChild(o.body);

    d.appendChild(head);
    d.appendChild(body);
    if (o.actions && o.actions.length) {
      var foot = el('div', 'tb-modal-foot');
      buildActions(foot, o.actions, function () { closeModal(d); });
      d.appendChild(foot);
    }
    bodyRoot().appendChild(d);
    d.addEventListener('close', function () {
      if (o.onClose) o.onClose();
      d.remove();
    });
    openModal(d);
    if (o.onOpen) o.onOpen(d, body);
    var af = d.querySelector('[data-tb-autofocus]');
    if (af) af.focus();
    return d;
  }

  /* Potwierdzenie. Zawsze z nazwą operacji — używane przy usuwaniu
     i akcjach masowych. */
  function confirmDialog(o) {
    o = o || {};
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) { if (!done) { done = true; resolve(v); } }
      showModal({
        size: 'sm',
        title: o.title || 'Confirm',
        body: '<p style="margin:0;font-size:13.5px;color:var(--text-2)">' +
              escapeHtml(o.text || '') + '</p>',
        actions: [
          { label: o.cancelLabel || 'Cancel', variant: 'ghost', onClick: function () { finish(false); } },
          {
            label: o.confirmLabel || 'Confirm',
            variant: o.tone === 'danger' ? 'secondary' : 'primary',
            autofocus: true,
            onClick: function () { finish(true); }
          }
        ],
        onClose: function () { finish(false); }
      });
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ------------------------------------------------------------ drawer */

  var drawerState = null;

  function trapFocus(container) {
    function onKey(e) {
      if (e.key !== 'Tab') return;
      var f = container.querySelectorAll(
        'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),' +
        'textarea:not(:disabled),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    container.addEventListener('keydown', onKey);
    return function () { container.removeEventListener('keydown', onKey); };
  }

  function closeDrawer() {
    if (!drawerState) return;
    var st = drawerState;
    drawerState = null;
    st.el.classList.remove('is-open');
    st.backdrop.classList.remove('is-open');
    st.untrap();
    doc.removeEventListener('keydown', st.onEsc);
    if (st.onClose) st.onClose();
    setTimeout(function () {
      st.el.remove();
      st.backdrop.remove();
      if (st.restore && st.restore.isConnected) st.restore.focus();
    }, 190);
  }

  function showDrawer(o) {
    o = o || {};
    closeDrawer();
    var backdrop = el('div', 'tb-drawer-backdrop');
    var d = el('aside', 'tb-drawer');
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('aria-label', o.title || 'Details');

    var head = el('div', 'tb-drawer-head');
    var titles = el('div');
    titles.appendChild(el('h2', 'tb-modal-title', o.title || ''));
    if (o.sub) titles.appendChild(el('p', 'tb-modal-sub', o.sub));
    head.appendChild(titles);
    var x = el('button', 'tb-modal-close', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.setAttribute('data-tb-close', '');
    head.appendChild(x);

    var body = el('div', 'tb-drawer-body');
    if (typeof o.body === 'string') body.innerHTML = o.body;
    else if (o.body) body.appendChild(o.body);

    d.appendChild(head);
    d.appendChild(body);
    if (o.actions && o.actions.length) {
      var foot = el('div', 'tb-drawer-foot');
      buildActions(foot, o.actions, closeDrawer);
      d.appendChild(foot);
    }

    var root = bodyRoot();
    root.appendChild(backdrop);
    root.appendChild(d);
    backdrop.addEventListener('click', closeDrawer);

    function onEsc(e) { if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); } }
    doc.addEventListener('keydown', onEsc);

    drawerState = {
      el: d, backdrop: backdrop, onClose: o.onClose, onEsc: onEsc,
      untrap: trapFocus(d), restore: doc.activeElement
    };

    requestAnimationFrame(function () {
      backdrop.classList.add('is-open');
      d.classList.add('is-open');
      var af = d.querySelector('[data-tb-autofocus]') ||
               d.querySelector('input,select,textarea,button');
      if (af) af.focus();
    });
    if (o.onOpen) o.onOpen(d, body);
    return { el: d, body: body, close: closeDrawer };
  }

  /* ------------------------------------------------------------ toast */

  var toastEl = null, toastTimer = null;

  function toast(msg, tone, ms) {
    if (!toastEl) {
      toastEl = el('div', 'toast');
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      bodyRoot().appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (tone ? ' tb-toast-' + tone : '');
    // reflow, żeby kolejny toast animował się od nowa
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
    }, ms || 3000);
  }

  /* ------------------------------------------------------------ dropzone */

  function dropzone(zone, onFiles) {
    if (!zone) return;
    var input = zone.querySelector('input[type="file"]');
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) {
        e.preventDefault();
        zone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function () { zone.classList.remove('is-dragover'); });
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
    });
    if (input) {
      input.addEventListener('change', function () {
        if (input.files.length) onFiles(input.files);
        input.value = '';                    // ten sam plik da się wybrać ponownie
      });
    }
  }

  /* ------------------------------------------------------------ menu kontekstowe */

  var providers = {};
  var menuEl = null, menuRestore = null;

  function closeMenu() {
    if (!menuEl) return;
    menuEl.remove();
    menuEl = null;
    doc.removeEventListener('keydown', onMenuKey, true);
    if (menuRestore && menuRestore.isConnected) menuRestore.focus();
    menuRestore = null;
  }

  function menuItems() {
    return menuEl ? [].slice.call(menuEl.querySelectorAll('.tb-menu-item:not(:disabled)')) : [];
  }

  function onMenuKey(e) {
    if (!menuEl) return;
    var items = menuItems();
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      if (!items.length) return;
      var cur = items.indexOf(doc.activeElement);
      var next = (cur + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[cur < 0 ? 0 : next].focus();
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); }
  }

  function openMenu(x, y, items) {
    closeMenu();
    if (!items || !items.length) return;
    menuRestore = doc.activeElement;
    var m = el('div', 'tb-menu');
    m.setAttribute('role', 'menu');
    items.forEach(function (it) {
      if (it.sep) { m.appendChild(el('div', 'tb-menu-sep')); return; }
      if (it.head) { m.appendChild(el('div', 'tb-menu-head', it.head)); return; }
      var b = el('button', 'tb-menu-item' + (it.danger ? ' tb-menu-item-danger' : ''));
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      if (it.disabled) b.disabled = true;
      if (it.icon) b.appendChild(el('i', null, it.icon));
      b.appendChild(doc.createTextNode(it.label));
      if (it.kbd) b.appendChild(el('kbd', null, it.kbd));
      b.addEventListener('click', function () {
        closeMenu();
        if (it.onClick) it.onClick();
      });
      m.appendChild(b);
    });
    m.style.visibility = 'hidden';
    bodyRoot().appendChild(m);
    menuEl = m;

    // pozycjonowanie z odbiciem przy krawędzi okna
    var r = m.getBoundingClientRect();
    var left = x, top = y;
    if (left + r.width > global.innerWidth - 8) left = Math.max(8, x - r.width);
    if (top + r.height > global.innerHeight - 8) top = Math.max(8, y - r.height);
    m.style.left = left + 'px';
    m.style.top = top + 'px';
    m.style.visibility = '';

    doc.addEventListener('keydown', onMenuKey, true);
    var first = menuItems()[0];
    if (first) first.focus();
  }

  doc.addEventListener('contextmenu', function (e) {
    var host = e.target.closest ? e.target.closest('[data-tb-ctx]') : null;
    if (!host) return;                       // poza strefą — normalne menu przeglądarki
    var fn = providers[host.getAttribute('data-tb-ctx')];
    if (!fn) return;
    var items = fn(e, host);
    if (!items || !items.length) return;
    e.preventDefault();
    openMenu(e.clientX, e.clientY, items);
  });

  // klawiatura: Shift+F10 oraz klawisz menu kontekstowego
  doc.addEventListener('keydown', function (e) {
    var isMenuKey = e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');
    if (!isMenuKey) return;
    var host = doc.activeElement && doc.activeElement.closest
      ? doc.activeElement.closest('[data-tb-ctx]') : null;
    if (!host) return;
    var fn = providers[host.getAttribute('data-tb-ctx')];
    if (!fn) return;
    var anchor = doc.activeElement.getBoundingClientRect();
    var items = fn({ target: doc.activeElement, keyboard: true }, host);
    if (!items || !items.length) return;
    e.preventDefault();
    openMenu(Math.round(anchor.left + 12), Math.round(anchor.bottom), items);
  });

  doc.addEventListener('mousedown', function (e) {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
  });
  global.addEventListener('blur', closeMenu);
  global.addEventListener('resize', closeMenu);
  doc.addEventListener('scroll', closeMenu, true);

  /* ------------------------------------------------------------ init */

  function init(root) { initTabs(root || doc); }

  global.TBUI = {
    init: init,
    tabs: { activate: activateTab },
    modal: { open: openModal, close: closeModal, show: showModal },
    confirm: confirmDialog,
    drawer: { show: showDrawer, close: closeDrawer },
    toast: toast,
    dropzone: dropzone,
    menu: { provider: function (n, fn) { providers[n] = fn; }, open: openMenu, close: closeMenu },
    esc: escapeHtml
  };
})(window);
