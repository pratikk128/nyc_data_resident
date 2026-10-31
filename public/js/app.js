/*
 * Ask NYC Data — landing page behavior (loaded by src/pages/index.astro).
 * The sidebar and cards are rendered at build time from src/data/dashboards.js;
 * this script filters them by category and by audience (the For NYC Residents /
 * For NYC Businesses switch), keeps both in the URL (?category=<slug>&for=business)
 * so a view can be shared, remembers the audience for next time, and handles
 * the collapsible sidebar.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "anycd-sidebar";
  var AUDIENCE_KEY = "anycd-audience";
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
  var emptyText = document.getElementById("empty-text");
  var audienceToggle = document.getElementById("audience-toggle");

  var links = Array.prototype.slice.call(categoryList.querySelectorAll(".category-btn"));
  var cards = Array.prototype.slice.call(cardGrid.children);
  var heroAddress = document.getElementById("hero-address");
  var audienceBtns = Array.prototype.slice.call(audienceToggle.querySelectorAll(".audience-btn"));
  var DEFAULT_AUDIENCE = audienceBtns[0].getAttribute("data-audience");
  var audience = DEFAULT_AUDIENCE;

  function plural(n) { return n + (n === 1 ? " dashboard" : " dashboards"); }

  function isAudience(id) {
    return audienceBtns.some(function (btn) { return btn.getAttribute("data-audience") === id; });
  }

  function forAudience(card) {
    return (" " + card.getAttribute("data-audience") + " ").indexOf(" " + audience + " ") !== -1;
  }

  // Landing URL for a category slug ("" = all) under the current audience.
  function urlFor(slug) {
    var params = new URLSearchParams();
    if (slug) params.set("category", slug);
    if (audience !== DEFAULT_AUDIENCE) params.set("for", audience);
    var query = params.toString();
    return "/" + (query ? "?" + query : "");
  }

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

  // Put a remembered audience in the URL too, so a copied link shows the same view.
  function syncURL() {
    var url = urlFor(slugFromURL());
    if (url !== window.location.pathname + window.location.search) history.replaceState(null, "", url);
  }

  // ?for= wins (shared links), then the saved choice, then the default.
  function audienceFromURL() {
    var id = new URLSearchParams(window.location.search).get("for");
    if (isAudience(id)) return id;
    try { id = localStorage.getItem(AUDIENCE_KEY); } catch (e) { id = null; }
    return isAudience(id) ? id : DEFAULT_AUDIENCE;
  }

  // ---------- Filtering ----------
  function applyAudience(id) {
    audience = id;
    // The address report is about where you live, so it's for residents only.
    if (heroAddress) heroAddress.hidden = id !== DEFAULT_AUDIENCE;
    root.classList.toggle("not-default-audience", id !== DEFAULT_AUDIENCE);
    audienceBtns.forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.getAttribute("data-audience") === id));
    });

    // Sidebar counts and links follow the audience.
    links.forEach(function (link) {
      var slug = link.getAttribute("data-category");
      var n = cards.filter(function (card) {
        return forAudience(card) && (slug === "" || card.getAttribute("data-category") === slug);
      }).length;
      link.querySelector(".category-count").textContent = n;
      link.setAttribute("aria-label", link.querySelector(".category-label").textContent + ", " + plural(n));
      link.setAttribute("href", urlFor(slug));
      link.setAttribute("data-count", n);
    });
  }

  // Hide categories with no dashboards for this audience, except the one being
  // viewed (a shared ?category= link), so its "Coming soon" still has a home.
  function hideEmptyCategories(active) {
    links.forEach(function (link) {
      link.parentNode.hidden = link !== active && link.getAttribute("data-category") !== "" &&
        link.getAttribute("data-count") === "0";
    });
  }

  function applyCategory(slug) {
    var active = linkFor(slug);
    links.forEach(function (link) {
      if (link === active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    hideEmptyCategories(active);

    var shown = 0;
    cards.forEach(function (card) {
      var match = forAudience(card) && (slug === "" || card.getAttribute("data-category") === slug);
      card.hidden = !match;
      if (match) shown++;
    });

    resultsTitle.textContent = active.querySelector(".category-label").textContent;
    resultsCount.textContent = plural(shown);
    emptyText.textContent = audience === DEFAULT_AUDIENCE
      ? "No dashboards in this category yet. Coming soon."
      : "No dashboards for businesses in this category yet. Coming soon.";
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

  audienceToggle.addEventListener("click", function (e) {
    var btn = e.target.closest(".audience-btn");
    if (!btn) return;
    var id = btn.getAttribute("data-audience");
    if (id === audience) return;
    try { localStorage.setItem(AUDIENCE_KEY, id); } catch (err) {}
    applyAudience(id);
    // A preference, not a navigation: rewrite the URL so Back doesn't flip it.
    var slug = slugFromURL();
    history.replaceState(null, "", urlFor(slug));
    applyCategory(slug);
  });

  window.addEventListener("popstate", function () {
    applyAudience(audienceFromURL());
    syncURL();
    applyCategory(slugFromURL());
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
    var current = categoryList.querySelector('[aria-current="page"]') || categoryList.querySelector(".category-btn");
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
  applyAudience(audienceFromURL());
  syncURL();
  applyCategory(slugFromURL());
  syncToggle();
})();
