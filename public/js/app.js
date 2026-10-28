/*
 * Ask NYC Data — landing page behavior (loaded by src/pages/index.astro).
 * The sidebar and cards are rendered at build time from src/data/dashboards.js;
 * this script filters them by category, keeps the filter in the URL
 * (?category=<slug>) so it can be shared and undone with Back, and handles
 * the collapsible sidebar.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "anycd-sidebar";
  var MOBILE_QUERY = window.matchMedia("(max-width: 767px)");

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

  var links = Array.prototype.slice.call(categoryList.querySelectorAll(".category-btn"));
  var cards = Array.prototype.slice.call(cardGrid.children);

  function linkFor(slug) {
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute("data-category") === slug) return links[i];
    }
    return null;
  }

  // The ?category= slug, or "" (All Categories) when missing or unknown.
  function slugFromURL() {
    var slug = new URLSearchParams(window.location.search).get("category") || "";
    return linkFor(slug) ? slug : "";
  }

  // ---------- Filtering ----------
  function applyCategory(slug) {
    var active = linkFor(slug);
    links.forEach(function (link) {
      if (link === active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });

    var shown = 0;
    cards.forEach(function (card) {
      var match = slug === "" || card.getAttribute("data-category") === slug;
      card.hidden = !match;
      if (match) shown++;
    });

    resultsTitle.textContent = active.querySelector(".category-label").textContent;
    resultsCount.textContent = shown + (shown === 1 ? " dashboard" : " dashboards");
    cardGrid.hidden = shown === 0;
    emptyState.hidden = shown !== 0;
  }

  categoryList.addEventListener("click", function (e) {
    var link = e.target.closest(".category-btn");
    // Let modified clicks (new tab, etc.) through to the real link.
    if (!link || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    var slug = link.getAttribute("data-category");
    if (slug !== slugFromURL()) history.pushState(null, "", link.getAttribute("href"));
    applyCategory(slug);
    if (MOBILE_QUERY.matches) closeDrawer(false);
  });

  window.addEventListener("popstate", function () { applyCategory(slugFromURL()); });

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
  applyCategory(slugFromURL());
  syncToggle();
})();
