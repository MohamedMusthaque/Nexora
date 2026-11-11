// Tooltips on every button.
//
// Hovering a button (or focusing it with the keyboard) shows a small dark
// tooltip above it (below when there is no room). One tooltip for the whole
// app, so buttons added later (table rows, windows) get it too.
//
// The text, first found:
//   data-tooltip  >  title  >  aria-label  >  the button's own text  >
//   its icon (pencil: "Edit", trash: "Delete"...)  >  "Close" for ×
// A title is moved aside while hovering so the browser's own tooltip doesn't
// show as well, and put back afterwards (unless the app changed it).
// Styles: components.css "Tooltips".

(function () {
  const SELECTOR = [
    "button",
    ".btn",
    'input[type="button"]',
    'input[type="submit"]',
    'input[type="reset"]',
    ".dt-button",
    ".paginate_button",
    '[role="button"]',
    "[data-tooltip]",
  ].join(",");
  const SHOW_DELAY = 400; // ms of hovering before it shows
  const GAP = 8; // px between the button and the tooltip
  const EDGE = 6; // px kept free at the window edges

  // icon-only buttons: what the icon means
  const ICON_TEXT = [
    [/\bfa-(edit|pencil|pencil-square-o)\b/, "Edit"],
    [/\bfa-trash(-o)?\b/, "Delete"],
    [/\bfa-print\b/, "Print"],
    [/\bfa-search-plus\b/, "View details"],
    [/\bfa-eye\b/, "View"],
    [/\bfa-file-text-o\b/, "View bill"],
    [/\bfa-history\b/, "History"],
    [/\bfa-sliders\b/, "Adjust stock"],
    [/\bfa-barcode\b/, "Print barcode"],
    [/\bfa-plus\b/, "Add"],
    [/\bfa-minus\b/, "Reduce"],
    [/\bfa-check\b/, "Confirm"],
    [/\bfa-times\b/, "Close"],
    [/\bfa-ban\b/, "Cancel"],
    [/\bfa-refresh\b/, "Reload"],
    [/\bfa-chevron-left\b/, "Previous"],
    [/\bfa-chevron-right\b/, "Next"],
    [/\bfa-arrow-left\b/, "Back"],
    [/\bfa-undo\b/, "Return / refund"],
    [/\bfa-exchange\b/, "Exchange"],
    [/\bfa-money\b/, "Payment"],
    [/\bfa-list\b/, "List"],
    [/\bfa-download\b/, "Download"],
    [/\bfa-file-excel-o\b/, "Download as Excel"],
    [/\bfa-file-pdf-o\b/, "Download as PDF"],
    [/\bglyphicon-cog\b/, "Settings"],
    [/\bglyphicon-log-out\b/, "Log out"],
    [/\bglyphicon-off\b/, "Quit"],
  ];

  let tip = null;
  let current = null; // the button hovered / focused
  let showTimer = null;
  let lastTouch = 0; // a tap also fires mouse events: no tooltip for taps

  function tipElement() {
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "appTooltip";
      tip.setAttribute("role", "tooltip");
      tip.innerHTML = '<span class="app-tooltip-text"></span><span class="app-tooltip-arrow"></span>';
      document.body.appendChild(tip);
    }
    return tip;
  }

  function clean(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function tooltipText(el) {
    let text =
      clean(el.getAttribute("data-tooltip")) ||
      clean(el.dataset.ttTitle) ||
      clean(el.getAttribute("title")) ||
      clean(el.getAttribute("aria-label")) ||
      clean(el.getAttribute("data-original-title"));
    if (text) return text;

    if (el.tagName === "INPUT") return clean(el.value);

    let own = clean(el.innerText);
    if (own === "×" || own === "✕" || el.classList.contains("close")) return "Close";
    if (/^\d+$/.test(own) && el.closest(".pagination, .paginate_button, .dataTables_paginate")) {
      return "Page " + own;
    }
    if (own) return own;

    let icon = el.querySelector("i, .fa, .glyphicon");
    let cls = icon ? icon.className : "";
    for (const [re, label] of ICON_TEXT) {
      if (re.test(cls)) return label;
    }
    return "";
  }

  // the browser's own tooltip would show too: keep the title aside meanwhile
  function stashTitle(el) {
    let t = el.getAttribute("title");
    if (t) {
      el.dataset.ttTitle = t;
      el.setAttribute("title", "");
    }
  }
  function restoreTitle(el) {
    if (el.dataset.ttTitle === undefined) return;
    // the app may have set a new title while hovering: keep that one
    if (el.getAttribute("title") === "") el.setAttribute("title", el.dataset.ttTitle);
    delete el.dataset.ttTitle;
  }

  function place(el) {
    let t = tipElement();
    let r = el.getBoundingClientRect();
    let w = t.offsetWidth;
    let h = t.offsetHeight;
    let below = r.top - h - GAP < EDGE;
    let top = below ? r.bottom + GAP : r.top - h - GAP;
    let centre = r.left + r.width / 2;
    let left = Math.min(Math.max(centre - w / 2, EDGE), window.innerWidth - w - EDGE);
    t.style.top = Math.round(top) + "px";
    t.style.left = Math.round(left) + "px";
    t.classList.toggle("below", below);
    t.querySelector(".app-tooltip-arrow").style.left = Math.round(centre - left) + "px";
  }

  function show(el) {
    showTimer = null;
    if (el !== current || !document.body.contains(el)) return;
    let r = el.getBoundingClientRect();
    if (!r.width && !r.height) return; // hidden meanwhile
    let text = tooltipText(el);
    if (!text) return;
    let t = tipElement();
    t.querySelector(".app-tooltip-text").textContent = text;
    t.classList.add("visible");
    place(el);
    el.setAttribute("aria-describedby", "appTooltip");
  }

  function hide() {
    clearTimeout(showTimer);
    showTimer = null;
    if (current) {
      restoreTitle(current);
      if (current.getAttribute("aria-describedby") === "appTooltip") current.removeAttribute("aria-describedby");
      current = null;
    }
    if (tip) tip.classList.remove("visible");
  }

  function start(el, delay) {
    if (el === current) return;
    hide();
    current = el;
    stashTitle(el);
    showTimer = setTimeout(() => show(el), delay);
  }

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "touch") lastTouch = Date.now();
      hide(); // pressing a button: the tooltip goes
    },
    true
  );

  document.addEventListener("mouseover", (e) => {
    if (Date.now() - lastTouch < 1000) return;
    let el = e.target.closest ? e.target.closest(SELECTOR) : null;
    if (!el) {
      if (current && !current.contains(e.target)) hide();
      return;
    }
    start(el, SHOW_DELAY);
  });

  document.addEventListener("mouseout", (e) => {
    if (current && !(e.relatedTarget && current.contains(e.relatedTarget))) hide();
  });

  // keyboard users: show at once when a button gets focus with Tab
  document.addEventListener("focusin", (e) => {
    let el = e.target.closest ? e.target.closest(SELECTOR) : null;
    if (el && el.matches(":focus-visible")) start(el, 0);
  });
  document.addEventListener("focusout", (e) => {
    if (current && e.target === current) hide();
  });

  // anything that moves things around: the tooltip goes
  document.addEventListener("keydown", hide, true);
  document.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
  window.addEventListener("blur", hide);
  if (window.jQuery) {
    jQuery(document).on("show.bs.modal hide.bs.modal", hide);
  }
})();
