/*
 * ============================================================
 *  ADD NEW DASHBOARDS HERE
 * ============================================================
 *
 * Every card on the landing page is rendered from this array at
 * build time (src/pages/index.astro). To add a dashboard, append
 * one object with these fields:
 *
 *   id          Unique, URL-friendly slug (e.g. "street-trees").
 *   title       Card title, in plain language.
 *   description One short sentence telling residents what they'll find.
 *   category    Must exactly match one of the names in CATEGORIES
 *               below (e.g. "Health", "Transportation").
 *   url         Where "Open dashboard →" goes.
 *   audience    Who it's for: ["resident"], ["business"], or both.
 *               Drives the For NYC Residents / For NYC Businesses
 *               switch in the header.
 *
 * The sidebar counts, category filter, and "N dashboards" heading
 * all update automatically. No other file needs to change.
 */

export const dashboards = [
  {
    id: "restaurant-inspections",
    title: "NYC Restaurant Inspections",
    description: "Explore health inspection grades, violations, and trends for restaurants across the five boroughs.",
    category: "Health",
    url: "/restaurant-inspections/",
    audience: ["resident", "business"]
  },
  {
    id: "311-complaints",
    title: "311 Complaints in My Neighborhood",
    description: "See what your neighbors are reporting: noise, sanitation, housing, and more.",
    category: "City Government",
    url: "/311-complaints/",
    audience: ["resident"]
  },
  {
    id: "city-payroll",
    title: "City Payroll Spending",
    description: "See what NYC pays its workforce: total payroll, overtime and other pay by agency and year.",
    category: "City Government",
    url: "/city-payroll/",
    audience: ["resident"]
  },
  {
    id: "drinking-water",
    title: "NYC Drinking Water Quality",
    description: "Is the water safe right now? Monthly test results for bacteria, chlorine and more, citywide and near you.",
    category: "Environment",
    url: "/drinking-water/",
    audience: ["resident"]
  },
  {
    id: "shop-diverse",
    title: "Women- and Minority-Owned Businesses",
    description: "Find and support women- and minority-owned businesses certified by the city, by what you need and where.",
    category: "Business",
    url: "/shop-diverse/",
    audience: ["resident", "business"]
  },
  {
    id: "school-quality",
    title: "NYC School Quality Explorer",
    description: "Find any NYC public school and see how it’s doing now and whether it’s getting better or worse.",
    category: "Education",
    url: "/school-quality/",
    audience: ["resident"]
  },
  {
    id: "street-closures",
    title: "Street Closures Near You",
    description: "See which blocks are closed for construction near you, on your street or in your borough, today and in the weeks ahead.",
    category: "Transportation",
    url: "/street-closures/",
    audience: ["resident", "business"]
  },
  {
    id: "help-near-me",
    title: "Where Can I Get Help Near Me?",
    description: "Find the nearest food benefits office, homelessness help, free computers, youth and older adult programs, with hours and directions.",
    category: "Social Services",
    url: "/help-near-me/",
    audience: ["resident"]
  }
];

export const ALL = "All Categories";

/*
 * Header switch options, in display order. The first is the default;
 * `id` is the ?for= value (omitted from the URL for the default).
 */
export const AUDIENCES = [
  { id: "resident", label: "For NYC Residents", short: "Residents", icon: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10M10 20v-6h4v6"/>' },
  { id: "business", label: "For NYC Businesses", short: "Businesses", icon: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>' }
];

/*
 * Sidebar categories, in display order. `tone` picks the pastel color
 * ([data-tone] in landing.css); `icon` is the inner SVG of a 24×24
 * stroke-based line icon.
 */
export const CATEGORIES = [
  { name: ALL, tone: "blue", icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>' },
  { name: "Business", tone: "yellow", icon: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>' },
  { name: "City Government", tone: "blue", icon: '<path d="M3 21h18M4 10h16M12 3l8 4H4l8-4zM6 10v8M10 10v8M14 10v8M18 10v8"/>' },
  { name: "Education", tone: "purple", icon: '<path d="M2 9l10-5 10 5-10 5L2 9z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v6"/>' },
  { name: "Environment", tone: "teal", icon: '<path d="M5 19c0-9 5-14 15-15-1 10-6 15-15 15z"/><path d="M5 19l7-7"/>' },
  { name: "Health", tone: "green", icon: '<path d="M20.4 5.6a5 5 0 0 0-7.1 0L12 6.9l-1.3-1.3a5 5 0 0 0-7.1 7.1L12 21l8.4-8.3a5 5 0 0 0 0-7.1z"/><path d="M7 12h2.5l1.5-2.5 2 5 1.5-2.5H17"/>' },
  { name: "Housing & Development", tone: "orange", icon: '<path d="M4 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17M14 9h5a1 1 0 0 1 1 1v11M2 21h20M8 7h2M8 11h2M8 15h2M17 13h0M17 17h0"/>' },
  { name: "Public Safety", tone: "red", icon: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>' },
  { name: "Recreation", tone: "lime", icon: '<path d="M12 3l5 8h-3l4 6H6l4-6H7l5-8zM12 17v4"/>' },
  { name: "Social Services", tone: "pink", icon: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.1A5 5 0 0 1 21.5 19"/>' },
  { name: "Transportation", tone: "yellow", icon: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 10h14M9 21l-2-4M15 21l2-4"/><circle cx="9" cy="13.5" r="0.6"/><circle cx="15" cy="13.5" r="0.6"/>' }
];

// "Housing & Development" → "housing-development"; the ?category= value.
export function categorySlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Landing page filtered to one category ("/" for All Categories).
export function categoryHref(name) {
  return name === ALL ? "/" : "/?category=" + categorySlug(name);
}

export function categoryTone(name) {
  const category = CATEGORIES.find((c) => c.name === name);
  return category ? category.tone : "blue";
}

export function categoryIcon(name) {
  const category = CATEGORIES.find((c) => c.name === name) || CATEGORIES[0];
  return category.icon;
}
