/*
 * "Copy link" and "Print or save as PDF" for any dashboard (ShareActions,
 * Building Report's header, a restaurant's header). Browser-only.
 *
 * preparePrint() makes every printout say when it was made and where it came
 * from (DashboardLayout's [data-print-meta]) and prints in the light theme,
 * however the printing started: a button or the browser's own Print.
 */

let preparing = false;
export function preparePrint() {
  if (preparing) return;
  preparing = true;
  let themeBeforePrint = "";
  addEventListener("beforeprint", () => {
    const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    for (const el of document.querySelectorAll("[data-print-meta]")) {
      el.textContent = `Printed from Ask NYC Data on ${today}. ${location.href}`;
    }
    themeBeforePrint = document.documentElement.dataset.theme || "";
    document.documentElement.dataset.theme = "light";
  });
  addEventListener("afterprint", () => {
    if (themeBeforePrint) document.documentElement.dataset.theme = themeBeforePrint;
  });
}

// Copies `link` (default: this page as it is now) and says so on the button for a moment.
export async function copyLink(button, link = location.href) {
  const label = button.dataset.label || (button.dataset.label = button.textContent.trim());
  try {
    await navigator.clipboard.writeText(link);
    button.textContent = "Link copied";
  } catch {
    button.textContent = "Copy it from the address bar";
  }
  clearTimeout(Number(button.dataset.timer));
  button.dataset.timer = String(setTimeout(() => { button.textContent = label; }, 2500));
}
