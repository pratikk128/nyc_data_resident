/*
 * ============================================================
 *  THE CURATED METRICS: EDIT HERE
 * ============================================================
 *
 * The NYC School Quality Explorer shows only these metrics from "School
 * Quality Reports Data" (dnpx-dfnc), which has 100+ per report type. Each
 * school page shows the ones for its report type that it has data for, in
 * this order; cards on the browse page show the ones with `card`.
 *
 *   key          metric_variable_name in the dataset
 *   label        what we call it
 *   description  one plain-English line under the number
 *   reports      report types it applies to (REPORTS in config.js)
 *   format       "percent" (0–1), "points" (a change, ±percentage points)
 *                or "count"
 *   scale        divide the raw value by this first (ccr_* is 0–100, the
 *                rest are 0–1)
 *   invert       show 1 − value. chronic_absent_* holds the share of students
 *                with 90%+ attendance, despite its name; inverted it's the
 *                chronic absenteeism rate.
 *   higherIsBetter  for the trend words and the "vs. NYC" wording
 *   context      true: shown as context, not as a sign of quality
 *   field        "number_of_students" to read that column instead of
 *                metric_value (enrollment isn't in the dataset)
 *   card         order on the browse cards (1–3), per report type
 *   sortKey      offered as a browse sort under this URL value
 *   stateTest    a New York State test result: blank 2019–20 and 2020–21
 *                years get the COVID-19 testing explanation (GAP_REASONS)
 *   firstYear    the measure exists only from this school year: charts and
 *                tables start there, with `note` under the chart
 *   seriesBreak  { year, note }: the measure changed that year; the chart
 *                marks it and the trend only uses years from then on
 *   trendThreshold  smallest change over the last 3 years that counts as
 *                improving or declining (in the value's own units, after
 *                scale/invert; default 0.03 = 3 percentage points)
 */

const NEW_STATE_TESTS = {
  year: 2022,
  note: "New York gave new ELA and math tests, with new score cutoffs, starting in spring 2023. Results from 2022–23 on can’t be compared with earlier years."
};

const CCR_STARTED = {
  firstYear: 2023,
  note: "DOE started reporting this measure in 2023–24. Earlier college readiness numbers used a different definition and aren’t shown."
};

