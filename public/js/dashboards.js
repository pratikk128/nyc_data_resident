/*
 * ============================================================
 *  ADD NEW DASHBOARDS HERE
 * ============================================================
 *
 * Every card on the landing page is rendered from this array.
 * To add a dashboard, append one object with these fields:
 *
 *   id          Unique, URL-friendly slug (e.g. "street-trees").
 *   title       Card title, in plain language.
 *   description One short sentence telling residents what they'll find.
 *   category    Must exactly match one of the category names in
 *               public/js/app.js (e.g. "Health", "Transportation").
 *   url         Where "Open dashboard →" goes.
 *
 * The sidebar counts, category filter, and "N dashboards" heading
 * all update automatically. No other file needs to change.
 */

const dashboards = [
  {
    id: "restaurant-inspections",
    title: "NYC Restaurant Inspections",
    description: "Explore health inspection grades, violations, and trends for restaurants across the five boroughs.",
    category: "Health",
    // Placeholder link: the dashboard isn't built yet. Replace "#" with its real page when it's ready.
    url: "#"
  },
  {
    id: "311-complaints",
    title: "311 Complaints in My Neighborhood",
    description: "See what your neighbors are reporting: noise, sanitation, housing, and more.",
    category: "City Government",
    // Placeholder link: replace "#" with the real dashboard URL later.
    url: "#"
  },
  {
    id: "city-payroll",
    title: "City Payroll Spending",
    description: "See what NYC pays its workforce: total payroll, overtime and other pay by agency and year.",
    category: "City Government",
    url: "/city-payroll/"
  }
];
