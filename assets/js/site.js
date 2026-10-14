/* OffPage SEO Expert — site scripts */
(function () {
  // Mobile navigation
  var burger = document.querySelector('.burger');
  var links = document.querySelector('.nav-links');
  if (burger && links) {
    burger.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.innerHTML = open ? '<i class="fas fa-xmark"></i>' : '<i class="fas fa-bars"></i>';
      document.body.style.overflow = open ? 'hidden' : '';
    });
  }
  document.querySelectorAll('.has-menu > .nav-link').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      if (window.innerWidth <= 1200) {
        e.preventDefault();
        var item = btn.parentElement;
        var isOpen = item.classList.toggle('open');
        btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      }
    });
  });

  // Reveal on scroll
  var els = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -60px 0px' });
    els.forEach(function (el) { io.observe(el); });
  } else {
    els.forEach(function (el) { el.classList.add('in'); });
  }

  // Contact form success message (Web3Forms redirect)
  if (location.search.indexOf('sent=1') > -1) {
    var ok = document.querySelector('.form-success');
    if (ok) { ok.classList.add('show'); ok.scrollIntoView({ block: 'center' }); }
  }

  // Portfolio tabs
  document.querySelectorAll('[data-tabs]').forEach(function (group) {
    var tabs = group.querySelectorAll('.tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        var target = tab.getAttribute('data-target');
        document.querySelectorAll('[data-panel]').forEach(function (p) {
          p.hidden = target !== 'all' && p.getAttribute('data-panel') !== target;
        });
      });
    });
  });

  // Inventory tables: search, filter, sort
  var table = document.querySelector('.inv-table');
  if (!table) return;
  var tbody = table.tBodies[0];
  var rows = Array.prototype.slice.call(tbody.rows);
  var search = document.querySelector('#invSearch');
  var selects = document.querySelectorAll('.inv-select[data-col]');
  var countEl = document.querySelector('#invCount');
  var empty = document.querySelector('.inv-empty');

  // Fill select options from table data
  selects.forEach(function (sel) {
    var col = +sel.getAttribute('data-col');
    var values = {};
    rows.forEach(function (r) {
      var v = (r.cells[col] && r.cells[col].textContent.trim()) || '';
      if (v) values[v] = (values[v] || 0) + 1;
    });
    Object.keys(values).sort().forEach(function (v) {
      var o = document.createElement('option');
      o.value = v; o.textContent = v + ' (' + values[v] + ')';
      sel.appendChild(o);
    });
    sel.addEventListener('change', apply);
  });

  function apply() {
    var q = (search && search.value || '').toLowerCase().trim();
    var shown = 0;
    rows.forEach(function (r) {
      var ok = !q || r.textContent.toLowerCase().indexOf(q) > -1;
      selects.forEach(function (sel) {
        var v = sel.value;
        if (ok && v) ok = r.cells[+sel.getAttribute('data-col')].textContent.trim() === v;
      });
      r.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    if (countEl) countEl.textContent = shown.toLocaleString();
    if (empty) empty.style.display = shown ? 'none' : 'block';
  }
  if (search) search.addEventListener('input', apply);
  apply();

  function num(text) {
    var t = text.replace(/,/g, '').trim().toUpperCase();
    var m = t.match(/([\d.]+)\s*([KMB]?)/);
    if (!m) return -1;
    var n = parseFloat(m[1]);
    if (m[2] === 'K') n *= 1e3; else if (m[2] === 'M') n *= 1e6; else if (m[2] === 'B') n *= 1e9;
    return n;
  }
  table.querySelectorAll('th.sortable').forEach(function (th) {
    th.addEventListener('click', function () {
      var col = th.cellIndex;
      var dir = th.classList.contains('desc') ? 'asc' : 'desc';
      table.querySelectorAll('th.sortable').forEach(function (h) { h.classList.remove('asc', 'desc'); });
      th.classList.add(dir);
      var isText = th.hasAttribute('data-text');
      rows.sort(function (a, b) {
        var x = a.cells[col].textContent, y = b.cells[col].textContent;
        var r = isText ? x.localeCompare(y) : num(x) - num(y);
        return dir === 'asc' ? r : -r;
      });
      rows.forEach(function (r) { tbody.appendChild(r); });
    });
  });
})();