export const METRICS = [
  // ---------- Elementary, middle and K-8 ----------
  {
    key: "prof_pct_ela_all", reports: ["EMS", "EC"], card: { EMS: 1 }, sortKey: "ela",
    label: "ELA proficiency",
    description: "Share of tested students (grades 3–8) scoring at Level 3 or 4, proficient, on the New York State English test.",
    format: "percent", higherIsBetter: true, stateTest: true, seriesBreak: NEW_STATE_TESTS
  },
  {
    key: "prof_pct_mth_all", reports: ["EMS", "EC"], card: { EMS: 2 }, sortKey: "math",
    label: "Math proficiency",
    description: "Share of tested students (grades 3–8) scoring at Level 3 or 4, proficient, on the New York State math test.",
    format: "percent", higherIsBetter: true, stateTest: true, seriesBreak: NEW_STATE_TESTS
  },
  {
    key: "ele_core_all", reports: ["EMS"],
    label: "Former students passing middle school courses",
    description: "How this school’s former 5th graders did in their middle school core courses (DOE’s adjusted pass rate).",
    format: "percent", higherIsBetter: true
  },
  {
    key: "hs_9gr_credits_all", reports: ["EMS"],
    label: "Former students on track in 9th grade",
    description: "Share of this school’s former 8th graders who earned enough credits in 9th grade to stay on track (adjusted).",
    format: "percent", higherIsBetter: true
  },
  {
    key: "pct_accelerated_all", reports: ["EMS"],
    label: "8th graders earning high school credit",
    description: "Share of 8th graders who passed a high school–level course or Regents exam.",
    format: "percent", higherIsBetter: true
  },

  // ---------- High school ----------
  {
    key: "grad_pct_4_all", reports: ["HS"], card: { HS: 1 }, sortKey: "grad",
    label: "4-year graduation rate",
    description: "Share of students who graduated within 4 years of starting 9th grade.",
    format: "percent", higherIsBetter: true
  },
  {
    key: "ccr_4yr_all", reports: ["HS"], card: { HS: 2 }, scale: 100,
    label: "College and career readiness",
    description: "Share of the 4-year class who graduated and met DOE’s college- or career-readiness standards (exams, courses or credentials).",
    format: "percent", higherIsBetter: true, ...CCR_STARTED
  },
  {
    key: "pct_cer_18mo_all", reports: ["HS"], card: { HS: 3 },
    label: "Went on to college or training",
    description: "Share of students who enrolled in college, a vocational program or public service within 18 months of their scheduled graduation.",
    format: "percent", higherIsBetter: true
  },
  {
    key: "grad_pct_6_all", reports: ["HS"],
    label: "6-year graduation rate",
    description: "Share of students who graduated within 6 years of starting 9th grade.",
    format: "percent", higherIsBetter: true
  },
  {
    key: "pct_cpci_all", reports: ["HS", "HST"],
    label: "College prep course index",
    description: "Share of students who passed a college-level course or exam (AP, IB, college credit, a technical exam or advanced Regents) by the end of 4 years.",
    format: "percent", higherIsBetter: true
  },
  {
    key: "credit_10_pct_yr1", reports: ["HS"],
    label: "9th graders on track",
    description: "Share of first-year students who earned 10 or more credits, the pace needed to graduate on time.",
    format: "percent", higherIsBetter: true
  },

  // ---------- Transfer high schools and YABCs ----------
  {
    key: "grad_pct_6_all", id: "grad_pct_6_transfer", reports: ["HST", "YABC"], card: { HST: 1, YABC: 1 },
    label: "Graduation rate",
    description: "DOE’s graduation rate for schools that serve students who are behind or returning: the share of students in the school’s 6-year graduation group who earned a diploma.",
    format: "percent", higherIsBetter: true
  },
  {
    key: "ccr_6yr_all", reports: ["HST"], scale: 100,
    label: "College and career readiness",
    description: "Share of the school’s 6-year class who graduated and met DOE’s college- or career-readiness standards.",
    format: "percent", higherIsBetter: true, firstYear: 2024, note: "DOE started reporting this measure for transfer schools in 2024–25."
  },
  {
    key: "nondropout_6_all", reports: ["HST", "YABC"], card: { YABC: 2 },
    label: "Stayed in school",
    description: "Share of students who graduated or are still enrolled, rather than dropping out (DOE’s persistence rate).",
    format: "percent", higherIsBetter: true
  },
  {
    key: "pct_cer_6mo_all", reports: ["HST", "YABC"], card: { HST: 2 },
    label: "Went on to college or training",
    description: "Share of students who enrolled in college, a vocational program or public service within 6 months of their scheduled graduation.",
    format: "percent", higherIsBetter: true
  },
  {
    key: "met_reg_compl_all", reports: ["HST", "YABC"],
    label: "Regents exams completed",
    description: "On average, the share of the Regents exams students still needed to graduate that they passed this year.",
    format: "percent", higherIsBetter: true
  },
  {
    key: "attend_increase_mean_all", reports: ["HST", "YABC", "D75"],
    label: "Change in attendance",
    description: "Average change in each student’s attendance rate from the year before. Above zero means students came to school more.",
    format: "points", higherIsBetter: true, trendThreshold: 0.02
  },

  // ---------- District 75 ----------
  {
    key: "prof_nysaa_pct_ela_all", reports: ["D75"], card: { D75: 1 },
    label: "Alternate assessment, ELA",
    description: "Students with significant disabilities take the NYS Alternate Assessment (NYSAA) instead of the regular test. Share scoring Level 3 or 4 in English.",
    format: "percent", higherIsBetter: true, stateTest: true
  },
  {
    key: "prof_nysaa_pct_mth_all", reports: ["D75"], card: { D75: 2 },
    label: "Alternate assessment, math",
    description: "Share of students taking the NYS Alternate Assessment who scored Level 3 or 4 in math.",
    format: "percent", higherIsBetter: true, stateTest: true
  },
  {
    key: "move_to_lre_pct_all", reports: ["D75"],
    label: "Moved to less restrictive settings",
    description: "Share of students who moved to a less restrictive special education setting during the year.",
    format: "percent", higherIsBetter: true, trendThreshold: 0.02
  },
  {
    key: "move_to_gen_pct_all", reports: ["D75"],
    label: "Moved to a non-District 75 school",
    description: "Share of students who moved from District 75 into a community school.",
    format: "percent", higherIsBetter: true, trendThreshold: 0.02
  },

  // ---------- Attendance (every report type that has it) ----------
  {
    key: "chronic_absent_ems_all", reports: ["EMS"], card: { EMS: 3 }, sortKey: "absent", invert: true,
    label: "Chronic absenteeism",
    description: "Share of students who missed more than 10% of school days, about 18 days a year. Lower is better.",
    format: "percent", higherIsBetter: false
  },
  {
    key: "chronic_absent_hs_all", reports: ["HS"], sortKey: "absent", invert: true,
    label: "Chronic absenteeism",
    description: "Share of students who missed more than 10% of school days, about 18 days a year. Lower is better.",
    format: "percent", higherIsBetter: false
  },
  {
    key: "chronic_absent_all", reports: ["EC"], card: { EC: 1 }, sortKey: "absent", invert: true,
    label: "Chronic absenteeism",
    description: "Share of students who missed more than 10% of school days, about 18 days a year. Lower is better.",
    format: "percent", higherIsBetter: false
  },
  {
    key: "attendance_k8_all", reports: ["EMS"],
    label: "Average attendance",
    description: "The average student’s share of school days attended.",
    format: "percent", higherIsBetter: true, trendThreshold: 0.01
  },
  {
    key: "attendance_hs_all", reports: ["HS"],
    label: "Average attendance",
    description: "The average student’s share of school days attended.",
    format: "percent", higherIsBetter: true, trendThreshold: 0.01
  },
  {
    key: "attendance_k3_all", reports: ["EC"], card: { EC: 2 },
    label: "Average attendance",
    description: "The average student’s share of school days attended.",
    format: "percent", higherIsBetter: true, trendThreshold: 0.01
  },

  // ---------- Context ----------
  {
    key: "attendance_k8_all", id: "students_ems", reports: ["EMS"], field: "number_of_students", context: true,
    label: "Students",
    description: "Students with attendance records this year, a close stand-in for enrollment (the dataset has no enrollment count).",
    format: "count", higherIsBetter: null, trendThreshold: Infinity
  },
  {
    key: "attendance_hs_all", id: "students_hs", reports: ["HS"], field: "number_of_students", context: true,
    label: "Students",
    description: "Students with attendance records this year, a close stand-in for enrollment (the dataset has no enrollment count).",
    format: "count", higherIsBetter: null, trendThreshold: Infinity
  },
  {
    key: "attendance_k3_all", id: "students_ec", reports: ["EC"], field: "number_of_students", context: true,
    label: "Students",
    description: "Students with attendance records this year, a close stand-in for enrollment (the dataset has no enrollment count).",
    format: "count", higherIsBetter: null, trendThreshold: Infinity
  }
];

