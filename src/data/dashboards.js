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
 *
 * The sidebar counts, category filter, and "N dashboards" heading
 * all update automatically. No other file needs to change.
 */

export const dashboards = [
  {
    id: "address",
    title: "Your Address Report",
    description: "Type an address and see the city’s data around it: your building’s records, crashes, 311, street closures, parks, help, schools and restaurant grades.",
    category: "Housing & Development",
    url: "/address/"
  },
  {
    id: "restaurant-inspections",
    title: "NYC Restaurant Inspections",
    description: "Look up any restaurant’s health inspection grade and latest violations, and see how it compares with similar places.",
    category: "Health",
    url: "/restaurant-inspections/"
  },
  {
    id: "311-complaints",
    title: "311 Complaints in My Neighborhood",
    description: "See what your neighbors are reporting: noise, sanitation, housing, and more.",
    category: "City Government",
    url: "/311-complaints/"
  },
  {
    id: "city-payroll",
    title: "City Payroll Spending",
    description: "See what NYC pays its workforce: total payroll, overtime and other pay by agency and year.",
    category: "City Government",
    url: "/city-payroll/"
  },
  {
    id: "city-jobs",
    title: "What NYC City Jobs Pay",
    description: "See what full-time city jobs pay, from nurses to firefighters: median salary, overtime and how pay has changed.",
    category: "City Government",
    url: "/city-jobs/"
  },
  {
    id: "school-quality",
    title: "NYC School Quality Explorer",
    description: "Find any NYC public school and see how it’s doing now and whether it’s getting better or worse.",
    category: "Education",
    url: "/school-quality/"
  },
  {
    id: "street-closures",
    title: "Street Closures Near You",
    description: "See which blocks are closed for construction near you, on your street or in your borough, today and in the weeks ahead.",
    category: "Transportation",
    url: "/street-closures/"
  },
  {
    id: "crash-hotspots",
    title: "NYC Crash Hotspots",
    description: "The intersections near you where crashes hurt people most, what goes wrong at each, and what to watch for when you walk, bike or drive.",
    category: "Public Safety",
    url: "/crash-hotspots/"
  },
  {
    id: "help-near-me",
    title: "Where Can I Get Help Near Me?",
    description: "Find the nearest food benefits office, homelessness help, free computers, youth and older adult programs, with hours and directions.",
    category: "Social Services",
    url: "/help-near-me/"
  },
  {
    id: "building-report",
    title: "Building Report Card",
    description: "Type an address and see a building’s record: repairs the city ordered, tenant complaints, bedbugs and pests, vacate orders, court cases and who owns it.",
    category: "Housing & Development",
    url: "/building-report/"
  },
  {
    id: "park-amenities",
    title: "Park Amenities Near Me",
    description: "Find the closest playgrounds, dog runs, drinking fountains and pools to any address, on a map with directions.",
    category: "Recreation",
    url: "/park-amenities/"
  }
];

export const ALL = "All Categories";

/*
 * Sidebar categories, in display order. `tone` picks the pastel color
 * ([data-tone] in landing.css); `icon` is the inner SVG of a 24×24
 * stroke-based line icon.
 */
export const CATEGORIES = [
  { name: ALL, tone: "blue", icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>' },
  { name: "City Government", tone: "blue", icon: '<path d="M3 21h18M4 10h16M12 3l8 4H4l8-4zM6 10v8M10 10v8M14 10v8M18 10v8"/>' },
  { name: "Education", tone: "purple", icon: '<path d="M2 9l10-5 10 5-10 5L2 9z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v6"/>' },
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
