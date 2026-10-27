/*
 * Ask NYC Data — landing page behavior (loaded by src/pages/index.astro).
 * Renders the category sidebar and dashboard cards from `dashboards`
 * (js/dashboards.js), handles filtering, and the collapsible sidebar.
 */
(function () {
  "use strict";

  var ALL = "All Categories";
  var STORAGE_KEY = "anycd-sidebar";
  var MOBILE_QUERY = window.matchMedia("(max-width: 767px)");

  // Simple line icons (24×24, stroke-based). Keys match category names.
  var ICONS = {
    "All Categories": '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    "Business": '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
    "City Government": '<path d="M3 21h18M4 10h16M12 3l8 4H4l8-4zM6 10v8M10 10v8M14 10v8M18 10v8"/>',
    "Education": '<path d="M2 9l10-5 10 5-10 5L2 9z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v6"/>',
    "Environment": '<path d="M5 19c0-9 5-14 15-15-1 10-6 15-15 15z"/><path d="M5 19l7-7"/>',
    "Health": '<path d="M20.4 5.6a5 5 0 0 0-7.1 0L12 6.9l-1.3-1.3a5 5 0 0 0-7.1 7.1L12 21l8.4-8.3a5 5 0 0 0 0-7.1z"/><path d="M7 12h2.5l1.5-2.5 2 5 1.5-2.5H17"/>',
    "Housing & Development": '<path d="M4 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17M14 9h5a1 1 0 0 1 1 1v11M2 21h20M8 7h2M8 11h2M8 15h2M17 13h0M17 17h0"/>',
    "Public Safety": '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>',
    "Recreation": '<path d="M12 3l5 8h-3l4 6H6l4-6H7l5-8zM12 17v4"/>',
    "Social Services": '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.1A5 5 0 0 1 21.5 19"/>',
    "Transportation": '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 10h14M9 21l-2-4M15 21l2-4"/><circle cx="9" cy="13.5" r="0.6"/><circle cx="15" cy="13.5" r="0.6"/>'
  };

  var CATEGORIES = Object.keys(ICONS); // Display order is the key order above.

  // Pastel color per category (styled via [data-tone] in landing.css).
  var TONES = {
    "All Categories": "blue",
    "Business": "yellow",
    "City Government": "blue",
    "Education": "purple",
    "Environment": "teal",
    "Health": "green",
    "Housing & Development": "orange",
    "Public Safety": "red",
    "Recreation": "lime",
    "Social Services": "pink",
    "Transportation": "yellow"
  };

  function tone(name) {
    return TONES[name] || "blue";
  }

  function icon(name, className) {
    return '<svg class="' + className + '" viewBox="0 0 24 24" aria-hidden="true">' +
      (ICONS[name] || ICONS[ALL]) + "</svg>";
  }

  function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function countFor(category) {
    if (category === ALL) return dashboards.length;
    return dashboards.filter(function (d) { return d.category === category; }).length;
  }

  // ---------- Elements ----------
  var root = document.documentElement;
  var menuToggle = document.getElementById("menu-toggle");
  var sidebar = document.getElementById("sidebar");
  var backdrop = document.getElementById("backdrop");
  var categoryList = document.getElementById("category-list");
  var resultsTitle = document.getElementById("results-title");
  var resultsCount = document.getElementById("results-count");
  var cardGrid = document.getElementById("card-grid");
  var emptyState = document.getElementById("empty-state");

  // ---------- Sidebar categories ----------
  function renderCategories() {
    categoryList.innerHTML = CATEGORIES.map(function (name) {
      var n = countFor(name);
      return '<li><button type="button" class="category-btn" data-category="' + escapeHTML(name) + '" data-tone="' + tone(name) + '"' +
        ' title="' + escapeHTML(name) + '"' +
        ' aria-label="' + escapeHTML(name) + ", " + n + (n === 1 ? " dashboard" : " dashboards") + '">' +
        icon(name, "category-icon") +
        '<span class="category-label">' + escapeHTML(name) + "</span>" +
        '<span class="category-count" aria-hidden="true">' + n + "</span>" +
        "</button></li>";
    }).join("");
  }

  function setActiveCategory(name) {
    var buttons = categoryList.querySelectorAll(".category-btn");
    Array.prototype.forEach.call(buttons, function (btn) {
      if (btn.getAttribute("data-category") === name) {
        btn.setAttribute("aria-current", "true");
      } else {
        btn.removeAttribute("aria-current");
      }
    });
  }

  // ---------- Dashboard cards ----------
  function renderCards(category) {
    var list = category === ALL ? dashboards : dashboards.filter(function (d) {
      return d.category === category;
    });

    resultsTitle.textContent = category;
    resultsCount.textContent = list.length + (list.length === 1 ? " dashboard" : " dashboards");

    cardGrid.innerHTML = list.map(function (d) {
      return '<li><a class="card" data-tone="' + tone(d.category) + '" href="' + escapeHTML(d.url || "#") + '">' +
        '<span class="card-icon">' + icon(d.category, "") + "</span>" +
        '<h3 class="card-title">' + escapeHTML(d.title) + "</h3>" +
        '<p class="card-desc">' + escapeHTML(d.description) + "</p>" +
        '<span class="card-footer">' +
          '<span class="tag">' + escapeHTML(d.category) + "</span>" +
          '<span class="card-link">Open dashboard <span aria-hidden="true">→</span></span>' +
        "</span>" +
        "</a></li>";
    }).join("");

    cardGrid.hidden = list.length === 0;
    emptyState.hidden = list.length !== 0;
  }

  function selectCategory(name) {
    setActiveCategory(name);
    renderCards(name);
  }

  categoryList.addEventListener("click", function (e) {
    var btn = e.target.closest(".category-btn");
    if (!btn) return;
    selectCategory(btn.getAttribute("data-category"));
    if (MOBILE_QUERY.matches) closeDrawer(false);
  });

  // ---------- Sidebar collapse (desktop) / drawer (mobile) ----------
  function savePref(collapsed) {
    try { localStorage.setItem(STORAGE_KEY, collapsed ? "collapsed" : "expanded"); } catch (e) {}
  }

  function syncToggle() {
    var expanded = MOBILE_QUERY.matches
      ? root.classList.contains("drawer-open")
      : !root.classList.contains("sidebar-collapsed");
    menuToggle.setAttribute("aria-expanded", String(expanded));
    menuToggle.setAttribute("aria-label", expanded ? "Hide categories" : "Show categories");
  }

  function openDrawer() {
    root.classList.add("drawer-open");
    backdrop.hidden = false;
    syncToggle();
    var current = categoryList.querySelector('[aria-current="true"]') || categoryList.querySelector("button");
    if (current) current.focus();
  }

  function closeDrawer(returnFocus) {
    root.classList.remove("drawer-open");
    backdrop.hidden = true;
    syncToggle();
    if (returnFocus) menuToggle.focus();
  }

  menuToggle.addEventListener("click", function () {
    if (MOBILE_QUERY.matches) {
      if (root.classList.contains("drawer-open")) closeDrawer(false);
      else openDrawer();
    } else {
      var collapsed = root.classList.toggle("sidebar-collapsed");
      savePref(collapsed);
      syncToggle();
    }
  });

  backdrop.addEventListener("click", function () { closeDrawer(true); });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && root.classList.contains("drawer-open")) closeDrawer(true);
  });

  // Leaving mobile width with the drawer open: reset to the desktop state.
  function onBreakpointChange() {
    if (!MOBILE_QUERY.matches) {
      root.classList.remove("drawer-open");
      backdrop.hidden = true;
    }
    syncToggle();
  }
  if (MOBILE_QUERY.addEventListener) MOBILE_QUERY.addEventListener("change", onBreakpointChange);
  else MOBILE_QUERY.addListener(onBreakpointChange);

  // Enable transitions only after first paint so the saved state doesn't animate in.
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { root.classList.add("is-ready"); });
  });

  // ---------- Init ----------
  renderCategories();
  selectCategory(ALL);
  syncToggle();
})();