// A metric's id is its key unless two entries read the same key (students vs
// attendance; the high school and transfer school graduation rates). Within
// one report type, a key's rows are the same rows, told apart by report_type.
for (const m of METRICS) m.id ??= m.key;

// Every metric_variable_name we read, for the SoQL `in (...)`.
export const METRIC_KEYS = [...new Set(METRICS.map((m) => m.key))];

// The metrics for one report type, in display order: card metrics first (in
// card order), then the rest in the order above.
export const metricsFor = (report) => METRICS
  .filter((m) => m.reports.includes(report))
  .map((m, i) => ({ m, rank: m.card?.[report] ?? 100 + i }))
  .sort((a, b) => a.rank - b.rank)
  .map(({ m }) => m);

// The card metrics for one report type, in card order.
export const cardMetrics = (report) => METRICS
  .filter((m) => m.card?.[report] && m.reports.includes(report))
  .sort((a, b) => a.card[report] - b.card[report]);

// Browse sorts by a metric: URL value → the metrics behind it (one per report type).
export const METRIC_SORTS = [
  { value: "ela", label: "ELA proficiency", note: "elementary and middle schools" },
  { value: "math", label: "Math proficiency", note: "elementary and middle schools" },
  { value: "grad", label: "4-year graduation rate", note: "high schools" },
  { value: "absent", label: "Chronic absenteeism (lowest first)", note: "where reported" }
].map((s) => ({ ...s, metrics: METRICS.filter((m) => m.sortKey === s.value) }));

export const CARD_KEYS = [...new Set(METRICS.filter((m) => m.card || m.sortKey).map((m) => m.key))];
