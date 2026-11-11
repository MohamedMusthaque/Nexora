let cart = [];
let index = 0;
let allUsers = [];
let allCustomers = [];
let allProducts = [];
let allCategories = [];
let productGroups = [];
let productListPage = 1;
let productListPageSize = 10;
let allTransactions = [];
let sold = [];
let state = [];
let sold_items = [];
let item;
let auth;
let holdOrder = 0;
let vat = 0;
let perms = null;
let deleteId = 0;
let paymentType = 1;
let receipt = "";
let totalVat = 0;
let subTotal = 0;
let method = "";
let order_index = 0;
let user_index = 0;
let product_index = 0;
let transaction_index;
let host = "localhost";
let notiflix = require("notiflix");
let path = require("path");
let port = "8001";
let moment = require("moment");
let Swal = require("sweetalert2");
let { ipcRenderer } = require("electron");
let dotInterval = setInterval(function () {
  $(".dot").text(".");
}, 3000);
let Store = require("electron-store");
Store = Store.default || Store;
// NOTE: require('electron').remote was removed in Electron 14+ and no longer
// exists in Electron 43. These lines crashed the renderer at startup.
// const remote = require("electron").remote;
// const app = remote.app;
let img_path = process.env.APPDATA + "/POS/uploads/";
let api = "http://" + host + ":" + port + "/api/";
let btoa = require("btoa");
let ExcelJS = require("exceljs");
let JsBarcode = require("jsbarcode");
let macaddress = require("macaddress");

// ---- Amount fields (inputs with class "amount-input") ----------------------
// Money is typed with thousands separators ("1,250,000.50") and only as a
// positive number: digits and one decimal point, at most 2 decimals. Minus,
// plus, "e" and letters are blocked. The commas are only for showing:
// $(field).val() gives the plain number ("1250000.50") and
// $(field).val(x) shows x with commas, so the code reading and filling these
// fields (and forms sent with serialize / ajaxSubmit, which use .val())
// works with plain numbers.

// the plain number in some text: commas dropped, the first number kept (so
// pasting "Rs. 1,250.00" gives "1250.00"), at most 2 decimals
function cleanAmountText(value) {
  let text = String(value == null ? "" : value).replace(/,/g, "");
  let match = text.match(/\d+(\.\d*)?|\.\d+|^\.$/);
  let cleaned = match ? match[0] : "";
  let dot = cleaned.indexOf(".");
  if (dot !== -1) cleaned = cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1, dot + 3);
  return cleaned;
}

// "1250000.5" -> "1,250,000.5" (a number being typed, e.g. "1250." stays as it is)
function groupAmountText(clean) {
  let dot = clean.indexOf(".");
  let whole = dot === -1 ? clean : clean.slice(0, dot);
  whole = whole.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dot === -1 ? whole : whole + clean.slice(dot);
}

// what an amount field shows for a value (for inputs drawn as HTML)
// A plain number from code (jQuery's .val() passes numbers as text) is
// rounded to 2 decimals (1234.5678 -> 1,234.57); typed text is only trimmed.
function amountInputText(value) {
  if (typeof value === "number") value = isFinite(value) ? String(value) : "";
  let text = String(value == null ? "" : value).trim();
  if (/^\d+\.\d{3,}$/.test(text)) text = String(Math.round(parseFloat(text) * 100) / 100);
  return groupAmountText(cleanAmountText(text));
}

(function () {
  let isAmount = (el) => !!(el && el.classList && el.classList.contains("amount-input"));
  let previous = $.valHooks.text;
  $.valHooks.text = {
    get: function (el) {
      if (isAmount(el)) return cleanAmountText(el.value);
      return previous && previous.get ? previous.get.apply(this, arguments) : undefined;
    },
    set: function (el, value) {
      if (isAmount(el)) {
        el.value = amountInputText(value);
        return true;
      }
      return previous && previous.set ? previous.set.apply(this, arguments) : undefined;
    },
  };

  // a short note under the field (or a red border inside tables)
  function amountError(el, message) {
    let $el = $(el);
    let $group = $el.closest(".form-group");
    clearTimeout(el._amountErrorTimer);
    $el.addClass("amount-input-invalid");
    let $note = $el.siblings(".price-input-error");
    if (!$note.length && !$el.closest("td").length) {
      let $anchor = $el.closest(".input-group");
      if (!$anchor.length) $anchor = $el;
      $note = $anchor.next(".amount-input-error");
      if (!$note.length) $note = $('<small class="amount-input-error text-danger"></small>').insertAfter($anchor);
    }
    $note.text(message);
    $group.addClass("has-error");
    el._amountErrorTimer = setTimeout(function () {
      $el.removeClass("amount-input-invalid");
      $note.text("");
      $group.removeClass("has-error");
    }, 2500);
  }

  // capture phase: before the fields' own handlers, so they see clean values
  document.addEventListener(
    "keydown",
    function (e) {
      if (!isAmount(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key && e.key.length === 1 && !/[0-9.]/.test(e.key)) {
        e.preventDefault();
        amountError(e.target, "Only positive numbers are allowed.");
      } else if (e.key === "." && e.target.value.indexOf(".") !== -1 && e.target.selectionStart === e.target.selectionEnd) {
        e.preventDefault(); // one decimal point
      }
    },
    true
  );
  document.addEventListener(
    "input",
    function (e) {
      let el = e.target;
      if (!isAmount(el)) return;
      let before = el.value;
      let clean = cleanAmountText(before);
      let shown = groupAmountText(clean);
      if (shown === before) return;
      // keep the caret after the same digit it was after
      let caret = el.selectionStart == null ? before.length : el.selectionStart;
      let kept = before.slice(0, caret).replace(/[^0-9.]/g, "").length;
      let pos = 0;
      for (let seen = 0; pos < shown.length && seen < kept; pos++) if (/[0-9.]/.test(shown[pos])) seen++;
      el.value = shown;
      try { el.setSelectionRange(pos, pos); } catch (err) {}
      let typedDigits = before.replace(/,/g, "");
      if (e.inputType === "insertFromPaste" || e.inputType === "insertFromDrop") return; // pasted "Rs. 1,250.00": just cleaned
      if (/[^0-9.]/.test(typedDigits)) amountError(el, "Only positive numbers are allowed.");
      else if (typedDigits !== clean) amountError(el, "Up to 2 decimals.");
    },
    true
  );
})();

let categories = [];
// products on the POS sale grid, grouped by category + name so that
// same-name items with different prices/barcodes share one tile; the user
// picks which price to add via selectVariant()
let posProductGroups = [];
let holdOrderList = [];
let customerOrderList = [];
let ownUserEdit = null;
let totalPrice = 0;
let orderTotal = 0;
let auth_error = "Incorrect username or password";
let auth_empty = "Please enter a username and password";
let holdOrderlocation = $("#randerHoldOrders");
let customerOrderLocation = $("#randerCustomerOrders");
let storage = new Store();
let settings;
let platform;
let user = {};
// Transactions page date range (ISO strings; "" = no limit, i.e. "All dates",
// the default). Kept in sync with the date filter set up below.
let start_date = "";
let end_date = "";
let by_user = 0;
let by_status = 2; // Transactions page shows all sales (paid + credit) by default
let by_method = ""; // Payment Method filter: "" (all), Cash, Card, Bank Transfer, Credit, Partial

// query string shared by the Transactions list and the Profit section
function transactionFilterQuery(start, end) {
  return (
    `by-date?start=${start}&end=${end}&user=${by_user}&status=${by_status}` +
    `&method=${encodeURIComponent(by_method)}`
  );
}

// ---- Transactions list helpers ----
function txnHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// registered customer's name, or "" for a walk-in customer
function transactionCustomerName(customer) {
  if (!customer || customer == 0) return "";
  if (typeof customer === "string") {
    try {
      customer = JSON.parse(customer);
    } catch (e) {
      return customer;
    }
  }
  return (customer && customer.name) || "";
}

// how much of a sale was left on the customer's credit: the whole bill for
// a Credit sale, the unpaid part of a partial payment (same rule as the server)
function txnCreditPart(t) {
  let part = parseFloat(t && t.credit_amount);
  if (t && t.payment_type === "Credit") return part > 0 ? part : parseFloat(t.total) || 0;
  return part > 0 ? part : 0;
}

// ======================================================================
// Popups (Bootstrap 3 modals): keep them scrollable
// A popup only scrolls while <body> has the "modal-open" class. When one
// popup closes as another opens (Customers -> Transactions, Products ->
// History, Pay -> receipt, Settle Credit over Transactions, ...) Bootstrap
// removes that class when the first finishes fading out, so the open popup
// can't scroll and anything below the screen edge is cut off. Put it back
// whenever a popup is still open.
// ======================================================================
$(document).on("hidden.bs.modal", ".modal", function () {
  if ($(".modal.in").length) $("body").addClass("modal-open");
});

// ======================================================================
// Password fields: show / hide (eye) button
// Every <input type="password"> gets a toggle, including ones added later
// (the login form is built in authenticate()). Fields go back to hidden when
// their window closes and after logging in.
// ======================================================================
function enhancePasswordInputs(root) {
  $(root || document)
    .find('input[type="password"]')
    .addBack('input[type="password"]')
    .each(function () {
      if (this.dataset.pwToggle) return;
      this.dataset.pwToggle = "1";
      let $wrap = $('<div class="password-field"></div>');
      $(this).after($wrap);
      $wrap.append(this);
      $wrap.append(
        '<button type="button" class="password-toggle" title="Show password" aria-label="Show password" aria-pressed="false">' +
          '<i class="fa fa-eye"></i></button>'
      );
    });
}

function setPasswordVisible(button, visible) {
  let input = $(button).siblings("input")[0];
  if (!input) return;
  input.type = visible ? "text" : "password";
  $(button)
    .attr({
      title: visible ? "Hide password" : "Show password",
      "aria-label": visible ? "Hide password" : "Show password",
      "aria-pressed": visible ? "true" : "false",
    })
    .find("i")
    .toggleClass("fa-eye", !visible)
    .toggleClass("fa-eye-slash", visible);
}

function hideAllPasswords(root) {
  $(root || document).find(".password-toggle").each(function () {
    setPasswordVisible(this, false);
  });
}

$(document).on("mousedown", ".password-toggle", function (e) {
  e.preventDefault(); // keep the cursor in the password box
});
$(document).on("click", ".password-toggle", function (e) {
  e.preventDefault();
  let input = $(this).siblings("input")[0];
  setPasswordVisible(this, input && input.type === "password");
  if (input) input.focus();
});
// back to hidden when a window closes or a form is submitted
$(document).on("hidden.bs.modal", ".modal", function () {
  hideAllPasswords(this);
});
$(document).on("submit", "form", function () {
  hideAllPasswords(this);
});

$(function () {
  enhancePasswordInputs(document);
  if (window.MutationObserver) {
    new MutationObserver((mutations) => {
      mutations.forEach((m) =>
        m.addedNodes.forEach((node) => {
          if (node.nodeType === 1) enhancePasswordInputs(node);
        })
      );
    }).observe(document.body, { childList: true, subtree: true });
  }
});

// ======================================================================
// Report exports: styled Excel (.xlsx) and PDF files for every list table
// (and the Products / Customers "Download" buttons).
// ======================================================================
const REPORT_STYLE = {
  brand: "5FBEAA",      // header fill (app green)
  brandDark: "3E9E8A",  // report title
  ink: "4C5667",        // main text
  muted: "98A6AD",      // subtitles, footers
  zebra: "F6F8FA",      // alternate rows
  border: "DFE3E8",     // cell borders
  totalFill: "E8F6F3",  // totals row
  groupFill: "EEF2F5",  // group rows (Products download)
};

function reportStoreName() {
  return (settings && settings.store) || "NEXORA POS";
}

function reportCurrency() {
  return ((settings && settings.symbol) || "").trim();
}

function reportGeneratedText() {
  return "Generated " + moment().format("DD MMM YYYY, hh:mm A");
}

function safeFileName(text) {
  return String(text || "report").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
}

// Turns an exported cell's text into a typed value:
//   "Rs. 1,250.00" -> 1250 (money)   "33.3%" -> 0.333 (percent)   "12" -> 12
// Long digit strings (invoice numbers, phones, barcodes) and numbers with a
// leading zero stay text so Excel doesn't change them.
function parseReportCell(text) {
  if (typeof text === "number") return { value: text, kind: "number" };
  let t = String(text ?? "").trim();
  if (t === "") return { value: "", kind: "empty" };
  let s = t, negative = false, money = false;
  if (s.startsWith("-")) { negative = true; s = s.slice(1).trim(); }
  let sym = reportCurrency();
  if (sym && s.startsWith(sym)) { money = true; s = s.slice(sym.length).trim(); }
  else if (/^Rs\.?\s*/i.test(s)) { money = true; s = s.replace(/^Rs\.?\s*/i, ""); }
  if (/^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(s)) {
    let digits = s.replace(/,/g, "");
    let isInt = !digits.includes(".");
    if (!money && isInt && (digits.length >= 8 || (digits.length > 1 && digits[0] === "0"))) {
      return { value: t, kind: "text" };
    }
    let v = parseFloat(digits) * (negative ? -1 : 1);
    return { value: v, kind: money ? "money" : isInt ? "int" : "number" };
  }
  if (/^-?\d+(\.\d+)?%$/.test(t)) return { value: parseFloat(t) / 100, kind: "percent" };
  return { value: t, kind: "text" };
}

function reportNumFmt(kind) {
  let sym = reportCurrency().replace(/"/g, "");
  if (kind === "money") return sym ? `"${sym} "#,##0.00;[Red]-"${sym} "#,##0.00` : "#,##0.00;[Red]-#,##0.00";
  if (kind === "percent") return "0.0%";
  if (kind === "int") return "#,##0";
  if (kind === "number") return "#,##0.00";
  return undefined;
}

// --- Excel building blocks (also used by the Products / Customers downloads) ---
function reportBorder() {
  let side = { style: "thin", color: { argb: "FF" + REPORT_STYLE.border } };
  return { top: side, left: side, bottom: side, right: side };
}

// rows 1-3: store name, report title, generated/filters line; returns next row number
function addReportHeader(ws, title, subtitle, columnCount) {
  let lines = [
    { text: reportStoreName(), font: { bold: true, size: 16, color: { argb: "FF" + REPORT_STYLE.ink } }, height: 24 },
    { text: title, font: { bold: true, size: 13, color: { argb: "FF" + REPORT_STYLE.brandDark } }, height: 20 },
    { text: [reportGeneratedText(), subtitle].filter(Boolean).join("   ·   "), font: { italic: true, size: 10, color: { argb: "FF" + REPORT_STYLE.muted } }, height: 16 },
  ];
  lines.forEach((line, i) => {
    let row = ws.getRow(i + 1);
    row.getCell(1).value = line.text;
    row.getCell(1).font = line.font;
    row.getCell(1).alignment = { vertical: "middle" };
    row.height = line.height;
    if (columnCount > 1) ws.mergeCells(i + 1, 1, i + 1, columnCount);
  });
  return 5; // row 4 left blank
}

function styleReportHeaderRow(row) {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + REPORT_STYLE.brand } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = reportBorder();
  });
}

// puts a value into a data cell with number format, alignment, zebra and borders
function setReportCell(cell, raw, zebra, forcedKind) {
  let parsed = forcedKind && typeof raw === "number"
    ? { value: raw, kind: forcedKind }
    : parseReportCell(raw);
  cell.value = parsed.kind === "empty" ? null : parsed.value;
  let fmt = reportNumFmt(parsed.kind);
  if (fmt) cell.numFmt = fmt;
  let numeric = ["money", "percent", "int", "number"].includes(parsed.kind);
  cell.alignment = { vertical: "top", horizontal: numeric ? "right" : "left", wrapText: !numeric };
  cell.font = { size: 10, color: { argb: "FF" + REPORT_STYLE.ink } };
  if (zebra) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + REPORT_STYLE.zebra } };
  cell.border = reportBorder();
  return parsed;
}

// column widths from content, frozen header, filter buttons, print setup
function finishReportSheet(ws, headerRowNumber, columnCount, lastRowNumber) {
  for (let c = 1; c <= columnCount; c++) {
    let longest = 0;
    for (let r = headerRowNumber; r <= lastRowNumber; r++) {
      let v = ws.getRow(r).getCell(c).value;
      if (v === null || v === undefined) continue;
      let text = typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) + "    " : String(v.formula ? "" : v);
      text.split("\n").forEach((line) => (longest = Math.max(longest, line.length)));
    }
    ws.getColumn(c).width = Math.min(50, Math.max(10, longest + 3));
  }
  ws.views = [{ state: "frozen", ySplit: headerRowNumber, showGridLines: false }];
  ws.autoFilter = { from: { row: headerRowNumber, column: 1 }, to: { row: headerRowNumber, column: columnCount } };
  ws.pageSetup = {
    orientation: columnCount > 5 ? "landscape" : "portrait",
    fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    printTitlesRow: headerRowNumber + ":" + headerRowNumber,
  };
  ws.headerFooter.oddFooter = "&L&8" + reportStoreName() + "&R&8Page &P of &N";
}

function downloadWorkbook(workbook, fileName) {
  // Blob + <a download> so Electron's will-download handler shows a Save dialog
  return workbook.xlsx.writeBuffer().then((buffer) => {
    let blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    let url = URL.createObjectURL(blob);
    let link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });
}

// A complete styled report sheet from a header + rows.
// sumColumns: 0-based column indexes to total; columnKinds: { index: "money" }
// for columns given as plain numbers.
function buildReportWorkbook({ title, subtitle, sheetName, header, rows, sumColumns, columnKinds }) {
  let wb = new ExcelJS.Workbook();
  wb.creator = reportStoreName();
  wb.created = new Date();
  let ws = wb.addWorksheet(String(sheetName || title || "Report").replace(/[\[\]:*?\/\\]/g, "-").slice(0, 31));
  let cols = header.length;
  let headerRowNumber = addReportHeader(ws, title, subtitle, cols);

  let headerRow = ws.getRow(headerRowNumber);
  header.forEach((h, i) => (headerRow.getCell(i + 1).value = h));
  styleReportHeaderRow(headerRow);

  let kinds = header.map(() => null);
  rows.forEach((values, r) => {
    let row = ws.getRow(headerRowNumber + 1 + r);
    values.forEach((v, c) => {
      let parsed = setReportCell(row.getCell(c + 1), v, r % 2 === 1, columnKinds && columnKinds[c]);
      if (parsed.kind !== "empty" && parsed.kind !== "text" && !kinds[c]) kinds[c] = parsed.kind;
    });
  });
  // number columns: header and text placeholders ("—", "Unlimited", "N/A")
  // are right-aligned too, so the column lines up
  kinds.forEach((k, c) => {
    if (!k) return;
    headerRow.getCell(c + 1).alignment = { vertical: "middle", horizontal: "right", wrapText: true };
    for (let r = 0; r < rows.length; r++) {
      let cell = ws.getRow(headerRowNumber + 1 + r).getCell(c + 1);
      if (typeof cell.value === "string") cell.alignment = { vertical: "top", horizontal: "right" };
    }
  });

  let last = headerRowNumber + rows.length;
  if (sumColumns && sumColumns.length && rows.length) {
    last += 1;
    let totalRow = ws.getRow(last);
    totalRow.getCell(1).value = "Total";
    for (let c = 1; c <= cols; c++) {
      let cell = totalRow.getCell(c);
      if (sumColumns.includes(c - 1)) {
        let col = ws.getColumn(c).letter;
        let sum = rows.reduce((s, r) => { let p = parseReportCell(r[c - 1]); return s + (typeof p.value === "number" ? p.value : 0); }, 0);
        cell.value = { formula: `SUM(${col}${headerRowNumber + 1}:${col}${last - 1})`, result: sum };
        cell.numFmt = reportNumFmt(kinds[c - 1] || "number");
        cell.alignment = { horizontal: "right" };
      }
      cell.font = { bold: true, size: 10, color: { argb: "FF" + REPORT_STYLE.ink } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + REPORT_STYLE.totalFill } };
      cell.border = Object.assign(reportBorder(), { top: { style: "medium", color: { argb: "FF" + REPORT_STYLE.brand } } });
    }
  }
  finishReportSheet(ws, headerRowNumber, cols, last);

  let note = ws.getRow(last + 2);
  note.getCell(1).value = rows.length + (rows.length === 1 ? " row" : " rows");
  note.getCell(1).font = { italic: true, size: 9, color: { argb: "FF" + REPORT_STYLE.muted } };
  return wb;
}

// --- PDF styling (pdfmake document from DataTables' pdfHtml5) ---
// opts.textColumns: column indexes that are always text (e.g. barcodes)
function styleReportPdf(doc, title, subtitle, sumColumns, opts) {
  opts = opts || {};
  const C = (hex) => "#" + hex.toLowerCase();
  let tableNode = doc.content.find((c) => c && c.table);
  if (!tableNode) return;
  let body = tableNode.table.body;
  let cols = body[0].length;
  doc.content = [tableNode];
  doc.pageOrientation = cols > 5 ? "landscape" : "portrait";
  doc.pageMargins = [32, 78, 32, 44];
  doc.defaultStyle = { fontSize: 8.5, color: C(REPORT_STYLE.ink) };

  // which columns hold numbers (right-aligned, totals)
  let numeric = body[0].map((_, c) => {
    if ((opts.textColumns || []).includes(c)) return false;
    let cells = body.slice(1).map((r) => parseReportCell(r[c].text)).filter((p) => p.kind !== "empty");
    return cells.length > 0 && cells.filter((p) => p.kind !== "text").length >= cells.length * 0.6;
  });

  body[0].forEach((cell, c) => Object.assign(cell, {
    fillColor: C(REPORT_STYLE.brand), color: "#ffffff", bold: true, fontSize: 9,
    alignment: numeric[c] ? "right" : "left", margin: [4, 5, 4, 5],
  }));
  body.slice(1).forEach((row, r) => row.forEach((cell, c) => Object.assign(cell, {
    fillColor: r % 2 ? C(REPORT_STYLE.zebra) : "#ffffff",
    alignment: numeric[c] ? "right" : "left", margin: [4, 3.5, 4, 3.5], fontSize: 8.5,
  })));

  if (sumColumns && sumColumns.length && body.length > 1) {
    let sym = reportCurrency();
    body.push(body[0].map((_, c) => {
      if (c === 0) return { text: "Total", bold: true };
      if (!sumColumns.includes(c)) return { text: "" };
      let parsed = body.slice(1).map((r) => parseReportCell(r[c].text));
      let sum = parsed.reduce((s, p) => s + (typeof p.value === "number" ? p.value : 0), 0);
      let money = parsed.some((p) => p.kind === "money");
      let text = (sum < 0 ? "-" : "") + (money && sym ? sym + " " : "") +
        Math.abs(sum).toLocaleString("en-US", { minimumFractionDigits: money ? 2 : 0, maximumFractionDigits: 2 });
      return { text: text, bold: true, alignment: "right" };
    }).map((cell) => Object.assign(cell, { fillColor: C(REPORT_STYLE.totalFill), margin: [4, 5, 4, 5], fontSize: 9 })));
  }

  tableNode.table.headerRows = 1; // repeat the header on every page
  // Column widths from content (header included): each column gets what its
  // longest text needs, spare page width goes to the text columns in
  // proportion, and if space is short everything shrinks evenly. Keeps codes
  // like barcodes on one line and avoids big gaps between short columns.
  let usable = (doc.pageOrientation === "landscape" ? 841.89 : 595.28) - 64;
  let longestLine = (t) => String(t ?? "").split("\n").reduce((m, l) => Math.max(m, l.length), 0);
  let need = body[0].map((h, c) => {
    let cells = Math.max(0, ...body.slice(1).map((r) => longestLine(r[c].text)));
    return Math.max(cells * 4.7, longestLine(h.text) * 5.2) + 10; // ~pt per character at 8.5-9pt, + cell padding
  });
  let total = need.reduce((s, w) => s + w, 0);
  if (total < usable) {
    let grow = need.map((_, c) => !numeric[c]);
    if (!grow.some(Boolean)) grow = need.map(() => true);
    let growTotal = need.reduce((s, w, c) => s + (grow[c] ? w : 0), 0);
    let extra = usable - total;
    need = need.map((w, c) => (grow[c] ? w + (extra * w) / growTotal : w));
  } else {
    need = need.map((w) => (w * usable) / total);
  }
  tableNode.table.widths = need.map((w) => Math.floor(w * 10) / 10);
  let lastRow = body.length;
  let hasTotal = sumColumns && sumColumns.length && body.length > 2;
  tableNode.layout = {
    hLineWidth: (i) => (i === 0 || i === 1 ? 0 : hasTotal && i === lastRow - 1 ? 1 : 0.5),
    hLineColor: (i) => (hasTotal && i === lastRow - 1 ? C(REPORT_STYLE.brand) : C(REPORT_STYLE.border)),
    vLineWidth: () => 0,
    paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
  };

  let generated = reportGeneratedText();
  let pageWidth = doc.pageOrientation === "landscape" ? 841.89 : 595.28;
  doc.header = () => ({
    margin: [32, 20, 32, 0],
    stack: [
      {
        columns: [
          { stack: [
            { text: reportStoreName(), fontSize: 15, bold: true, color: C(REPORT_STYLE.ink) },
            { text: title, fontSize: 11, bold: true, color: C(REPORT_STYLE.brandDark), margin: [0, 2, 0, 0] },
          ] },
          { stack: [generated, subtitle].filter(Boolean).map((t) => ({ text: t, fontSize: 8, color: C(REPORT_STYLE.muted), alignment: "right" })), width: "auto", margin: [0, 4, 0, 0] },
        ],
      },
      { canvas: [{ type: "line", x1: 0, y1: 6, x2: pageWidth - 64, y2: 6, lineWidth: 1.2, lineColor: C(REPORT_STYLE.brand) }] },
    ],
  });
  doc.footer = (page, pages) => ({
    margin: [32, 14, 32, 0],
    columns: [
      { text: reportStoreName() + "  ·  " + (body.length - 1 - (hasTotal ? 1 : 0)) + " rows", fontSize: 7.5, color: C(REPORT_STYLE.muted) },
      { text: "Page " + page + " of " + pages, fontSize: 7.5, color: C(REPORT_STYLE.muted), alignment: "right" },
    ],
  });
}

// exported cell text: <br> becomes a line break, other HTML is dropped
function exportCellText(data) {
  let html = String(data ?? "").replace(/<br\s*\/?>/gi, "\n");
  let text = $("<div>").html(html).text();
  return text.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
}

// Excel (.xlsx) / PDF export buttons used by every list table
// (styled by .ph-toolbar .dt-button in components.css).
// options.exportOptions: which columns etc.; options.sumColumns: indexes
// (within the exported columns) to total; options.subtitle: string or
// function shown under the title (e.g. the date range).
function tableExportButtons(title, options) {
  options = options || {};
  let exportOptions = Object.assign({}, options.exportOptions || {}, {
    stripHtml: false,
    format: {
      // a cell can set data-export="..." to say exactly what goes into the
      // Excel / PDF file (e.g. just the amount, without the extra lines shown on screen)
      body: (data, row, column, node) =>
        node && node.hasAttribute && node.hasAttribute("data-export")
          ? node.getAttribute("data-export")
          : exportCellText(data),
      header: (data) => exportCellText(data),
    },
  });
  let subtitle = () => (typeof options.subtitle === "function" ? options.subtitle() : options.subtitle || "");
  let fileBase = () => safeFileName(title) + " " + moment().format("YYYY-MM-DD HHmm");

  return [
    {
      text: '<i class="fa fa-file-excel-o"></i><span>Excel</span>',
      titleAttr: "Download as Excel (.xlsx)",
      className: "export-btn export-excel",
      exportOptions: exportOptions,
      action: function (e, dt, node, config) {
        let data = dt.buttons.exportData(config.exportOptions);
        let wb = buildReportWorkbook({
          title: title,
          subtitle: subtitle(),
          header: data.header,
          rows: data.body,
          sumColumns: options.sumColumns,
        });
        downloadWorkbook(wb, fileBase() + ".xlsx").catch((err) => {
          console.error("Excel export failed:", err);
          Swal.fire("Oops!", "Could not create the Excel file. Please try again.", "warning");
        });
      },
    },
    {
      extend: "pdf",
      title: title,
      filename: () => fileBase(),
      text: '<i class="fa fa-file-pdf-o"></i><span>PDF</span>',
      titleAttr: "Download as PDF",
      className: "export-btn export-pdf",
      exportOptions: exportOptions,
      customize: (doc) => styleReportPdf(doc, title, subtitle(), options.sumColumns),
    },
  ];
}

// Shared table layout (styled by .ph-toolbar / .ph-footer in components.css):
//   [Excel][PDF]  Show [10] rows ............ [search]
//   table
//   Showing 1 to 10 of N <noun> ........... Previous 1 2 3 Next
const TABLE_TOOLBAR_DOM =
  "<'ph-toolbar'<'ph-toolbar-left'Bl><'ph-toolbar-right'f>>" +
  "r<'ph-table-scroll't>" + // table in its own scroll area (fits popups, see .modal-fit)
  "<'ph-footer'<'ph-footer-left'i><'ph-footer-right'p>>";

// DataTables options for a list table with the shared layout.
// o.noun: what the rows are ("customers"); o.searchPlaceholder;
// o.exportTitle (omit for no Excel/PDF buttons) + o.exportColumns,
// o.sumColumns (exported column indexes to total), o.exportSubtitle;
// o.actionColumns: button columns (not sortable/searchable/exported).
function standardTableOptions(o) {
  o = o || {};
  let noun = o.noun || "entries";
  return {
    autoWidth: false,
    info: true,
    ordering: true,
    paging: true,
    pageLength: o.pageLength || 10,
    lengthMenu: [10, 25, 50, 100],
    dom: o.exportTitle ? TABLE_TOOLBAR_DOM : TABLE_TOOLBAR_DOM.replace("Bl>", "l>"),
    buttons: o.exportTitle
      ? tableExportButtons(o.exportTitle, {
          exportOptions: o.exportColumns ? { columns: o.exportColumns } : {},
          sumColumns: o.sumColumns,
          subtitle: o.exportSubtitle,
        })
      : [],
    // hiddenColumns: not shown on screen, still in the Excel / PDF exports
    columnDefs: (o.actionColumns
      ? [{ targets: o.actionColumns, orderable: false, searchable: false }]
      : []
    ).concat(o.hiddenColumns ? [{ targets: o.hiddenColumns, visible: false }] : []),
    language: {
      search: "_INPUT_",
      searchPlaceholder: o.searchPlaceholder || "Search...",
      lengthMenu: "Show _MENU_ rows",
      info: "Showing _START_ to _END_ of _TOTAL_ " + noun,
      infoEmpty: "Showing 0 " + noun,
      infoFiltered: "(filtered from _MAX_)",
      emptyTable: o.emptyTable || "No " + noun + " yet",
      zeroRecords: "No matching " + noun + " found",
    },
  };
}

// Reusable date range filter with a Clear option.
// Markup (see index.html): .date-range-filter > .date-range-input (span label)
// + .date-range-clear button. onChange() is called whenever the range is set
// or cleared. options.initial: { start, end } to start with a range instead
// of "All dates". Returns { matches(date), isActive(), getRange(), reset() }.
function initDateRangeFilter(container, onChange, options) {
  options = options || {};
  let $box = $(container);
  let $input = $box.find(".date-range-input");
  let $label = $input.find(".date-range-label");
  let $clear = $box.find(".date-range-clear");
  let range = options.initial // { start, end } as moments, or null for all dates
    ? {
        start: moment(options.initial.start).startOf("day"),
        end: moment(options.initial.end).endOf("day"),
      }
    : null;

  function show() {
    if (range) {
      $label.text(
        range.start.format("D MMM YYYY") + "  -  " + range.end.format("D MMM YYYY")
      );
    } else {
      $label.text("All dates");
    }
    $clear.toggle(!!range);
    $box.toggleClass("has-range", !!range);
  }

  function set(newRange, notify) {
    range = newRange;
    show();
    if (notify !== false && typeof onChange === "function") onChange();
  }

  $input.daterangepicker({
    autoUpdateInput: false,
    startDate: range ? range.start : moment(),
    endDate: range ? range.end : moment(),
    showDropdowns: true,
    alwaysShowCalendars: true,
    opens: "right",
    locale: { format: "D MMM YYYY", cancelLabel: "Clear", applyLabel: "Apply" },
    ranges: {
      Today: [moment(), moment()],
      Yesterday: [moment().subtract(1, "days"), moment().subtract(1, "days")],
      "Last 7 Days": [moment().subtract(6, "days"), moment()],
      "Last 30 Days": [moment().subtract(29, "days"), moment()],
      "This Month": [moment().startOf("month"), moment().endOf("month")],
      "Last Month": [
        moment().subtract(1, "month").startOf("month"),
        moment().subtract(1, "month").endOf("month"),
      ],
    },
  });

  // use the events (not the callback): the callback doesn't fire when the
  // same range is applied again after clearing
  $input.on("apply.daterangepicker", function (ev, picker) {
    set({
      start: picker.startDate.clone().startOf("day"),
      end: picker.endDate.clone().endOf("day"),
    });
  });
  $input.on("cancel.daterangepicker", function () {
    set(null);
  });
  $clear.on("click", function () {
    set(null);
  });

  show();

  return {
    matches: function (date) {
      if (!range) return true;
      let d = moment(date);
      return d.isValid() && !d.isBefore(range.start) && !d.isAfter(range.end);
    },
    isActive: function () {
      return !!range;
    },
    getRange: function () {
      return range ? { start: range.start.clone(), end: range.end.clone() } : null;
    },
    // back to "All dates" without triggering onChange
    reset: function () {
      let picker = $input.data("daterangepicker");
      if (picker) {
        picker.setStartDate(moment());
        picker.setEndDate(moment());
      }
      set(null, false);
    },
  };
}

// Transactions page date filter: starts on "All dates" like every other date
// filter (start_date/end_date empty = no date limit in the by-date query).
$(function () {
  let transactionsDateFilter = initDateRangeFilter(
    "#transactionsDateRange",
    function () {
      let range = transactionsDateFilter.getRange();
      start_date = range ? range.start.toDate().toJSON() : "";
      end_date = range ? range.end.toDate().toJSON() : "";
      loadTransactions();
    }
  );

  // Profit section: its own date range ("All dates" by default)
  profitDateFilter = initDateRangeFilter("#profitDateRange", refreshProfit);
});

$.fn.serializeObject = function () {
  var o = {};
  var a = this.serializeArray();
  $.each(a, function () {
    if (o[this.name]) {
      if (!o[this.name].push) {
        o[this.name] = [o[this.name]];
      }
      o[this.name].push(this.value || "");
    } else {
      o[this.name] = this.value || "";
    }
  });
  return o;
};

// Session-scoped login flag: survives window.reload() (used right after
// login/logout) but is cleared when the app restarts, so the login screen
// always shows on launch instead of auto-entering the previous session.
let authedThisSession = sessionStorage.getItem("auth") === "1";

auth = storage.get("auth");
user = storage.get("user");

if (!authedThisSession) {
  $("#loading").show();
  // first launch on this machine (no user accounts yet): set up the
  // administrator instead of logging in
  $.get(api + "users/setup-status")
    .done(function (status) {
      if (status && status.needsSetup) {
        showFirstRunSetup();
      } else {
        $.get(api + "users/check/");
        authenticate();
      }
    })
    .fail(function () {
      $.get(api + "users/check/");
      authenticate();
    });
} else {
  $("#loading").show();

  setTimeout(function () {
    $("#loading").hide();
  }, 2000);

  platform = storage.get("settings");

  if (platform != undefined) {
    if (platform.app == "Network Point of Sale Terminal") {
      api = "http://" + platform.ip + ":" + port + "/api/";
      perms = true;
    }
  }

  $.get(api + "users/user/" + user._id, function (data) {
    user = data;
    applyProfitPermission();
    applyExpensesPermission();
    applySuppliersPermission();
    applyJournalPermission();
    $("#loggedin-user").text(user.fullname);
    $("#cashier").attr("title", user.fullname);
  });

  $.get(api + "settings/get", function (data) {
    settings = data.settings;
    if (settings.return_disabled == "on") {
      $("#returnOrdersBtn").hide();
    }
    if (settings.exchange_disabled == "on") {
      $("#exchangeOrdersBtn").hide();
    }
    if (settings.stock_check_disabled == "on") {
      $("#stock").parent().hide();
    }
  });

  $.get(api + "users/all", function (users) {
    allUsers = [...users];
  });

  $(document).ready(function () {
    $(".loading").hide();

    loadCategories();
    loadProducts();
    loadCustomers();

    // stock changed elsewhere (e.g. a GRN on the Suppliers page)
    $(document).on("products:changed", function () {
      loadProducts();
    });

    if (settings && settings.symbol) {
      $("#price_curr, #payment_curr, #change_curr").text(settings.symbol);
    }

    setTimeout(function () {
      if (settings == undefined && auth != undefined) {
        $("#settingsModal").modal("show");
      } else {
        vat = parseFloat(settings.percentage);
        $("#taxInfo").text(settings.charge_tax ? vat : 0);
      }
    }, 1500);

    $("#settingsModal").on("hide.bs.modal", function () {
      setTimeout(function () {
        if (settings == undefined && auth != undefined) {
          $("#settingsModal").modal("show");
        }
      }, 1000);
    });

    if (0 == user.perm_products) {
      $(".p_one").hide();
    }
    if (0 == user.perm_categories) {
      $(".p_two").hide();
    }
    // the Products window also holds the Categories tab
    if (0 == user.perm_products && 0 == user.perm_categories) {
      $("#productsToolbarGroup").hide();
    }
    if (0 == user.perm_transactions) {
      $(".p_three").hide();
    }
    if (0 == user.perm_users) {
      $(".p_four").hide();
    }
    if (0 == user.perm_settings) {
      $(".p_five").hide();
    }
    applyProfitPermission();
    applyExpensesPermission();
    applySuppliersPermission();
    applyJournalPermission();

    // product id -> open stock batches, from the latest product lookup (the
    // till's price codes). Declared before loadProducts, which resets it.
    let cartBatchInfo = {};

    // function to load products
    function loadProducts() {
      $.get(api + "inventory/products", function (data) {
        data.forEach((item) => {
          item.price = parseFloat(item.price).toFixed(2);
        });

        allProducts = [...data];
        cartBatchInfo = {}; // the fresh products carry the current stock batches
        loadProductList();
        const capitalizeFirstLetter = (word) =>
          `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

        let delay = 0;
        allProducts?.forEach((product) => {
          if (product.stock != 1) return; // doesn't track stock: no stock warnings
          let name = capitalizeFirstLetter(product.name);
          if (product.quantity <= 5 && product.quantity > 2) {
            stockToast("warning", `${name} has only ${product.quantity} left in the inventory`, 4000 + delay);
          } else if (product.quantity >= 1 && product.quantity <= 2) {
            stockToast("failure", `${name} has only ${product.quantity} left in the inventory`, 8000 + delay * 2);
          } else if (product.quantity < 1) {
            stockToast("failure", `${name} is out of stock. Please restock.`, 8000 + delay * 2);
          }
          delay += 100;
        });

        $("#parent").text("");
        categories = [];

        // group products with the same name inside the same category so
        // they share one tile; each group's variants keep their own price,
        // barcode and stock, picked via a popup when the tile is clicked.
        // Only what can be sold shows: a product that tracks stock and has
        // none left has no tile (and no price in a tile's price range or
        // price list); products that don't track stock always show.
        let groupsByKey = {};
        data.forEach((item) => {
          if (item.stock == 1 && !((parseInt(item.quantity) || 0) > 0)) return;
          if (!categories.includes(item.category)) {
            categories.push(item.category);
          }

          let key = item.category + "||" + item.name;
          if (!groupsByKey[key]) {
            groupsByKey[key] = {
              category: item.category,
              name: item.name,
              variants: [],
            };
          }
          groupsByKey[key].variants.push(item);
        });

        posProductGroups = Object.values(groupsByKey);

        posProductGroups.forEach((group, groupIndex) => {
          let representative = group.variants[0];
          // a product with stock at several selling prices shows them all
          let prices = [];
          let priceCount = 0;
          group.variants.forEach((v) => {
            let sets = priceSetsOf(v);
            if (sets.length) sets.forEach((set) => prices.push(parseFloat(set.price)));
            else prices.push(parseFloat(v.price));
            priceCount += Math.max(sets.length, 1);
          });
          let minPrice = Math.min(...prices);
          let maxPrice = Math.max(...prices);
          let priceLabel =
            minPrice === maxPrice
              ? settings.symbol + minPrice.toFixed(2)
              : `${settings.symbol}${minPrice.toFixed(
                  2
                )} - ${settings.symbol}${maxPrice.toFixed(2)}`;

          let trackedVariants = group.variants.filter((v) => v.stock == 1);
          let totalStock = trackedVariants.reduce(
            (sum, v) => sum + (parseInt(v.quantity) || 0),
            0
          );
          let stockLabel = trackedVariants.length > 0 ? totalStock : "N/A";

          let item_info = `<div class="col-lg-2 box ${group.category}"
                          onclick="$(this).selectVariant(${groupIndex})">
                      <div class="widget-panel widget-style-2 ">
                      <div id="image"><img src="${
                        representative.img == ""
                          ? "./assets/images/default.jpg"
                          : img_path + representative.img
                      }" id="product_img" alt=""></div>
                                  <div class="text-muted m-t-5 text-center">
                                  <div class="name" id="product_name">${
                                    group.name
                                  }</div>
                                  <span class="sku">${
                                    priceCount > 1
                                      ? priceCount + " prices"
                                      : representative.sku || ""
                                  }</span>
                                  <span class="stock">STOCK </span><span class="count">${stockLabel}</span></div>
                                  <sp class="text-success text-center"><b data-plugin="counterup">${priceLabel}</b> </sp>
                      </div>
                  </div>`;
          $("#parent").append(item_info);
        });

        if (!posProductGroups.length && data.length) {
          $("#parent").html(
            `<div class="pos-no-stock text-muted"><i class="fa fa-cubes"></i><br>No products in stock.<br><small>Receive goods (GRN) or update the stock in Products.</small></div>`
          );
        }

        renderCategoryButtons();
      });
    }

    // Products and categories load in parallel, so this runs after either
    // finishes; otherwise buttons built before the category names arrive
    // end up with empty labels.
    function renderCategoryButtons() {
      $("#categories").html(
        `<button type="button" id="all" class="btn btn-categories btn-white waves-effect waves-light">All</button> `
      );

      categories.forEach((category) => {
        let c = allCategories.find((ctg) => ctg._id == category);
        let label = c ? c.name : "Uncategorized";

        $("#categories").append(
          `<button type="button" id="${category}" class="btn btn-categories btn-white waves-effect waves-light">${label}</button> `
        );
      });
    }

    function loadCategories() {
      $.get(api + "categories/all", function (data) {
        allCategories = data;
        renderCategoryButtons();
        loadCategoryList();
        $("#category").html(`<option value="0">Select</option>`);
        allCategories.forEach((category) => {
          $("#category").append(
            `<option value="${category._id}">${category.name}</option>`
          );
        });
      });
    }

    function loadCustomers() {
      $.get(api + "customers/all", function (customers) {
        $("#customer").html(
          `<option value="0" selected="selected">Walk in customer</option>`
        );

        customers.forEach((cust) => {
          $("#customer").append(
            $("<option>", {
              text: cust.name,
              value: JSON.stringify({ id: cust._id, name: cust.name }),
            })
          );
        });

        // Initialize or update Chosen plugin for searchable dropdown
        $('#customer').chosen({ width: '100%', search_contains: true });
        $('#customer').trigger("chosen:updated");
      });
    }

    // called when a POS tile is clicked. Products with the same name share a
    // tile, and a product can have several selling prices (stock batches,
    // each with its own barcode): with more than one choice a popup asks
    // which to ring up, otherwise it is added directly
    $.fn.selectVariant = function (groupIndex) {
      let group = posProductGroups[groupIndex];
      if (!group || group.variants.length === 0) return;

      let choices = [];
      group.variants.forEach((v) => {
        let sets = priceSetsOf(v);
        if (sets.length > 1) sets.forEach((set) => choices.push({ v: v, set: set }));
        else choices.push({ v: v, set: sets[0] || null });
      });

      if (choices.length === 1) {
        let c = choices[0];
        $(this).addToCart(c.v._id, c.v.quantity, c.v.stock, c.set ? c.set.code : null);
        return;
      }

      let optionsHtml = choices
        .map((c, i) => {
          let code = c.set ? c.set.code : c.v.barcode;
          let price = c.set ? c.set.price : c.v.price;
          let left = c.set ? c.set.qty_left : c.v.stock == 1 ? c.v.quantity : null;
          return `<button type="button" class="btn btn-white btn-block variant-option" data-choice="${i}"
              style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <span style="text-align:left;">${code ? "<b>" + txnHtml(code) + "</b>" : ""}${
                c.set || left !== null
                  ? `<br><small class="text-muted">${c.set ? txnHtml(c.set.references.join(", ")) + " · " : ""}${left !== null ? left + " left" : ""}</small>`
                  : ""
              }</span>
              <span style="font-size: 16px;"><b>${settings.symbol}${(parseFloat(price) || 0).toFixed(2)}</b></span>
            </button>`;
        })
        .join("");

      Swal.fire({
        title: `Select price for ${txnHtml(group.name)}`,
        html: `<p class="text-muted" style="font-size: 13px;">Check the barcode / price label on the item.</p><div class="variant-list">${optionsHtml}</div>`,
        showConfirmButton: false,
        showCloseButton: true,
        didOpen: (popup) => {
          $(popup)
            .find(".variant-option")
            .on("click", function () {
              let c = choices[parseInt($(this).data("choice"))];
              Swal.close();
              if (c) $(document).addToCart(c.v._id, c.v.quantity, c.v.stock, c.set ? c.set.code : null);
            });
        },
      });
    };

    // code: the selling price picked (a price barcode), if any
    $.fn.addToCart = function (id, count, stock, code) {
      if (stock == 1 && !(count > 0)) {
        Swal.fire("Out of stock!", "This item is currently unavailable", "info");
        return;
      }
      $.get(api + "inventory/product/" + id, function (data) {
        addLookedUpProduct(data, code);
      });
    };

    function barcodeSearch(e) {
      e.preventDefault();
      $("#basic-addon2").empty();
      $("#basic-addon2").append($("<i>", { class: "fa fa-spinner fa-spin" }));

      let req = {
        skuCode: $("#skuCode").val(),
      };

      $.ajax({
        url: api + "inventory/product/sku",
        type: "POST",
        data: JSON.stringify(req),
        contentType: "application/json; charset=utf-8",
        cache: false,
        processData: false,
        success: function (data) {
          if (data.barcode != undefined && data.quantity >= 1) {
            // a price barcode rings up that price (stock batches)
            addLookedUpProduct(data, data.scanned_code);
            $("#searchBarCode").get(0).reset();
            $("#basic-addon2").empty();
            $("#basic-addon2").append(
              $("<i>", { class: "glyphicon glyphicon-ok" })
            );
          } else if (data.quantity < 1) {
            Swal.fire(
              "Out of stock!",
              "This item is currently unavailable",
              "info"
            );
          } else {
            Swal.fire(
              "Not Found!",
              "<b>" + $("#skuCode").val() + "</b> is not a valid barcode!",
              "warning"
            );

            $("#searchBarCode").get(0).reset();
            $("#basic-addon2").empty();
            $("#basic-addon2").append(
              $("<i>", { class: "glyphicon glyphicon-ok" })
            );
          }
        },
        error: function (data) {
          if (data.status === 422) {
            $(this).showValidationError(data);
            $("#basic-addon2").append(
              $("<i>", { class: "glyphicon glyphicon-remove" })
            );
          } else if (data.status === 404) {
            $("#basic-addon2").empty();
            $("#basic-addon2").append(
              $("<i>", { class: "glyphicon glyphicon-remove" })
            );
          } else {
            $(this).showServerError();
            $("#basic-addon2").empty();
            $("#basic-addon2").append(
              $("<i>", { class: "glyphicon glyphicon-warning-sign" })
            );
          }
        },
      });
    }

    $("#searchBarCode").on("submit", function (e) {
      barcodeSearch(e);
    });

    $("body").on("click", "#jq-keyboard button", function (e) {
      let pressed = $(this)[0].className.split(" ");
      if ($("#skuCode").val() != "" && pressed[2] == "enter") {
        barcodeSearch(e);
      }
    });

    // ---- one product, several selling prices (stock batches, api/inventory.js) ----
    // Goods received at a different cost have their own selling price and
    // their own barcode ("<product barcode>-2", ...). Scanning a price's
    // barcode rings up that price; clicking a product with several prices asks
    // which one. The cart keeps one line per price (batch_code) and the sale
    // takes its stock from that price's batches. (cartBatchInfo: see loadProducts)

    function cartBatches(id) {
      let list = cartBatchInfo[id];
      if (!list) {
        let p = allProducts.find((x) => x._id == id);
        list = (p && p.batches) || [];
      }
      return list.filter((b) => b.qty_left > 0);
    }

    // a product's selling prices with stock, one per barcode, oldest first:
    // [{ code, price, cost, qty_left, batch_id, references }]
    function priceSetsOf(product) {
      let sets = [];
      ((product && product.batches) || [])
        .filter((b) => b.qty_left > 0)
        .forEach((b) => {
          let code = b.barcode || "";
          let set = sets.find((x) => x.code === code);
          if (set) {
            set.qty_left += b.qty_left;
            set.references.push(b.reference);
          } else {
            sets.push({
              code: code,
              price: b.selling_price,
              cost: b.unit_cost,
              qty_left: b.qty_left,
              batch_id: b._id,
              references: [b.reference],
            });
          }
        });
      return sets;
    }

    function cartQtyOf(id) {
      return cart.reduce((s, l) => s + (l.id == id ? parseInt(l.quantity) || 0 : 0), 0);
    }

    function noMoreStock() {
      Swal.fire("No more stock!", "You have already added all the available stock.", "info");
    }

    // asks which selling price to ring up (note: shown above the list)
    function pickPriceSet(product, sets, note, done) {
      let options = sets
        .map(
          (set, i) => `<button type="button" class="btn btn-white btn-block variant-option" data-set="${i}"
              style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <span style="text-align:left;"><b>${txnHtml(set.code)}</b><br><small class="text-muted">${txnHtml(set.references.join(", "))} · ${set.qty_left} left</small></span>
              <span style="font-size: 16px;"><b>${settings.symbol}${(parseFloat(set.price) || 0).toFixed(2)}</b></span>
            </button>`
        )
        .join("");
      Swal.fire({
        title: `Select price for ${txnHtml(product.name)}`,
        html: `<p class="text-muted" style="font-size: 13px;">${note || "Check the barcode / price label on the item."}</p><div class="variant-list">${options}</div>`,
        showConfirmButton: false,
        showCloseButton: true,
        didOpen: (popup) => {
          $(popup)
            .find(".variant-option")
            .on("click", function () {
              let set = sets[parseInt($(this).data("set"))];
              Swal.close();
              if (set) done(set);
            });
        },
      });
    }

    // Adds a looked-up product at the price of the code scanned / picked;
    // a product with several prices and no code asks which one.
    function addLookedUpProduct(data, code) {
      let sets = priceSetsOf(data);
      let chosen = code ? sets.find((set) => set.code === String(code)) : null;
      if (chosen) return $(document).addProductToCart(data, chosen);
      if (sets.length > 1) {
        let note = code
          ? `Nothing is left at the price of <b>${txnHtml(code)}</b>. Check the label and pick the price to charge.`
          : "";
        return pickPriceSet(data, sets, note, (set) => $(document).addProductToCart(data, set));
      }
      $(document).addProductToCart(data, sets[0] || null);
    }

    // set: the selling price to ring up (from priceSetsOf); none for a
    // product without stock batches
    $.fn.addProductToCart = function (data, set) {
      cartBatchInfo[data._id] = data.batches || [];
      item = {
        id: data._id,
        product_name: data.name,
        sku: data.sku,
        price: set ? set.price : data.price,
        // cost at the time of sale, saved with the transaction for profit
        cost_price: set ? set.cost ?? "" : data.cost_price ?? "",
        img: data.img,
        quantity: 1,
      };
      if (set) {
        item.batch_code = set.code; // which price (barcode) this line is
        item.batch_id = set.batch_id;
      }

      if ($(this).isExist(item)) {
        $(this).qtIncrement(index);
      } else {
        cart.push(item);
        $(this).renderTable(cart);
      }
    };

    // the same product at the same price is already in the cart
    $.fn.isExist = function (data) {
      let toReturn = false;
      $.each(cart, function (index, value) {
        if (value.id == data.id && String(value.batch_code || "") === String(data.batch_code || "")) {
          $(this).setIndex(index);
          toReturn = true;
        }
      });
      return toReturn;
    };

    $.fn.setIndex = function (value) {
      index = value;
    };

    $.fn.calculateCart = function () {
      let total = 0;
      let grossTotal;
      $("#total").text(cart.length);
      $.each(cart, function (index, data) {
        total += data.quantity * data.price;
      });
      let discount = $("#inputDiscount").val();
      if (discount < 0) {
        $("#inputDiscount").val(0);
        discount = 0;
      }
      total = total - discount;
      $("#price").text(settings.symbol + total.toFixed(2));

      subTotal = total;

      if ($("#inputDiscount").val() >= total) {
        $("#inputDiscount").val(0);
      }

      if (settings.charge_tax) {
        totalVat = (total * vat) / 100;
        grossTotal = total + totalVat;
      } else {
        grossTotal = total;
      }

      orderTotal = grossTotal.toFixed(2);

      $("#gross_price").text(settings.symbol + grossTotal.toFixed(2));
      $("#payablePrice").val(grossTotal);
    };

    $.fn.renderTable = function (cartList) {
      $("#cartTable > tbody").empty();
      $(this).calculateCart();
      $.each(cartList, function (index, data) {
        $("#cartTable > tbody").append(
          $("<tr>").append(
            $("<td>", { text: index + 1 }),
            $("<td>").append(
              $("<span>", { text: data.product_name }),
              data.batch_code ? [$("<br>"), $("<small>", { class: "text-muted", text: data.batch_code })] : []
            ),
            $("<td>").append(
              $("<div>", { id: "image", class: "cart-image-wrapper" }).append(
                $("<img>", {
                  src:
                    data.img == ""
                      ? "./assets/images/default.jpg"
                      : img_path + data.img,
                  id: "product_img",
                  alt: "",
                  class: "cart-image",
                })
              )
            ),
            $("<td>").append(
              $("<div>", { class: "input-group" }).append(
                $("<div>", { class: "input-group-btn btn-xs" }).append(
                  $("<button>", {
                    class: "btn btn-default btn-xs increase-btn",
                    onclick: "$(this).qtDecrement(" + index + ")",
                  }).append($("<i>", { class: "fa fa-minus" }))
                ),
                $("<input>", {
                  class: "cart-quantity-form",

                  value: data.quantity,
                  onInput: "$(this).qtInput(" + index + ")",
                }),
                $("<div>", { class: "input-group-btn btn-xs" }).append(
                  $("<button>", {
                    class: "btn btn-default btn-xs increase-btn",
                    onclick: "$(this).qtIncrement(" + index + ")",
                  }).append($("<i>", { class: "fa fa-plus" }))
                )
              )
            ),
            $("<td>", {
              text: settings.symbol + (data.price * data.quantity).toFixed(2),
            }),
            $("<td>").append(
              $("<button>", {
                class: "btn btn-danger btn-xs",
                onclick: "$(this).deleteFromCart(" + index + ")",
              }).append($("<i>", { class: "fa fa-times" }))
            )
          )
        );
      });
    };

    $.fn.deleteFromCart = function (index) {
      cart.splice(index, 1);
      $(this).renderTable(cart);
    };

    $.fn.qtIncrement = function (i) {
      item = cart[i];

      // a line at one price can't have more than is left at that price
      if (item.batch_code) {
        let set = priceSetsOf({ batches: cartBatches(item.id) }).find((x) => x.code === item.batch_code);
        if (set && (parseInt(item.quantity) || 0) >= set.qty_left) {
          Swal.fire(
            "No more stock at this price!",
            `Only ${set.qty_left} left at ${settings.symbol}${(parseFloat(set.price) || 0).toFixed(2)} (${txnHtml(set.code)}). Ring up the rest at their own price.`,
            "info"
          );
          return;
        }
      }

      let product = allProducts.filter(function (selected) {
        return selected._id == parseInt(item.id);
      });

      if (product[0] && product[0].stock == 1) {
        // all lines of the product together (one line per price)
        if (cartQtyOf(item.id) < product[0].quantity) {
          item.quantity = (parseInt(item.quantity) || 0) + 1;
          $(this).renderTable(cart);
        } else {
          noMoreStock();
        }
      } else {
        item.quantity = (parseInt(item.quantity) || 0) + 1;
        $(this).renderTable(cart);
      }
    };

    $.fn.qtDecrement = function (i) {
      item = cart[i];
      if (item && item.quantity > 1) {
        item.quantity -= 1;
        $(this).renderTable(cart);
      }
    };

    $.fn.qtInput = function (i) {
      item = cart[i];
      item.quantity = $(this).val();
      $(this).renderTable(cart);
    };

    $.fn.cancelOrder = function () {
      if (cart.length > 0) {
        Swal.fire({
          title: "Are you sure?",
          text: "You are about to remove all items from the cart.",
          icon: "warning",
          showCancelButton: true,
          confirmButtonColor: "#3085d6",
          cancelButtonColor: "#d33",
          confirmButtonText: "Yes, clear it!",
        }).then((result) => {
          if (result.value) {
            cart = [];
            $(this).renderTable(cart);
            holdOrder = 0;

            Swal.fire("Cleared!", "All items have been removed.", "success");
          }
        });
      }
    };

    $("#payButton").on("click", function () {
      if (cart.length != 0) {
        $("#card").toggle(settings.card_disabled != "on");
        $("#bank").toggle(settings.bank_disabled != "on");
        
        // Credit is always listed, but only usable for a registered customer
        let customer = JSON.parse($("#customer").val());
        $("#credit")
          .show()
          .toggleClass("disabled", customer == 0)
          .attr(
            "title",
            customer == 0 ? "Available for registered customers only" : ""
          );

        if (
          (paymentType == 2 && settings.card_disabled == "on") ||
          (paymentType == 4 && settings.bank_disabled == "on") ||
          (paymentType == 5 && customer == 0)
        ) {
          paymentType = 1;
          $(".list-group-item").removeClass("active");
          $("#cash").addClass("active");
          $("#cardInfo").hide();
        }

        setupPaymentAdvance(customer);
        $("#paymentModel").modal("toggle");
      } else {
        Swal.fire("Oops!", "There is nothing to pay!", "warning");
      }
    });

    // ---- Customer advance in the Pay window ----
    // A registered customer can (a) use their advance to pay part or all of
    // this bill, and (b) keep any extra they pay as advance for the next bill.
    let paymentAdvance = { customer: null, balance: 0, applied: 0, requestId: 0 };

    function advanceMoney(n) {
      return settings.symbol + (parseFloat(n) || 0).toFixed(2);
    }

    // called when the Pay window opens
    function setupPaymentAdvance(customer) {
      let registered = customer && customer != 0;
      paymentAdvance = { customer: registered ? customer : null, balance: 0, applied: 0, requestId: paymentAdvance.requestId + 1 };
      $("#paymentModel").data("advanceCustomer", registered ? customer.name : "");
      $("#advanceKeepCustomer").text(registered ? customer.name : "");
      $("#useAdvance").prop("checked", false);
      $("#keepAsAdvance").prop("checked", false);
      // split payment (part now, rest on credit) starts unticked
      $("#creditRemainder").prop("checked", false);
      $("#creditRemainderRow").hide();
      $("#creditRemainderCustomer").text(registered ? customer.name : "");
      $("#advancePanel").hide();
      $("#advanceKeepRow").hide();
      applyPaymentAdvance();
      if (!registered) return $.Deferred().resolve().promise();

      let requestId = paymentAdvance.requestId;
      return $.get(api + "customer-advance/" + customer.id).done(function (data) {
        if (requestId !== paymentAdvance.requestId) return; // window reopened meanwhile
        paymentAdvance.balance = parseFloat(data && data.balance) || 0;
        $("#advanceAvailable").text(advanceMoney(paymentAdvance.balance));
        updateAdvanceForPaymentType();
      });
    }

    // Print the bill before paying (POS screen Print button): looks up a
    // registered customer's advance and shows it deducted.
    $.fn.printBill = function () {
      if (!cart.length) {
        Swal.fire("Oops!", "There is nothing to print!", "warning");
        return;
      }
      let self = this;
      // the method isn't chosen yet: print as unpaid, with the advance deducted
      let customer = JSON.parse($("#customer").val());
      $("#payment").val("");
      setupPaymentAdvance(customer).always(function () {
        let savedType = paymentType;
        paymentType = 1;
        updateAdvanceForPaymentType();
        try {
          $(self).submitDueOrder(3);
        } finally {
          paymentType = savedType;
        }
      });
    };

    // A registered customer's advance is deducted from the bill automatically.
    // Credit sales can't use or save advance (the customer pays later), so
    // the panel then just says the advance isn't used.
    function updateAdvanceForPaymentType() {
      let hasAdvance = paymentAdvance.customer && paymentAdvance.balance > 0;
      let onCredit = paymentType === 5;
      $("#advancePanel").toggle(!!hasAdvance).toggleClass("advance-panel-off", !!(hasAdvance && onCredit));
      $("#advanceUseLabel").html(
        onCredit
          ? '<i class="fa fa-info-circle"></i> Advance isn\'t used on Credit sales'
          : '<i class="fa fa-check-circle"></i> Advance applied to this bill'
      );
      $("#useAdvance").prop("checked", !!(hasAdvance && !onCredit));
      applyPaymentAdvance();
    }

    // sets "Price" to what's left to pay after the advance, and recalculates change
    function applyPaymentAdvance() {
      let billTotal = parseFloat(orderTotal) || 0;
      let use = $("#useAdvance").is(":checked") && paymentType !== 5;
      paymentAdvance.applied = use ? Math.round(Math.min(paymentAdvance.balance, billTotal) * 100) / 100 : 0;
      let toPay = Math.round((billTotal - paymentAdvance.applied) * 100) / 100;
      $("#payablePrice").val(toPay.toFixed(2));
      $("#advanceBreakdown").html(
        paymentAdvance.applied > 0
          ? `Bill ${advanceMoney(billTotal)} &minus; advance ${advanceMoney(paymentAdvance.applied)} = <b>to pay ${advanceMoney(toPay)}</b>` +
              (paymentAdvance.balance - paymentAdvance.applied > 0.004
                ? ` &nbsp;·&nbsp; advance left after this bill: ${advanceMoney(paymentAdvance.balance - paymentAdvance.applied)}`
                : "")
          : ""
      );
      $(this).calculateChange();
    }

    $("#useAdvance").on("change", applyPaymentAdvance);
    $("#keepAsAdvance, #creditRemainder").on("change", function () {
      $(this).calculateChange();
    });

    // split payment: what's left on credit after the advance and the amount paid now
    function splitCreditAmount() {
      if (paymentType === 5) return 0;
      if (!$("#creditRemainder").is(":checked") || !$("#creditRemainderRow").is(":visible")) return 0;
      let toPay = parseFloat($("#payablePrice").val()) || 0;
      let paidNow = parseFloat($("#payment").val()) || 0;
      return Math.max(Math.round((toPay - paidNow) * 100) / 100, 0);
    }

    $("#hold").on("click", function () {
      if (cart.length != 0) {
        $("#dueModal").modal("toggle");
      } else {
        Swal.fire("Oops!", "There is nothing to hold!", "warning");
      }
    });

    function printJobComplete() {
      alert("print job complete");
    }

    $(document).ready(function () {
      $(".list-group-item").click(function () {
        if ($(this).hasClass("disabled")) {
          if (this.id == "credit") {
            Swal.fire(
              "Credit not available",
              "Credit payment is available for registered customers only. Please select a registered customer (or add a new one) before choosing Credit.",
              "info"
            );
          }
          return;
        }

        var buttonValue = $(this).text().trim();
        if (buttonValue == "Cash") {
          paymentType = 1;
        }
        if (buttonValue == "Card") {
          paymentType = 2;
        }
        if (buttonValue == "Bank Transfer") {
          paymentType = 4;
        }
        if (buttonValue == "Credit") {
          paymentType = 5;
        }
        // advance options follow the payment type (none on Credit); after the
        // other click handler has marked the new option active
        setTimeout(updateAdvanceForPaymentType, 0);
      });
    });

    // creditChecked: internal flag, set once the credit limit has been verified
    $.fn.submitDueOrder = function (status, creditChecked) {
      // Credit sales must fit within the customer's credit limit (if any).
      // Printing (status 3) doesn't save anything, so it isn't checked.
      let splitPart = status == 1 ? splitCreditAmount() : 0;
      if ((paymentType === 5 || splitPart > 0) && status != 3 && !creditChecked) {
        let creditCustomer = JSON.parse($("#customer").val());
        if (creditCustomer != 0) {
          let self = this;
          // a split payment only puts the remaining part on credit
          checkCreditLimit(creditCustomer, splitPart > 0 ? splitPart : orderTotal, holdOrder || null).then(
            (ok) => {
              if (ok) $(self).submitDueOrder(status, true);
            }
          );
          return;
        }
      }

      // setting value of card info / bank info to empty
      $("#paymentInfo").val("");

      let items = "";
      let payment = 0;

      cart.forEach((item) => {
        items +=
          "<tr><td>" +
          item.product_name +
          "</td><td>" +
          item.quantity +
          "</td><td>" +
          settings.symbol +
          parseFloat(item.price).toFixed(2) +
          "</td></tr>";
      });

      let currentTime = new Date(moment());

      let discount = $("#inputDiscount").val();
      let customer = JSON.parse($("#customer").val());
      
      if (paymentType === 5 && customer == 0) {
        Swal.fire("Action Denied", "Walk in customer cannot do credit payment. Please register or select a customer first.", "error");
        return;
      }

      let date = moment(currentTime).format("YYYY-MM-DD HH:mm:ss");
      let paid =
        $("#payment").val() == ""
          ? ""
          : parseFloat($("#payment").val()).toFixed(2);
      let change =
        $("#change").text() == ""
          ? ""
          : parseFloat($("#change").text()).toFixed(2);
      let refNumber = $("#refNumber").val();
      let orderNumber = holdOrder;
      let type = "";
      let tax_row = "";

      switch (paymentType) {
        case 1:
          type = "Cash";
          break;

        case 2:
          type = "Card";
          break;
        case 4:
          type = "Bank Transfer";
          break;
        case 5:
          type = "Credit";
          break;
        default:
          type = "Cash";
      }

      // customer advance on this sale (only when it's paid now, not on Credit):
      // advance used towards the bill, and any extra paid kept for the next bill
      let advanceUsed = 0;
      let advanceDeposit = 0;
      // status 1 = paying now, status 3 = printing the bill before paying (same figures)
      let showsPayment = status == 1 || status == 3;
      if (showsPayment && type !== "Credit" && paymentAdvance.customer) {
        advanceUsed = paymentAdvance.applied || 0;
        if ($("#keepAsAdvance").is(":checked") && $("#advanceKeepRow").is(":visible")) {
          let toPay = parseFloat($("#payablePrice").val()) || 0;
          advanceDeposit = Math.max(Math.round(((parseFloat(paid) || 0) - toPay) * 100) / 100, 0);
          if (advanceDeposit > 0) change = "0.00"; // no change given: it's kept
        }
      }
      // split payment: the rest of the bill goes on the customer's credit
      let creditPart = showsPayment && type !== "Credit" && paymentAdvance.customer ? splitCreditAmount() : 0;
      if (creditPart > 0) change = "0.00";
      let methodLabel = creditPart > 0 ? type + " + Credit" : type;

      // the customer's advance after this bill (shown on the receipt, saved with the sale)
      let advanceAfter =
        showsPayment && type !== "Credit" && paymentAdvance.customer
          ? Math.max(Math.round((paymentAdvance.balance - advanceUsed + advanceDeposit) * 100) / 100, 0)
          : null;

      // a bill printed before paying in full: what's still owed (not on credit)
      let balanceDue = 0;
      if (status == 3 && paid != "") {
        let toPayNow = Math.max((parseFloat(orderTotal) || 0) - advanceUsed, 0);
        balanceDue = Math.round((toPayNow - (parseFloat(paid) || 0) - creditPart) * 100) / 100;
        if (balanceDue < 0.005) balanceDue = 0;
      }

      if (paid == "" && advanceUsed > 0) {
        // printed bill before any payment: the advance is already deducted
        payment = `<tr>
                        <td>Advance used</td>
                        <td>:</td>
                        <td>-${settings.symbol + advanceUsed.toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td><b>Amount to pay</b></td>
                        <td>:</td>
                        <td><b>${settings.symbol + Math.max((parseFloat(orderTotal) || 0) - advanceUsed, 0).toFixed(2)}</b></td>
                    </tr>`;
      }
      if (status == 3 && paid == "" && type === "Credit" && customer != 0) {
        // printed bill for a credit sale (registered customers only)
        payment = `<tr>
                        <td><b>On credit</b></td>
                        <td>:</td>
                        <td><b>${settings.symbol + (parseFloat(orderTotal) || 0).toFixed(2)}</b></td>
                    </tr>
                    <tr>
                        <td>Method</td>
                        <td>:</td>
                        <td>Credit</td>
                    </tr>`;
      }
      if (paid != "") {
        payment = `${
                      advanceUsed > 0
                        ? `<tr>
                        <td>Advance used</td>
                        <td>:</td>
                        <td>-${settings.symbol + advanceUsed.toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td><b>Amount to pay</b></td>
                        <td>:</td>
                        <td><b>${settings.symbol + Math.max((parseFloat(orderTotal) || 0) - advanceUsed, 0).toFixed(2)}</b></td>
                    </tr>`
                        : ""
                    }                    <tr>
                        <td>Paid${creditPart > 0 ? " (" + type + ")" : ""}</td>
                        <td>:</td>
                        <td>${settings.symbol + paid}</td>
                    </tr>${
                      creditPart > 0
                        ? `<tr>
                        <td><b>On credit</b></td>
                        <td>:</td>
                        <td><b>${settings.symbol + creditPart.toFixed(2)}</b></td>
                    </tr>`
                        : ""
                    }
                    <tr>${
                      balanceDue > 0
                        ? `
                        <td><b>Balance due</b></td>
                        <td>:</td>
                        <td><b>${settings.symbol + balanceDue.toFixed(2)}</b></td>`
                        : `
                        <td>Change</td>
                        <td>:</td>
                        <td>${
                          settings.symbol + Math.abs(change).toFixed(2)
                        }</td>`
                    }
                    </tr>${
                      advanceDeposit > 0
                        ? `<tr>
                        <td>Saved as advance</td>
                        <td>:</td>
                        <td>${settings.symbol + advanceDeposit.toFixed(2)}</td>
                    </tr>`
                        : ""
                    }
                    <tr>
                        <td>Method</td>
                        <td>:</td>
                        <td>${methodLabel}</td>
                    </tr>${
                      (advanceUsed > 0 || advanceDeposit > 0) && advanceAfter !== null
                        ? `<tr>
                        <td>Advance balance</td>
                        <td>:</td>
                        <td>${settings.symbol + advanceAfter.toFixed(2)}</td>
                    </tr>`
                        : ""
                    }`;
      }

      if (settings.charge_tax) {
        tax_row = `<tr>
                    <td>Vat(${settings.percentage})% </td>
                    <td>:</td>
                    <td>${settings.symbol}${parseFloat(totalVat).toFixed(
          2
        )}</td>
                </tr>`;
      }

      if (status == 0) {
        if ($("#customer").val() == 0 && $("#refNumber").val() == "") {
          Swal.fire(
            "Reference Required!",
            "You either need to select a customer <br> or enter a reference!",
            "warning"
          );

          return;
        }
      }

      $(".loading").show();

      if (holdOrder != 0) {
        orderNumber = holdOrder;
        method = "PUT";
      } else {
        orderNumber = Math.floor(Date.now() / 1000);
        method = "POST";
      }

      receipt = `<div style="font-size: 10px;">                            
        <p style="text-align: center;">
        ${
          settings.img == ""
            ? settings.img
            : '<img style="max-width: 50px;max-width: 100px;" src ="' +
              img_path +
              settings.img +
              '" /><br>'
        }
            <span style="font-size: 22px;">${settings.store}</span> <br>
            ${settings.address_one} <br>
            ${settings.address_two} <br>
            ${
              settings.contact != "" ? "Tel: " + settings.contact + "<br>" : ""
            } 
            ${settings.tax != "" ? "Vat No: " + settings.tax + "<br>" : ""} 
        </p>
        <hr>
        <left>
            <p>
            Order No : ${orderNumber} <br>
            Ref No : ${refNumber == "" ? orderNumber : refNumber} <br>
            Customer : ${
              customer == 0 ? "Walk in customer" : customer.name
            } <br>
            Cashier : ${user.fullname} <br>
            Date : ${date}<br>
            </p>

        </left>
        <hr>
        <table width="100%">
            <thead style="text-align: left;">
            <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Price</th>
            </tr>
            </thead>
            <tbody>
            ${items}                
     
            <tr>                        
                <td><b>Subtotal</b></td>
                <td>:</td>
                <td><b>${settings.symbol}${subTotal.toFixed(2)}</b></td>
            </tr>
            <tr>
                <td>Discount</td>
                <td>:</td>
                <td>${
                  discount > 0
                    ? settings.symbol + parseFloat(discount).toFixed(2)
                    : ""
                }</td>
            </tr>
            
            ${tax_row}
        
            <tr>
                <td><h3>Total</h3></td>
                <td><h3>:</h3></td>
                <td>
                    <h3>${settings.symbol}${parseFloat(orderTotal).toFixed(
        2
      )}</h3>
                </td>
            </tr>
            ${payment == 0 ? "" : payment}
            </tbody>
            </table>
            <br>
            <hr>
            <br>
            <p style="text-align: center;">
             ${settings.footer}
             </p>
            </div>`;

      if (status == 3) {
        if (cart.length > 0) {
          // printed before the payment is confirmed: say so on the bill
          receipt = receipt.replace(
            "</tbody>",
            `<tr><td>Status</td><td>:</td><td><b>${
              paid == "" ? "Not paid yet" : "Payment not confirmed"
            }</b></td></tr></tbody>`
          );
          printJS({
            printable: receipt,
            type: "raw-html",
            style: "@page { size:A7 }",
          });

          $(".loading").hide();
          return;
        } else {
          $(".loading").hide();
          return;
        }
      }

      if (type === "Credit") {
        status = 0;
      }

      let data = {
        order: orderNumber,
        ref_number: refNumber,
        discount: discount,
        customer: customer,
        status: status,
        subtotal: parseFloat(subTotal).toFixed(2),
        tax: totalVat,
        order_type: 1,
        items: cart,
        date: currentTime,
        payment_type: type,
        payment_info: $("#paymentInfo").val(),
        total: orderTotal,
        paid: paid,
        change: change,
        // customer advance: used towards this bill / extra kept for the next bill
        advance_used: advanceUsed ? advanceUsed.toFixed(2) : "",
        advance_deposit: advanceDeposit ? advanceDeposit.toFixed(2) : "",
        // split payment: part of the bill put on the customer's credit
        credit_amount: creditPart > 0 ? creditPart : 0,
        advance_balance_after:
          (advanceUsed || advanceDeposit) && advanceAfter !== null ? advanceAfter.toFixed(2) : "",
        _id: orderNumber,
        till: platform?.till,
        mac: platform?.mac,
        user: user?.fullname,
        user_id: user._id,
      };

      $.ajax({
        url: api + "new",
        type: method,
        data: JSON.stringify(data),
        contentType: "application/json; charset=utf-8",
        cache: false,
        processData: false,
        success: function (data) {
          cart = [];
          $("#viewTransaction").html("");
          $("#viewTransaction").html(receipt);
          $("#orderModal").modal("show");
          loadProducts();
          loadCustomers();
          $(".loading").hide();
          $("#dueModal").modal("hide");
          $("#paymentModel").modal("hide");
          $(this).getHoldOrders();
          $(this).getCustomerOrders();
          $(this).renderTable(cart);
        },
        error: function (xhr) {
          $(".loading").hide();
          $("#dueModal").modal("hide");
          // show the server's reason when it refused the sale (e.g. not
          // enough advance); otherwise the generic message
          Swal.fire(
            "Something went wrong!",
            xhr && xhr.status === 400 && xhr.responseText
              ? xhr.responseText
              : "Please refresh this page and try again",
            "error"
          );
        },
      });

      $("#refNumber").val("");
      $("#change").text("");
      $("#payment").val("");
    };

    $.get(api + "on-hold", function (data) {
      holdOrderList = data;
      holdOrderlocation.empty();
      clearInterval(dotInterval);
      $(this).randerHoldOrders(holdOrderList, holdOrderlocation, 1);
    });

    $.fn.getHoldOrders = function () {
      $.get(api + "on-hold", function (data) {
        holdOrderList = data;
        clearInterval(dotInterval);
        holdOrderlocation.empty();
        $(this).randerHoldOrders(holdOrderList, holdOrderlocation, 1);
      });
    };

    $.fn.randerHoldOrders = function (data, renderLocation, orderType) {
      $.each(data, function (index, order) {
        $(this).calculatePrice(order);
        renderLocation.append(
          $("<div>", {
            class:
              orderType == 1
                ? "col-xs-12 col-sm-6 col-md-4 col-lg-3 order"
                : "col-xs-12 col-sm-6 col-md-4 col-lg-3 customer-order", // 1 / 2 / 3 / 4 cards per row by screen width
          }).append(
            $("<a>").append(
              $("<div>", { class: "card-box order-box" }).append(
                $("<p>").append(
                  $("<b>", { text: "Ref :" }),
                  $("<span>", { text: order.ref_number, class: "ref_number" }),
                  $("<br>"),
                  $("<b>", { text: "Price :" }),
                  $("<span>", {
                    text: order.total,
                    class: "label label-info",
                    style: "font-size:14px;",
                  }),
                  $("<br>"),
                  $("<b>", { text: "Items :" }),
                  $("<span>", { text: order.items.length }),
                  $("<br>"),
                  $("<b>", { text: "Customer :" }),
                  $("<span>", {
                    text:
                      order.customer != 0
                        ? order.customer.name
                        : "Walk in customer",
                    class: "customer_name",
                  })
                ),
                $("<button>", {
                  class: "btn btn-danger del",
                  onclick:
                    "$(this).deleteOrder(" + index + "," + orderType + ")",
                }).append($("<i>", { class: "fa fa-trash" })),

                $("<button>", {
                  class: "btn btn-default",
                  onclick:
                    "$(this).orderDetails(" + index + "," + orderType + ")",
                }).append($("<span>", { class: "fa fa-shopping-basket" }))
              )
            )
          )
        );
      });
    };

    $.fn.calculatePrice = function (data) {
      totalPrice = 0;
      $.each(data.products, function (index, product) {
        totalPrice += product.price * product.quantity;
      });

      let vat = (totalPrice * data.vat) / 100;
      totalPrice = (totalPrice + vat - data.discount).toFixed(0);

      return totalPrice;
    };

    $.fn.orderDetails = function (index, orderType) {
      $("#refNumber").val("");

      if (orderType == 1) {
        $("#refNumber").val(holdOrderList[index].ref_number);

        $("#customer option:selected").removeAttr("selected");

        $("#customer option")
          .filter(function () {
            return $(this).text() == "Walk in customer";
          })
          .prop("selected", true);
        $("#customer").trigger("chosen:updated");

        holdOrder = holdOrderList[index]._id;
        cart = [];
        $.each(holdOrderList[index].items, function (index, product) {
          item = {
            id: product.id,
            product_name: product.product_name,
            sku: product.sku,
            price: product.price,
            cost_price: product.cost_price ?? "",
            quantity: product.quantity,
          };
          // the stock batches the held line was taken from (kept with the sale)
          if (product.batch_id != null) item.batch_id = product.batch_id;
          if (product.batch_code) item.batch_code = product.batch_code;
          if (product.batches) item.batches = product.batches;
          cart.push(item);
        });
      } else if (orderType == 2) {
        $("#refNumber").val("");

        $("#customer option:selected").removeAttr("selected");

        $("#customer option")
          .filter(function () {
            return $(this).text() == customerOrderList[index].customer.name;
          })
          .prop("selected", true);
        $("#customer").trigger("chosen:updated");

        holdOrder = customerOrderList[index]._id;
        cart = [];
        $.each(customerOrderList[index].items, function (index, product) {
          item = {
            id: product.id,
            product_name: product.product_name,
            sku: product.sku,
            price: product.price,
            cost_price: product.cost_price ?? "",
            quantity: product.quantity,
          };
          if (product.batch_id != null) item.batch_id = product.batch_id;
          if (product.batch_code) item.batch_code = product.batch_code;
          if (product.batches) item.batches = product.batches;
          cart.push(item);
        });
      }
      $(this).renderTable(cart);
      $("#holdOrdersModal").modal("hide");
      $("#customerModal").modal("hide");
    };

    $.fn.deleteOrder = function (index, type) {
      switch (type) {
        case 1:
          deleteId = holdOrderList[index]._id;
          break;
        case 2:
          deleteId = customerOrderList[index]._id;
      }

      let data = {
        orderId: deleteId,
      };

      Swal.fire({
        title: "Delete order?",
        text: "This will delete the order. Are you sure you want to delete!",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#3085d6",
        cancelButtonColor: "#d33",
        confirmButtonText: "Yes, delete it!",
      }).then((result) => {
        if (result.value) {
          $.ajax({
            url: api + "delete",
            type: "POST",
            data: JSON.stringify(data),
            contentType: "application/json; charset=utf-8",
            cache: false,
            success: function (data) {
              $(this).getHoldOrders();
              $(this).getCustomerOrders();

              Swal.fire("Deleted!", "You have deleted the order!", "success");
            },
            error: function (data) {
              $(".loading").hide();
            },
          });
        }
      });
    };

    $.fn.getCustomerOrders = function () {
      $.get(api + "customer-orders", function (data) {
        // console.log("customer orders here: ", data)
        clearInterval(dotInterval);
        customerOrderList = data;
        customerOrderLocation.empty();
        $(this).randerHoldOrders(customerOrderList, customerOrderLocation, 2);
      });
    };

    // ---- Customer credit settings ----

    // Show the limit amount only when "Credit limit" is chosen
    $(".credit-type-select").on("change", function () {
      $($(this).data("limit-group")).toggle($(this).val() === "limited");
    });

    // Reads and validates a form's credit fields; returns null when invalid
    function readCreditFields(typeSelector, limitSelector) {
      if ($(typeSelector).val() !== "limited") {
        return { credit_type: "unlimited", credit_limit: null };
      }
      let limit = parseFloat($(limitSelector).val());
      if (isNaN(limit) || limit < 0) {
        Swal.fire(
          "Credit limit required",
          "Please enter a credit limit amount of 0 or more, or choose Unlimited credit.",
          "warning"
        );
        return null;
      }
      return { credit_type: "limited", credit_limit: limit };
    }

    // balance: outstanding credit (optional) -> shown as "Due Rs. X" under the limit
    // advance: money paid in advance (optional) -> "Advance Rs. X"
    function creditLabel(customer, balance, advance) {
      let label = customer?.credit_type === "limited"
        ? "Limit " + settings.symbol + parseFloat(customer.credit_limit || 0).toFixed(2)
        : "Unlimited";
      if (balance > 0) {
        label += '<br><small class="text-danger"><b>Due ' + settings.symbol + balance.toFixed(2) + "</b></small>";
      }
      if (advance > 0) {
        label += '<br><small class="text-success"><b>Advance ' + settings.symbol + advance.toFixed(2) + "</b></small>";
      }
      return label;
    }

    // Adds/replaces the customer in the POS customer dropdown and selects it
    function selectCustomerOption(cust) {
      let value = JSON.stringify({ id: cust._id, name: cust.name });
      $("#customer option").each(function () {
        try {
          if (JSON.parse(this.value).id == cust._id) $(this).remove();
        } catch (e) {}
      });
      $("#customer").append($("<option>", { text: cust.name, value: value }));
      $("#customer").val(value).trigger("chosen:updated");
    }

    // Resolves true if a Credit sale of `amount` fits the customer's limit.
    // excludeOrder: id of an order being re-saved, so it isn't counted twice.
    function checkCreditLimit(customer, amount, excludeOrder) {
      return new Promise((resolve) => {
        $.get(api + "customers/customer/" + customer.id)
          .done(function (cust) {
            if (!cust || cust.credit_type !== "limited") return resolve(true);

            let query = excludeOrder ? "?exclude=" + excludeOrder : "";
            $.get(api + "customer-credit/" + customer.id + query)
              .done(function (credit) {
                let limit = parseFloat(cust.credit_limit) || 0;
                let used = parseFloat(credit?.used) || 0;
                let available = Math.max(limit - used, 0);
                let total = parseFloat(amount) || 0;

                if (total <= available + 0.005) return resolve(true);

                let sym = settings.symbol;
                Swal.fire({
                  icon: "error",
                  title: "Credit limit exceeded",
                  html: `${cust.name} does not have enough credit for this sale.<br><br>
                    <table style="margin: 0 auto; text-align: left;">
                      <tr><td>Credit limit</td><td>&nbsp;:&nbsp;</td><td>${sym}${limit.toFixed(2)}</td></tr>
                      <tr><td>Already on credit</td><td>&nbsp;:&nbsp;</td><td>${sym}${used.toFixed(2)}</td></tr>
                      <tr><td>Available</td><td>&nbsp;:&nbsp;</td><td><b>${sym}${available.toFixed(2)}</b></td></tr>
                      <tr><td>This sale</td><td>&nbsp;:&nbsp;</td><td>${sym}${total.toFixed(2)}</td></tr>
                    </table><br>
                    Please take another payment method or increase the customer's credit limit.`,
                });
                resolve(false);
              })
              .fail(function () {
                Swal.fire("Error", "Could not check the customer's credit. Please try again.", "error");
                resolve(false);
              });
          })
          .fail(function () {
            Swal.fire("Error", "Could not load the customer's credit settings. Please try again.", "error");
            resolve(false);
          });
      });
    }

    // adding a new customer
    $("#saveCustomer").on("submit", function (e) {
      e.preventDefault();

      let credit = readCreditFields("#creditType", "#creditLimit");
      if (!credit) return;

      let custData = {
        _id: Math.floor(Date.now() / 1000),
        name: $("#userName").val(),
        phone: $("#phoneNumber").val(),
        email: $("#emailAddress").val(),
        address: $("#userAddress").val(),
        credit_type: credit.credit_type,
        credit_limit: credit.credit_limit,
      };

      $.ajax({
        url: api + "customers/customer",
        type: "POST",
        data: JSON.stringify(custData),
        contentType: "application/json; charset=utf-8",
        cache: false,
        processData: false,
        success: function (data) {
          $("#newCustomer").modal("hide");
          Swal.fire(
            "Customer added!",
            "Customer added successfully!",
            "success"
          );
          $("#saveCustomer")[0].reset();
          $("#creditType").trigger("change");
          selectCustomerOption(custData);
        },
        error: function (data) {
          $("#newCustomer").modal("hide");
          Swal.fire("Error", "Something went wrong please try again", "error");
        },
      });
    });

    // updating customer details
    $("#editCustomer").on("submit", function (e) {
      e.preventDefault();

      let credit = readCreditFields("#creditTypeEdit", "#creditLimitEdit");
      if (!credit) return;

      let custData = {
        _id: parseInt($("#customer_id_edit").val()),
        name: $("#userNameEdit").val(),
        phone: $("#phoneNumberEdit").val(),
        email: $("#emailAddressEdit").val(),
        address: $("#userAddressEdit").val(),
        credit_type: credit.credit_type,
        credit_limit: credit.credit_limit,
      };

      $.ajax({
        url: api + "customers/customer",
        type: "PUT",
        data: JSON.stringify(custData),
        contentType: "application/json; charset=utf-8",
        cache: false,
        processData: false,
        success: function (data) {
          $("#editCustomer").modal("hide");
          Swal.fire(
            "Customer updated!",
            "Customer updated successfully!",
            "success"
          );
          selectCustomerOption(custData);
        },
        error: function (data) {
          $("#editCustomer").modal("hide");
          Swal.fire("Error", "Something went wrong please try again", "error");
        },
      });
      editCustomer = false;
    });

    $("#confirmPayment").hide();

    $("#cardInfo").hide();

    $("#payment").on("input", function () {
      $(this).calculateChange();
    });

    $("#confirmPayment").on("click", function () {
      // nothing left to pay when the customer's advance covers the whole bill
      let toPay = parseFloat($("#payablePrice").val()) || 0;
      if ($("#payment").val() == "" && toPay > 0.004) {
        Swal.fire("Nope!", "Please enter the amount that was paid!", "warning");
      } else {
        if ($("#payment").val() == "") $("#payment").val("0");
        $(this).submitDueOrder(1);
      }
    });

    // Transactions page: keep the navigation buttons and the SALES /
    // TRANSACTIONS / ITEMS SOLD / PRODUCTS boxes in place while scrolling
    // (CSS: body.transactions-mode / body.totals-compact in components.css).
    function updateTransactionsStickyOffset() {
      let toolbar = document.querySelector(".main-toolbar-row");
      if (toolbar) {
        document.documentElement.style.setProperty(
          "--toolbar-height",
          toolbar.offsetHeight + "px"
        );
      }
    }

    function updateTotalsCompact() {
      if (!$("body").hasClass("transactions-mode")) return;
      // two thresholds so the boxes don't flicker: shrinking them shortens the
      // page, which moves the scroll position back up a little
      let y = window.scrollY || document.documentElement.scrollTop;
      if (y > 120) $("body").addClass("totals-compact");
      else if (y < 10) $("body").removeClass("totals-compact");
    }

    $(window).on("scroll", updateTotalsCompact);
    $(window).on("resize", updateTransactionsStickyOffset);
    // the toolbar can also change height on its own (loading spinner, buttons
    // shown/hidden), so follow its size directly
    if (window.ResizeObserver && document.querySelector(".main-toolbar-row")) {
      new ResizeObserver(updateTransactionsStickyOffset).observe(
        document.querySelector(".main-toolbar-row")
      );
    }

    // switches between the Point of Sale, Transactions, Expenses and Suppliers pages.
    // The open page's button is hidden with .nav-current (not .hide()), so
    // buttons hidden by a permission stay hidden.
    function showPage(page) {
      $("#pos_view").toggle(page === "pos");
      $("#transactions_view").toggle(page === "transactions");
      $("#expenses_view").toggle(page === "expenses");
      $("#suppliers_view").toggle(page === "suppliers");
      $("#accounts_view").toggle(page === "accounts");
      $("#pointofsale").toggle(page !== "pos");
      $("#transactions").toggleClass("nav-current", page === "transactions");
      $("#expensesNav").toggleClass("nav-current", page === "expenses");
      $("#suppliersNav").toggleClass("nav-current", page === "suppliers");
      $("#accountsNav").toggleClass("nav-current", page === "accounts");

      $("body")
        .toggleClass("transactions-mode", page === "transactions")
        .toggleClass("expenses-mode", page === "expenses")
        .toggleClass("suppliers-mode", page === "suppliers")
        .toggleClass("accounts-mode", page === "accounts")
        .removeClass("totals-compact");
      window.scrollTo(0, 0);
      if (page !== "pos") updateTransactionsStickyOffset();
      if (page === "suppliers") fitSuppliersView();
      if (page === "accounts") fitAccountsView();
    }

    $("#transactions").click(function () {
      loadTransactions();
      loadUserList();
      showPage("transactions");
    });

    $("#pointofsale").click(function () {
      showPage("pos");
    });

    $("#expensesNav").click(function () {
      if (!canManageExpenses()) return;
      showPage("expenses");
      loadExpensesPage();
    });

    $("#suppliersNav").click(function () {
      if (!canManageSuppliers()) return;
      showPage("suppliers");
      loadSuppliersPage();
    });

    $("#accountsNav").click(function () {
      if (!canViewJournal()) return;
      showPage("accounts");
      loadAccountsPage();
    });

    $("#viewRefOrders").click(function () {
      setTimeout(function () {
        $("#holdOrderInput").focus();
      }, 500);
    });

    $("#viewCustomerOrders").click(function () {
      setTimeout(function () {
        $("#holdCustomerOrderInput").focus();
      }, 500);
    });

    $("#newProductModal").click(function () {
      $("#saveProduct").get(0).reset();
      $("#current_img").text("");
      clearPriceInputErrors();
      updateProductMarginHint();
    });

    function clearPriceInputErrors() {
      $(".price-input").each(function () {
        clearTimeout(this._priceErrorTimer);
      });
      $(".price-input-error").text("");
      $(".price-input").closest(".form-group").removeClass("has-error");
    }

    // "Profit per item: Rs. 40.00 (20.0% margin)" under the price fields
    function updateProductMarginHint() {
      let cost = parseFloat($("#product_cost_price").val());
      let price = parseFloat($("#product_price").val());
      let hint = "";
      if (!isNaN(cost) && !isNaN(price) && price > 0) {
        let profit = price - cost;
        hint =
          (profit < 0 ? "Loss per item: " : "Profit per item: ") +
          settings.symbol +
          Math.abs(profit).toFixed(2) +
          " (" +
          ((profit / price) * 100).toFixed(1) +
          "% margin)";
      } else if (isNaN(cost) && !isNaN(price)) {
        hint = "Add a cost price to see this product's profit.";
      }
      $("#productMarginHint")
        .text(hint)
        .toggleClass("text-danger", !isNaN(cost) && !isNaN(price) && price - cost < 0);
    }
    $("#product_cost_price, #product_price").on("input", updateProductMarginHint);

    // Cost / Selling price: positive numbers only, shown with commas (the
    // "amount-input" fields at the top of this file)

    // returns an error message, or "" if the cost/selling prices are valid
    function validateProductPrices() {
      let price = $("#product_price").val().trim();
      let cost = $("#product_cost_price").val().trim();
      let valid = (v) => /^\d+(\.\d{1,2})?$/.test(v) || /^\d*\.\d{1,2}$/.test(v);
      if (price === "") return "Please enter the selling price.";
      if (!valid(price)) return "Selling price must be a positive number (e.g. 150 or 150.50).";
      if (cost !== "" && !valid(cost)) return "Cost price must be a positive number (e.g. 120 or 120.50).";
      return "";
    }

    $("#saveProduct").submit(function (e) {
      e.preventDefault();

      let priceError = validateProductPrices();
      if (priceError) {
        Swal.fire("Check the prices", priceError, "warning");
        return;
      }

      $(this).attr("action", api + "inventory/product");
      $(this).attr("method", "POST");

      $(this).ajaxSubmit({
        contentType: "application/json",
        // recorded in the product history
        data: { history_user: user?.fullname || "", history_user_id: user?._id || "" },
        success: function (response) {
          $("#saveProduct").get(0).reset();
          $("#current_img").text("");

          loadProducts();
          Swal.fire({
            title: "Product Saved",
            text: "Select an option below to continue.",
            icon: "success",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Add another",
            cancelButtonText: "Close",
          }).then((result) => {
            if (!result.value) {
              $("#newProduct").modal("hide");
            }
          });
        },
        error: function (data) {
          console.log(data);
          Swal.fire({
            title: "Could not save product",
            // show the server's reason for invalid input (e.g. a bad price)
            text:
              data && data.status === 400 && data.responseText
                ? data.responseText
                : "Please try again.",
            icon: "error",
          });
        },
      });
    });

    $("#saveCategory").submit(function (e) {
      e.preventDefault();

      if ($("#category_id").val() == "") {
        method = "POST";
      } else {
        method = "PUT";
      }

      $.ajax({
        type: method,
        url: api + "categories/category",
        data: $(this).serialize(),
        success: function (data, textStatus, jqXHR) {
          $("#saveCategory").get(0).reset();
          loadCategories();
          loadProducts();
          Swal.fire({
            title: "Category Saved",
            text: "Select an option below to continue.",
            icon: "success",
            showCancelButton: true,
            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#d33",
            confirmButtonText: "Add another",
            cancelButtonText: "Close",
          }).then((result) => {
            if (!result.value) {
              $("#newCategory").modal("hide");
            }
          });
        },
        error: function (data) {
          console.log(data);
        },
      });
    });

    $.fn.editProduct = function (index) {
      $("#Products").modal("hide");

      $("#category option")
        .filter(function () {
          return $(this).val() == allProducts[index].category;
        })
        .prop("selected", true);

      $("#productName").val(allProducts[index].name);
      $("#product_price").val(allProducts[index].price);
      $("#product_cost_price").val(allProducts[index].cost_price ?? "");
      clearPriceInputErrors();
      updateProductMarginHint();
      $("#product_barcode").val(allProducts[index].barcode);
      $("#quantity").val(allProducts[index].quantity);

      $("#product_id").val(allProducts[index]._id);
      $("#img").val(allProducts[index].img);

      if (allProducts[index].img != "") {
        $("#imagename").hide();
        $("#current_img").html(
          `<img src="${img_path + allProducts[index].img}" alt="">`
        );
        $("#rmv_img").show();
      }

      if (allProducts[index].stock == 0 && settings.stock_check_disabled != "on") {
        $("#stock").prop("checked", true);
      }

      $("#newProduct").modal("show");
    };

    $("#userModal").on("hide.bs.modal", function () {
      $(".perms").hide();
    });

    // function to print barcodes
    $.fn.printBarcode = function (productName, barcode, price) {
      const canvas = document.createElement("canvas");
      // Generate the barcode using jsbarcode
      JsBarcode(canvas, barcode, {
        format: "CODE128",
        displayValue: true,
        text: barcode,
        height: 40,
        margin: 0,
      });

      // Convert the canvas to an image URL
      const imageDataUrl = canvas.toDataURL("image/png");

      // Truncate the product name if it's too long
      const maxLength = 15;

      // Concatenate the truncated product name and price
      const headerText = `${productName} - ${settings.symbol + price}`;
      const headerText2 = `${productName}\n${settings.symbol + price}`;

      // Print the barcode using PrintJS
      printJS({
        printable: imageDataUrl,
        type: "image",
        header: productName.length > maxLength ? headerText2 : headerText, // Set the truncated product name and price as the header
        headerStyle:
          "font-size: 15px; margin-bottom: 4px; white-space: pre-wrap;",
        onPrintDialogClose: function () {
          console.log("Print dialog closed");
        },
      });
    };

    // Function to generate a random barcode value
    function generateBarcodeValue() {
      var barcodeDigits = [];

      // Generate 11 random digits for the barcode
      for (var i = 0; i < 11; i++) {
        var digit = Math.floor(Math.random() * 10);
        barcodeDigits.push(digit);
      }

      // Calculate the checksum digit
      var sumOdd = 0;
      var sumEven = 0;

      for (var j = 0; j < 11; j++) {
        if (j % 2 === 0) {
          sumOdd += barcodeDigits[j];
        } else {
          sumEven += barcodeDigits[j];
        }
      }

      var checksum = (sumOdd * 3 + sumEven) % 10;
      if (checksum !== 0) {
        checksum = 10 - checksum;
      }

      barcodeDigits.push(checksum);

      // Convert the barcode digits to a string
      var barcodeValue = barcodeDigits.join("");

      return barcodeValue;
    }

    // generating barcode when fill button is clicked
    $("#fill_barcode").click(function () {
      var barcodeInput = $("#product_barcode");

      // Check if the input field is empty
      if (barcodeInput.val().trim() === "") {
        // Generate a random barcode value (you can modify this logic as needed)
        var barcodeValue = generateBarcodeValue();
        // Set the input field value to the generated barcode
        barcodeInput.val(barcodeValue);
      }
    });

    // Only the bootstrap Administrator account (_id 1) may view or change
    // permission flags. Other users with "Manage Users" access can still
    // add/edit accounts, but the Permissions section stays hidden for them
    // so they can't grant themselves or anyone else extra access.
    function isCurrentUserAdministrator() {
      return !!(user && user._id === 1);
    }

    $.fn.editUser = function (index) {
      user_index = index;
      ownUserEdit = false;

      $("#Users").modal("hide");

      if (isCurrentUserAdministrator()) {
        $(".perms").show();
      } else {
        $(".perms").hide();
      }

      $("#user_id").val(allUsers[index]._id);
      $("#fullname").val(allUsers[index].fullname);
      $("#username").val(allUsers[index].username);
      $("#password").val(atob(allUsers[index].password));

      if (allUsers[index].perm_products == 1) {
        $("#perm_products").prop("checked", true);
      } else {
        $("#perm_products").prop("checked", false);
      }

      if (allUsers[index].perm_categories == 1) {
        $("#perm_categories").prop("checked", true);
      } else {
        $("#perm_categories").prop("checked", false);
      }

      if (allUsers[index].perm_transactions == 1) {
        $("#perm_transactions").prop("checked", true);
      } else {
        $("#perm_transactions").prop("checked", false);
      }

      if (allUsers[index].perm_users == 1) {
        $("#perm_users").prop("checked", true);
      } else {
        $("#perm_users").prop("checked", false);
      }

      if (allUsers[index].perm_settings == 1) {
        $("#perm_settings").prop("checked", true);
      } else {
        $("#perm_settings").prop("checked", false);
      }

      $("#perm_profit").prop("checked", allUsers[index].perm_profit == 1);
      $("#perm_expenses").prop("checked", allUsers[index].perm_expenses == 1);
      $("#perm_suppliers").prop("checked", allUsers[index].perm_suppliers == 1);
      $("#perm_journal").prop("checked", allUsers[index].perm_journal == 1);

      $("#userModal").modal("show");
    };

    // Categories live in a tab of the Products window: the category form
    // replaces that window while open, then the Categories tab comes back
    let returnToCategoriesTab = false;

    function showProductsTab(tab) {
      $('#Products .products-tabs a[href="#productsTab' + tab + '"]').tab("show");
    }

    function openCategoryForm() {
      returnToCategoriesTab = $("#Products").hasClass("in");
      $("#Products").modal("hide");
      $("#newCategory").modal("show");
    }

    $.fn.editCategory = function (index) {
      $("#categoryName").val(allCategories[index].name);
      $("#category_id").val(allCategories[index]._id);
      openCategoryForm();
    };

    $("#addCategoryBtn").on("click", function () {
      $("#saveCategory").get(0).reset();
      $("#category_id").val("");
      openCategoryForm();
    });

    $("#newCategory").on("hidden.bs.modal", function () {
      // an edit that was closed without saving must not turn the next add into an update
      $("#saveCategory").get(0).reset();
      $("#category_id").val("");
      if (returnToCategoriesTab) {
        returnToCategoriesTab = false;
        showProductsTab("Categories");
        $("#Products").modal("show");
      }
    });

    // the categories table is measured while its tab is hidden
    $('#Products .products-tabs a[href="#productsTabCategories"]').on("shown.bs.tab", function () {
      if ($.fn.DataTable.isDataTable("#categoryList")) {
        $("#categoryList").DataTable().columns.adjust();
      }
    });

    $.fn.deleteProduct = function (id, imagePath) {
      Swal.fire({
        title: "Are you sure?",
        text: "You are about to delete this product.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#3085d6",
        cancelButtonColor: "#d33",
        confirmButtonText: "Yes, delete it!",
      }).then((result) => {
        if (result.value) {
          $.ajax({
            url:
              api +
              "inventory/product/" +
              id +
              "?image_path=" +
              encodeURIComponent(imagePath) +
              "&user=" +
              encodeURIComponent(user?.fullname || "") +
              "&user_id=" +
              encodeURIComponent(user?._id || ""),
            type: "DELETE",
            success: function (result) {
              loadProducts();
              Swal.fire("Done!", "Product deleted", "success");
            },
          });
        }
      });
    };

    $.fn.deleteUser = function (id) {
      Swal.fire({
        title: "Are you sure?",
        text: "You are about to delete this user.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#3085d6",
        cancelButtonColor: "#d33",
        confirmButtonText: "Yes, delete!",
      }).then((result) => {
        if (result.value) {
          $.ajax({
            url: api + "users/user/" + id,
            type: "DELETE",
            success: function (result) {
              loadUserList();
              Swal.fire("Done!", "User deleted", "success");
            },
          });
        }
      });
    };

    $.fn.deleteCategory = function (id) {
      Swal.fire({
        title: "Are you sure?",
        text: "You are about to delete this category.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#3085d6",
        cancelButtonColor: "#d33",
        confirmButtonText: "Yes, delete it!",
      }).then((result) => {
        if (result.value) {
          $.ajax({
            url: api + "categories/category/" + id,
            type: "DELETE",
            success: function (result) {
              loadCategories();
              Swal.fire("Done!", "Category deleted", "success");
            },
          });
        }
      });
    };

    $("#productModal").click(function () {
      loadProductList();
      loadCategoryList();
      // users who can only manage categories go straight to that tab
      showProductsTab(user.perm_products == 0 ? "Categories" : "Products");
    });

    $("#usersModal").click(function () {
      loadUserList();
    });

    function loadUserList() {
      let counter = 0;
      let user_list = "";
      $("#user_list").empty();
      $("#userList").DataTable().destroy();

      $.get(api + "users/all", function (users) {
        allUsers = [...users];

        users.forEach((user, index) => {
          state = [];
          let class_name = "";

          if (user.status != "") {
            state = user.status.split("_");

            switch (state[0]) {
              case "Logged In":
                class_name = "btn-default";
                break;
              case "Logged Out":
                class_name = "btn-light";
                break;
            }
          }

          counter++;
          user_list += `<tr>
            <td>${user.fullname}</td>
            <td>${user.username}</td>
            <td class="${class_name}">${
            state.length > 0 ? state[0] : ""
          } <br><span style="font-size: 11px;"> ${
            state.length > 0
              ? moment(state[1]).format("hh:mm A DD MMM YYYY")
              : ""
          }</span></td>
            <td>${
              user._id == 1
                ? '<span class="btn-group"><button class="btn btn-dark"><i class="fa fa-edit"></i></button><button class="btn btn-dark"><i class="fa fa-trash"></i></button></span>'
                : '<span class="btn-group"><button onClick="$(this).editUser(' +
                  index +
                  ')" class="btn btn-warning"><i class="fa fa-edit"></i></button><button onClick="$(this).deleteUser(' +
                  user._id +
                  ')" class="btn btn-danger"><i class="fa fa-trash"></i></button></span>'
            }</td></tr>`;

          if (counter == users.length) {
            $("#user_list").html(user_list);

            $("#userList").DataTable(
              Object.assign(
                standardTableOptions({
                  noun: "users",
                  searchPlaceholder: "Search users...",
                  exportTitle: "Users",
                  exportColumns: [0, 1, 2],
                  actionColumns: [3],
                }),
                { order: [[1, "desc"]] }
              )
            );
          }
        });
      });
    }

    // function to edit customer
    $.fn.editCustomer = function (index) {
      // user_index = index;
      $("#customerModal").modal("hide");

      // $(".perms").show();

      $("#customer_id_edit").val(allCustomers[index]._id);
      $("#userNameEdit").val(allCustomers[index].name);
      $("#phoneNumberEdit").val(allCustomers[index].phone);
      $("#emailAddressEdit").val(allCustomers[index].email);
      $("#userAddressEdit").val(allCustomers[index].address);

      let limited = allCustomers[index].credit_type === "limited";
      $("#creditTypeEdit")
        .val(limited ? "limited" : "unlimited")
        .trigger("change");
      $("#creditLimitEdit").val(limited ? allCustomers[index].credit_limit : "");

      $("#editCustomer").modal("show");
    };

    // delete customer
    $.fn.deleteCustomer = function (id) {
      Swal.fire({
        title: "Are you sure?",
        text: "You are about to delete this user.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#3085d6",
        cancelButtonColor: "#d33",
        confirmButtonText: "Yes, delete!",
      }).then((result) => {
        if (result.value) {
          $.ajax({
            url: api + "customers/customer/" + id,
            type: "DELETE",
            success: function (result) {
              console.log("customer deleted:", result);
              loadCustomerList();
              Swal.fire("Done!", "User deleted", "success");
            },
            error: function (xhr, status, error) {
              console.log("deleteCustomer error with status:", status);
              console.log("deleteCustomer error with error:", error);
            },
          });
        }
      });
    };

    // function to load customers
    function loadCustomerList() {
      let counter = 0;
      let customer_list = "";
      $("#customer_list").empty();
      $("#customerList").DataTable().destroy();

      // customers + their outstanding credit (the list still loads if balances fail)
      Promise.all([
        $.get(api + "customers/all"),
        $.get(api + "credit-balances").catch(() => ({})),
      ]).then(([customers, balances]) => {
        allCustomers = [...customers];

        customers.forEach((customer, index) => {
          counter++;
          let pos = (balances && balances[String(customer._id)]) || {};
          let due = pos.balance || 0;
          let advance = pos.advance || 0;
          customer_list += `<tr>
            <td>${customer.name}</td>
            <td>${customer.phone}</td>
            <td>${customer.email}</td>
            <td>${customer.address}</td>
            <td class="nobr" data-order="${due}">${creditLabel(customer, due, advance)}</td>
            <td>${
              customer._id == 1
                ? '<span class="btn-group"><button class="btn btn-dark"><i class="fa fa-edit"></i></button><button class="btn btn-dark"><i class="fa fa-trash"></i></button></span>'
                : '<span class="btn-group customer-actions"><button onClick="$(this).viewCustomerTransactions(' +
                  index +
                  ')" class="btn btn-info" title="View transactions"><i class="fa fa-history"></i></button><button onClick="$(this).editCustomer(' +
                  index +
                  ')" class="btn btn-warning"><i class="fa fa-edit"></i></button><button onClick="$(this).deleteCustomer(' +
                  customer._id +
                  ')" class="btn btn-danger"><i class="fa fa-trash"></i></button></span>'
            }</td></tr>`;

          if (counter == customers.length) {
            $("#customer_list").html(customer_list);

            $("#customerList").DataTable(
              Object.assign(
                standardTableOptions({
                  noun: "customers",
                  searchPlaceholder: "Search customers...",
                  exportTitle: "Customers",
                  exportColumns: [0, 1, 2, 3, 4],
                  actionColumns: [5],
                }),
                { order: [[1, "desc"]] }
              )
            );
          }
        });
      });
    }

    $("#viewCustomerOrders").click(function () {
      loadCustomerList();
    });

    // ---- Customer transaction history (Cash, Card, Bank Transfer, Credit) ----
    let customerTransactions = [];
    let customerTransactionsAll = [];
    let customerTxnPageLength = 10;
    let customerTxnCustomerName = "";

    function customerTxnExportTitle() {
      return "Customer transactions - " + customerTxnCustomerName;
    }

    function renderCustomerTransactions() {
      let filter = $("#customerTransactionsFilter").val() || "all";
      // payment type + date range; the totals below follow both filters
      customerTransactions = customerTransactionsAll.filter(
        (t) =>
          (filter === "all" || t.payment_type === filter ||
            (filter === "Credit" && parseFloat(t.credit_amount) > 0)) && // split payments have a credit part
          customerTxnDateFilter.matches(t.date)
      );

      let sym = settings?.symbol || "";
      let total = 0;
      let paidTotal = 0;
      let creditTotal = 0;
      let rows = "";

      customerTransactions.forEach((trans, index) => {
        let amount = parseFloat(trans.total) || 0;
        total += amount;
        // credit part: the whole Credit sale, or the credit part of a split payment
        let creditPartOf = saleCreditPart(trans);
        creditTotal += creditPartOf;
        paidTotal += amount - creditPartOf;

        let settle = creditSaleStatus[String(trans._id)];
        let settleLabel =
          settle === "settled"
            ? ' <span class="label label-success" title="Paid back in full">Settled</span>'
            : settle === "partial"
            ? ' <span class="label label-info" title="Partly paid back">Partly settled</span>'
            : ' <span class="label label-danger" title="Not paid back yet">Unpaid</span>';
        let typeLabel =
          trans.payment_type !== "Credit" && creditPartOf > 0
            ? '<span class="label label-success">' + trans.payment_type + "</span>" +
              ' <span class="label label-warning" title="Part of this bill was put on credit">+ Credit ' +
              sym + creditPartOf.toFixed(2) + "</span>" + settleLabel
            : trans.payment_type === "Credit"
            ? '<span class="label label-warning">Credit</span>' +
              (settle === "settled"
                ? ' <span class="label label-success" title="Paid back in full">Settled</span>'
                : settle === "partial"
                ? ' <span class="label label-info" title="Partly paid back">Partly settled</span>'
                : ' <span class="label label-danger" title="Not paid back yet">Unpaid</span>')
            : '<span class="label label-success">' + trans.payment_type + "</span>";
        let returnBadge =
          trans.return_status == "full"
            ? ' <span class="label label-danger">Returned</span>'
            : trans.return_status == "partial"
            ? ' <span class="label label-warning">Partial Return</span>'
            : "";
        let itemCount = (trans.items || []).reduce(
          (sum, i) => sum + (parseInt(i.quantity) || 0),
          0
        );

        rows += `<tr>
            <td>${trans.order}${returnBadge}</td>
            <td class="nobr" data-order="${moment(trans.date).valueOf()}" data-export="${moment(trans.date).format("DD MMM YYYY, hh:mm A")}">${moment(trans.date).format("DD MMM YYYY")}<span class="ctxn-sub">${moment(trans.date).format("hh:mm A")}</span></td>
            <td class="text-right">${itemCount}</td>
            <td class="nobr text-right">${sym + amount.toFixed(2)}</td>
            <td class="nobr text-right">${trans.paid === "" || trans.paid == null ? "" : sym + parseFloat(trans.paid).toFixed(2)}</td>
            <td class="ctxn-method">${typeLabel}</td>
            <td>${trans.user || ""}</td>
            <td><button onClick="$(this).viewCustomerTransaction(${index})" class="btn btn-info btn-sm" title="View the bill"><i class="fa fa-search-plus"></i></button></td>
          </tr>`;
      });

      $("#customerTxnCount").text(customerTransactions.length);
      $("#customerTabTxnCount").text(customerTransactions.length);
      $("#customerTxnTotal").text(sym + total.toFixed(2));
      $("#customerTxnPaid").text(sym + paidTotal.toFixed(2));
      $("#customerTxnCredit").text(sym + creditTotal.toFixed(2));

      // keep the chosen "Show N transactions" when the filters rebuild the table
      if ($.fn.DataTable.isDataTable("#customerTransactionsTable")) {
        customerTxnPageLength = $("#customerTransactionsTable").DataTable().page.len();
        $("#customerTransactionsTable").DataTable().destroy();
      }
      $("#customer_transactions_list").html(rows);
      $("#customerTransactionsTable").DataTable({
        order: [[1, "desc"]],
        autoWidth: false,
        info: true,
        ordering: true,
        paging: true,
        pageLength: customerTxnPageLength,
        lengthMenu: [10, 25, 50, 100],
        // same toolbar layout as Product History:
        // export buttons + "Show N transactions" | search, then info | pages
        // the table sits in its own box: never wider than the window, and
        // it scrolls up and down inside the popup (.modal-fit)
        dom:
          "<'ph-toolbar'<'ph-toolbar-left'Bl><'ph-toolbar-right'f>>" +
          "r<'ph-table-scroll ctxn-table-box't>" +
          "<'ph-footer'<'ph-footer-left'i><'ph-footer-right'p>>",
        columnDefs: [{ targets: [7], orderable: false, searchable: false }],
        // same export buttons as the other tables
        buttons: tableExportButtons(customerTxnExportTitle(), {
          exportOptions: { columns: [0, 1, 2, 3, 4, 5, 6] }, // not the View button
          sumColumns: [2, 3, 4], // Items, Total, Paid
          subtitle: () =>
            "Payment type: " + $("#customerTransactionsFilter option:selected").text() +
            "   ·   " + $("#customerTransactionsDateRange .date-range-label").text(),
        }),
        language: {
          search: "_INPUT_",
          searchPlaceholder: "Search transactions...",
          lengthMenu: "Show _MENU_ rows",
          info: "Showing _START_ to _END_ of _TOTAL_ transactions",
          infoEmpty: "Showing 0 transactions",
          infoFiltered: "(filtered from _MAX_)",
          emptyTable: customerTransactionsAll.length
            ? "No transactions match the selected payment type / date range"
            : "No transactions for this customer",
        },
      });
    }

    $.fn.viewCustomerTransactions = function (index) {
      let customer = allCustomers[index];
      if (!customer) return;
      customerTxnCustomerName = customer.name || "";

      $("#customerTransactionsTitle").text("Transactions - " + customer.name);
      $("#customerTransactionsFilter").val("all");
      customerTxnDateFilter.reset();
      $("#customerTxnCreditInfo").empty();
      customerTransactionsAll = [];
      customerTransactions = [];
      if ($.fn.DataTable.isDataTable("#customerTransactionsTable")) {
        $("#customerTransactionsTable").DataTable().destroy();
      }
      $("#customer_transactions_list").html(
        '<tr><td colspan="8">Loading...</td></tr>'
      );
      creditState = { customer: customer, credit: 0, paid: 0, balance: 0, payments: [], advance: 0, advanceEntries: [] };
      creditSaleStatus = {};
      $("#settleCreditBtn").hide();
      // always open on the Transactions tab, with empty tabs until loaded
      $('#customerTransactionsModal .customer-tabs a[href="#customerTabTransactions"]').tab("show");
      $("#customerTabTxnCount, #customerTabPaymentCount, #customerTabAdvanceCount").text("0");
      $("#customerTxnAdvance").text(creditMoney(0));
      customerPaymentsDateFilter.reset();
      customerAdvanceDateFilter.reset();
      ["#customerPaymentsTable", "#customerAdvanceTable"].forEach((sel) => {
        if ($.fn.DataTable.isDataTable(sel)) $(sel).DataTable().destroy();
      });
      $("#customer_payments_list, #customer_advance_list").empty();

      $("#customerModal").modal("hide");
      $("#customerTransactionsModal").modal("show");

      loadCustomerCreditData();
    };

    // ---- Credit settlement (customer pays back what they owe on Credit) ----
    // balance = Credit sales - payments; payments settle the oldest Credit
    // sales first, which gives each sale its Settled / Partly settled / Unpaid label
    let creditState = { customer: null, credit: 0, paid: 0, balance: 0, payments: [], advance: 0, advanceEntries: [] };
    let creditSaleStatus = {};

    function creditMoney(n) {
      return (n < 0 ? "-" : "") + settings.symbol + Math.abs(n).toFixed(2);
    }

    // sales + balance + payments for the open customer, then redraw everything
    function loadCustomerCreditData() {
      let customer = creditState.customer;
      if (!customer) return;
      Promise.all([
        $.get(api + "by-customer/" + customer._id),
        $.get(api + "credit-payments/" + customer._id),
      ])
        .then(([transactions, credit]) => {
          if (creditState.customer !== customer) return; // another customer was opened
          customerTransactionsAll = transactions || [];
          Object.assign(creditState, {
            credit: credit.credit || 0,
            paid: credit.paid || 0,
            balance: credit.balance || 0,
            payments: credit.payments || [],
            advance: credit.advance || 0,
            advanceEntries: credit.advance_entries || [],
          });
          computeCreditSaleStatus();
          renderCustomerTransactions();
          renderCustomerCredit();
          renderCustomerPayments();
          renderCustomerAdvance();
        })
        .catch(() => {
          $("#customer_transactions_list").html(
            '<tr><td colspan="8">Could not load transactions.</td></tr>'
          );
        });
    }

    // how much of a sale went on credit: the whole Credit sale, or the credit
    // part of a split payment (same rule as the server)
    function saleCreditPart(t) {
      let part = parseFloat(t.credit_amount);
      if (t.payment_type === "Credit") return part > 0 ? part : parseFloat(t.total) || 0;
      return part > 0 ? part : 0;
    }

    function computeCreditSaleStatus() {
      creditSaleStatus = {};
      let left = creditState.paid;
      customerTransactionsAll
        .filter((t) => saleCreditPart(t) > 0)
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .forEach((t) => {
          let total = saleCreditPart(t);
          let status = left >= total - 0.005 ? "settled" : left > 0.005 ? "partial" : "unpaid";
          left = Math.max(left - total, 0);
          creditSaleStatus[String(t._id)] = status;
        });
    }

    function renderCustomerCredit() {
      let c = creditState.customer;
      let parts = [];
      if (c.credit_type === "limited") {
        let limit = parseFloat(c.credit_limit) || 0;
        parts.push(`Credit limit: <b>${creditMoney(limit)}</b>`);
        parts.push(`Outstanding: <b class="${creditState.balance > 0 ? "text-danger" : ""}">${creditMoney(creditState.balance)}</b>`);
        parts.push(`Available: <b>${creditMoney(Math.max(limit - creditState.balance, 0))}</b>`);
      } else {
        parts.push(`Credit: <b>Unlimited</b>`);
        parts.push(`Outstanding: <b class="${creditState.balance > 0 ? "text-danger" : ""}">${creditMoney(creditState.balance)}</b>`);
      }
      if (creditState.advance > 0) {
        parts.push(`Advance: <b class="text-success" title="Paid in advance for the next bill">${creditMoney(creditState.advance)}</b>`);
      }
      if (creditState.credit > 0) {
        parts.push(`<span class="credit-breakdown">credit sales ${creditMoney(creditState.credit)} − paid back ${creditMoney(creditState.paid)}</span>`);
      }
      $("#customerTxnCreditInfo").html(parts.join(" &nbsp;·&nbsp; "));
      $("#settleCreditBtn").toggle(creditState.balance > 0);
    }

    // Credit payments / Advance tabs: DataTables with the shared toolbar
    // (Excel / PDF, Show N rows, search), pagination and their own date filter.
    let customerSubtablePageLength = { "#customerPaymentsTable": 10, "#customerAdvanceTable": 10 };

    function buildCustomerSubtable(selector, rows, options) {
      if ($.fn.DataTable.isDataTable(selector)) {
        customerSubtablePageLength[selector] = $(selector).DataTable().page.len();
        $(selector).DataTable().destroy();
      }
      $(selector).find("tbody").html(rows);
      $(selector).DataTable(
        Object.assign(standardTableOptions(options), {
          order: [[options.dateColumn, "desc"]],
          pageLength: customerSubtablePageLength[selector],
        })
      );
    }

    function customerFileTitle(what) {
      return what + " - " + (creditState.customer ? creditState.customer.name : "");
    }

    function renderCustomerPayments() {
      let all = creditState.payments;
      $("#customerTabPaymentCount").text(all.length);
      let rows = all
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => customerPaymentsDateFilter.matches(p.date))
        .map(({ p, i }) => {
          let ref = [p.reference, p.note].filter(Boolean).map((t) => $("<i>").text(t).html()).join(" · ");
          let toAdvance = parseFloat(p.advance_added) || 0;
          let received = parseFloat(p.received ?? p.amount) || 0;
          return `<tr>
            <td class="nobr">${$("<i>").text(p.receipt_no || "").html()}</td>
            <td class="payment-date" data-order="${moment(p.date).valueOf()}" data-export="${moment(p.date).format("DD MMM YYYY, hh:mm A")}">${moment(p.date).format("DD MMM YYYY")}<br><small class="text-muted">${moment(p.date).format("hh:mm A")}</small></td>
            <td class="text-right" data-order="${received}" data-export="${creditMoney(received)}">
              <b class="text-success nobr">${creditMoney(received)}</b>${
                toAdvance > 0
                  ? `<div class="payment-split"><span>to credit ${creditMoney(parseFloat(p.amount) || 0)}</span><span>to advance ${creditMoney(toAdvance)}</span></div>`
                  : ""
              }
            </td>
            <td>${$("<i>").text(p.method || "").html()}</td>
            <td class="payment-ref">${ref || '<span class="text-muted">—</span>'}</td>
            <td class="text-right nobr" data-order="${parseFloat(p.balance_after) || 0}">${creditMoney(parseFloat(p.balance_after) || 0)}</td>
            <td>${$("<i>").text(p.user || "").html()}</td>
            <td class="text-center"><button type="button" class="btn btn-default btn-sm" onclick="$(this).showCreditPaymentReceipt(${i})" title="View / print receipt"><i class="fa fa-print"></i></button></td>
          </tr>`;
        })
        .join("");

      buildCustomerSubtable("#customerPaymentsTable", rows, {
        noun: "payments",
        searchPlaceholder: "Search payments...",
        exportTitle: customerFileTitle("Credit payments"),
        exportSubtitle: () => $("#customerPaymentsDateRange .date-range-label").text(),
        exportColumns: [0, 1, 2, 3, 4, 5, 6],
        sumColumns: [2], // amount received
        actionColumns: [7],
        dateColumn: 1,
        emptyTable: all.length ? "No credit payments in the selected dates." : "No credit payments yet.",
      });
    }

    // advance (money paid in advance for the next bill): added / used history
    function renderCustomerAdvance() {
      let all = creditState.advanceEntries;
      $("#customerTabAdvanceCount").text(all.length);
      $("#customerTxnAdvance").text(creditMoney(creditState.advance));
      $("#customerAdvanceBalance").text(creditMoney(creditState.advance));
      let rows = all
        .filter((e) => customerAdvanceDateFilter.matches(e.date))
        .map((e) => {
          let deposit = e.type === "deposit";
          let amount = parseFloat(e.amount) || 0;
          let source =
            e.source === "settlement" ? "Extra paid when settling credit" :
            deposit ? "Extra paid at the till" : "Used on a bill";
          return `<tr>
            <td class="nobr" data-order="${moment(e.date).valueOf()}">${moment(e.date).format("DD MMM YYYY, hh:mm A")}</td>
            <td>${deposit ? '<span class="label label-success">Added</span>' : '<span class="label label-info">Used</span>'}</td>
            <td class="text-right nobr" data-order="${deposit ? amount : -amount}" data-export="${(deposit ? "" : "-") + creditMoney(amount)}"><b class="${deposit ? "text-success" : ""}">${deposit ? "+" : "−"}${creditMoney(amount)}</b></td>
            <td>${source}</td>
            <td>${$("<i>").text(e.reference || "").html()}</td>
            <td>${$("<i>").text(e.user || "").html()}</td>
          </tr>`;
        })
        .join("");

      buildCustomerSubtable("#customerAdvanceTable", rows, {
        noun: "entries",
        searchPlaceholder: "Search advance...",
        exportTitle: customerFileTitle("Advance"),
        exportSubtitle: () =>
          $("#customerAdvanceDateRange .date-range-label").text() +
          "   ·   Advance balance now: " + creditMoney(creditState.advance),
        sumColumns: [2], // net: added minus used
        dateColumn: 0,
        emptyTable: all.length
          ? "No advance entries in the selected dates."
          : "No advance payments yet. When the customer pays extra at the till or while settling credit, it shows here.",
      });
    }

    let customerPaymentsDateFilter = initDateRangeFilter("#customerPaymentsDateRange", renderCustomerPayments);
    let customerAdvanceDateFilter = initDateRangeFilter("#customerAdvanceDateRange", renderCustomerAdvance);

    // tables in a tab that was hidden need re-measuring once shown
    $('#customerTransactionsModal .customer-tabs a[data-toggle="tab"]').on("shown.bs.tab", function () {
      ["#customerPaymentsTable", "#customerAdvanceTable"].forEach((sel) => {
        if ($.fn.DataTable.isDataTable(sel)) $(sel).DataTable().columns.adjust();
      });
    });

    // receipt in the same receipt window (and print button) as sales receipts
    $.fn.showCreditPaymentReceipt = function (index) {
      let p = creditState.payments[index];
      if (!p) return;
      receipt = creditPaymentReceiptHtml(p);
      $("#viewTransaction").html(receipt);
      $("#orderModal").modal("show");
    };

    // --- Settle Credit window ---
    $("#settleCreditBtn").on("click", function () {
      if (!creditState.customer || creditState.balance <= 0) return;
      $("#settleCreditTitle").text("Settle Credit - " + creditState.customer.name);
      $("#settleOutstanding").text(creditMoney(creditState.balance));
      $("#settleAmount, #settleReference, #settleNote").val("");
      $("#settleRemaining").text("");
      $("#settleAmount").closest(".form-group").removeClass("has-error");
      $("#settleAmount").siblings(".price-input-error").text("");
      // same payment methods as the Pay window (hide the ones switched off in Settings)
      $("#settleMethod option[value='Card']").toggle(settings.card_disabled != "on");
      $("#settleMethod option[value='Bank Transfer']").toggle(settings.bank_disabled != "on");
      $("#settleMethod").val("Cash");
      $("#settleCreditModal").modal("show");
    });

    $("#settleCreditModal").on("shown.bs.modal", function () {
      // this window's backdrop goes between it and the customer window behind
      $(".modal-backdrop").last().css("z-index", 1055);
      $("#settleAmount").trigger("focus");
    });

    $("#settleFullAmount").on("click", function () {
      $("#settleAmount").val(creditState.balance.toFixed(2)).trigger("input");
    });

    $("#settleAmount").on("input", function () {
      let amount = parseFloat($(this).val());
      let $hint = $("#settleRemaining").removeClass("text-danger text-muted text-success");
      if (isNaN(amount) || amount <= 0) {
        $hint.addClass("text-muted").text("");
      } else if (amount > creditState.balance + 0.005) {
        $hint.addClass("text-success").text(
          creditMoney(creditState.balance) + " settles the balance; the extra " +
            creditMoney(amount - creditState.balance) + " is kept as advance for the next bill."
        );
      } else {
        let left = creditState.balance - amount;
        $hint.addClass("text-muted").text(
          left < 0.005 ? "This settles the full balance." : "Remaining after this payment: " + creditMoney(left)
        );
      }
    });

    $("#settleConfirm").on("click", function () {
      let text = $("#settleAmount").val().trim();
      let amount = parseFloat(text);
      if (!/^(\d+(\.\d{1,2})?|\d*\.\d{1,2})$/.test(text) || !(amount > 0)) {
        Swal.fire("Check the amount", "Enter the amount received, greater than 0 (e.g. 500 or 500.50).", "warning");
        return;
      }
      let $btn = $(this).prop("disabled", true);
      let c = creditState.customer;
      $.ajax({
        url: api + "credit-payments",
        type: "POST",
        contentType: "application/json; charset=utf-8",
        data: JSON.stringify({
          customer_id: c._id,
          customer_name: c.name,
          amount: text,
          method: $("#settleMethod").val(),
          reference: $("#settleReference").val().trim(),
          note: $("#settleNote").val().trim(),
          user: user?.fullname || "",
          user_id: user?._id || "",
          till: platform?.till || "",
        }),
      })
        .done(function (payment) {
          $("#settleCreditModal").modal("hide");
          loadCustomerCreditData();
          Swal.fire({
            icon: "success",
            title: "Payment recorded",
            html:
              `${creditMoney(payment.received ?? payment.amount)} received from <b>${$("<i>").text(c.name).html()}</b> (${payment.method}).<br>` +
              (payment.balance_after > 0
                ? `Outstanding now: <b>${creditMoney(payment.balance_after)}</b>`
                : "<b>The credit is fully settled.</b>") +
              (payment.advance_added > 0
                ? `<br>${creditMoney(payment.advance_added)} kept as advance for the next bill` +
                  (payment.advance_balance ? ` (advance now ${creditMoney(payment.advance_balance)})` : "") + "."
                : ""),
            showCancelButton: true,
            confirmButtonText: '<i class="fa fa-print"></i> Receipt',
            cancelButtonText: "Close",
          }).then((r) => {
            if (!r.value) return;
            // the list reloads in the background; show this payment's receipt
            let show = () => {
              let i = creditState.payments.findIndex((p) => String(p._id) === String(payment._id));
              if (i === -1) {
                creditState.payments.unshift(payment);
                i = 0;
              }
              $(document).showCreditPaymentReceipt(i);
            };
            show();
          });
        })
        .fail(function (xhr) {
          Swal.fire(
            "Could not record the payment",
            xhr && xhr.status === 400 && xhr.responseText ? xhr.responseText : "Please try again.",
            "error"
          );
        })
        .always(function () {
          $btn.prop("disabled", false);
        });
    });

    $.fn.viewCustomerTransaction = function (index) {
      $(this).viewTransaction(index, customerTransactions);
    };

    $("#customerTransactionsFilter").on("change", renderCustomerTransactions);

    // the transactions table was hidden while another tab was open: re-measure it
    $('#customerTransactionsModal .customer-tabs a[href="#customerTabTransactions"]').on("shown.bs.tab", function () {
      if ($.fn.DataTable.isDataTable("#customerTransactionsTable")) {
        $("#customerTransactionsTable").DataTable().columns.adjust();
      }
    });

    let customerTxnDateFilter = initDateRangeFilter(
      "#customerTransactionsDateRange",
      renderCustomerTransactions
    );


    $("#customerTransactionsBack").on("click", function () {
      $("#customerTransactionsModal").modal("hide");
      $("#customerModal").modal("show");
      loadCustomerList();
    });

    // ---- Product history (sales, returns, stock adjustments, edits) ----
    let productHistoryEvents = [];
    let productHistoryProduct = null;

    const PRODUCT_HISTORY_TYPES = {
      sale: { label: "Sale", css: "label-success", group: "sales" },
      credit_sale: { label: "Credit sale", css: "label-warning", group: "sales" },
      held: { label: "Held order", css: "label-default", group: "sales" },
      return: { label: "Return", css: "label-danger", group: "returns" },
      exchange: { label: "Exchange", css: "label-danger", group: "returns" },
      grn: { label: "Goods received", css: "label-success", group: "purchases" },
      prn: { label: "Returned to supplier", css: "label-danger", group: "purchases" },
      stock_adjustment: { label: "Stock adjustment", css: "label-info", group: "changes" },
      adjustment: { label: "Stock adjusted", css: "label-inverse", group: "changes" },
      updated: { label: "Product edited", css: "label-primary", group: "changes" },
      created: { label: "Created", css: "label-primary", group: "changes" },
      deleted: { label: "Deleted", css: "label-inverse", group: "changes" },
    };

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      }[c]));
    }

    function historyCategoryName(id) {
      let c = allCategories.find((ctg) => ctg._id == id);
      return c ? c.name : id === "" || id == null ? "None" : "Unknown (" + id + ")";
    }

    function productHistoryDetails(e) {
      let sym = settings.symbol;
      switch (e.type) {
        case "sale":
        case "credit_sale":
        case "held": {
          let badge =
            e.return_status == "full"
              ? ' <span class="label label-danger">Returned</span>'
              : e.return_status == "partial"
              ? ' <span class="label label-warning">Partial return</span>'
              : "";
          let from = (e.batches || []).length
            ? " · from " + e.batches.map((b) => escapeHtml(b.reference) + " ×" + b.qty).join(", ")
            : "";
          return escapeHtml(e.payment_type) + " · " + escapeHtml(e.customer) + from + badge;
        }
        case "return":
        case "exchange":
          return [
            e.returned_qty + " returned",
            e.restocked ? "restocked" : "not restocked",
            e.refund_method ? "refund: " + escapeHtml(e.refund_method) : "",
            e.reason ? "reason: " + escapeHtml(e.reason) : "",
          ].filter(Boolean).join(" · ");
        case "stock_adjustment":
          return `Stock ${e.qty_before} → ${e.qty_after}`;
        case "adjustment":
          return [
            "<b>" + escapeHtml(e.reason || "") + "</b>",
            (e.batches || []).length ? "from " + e.batches.map((b) => escapeHtml(b.reference) + " ×" + b.qty).join(", ") : "",
            e.adjustment_date ? moment(e.adjustment_date, "YYYY-MM-DD").format("DD MMM YYYY") : "",
            `stock ${e.qty_before} → ${e.qty_after}`,
            e.no_cost ? '<span class="text-warning">no cost price: valued at 0</span>' : "",
          ].filter(Boolean).join(" · ");
        case "grn": {
          let cost = (v) => (v === "" || v == null ? "not set" : sym + (parseFloat(v) || 0).toFixed(2));
          return [
            "From " + escapeHtml(e.supplier || ""),
            e.selling_price != null ? `<b>sells at ${sym}${(parseFloat(e.selling_price) || 0).toFixed(2)}</b>` : "",
            e.payment_method ? "paid by " + escapeHtml(e.payment_method) : "",
            e.received_date ? "received " + moment(e.received_date, "YYYY-MM-DD").format("DD MMM YYYY") : "",
            `stock ${e.qty_before} → ${e.qty_after}`,
            e.price_after != null ? `price ${cost(e.price_before)} → ${cost(e.price_after)}` : "",
            e.cost_after != null ? `cost price ${cost(e.cost_before)} → ${cost(e.cost_after)}` : "",
          ].filter(Boolean).join(" · ");
        }
        case "prn":
          return [
            "To " + escapeHtml(e.supplier || ""),
            e.refund_method === "Credit" ? "deducted from the supplier's balance" : e.refund_method ? escapeHtml(e.refund_method) + " refund" : "",
            e.return_date ? "returned " + moment(e.return_date, "YYYY-MM-DD").format("DD MMM YYYY") : "",
            `stock ${e.qty_before} → ${e.qty_after}`,
          ].filter(Boolean).join(" · ");
        case "created":
          return [
            e.qty_after != null ? "Opening stock " + e.qty_after : "Stock not tracked",
            e.price != null ? "price " + sym + parseFloat(e.price).toFixed(2) : "",
          ].filter(Boolean).join(" · ");
        case "updated":
          return (e.changes || [])
            .map((c) => {
              let from = c.from, to = c.to;
              if (c.field === "category") { from = historyCategoryName(from); to = historyCategoryName(to); }
              if (c.field === "price") {
                from = sym + (parseFloat(from) || 0).toFixed(2);
                to = sym + (parseFloat(to) || 0).toFixed(2);
              }
              return `${escapeHtml(c.label)}: ${escapeHtml(from)} → ${escapeHtml(to)}`;
            })
            .join("<br>");
        case "deleted":
          return e.qty_before != null ? "Stock at deletion: " + e.qty_before : "";
        default:
          return "";
      }
    }

    function renderProductHistory() {
      let filter = $("#productHistoryFilter").val() || "all";
      let sym = settings.symbol;
      let rows = "";

      // totals follow the date range (not the activity type filter)
      let unitsSold = 0, salesValue = 0, returned = 0;
      productHistoryEvents.forEach((e) => {
        if (!productHistoryDateFilter.matches(e.date)) return;
        if (e.type === "sale" || e.type === "credit_sale") {
          unitsSold += -e.qty_change;
          salesValue += parseFloat(e.amount) || 0;
        }
        if (e.type === "return" || e.type === "exchange") returned += e.returned_qty || 0;
      });

      productHistoryEvents.forEach((e, index) => {
        let meta = PRODUCT_HISTORY_TYPES[e.type] || { label: e.type, css: "label-default", group: "changes" };
        if (filter !== "all" && meta.group !== filter) return;
        if (!productHistoryDateFilter.matches(e.date)) return;

        let qty =
          e.qty_change == null
            ? ""
            : e.qty_change > 0
            ? `<span class="text-success"><b>+${e.qty_change}</b></span>`
            : e.qty_change < 0
            ? `<span class="text-danger"><b>${e.qty_change}</b></span>`
            : `<span class="text-muted">0</span>`;
        let canView = e.transaction_id != null;

        rows += `<tr>
            <td class="nobr" data-order="${moment(e.date).valueOf()}">${moment(e.date).format("DD MMM YYYY, hh:mm A")}</td>
            <td><span class="label ${meta.css}">${meta.label}</span></td>
            <td>${e.reference != null ? escapeHtml(e.reference) : ""}</td>
            <td class="text-right">${qty}</td>
            <td class="text-right nobr" data-export="${e.price != null && (meta.group !== "changes" || e.type === "adjustment") ? sym + parseFloat(e.price).toFixed(2) : ""}">${
              e.price != null && (meta.group !== "changes" || e.type === "adjustment") ? sym + parseFloat(e.price).toFixed(2) : ""
            }${e.type === "grn" || e.type === "prn" || e.type === "adjustment" ? '<br><small class="text-muted">unit cost</small>' : ""}</td>
            <td class="text-right nobr">${e.amount != null ? sym + parseFloat(e.amount).toFixed(2) : ""}</td>
            <td>${productHistoryDetails(e)}</td>
            <td>${escapeHtml(e.user)}</td>
            <td>${canView ? `<button onClick="$(this).viewProductHistoryTransaction(${index})" class="btn btn-info btn-sm" title="View receipt"><i class="fa fa-search-plus"></i></button>` : ""}</td>
          </tr>`;
      });

      let p = productHistoryProduct;
      $("#productHistUnits").text(unitsSold);
      $("#productHistSales").text(sym + salesValue.toFixed(2));
      $("#productHistReturned").text(returned);
      $("#productHistStock").text(p && p.stock == 1 ? p.quantity : "N/A");

      if ($.fn.DataTable.isDataTable("#productHistoryTable")) {
        $("#productHistoryTable").DataTable().destroy();
      }
      $("#product_history_list").html(rows);
      $("#productHistoryTable").DataTable({
        order: [[0, "desc"]],
        autoWidth: false,
        info: true,
        ordering: true,
        paging: true,
        pageLength: 10,
        lengthMenu: [10, 25, 50, 100],
        // The table scrolls inside the popup (both ways) so the popup always
        // fits the screen and the pagination below the table stays visible.
        scrollX: true,
        scrollY: "40vh", // initial size; adjustProductHistoryColumns() fits it to the window
        scrollCollapse: true,
        dom:
          "<'ph-toolbar'<'ph-toolbar-left'Bl><'ph-toolbar-right'f>>" +
          "rt" +
          "<'ph-footer'<'ph-footer-left'i><'ph-footer-right'p>>",
        columnDefs: [
          { targets: [8], orderable: false },
          { targets: [3, 4, 5], className: "text-right" },
        ],
        buttons: tableExportButtons("Product history - " + (p ? p.name : ""), {
          exportOptions: { columns: [0, 1, 2, 3, 4, 5, 6, 7] }, // not the View button
          subtitle: () =>
            $("#productHistoryFilter option:selected").text() +
            "   ·   " + $("#productHistoryDateRange .date-range-label").text(),
        }),
        language: {
          search: "_INPUT_",
          searchPlaceholder: "Search history...",
          lengthMenu: "Show _MENU_ rows",
          info: "Showing _START_ to _END_ of _TOTAL_ entries",
          emptyTable: "No history for this product yet",
        },
      });
      adjustProductHistoryColumns();
    }

    // Sizes the table's scroll area to the space left in the window so the
    // whole popup (incl. pagination) fits on screen, then realigns the header
    // (header and body are separate tables when scrolling, and widths can't be
    // measured while the popup is hidden).
    function adjustProductHistoryColumns() {
      if (!$.fn.DataTable.isDataTable("#productHistoryTable")) return;
      let modal = $("#productHistoryModal");
      let scrollBody = modal.find(".dataTables_scrollBody");

      if (modal.hasClass("in") && scrollBody.length) {
        let dialog = modal.find(".modal-dialog")[0];
        let content = modal.find(".modal-content")[0];
        let margins =
          (parseFloat(getComputedStyle(dialog).marginTop) || 0) +
          (parseFloat(getComputedStyle(dialog).marginBottom) || 0);
        // everything in the popup except the table rows
        let chrome = content.offsetHeight - scrollBody[0].offsetHeight;
        let available = window.innerHeight - margins - chrome;
        scrollBody.css("max-height", Math.max(160, Math.floor(available)) + "px");
      }

      $("#productHistoryTable").DataTable().columns.adjust();
    }
    $("#productHistoryModal").on("shown.bs.modal", adjustProductHistoryColumns);
    $(window).on("resize", adjustProductHistoryColumns);

    // The product's stock batches (one per GRN, each with its own unit cost
    // and selling price), in selling order: the first with units left is
    // being sold now; the next takes over when it runs out.
    function loadProductBatches(product) {
      $("#productBatches").hide().empty();
      if (product.stock != 1) return;
      $.get(api + "inventory/batches/" + product._id).done(function (batches) {
        if (productHistoryProduct !== product || !(batches || []).length) return;
        let sym = settings.symbol;
        let money = (v) => (v === null || v === undefined || v === "" ? "-" : sym + (parseFloat(v) || 0).toFixed(2));
        let current = batches.find((b) => b.qty_left > 0);
        let rows = batches
          .map((b) => {
            let state =
              b === current
                ? '<span class="label label-success" title="The product\'s price in the list and when no price barcode is scanned">Default price</span>'
                : b.qty_left > 0
                ? '<span class="label label-info">In stock</span>'
                : '<span class="text-muted">Sold out</span>';
            return `<tr class="${b.qty_left > 0 ? "" : "text-muted"}">
              <td>${escapeHtml(b.reference)}${b.supplier ? `<br><small>${escapeHtml(b.supplier)}</small>` : ""}</td>
              <td class="nobr">${b.received_date ? moment(b.received_date, "YYYY-MM-DD").format("DD MMM YYYY") : "-"}</td>
              <td class="text-right nobr">${money(b.unit_cost)}</td>
              <td class="text-right nobr"><b>${money(b.selling_price)}</b></td>
              <td class="nobr">${b.barcode ? escapeHtml(b.barcode) : "-"}${
                b.barcode
                  ? ` <button type="button" class="btn btn-default btn-xs batch-label-btn" title="Print price labels"
                      data-code="${escapeHtml(b.barcode)}" data-price="${escapeHtml(b.selling_price)}" data-left="${b.qty_left}"><i class="fa fa-barcode"></i></button>`
                  : ""
              }</td>
              <td class="text-right">${b.qty_received}</td>
              <td class="text-right"><b>${b.qty_left}</b></td>
              <td>${state}</td>
            </tr>`;
          })
          .join("");
        $("#productBatches")
          .html(
            `<div class="product-batches-title"><i class="fa fa-cubes"></i> Stock batches <small class="text-muted">each selling price has its own barcode; scanning it charges that price</small></div>
            <div class="product-batches-scroll"><table class="table table-condensed">
              <thead><tr><th>Batch</th><th>Received</th><th class="text-right">Unit Cost</th><th class="text-right">Selling Price</th><th>Price Barcode</th><th class="text-right">Received</th><th class="text-right">Left</th><th></th></tr></thead>
              <tbody>${rows}</tbody>
            </table></div>`
          )
          .show();
        adjustProductHistoryColumns(); // less room for the history list now
      });
    }

    // labels for one selling price (its barcode), from the batches table
    $("#productBatches").on("click", ".batch-label-btn", function () {
      let product = productHistoryProduct;
      if (!product) return;
      let code = String($(this).data("code"));
      let price = $(this).data("price");
      let left = parseInt($(this).data("left")) || 1;
      Swal.fire({
        title: "Print price labels",
        html: `<b>${escapeHtml(product.name)}</b> · ${settings.symbol}${(parseFloat(price) || 0).toFixed(2)} · ${escapeHtml(code)}`,
        input: "number",
        inputLabel: "How many labels?",
        inputValue: Math.max(left, 1),
        inputAttributes: { min: 1, max: 1000, step: 1 },
        showCancelButton: true,
        confirmButtonText: '<i class="fa fa-print"></i> Print',
      }).then(function (result) {
        if (!result.value) return;
        printPriceLabels([{ name: product.name, code: code, price: price, copies: parseInt(result.value) || 1 }]);
      });
    });

    $.fn.viewProductHistory = function (productId) {
      let product = allProducts.find((p) => p._id == productId);
      if (!product) return;
      productHistoryProduct = product;
      productHistoryEvents = [];

      $("#productHistoryTitle").text("Product History - " + product.name);
      $("#productHistoryInfo").html(
        `Barcode: <b>${escapeHtml(product.barcode)}</b> &nbsp;·&nbsp; ` +
          `Category: <b>${escapeHtml(historyCategoryName(product.category))}</b> &nbsp;·&nbsp; ` +
          `Price now: <b>${settings.symbol}${(parseFloat(product.price) || 0).toFixed(2)}</b> &nbsp;·&nbsp; ` +
          `Stock tracking: <b>${product.stock == 1 ? "On" : "Off"}</b>`
      );
      loadProductBatches(product);
      $("#productHistoryFilter").val("all");
      productHistoryDateFilter.reset();
      if ($.fn.DataTable.isDataTable("#productHistoryTable")) {
        $("#productHistoryTable").DataTable().destroy();
      }
      $("#product_history_list").html('<tr><td colspan="9">Loading...</td></tr>');

      $("#Products").modal("hide");
      $("#productHistoryModal").modal("show");

      $.get(api + "product-history/" + product._id)
        .done(function (events) {
          productHistoryEvents = events || [];
          renderProductHistory();
        })
        .fail(function () {
          $("#product_history_list").html('<tr><td colspan="9">Could not load the product history.</td></tr>');
        });
    };

    $.fn.viewProductHistoryTransaction = function (index) {
      let e = productHistoryEvents[index];
      if (!e || e.transaction_id == null) return;
      $.get(api + encodeURIComponent(e.transaction_id))
        .done(function (transaction) {
          if (!transaction) {
            Swal.fire("Not found", "This transaction no longer exists.", "warning");
            return;
          }
          $(this).viewTransaction(0, [transaction]);
        })
        .fail(function (xhr) {
          if (xhr.status == 404) {
            Swal.fire("Not found", "This transaction no longer exists.", "warning");
          } else {
            Swal.fire("Error", "Could not load the transaction.", "error");
          }
        });
    };

    $("#productHistoryFilter").on("change", renderProductHistory);

    let productHistoryDateFilter = initDateRangeFilter(
      "#productHistoryDateRange",
      renderProductHistory
    );

    $("#productHistoryBack").on("click", function () {
      $("#productHistoryModal").modal("hide");
      $("#Products").modal("show");
    });

    // under the price in the product list: the product's other selling prices
    // with stock (each has its own barcode)
    function productNextPriceHint(product) {
      // only a hint: it must never stop the product list from showing
      try {
        let sets = priceSetsOf(product);
        if (sets.length < 2) return "";
        let others = sets.slice(1);
        return `<br><small class="text-muted" title="${escapeHtml(
          sets.map((s) => s.code + ": " + settings.symbol + parseFloat(s.price).toFixed(2) + " (" + s.qty_left + " left)").join("\n")
        )}">also ${others.map((s) => settings.symbol + parseFloat(s.price).toFixed(2)).join(", ")}</small>`;
      } catch (e) {
        console.error("Price hint failed for product " + (product && product._id), e);
        return "";
      }
    }

    // builds the row markup for one product inside a category's detail table
    function buildProductRowHtml(product) {
      let index = allProducts.indexOf(product);

      return `<tr>
          <td><img id="${product.barcode}"></td>
          <td><img style="max-height: 50px; max-width: 50px; border: 1px solid #ddd;" src="${
            product.img == ""
              ? "./assets/images/default.jpg"
              : img_path + product.img
          }" id="product_img"></td>
          <td>${product.name}</td>
          <td>${product.cost_price !== undefined && product.cost_price !== "" ? settings.symbol + parseFloat(product.cost_price).toFixed(2) : '<span class="text-muted" title="No cost price yet">&mdash;</span>'}</td>
          <td>${settings.symbol}${product.price}${productNextPriceHint(product)}</td>
          <td>${product.stock == 1 ? product.quantity : "N/A"}</td>
          <td class="nobr">
          <span class="btn-group" style="display: flex;">
            <button onClick="$(this).printBarcode('${product.name}', '${
        product.barcode
      }', '${
        product.price
      }')" class="btn btn-dark btn-sm" title="Print barcode"><i class="fa fa-print"></i></button>
            <button onClick="$(this).viewProductHistory(${product._id})" class="btn btn-info btn-sm" title="History"><i class="fa fa-history"></i></button>
            ${product.stock == 1 ? `<button onClick="$(this).adjustProductStock(${product._id})" class="btn btn-default btn-sm" title="Adjust stock (expired, damaged, lost, stock count...)"><i class="fa fa-sliders"></i></button>` : ""}
            <button onClick="$(this).editProduct(${index})" class="btn btn-warning btn-sm"><i class="fa fa-edit"></i></button>
            <button onClick="$(this).deleteProduct(${product._id}, '${
        product.img
      }')" class="btn btn-danger btn-sm"><i class="fa fa-trash"></i></button>
          </span>
        </td>
      </tr>`;
    }

    // builds the summary row + expandable detail row for one category group
    function buildCategoryGroupHtml(group, itemsToShow, expanded) {
      return `<tr class="category-row" data-category="${group.catId}">
          <td><i class="fa fa-chevron-${
            expanded ? "down" : "right"
          } toggle-icon"></i></td>
          <td><strong>${group.categoryName}</strong></td>
          <td>${group.trackedCount > 0 ? group.totalStock : "N/A"}</td>
          <td>${group.items.length}</td>
        </tr>
        <tr class="category-detail" data-category="${
          group.catId
        }" style="display: ${expanded ? "table-row" : "none"};">
          <td colspan="4" style="padding: 0;">
            <table class="table table-bordered table-condensed detail-table">
              <thead>
                <tr>
                  <th>Barcode</th>
                  <th>Item</th>
                  <th>Name</th>
                  <th>Cost</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${itemsToShow.map(buildProductRowHtml).join("")}
              </tbody>
            </table>
          </td>
        </tr>`;
    }

    // recomputes the category groups (barcode/price/stock changes, category
    // renamed, etc.) and resets back to page 1
    function loadProductList() {
      let products = [...allProducts];

      let groups = {};
      products.forEach((product) => {
        let key = String(product.category);
        (groups[key] = groups[key] || []).push(product);
      });

      // preserve category display order, with anything referencing an
      // unknown/removed category last
      let categoryIds = allCategories.map((c) => String(c._id));
      Object.keys(groups).forEach((key) => {
        if (!categoryIds.includes(key)) categoryIds.push(key);
      });

      productGroups = categoryIds
        .filter((catId) => groups[catId] && groups[catId].length > 0)
        .map((catId) => {
          let items = groups[catId];
          let categoryMeta = allCategories.filter((c) => String(c._id) == catId);
          let categoryName =
            categoryMeta.length > 0 ? categoryMeta[0].name : "Uncategorized";
          let trackedItems = items.filter((p) => p.stock == 1);
          let totalStock = trackedItems.reduce(
            (sum, p) => sum + (parseInt(p.quantity) || 0),
            0
          );

          return {
            catId,
            categoryName,
            items,
            totalStock,
            trackedCount: trackedItems.length,
          };
        });

      productListPage = 1;
      renderProductList();
    }

    // renders the current page of (optionally search-filtered) category
    // groups and refreshes the pagination controls
    // categories + products matching the Products search box (used by the
    // list and by its Excel / PDF exports, so both show the same rows)
    function productListMatches() {
      let term = $("#productListSearch").val().trim().toLowerCase();

      return productGroups
        .map((group) => {
          if (term === "") {
            return { group, itemsToShow: group.items, expand: false };
          }

          let categoryMatches = group.categoryName.toLowerCase().includes(term);
          let itemsToShow = categoryMatches
            ? group.items
            : group.items.filter((p) =>
                (p.name + " " + p.barcode).toLowerCase().includes(term)
              );

          return { group, itemsToShow, expand: true, matched: categoryMatches || itemsToShow.length > 0 };
        })
        .filter((entry) => term === "" || entry.matched);
    }

    // ---- Products page: Excel / PDF exports (same look as the table exports) ----
    // Both export what the search box currently shows (all pages).
    function productExportSubtitle(entries) {
      let products = entries.reduce((n, e) => n + e.itemsToShow.length, 0);
      let term = $("#productListSearch").val().trim();
      return (
        entries.length + (entries.length === 1 ? " category" : " categories") +
        " · " + products + (products === 1 ? " product" : " products") +
        (term ? ' · Search: "' + term + '"' : "")
      );
    }

    // cost / selling / profit / margin for one product (null = not available)
    function productPriceFigures(product) {
      let price = parseFloat(product.price);
      let cost = product.cost_price === undefined || product.cost_price === "" ? null : parseFloat(product.cost_price);
      let profit = cost === null || isNaN(price) ? null : price - cost;
      return {
        price: isNaN(price) ? null : price,
        cost: cost,
        profit: profit,
        margin: profit === null || !price ? null : profit / price,
      };
    }

    // Excel: products grouped under category rows (groups can be collapsed)
    function exportProductsExcel() {
      let entries = productListMatches();
      const headers = ["Barcode", "Product", "Cost Price", "Selling Price", "Profit / Item", "Margin", "Stock"];
      let cols = headers.length;
      let wb = new ExcelJS.Workbook();
      wb.creator = reportStoreName();
      let ws = wb.addWorksheet("Products");
      // keep groups expanded; the +/- control sits above each group
      ws.properties.outlineLevelRow = 2;
      ws.properties.outlineProperties = { summaryBelow: false };

      let headerRowNumber = addReportHeader(ws, "Product List", productExportSubtitle(entries), cols);
      let headerRow = ws.getRow(headerRowNumber);
      headers.forEach((h, i) => (headerRow.getCell(i + 1).value = h));
      styleReportHeaderRow(headerRow);
      [3, 4, 5, 6, 7].forEach((c) => (headerRow.getCell(c).alignment = { vertical: "middle", horizontal: "right", wrapText: true }));

      let r = headerRowNumber;
      entries.forEach(({ group, itemsToShow }) => {
        // category row
        let g = ws.getRow(++r);
        g.getCell(1).value = group.categoryName + "  (" + itemsToShow.length + (itemsToShow.length === 1 ? " product)" : " products)");
        let tracked = itemsToShow.filter((p) => p.stock == 1);
        g.getCell(7).value = tracked.length ? tracked.reduce((s, p) => s + (parseInt(p.quantity) || 0), 0) : "N/A";
        for (let c = 1; c <= cols; c++) {
          let cell = g.getCell(c);
          cell.font = { bold: true, size: 10.5, color: { argb: "FF" + REPORT_STYLE.ink } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + REPORT_STYLE.groupFill } };
          cell.border = reportBorder();
          cell.alignment = { vertical: "middle", horizontal: c === 7 ? "right" : "left" };
        }
        if (typeof g.getCell(7).value === "number") g.getCell(7).numFmt = reportNumFmt("int");

        // product rows
        itemsToShow.forEach((product, i) => {
          let row = ws.getRow(++r);
          row.outlineLevel = 1;
          let zebra = i % 2 === 1;
          let f = productPriceFigures(product);

          // barcode always text (keeps leading zeros / long codes intact)
          let barcode = row.getCell(1);
          setReportCell(barcode, "", zebra);
          barcode.value = String(product.barcode ?? "");
          barcode.numFmt = "@";
          setReportCell(row.getCell(2), product.name || "", zebra);
          setReportCell(row.getCell(3), f.cost === null ? "" : f.cost, zebra, "money");
          setReportCell(row.getCell(4), f.price === null ? "" : f.price, zebra, "money");
          setReportCell(row.getCell(5), f.profit === null ? "" : f.profit, zebra, "money");
          setReportCell(row.getCell(6), f.margin === null ? "" : f.margin, zebra, "percent");
          setReportCell(row.getCell(7), product.stock == 1 ? parseInt(product.quantity) || 0 : "N/A", zebra, "int");
          row.getCell(7).alignment = { vertical: "top", horizontal: "right" };
          if (f.cost === null) {
            let c = row.getCell(3);
            c.value = "not set";
            c.font = { italic: true, size: 10, color: { argb: "FF" + REPORT_STYLE.muted } };
            c.alignment = { horizontal: "right" };
          }
          if (f.profit !== null && f.profit < 0) row.getCell(6).font = { size: 10, color: { argb: "FFD84340" } };
        });
      });

      finishReportSheet(ws, headerRowNumber, cols, r);
      ws.getColumn(1).width = Math.max(ws.getColumn(1).width, 26); // category names live in column A
      let note = ws.getRow(r + 2);
      note.getCell(1).value = "Profit / Item and Margin use the cost and selling prices. Products without a cost price show \"not set\".";
      note.getCell(1).font = { italic: true, size: 9, color: { argb: "FF" + REPORT_STYLE.muted } };

      $("#loading").show();
      downloadWorkbook(wb, "Product List " + moment().format("YYYY-MM-DD HHmm") + ".xlsx")
        .catch((err) => {
          console.error("Failed to generate product list Excel file:", err);
          Swal.fire("Oops!", "Could not create the Excel file. Please try again.", "warning");
        })
        .finally(() => $("#loading").hide());
    }

    // PDF: one table with a Category column, styled like the other PDF exports
    function exportProductsPdf() {
      let entries = productListMatches();
      let sym = reportCurrency();
      let money = (n) => (n < 0 ? "-" : "") + (sym ? sym + " " : "") +
        Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      let body = [["Category", "Product", "Barcode", "Cost Price", "Selling Price", "Profit / Item", "Margin", "Stock"].map((t) => ({ text: t }))];
      entries.forEach(({ group, itemsToShow }) => {
        itemsToShow.forEach((product) => {
          let f = productPriceFigures(product);
          body.push([
            group.categoryName,
            product.name || "",
            String(product.barcode ?? ""),
            f.cost === null ? "not set" : money(f.cost),
            f.price === null ? "" : money(f.price),
            f.profit === null ? "—" : money(f.profit),
            f.margin === null ? "—" : (f.margin * 100).toFixed(1) + "%",
            product.stock == 1 ? String(parseInt(product.quantity) || 0) : "N/A",
          ].map((t) => ({ text: t })));
        });
      });
      if (body.length === 1) {
        Swal.fire("Nothing to export", "No products match the current search.", "info");
        return;
      }

      let doc = { content: [{ table: { body: body } }] };
      styleReportPdf(doc, "Product List", productExportSubtitle(entries), null, { textColumns: [2] });
      // margin text in red when it's a loss
      body.slice(1).forEach((row) => { if (String(row[5].text).startsWith("-")) row[5].color = row[6].color = "#d84340"; });
      try {
        pdfMake.createPdf(doc).download("Product List " + moment().format("YYYY-MM-DD HHmm") + ".pdf");
      } catch (err) {
        console.error("Failed to generate product list PDF:", err);
        Swal.fire("Oops!", "Could not create the PDF file. Please try again.", "warning");
      }
    }

    $("#productsExportExcel").on("click", exportProductsExcel);
    $("#productsExportPdf").on("click", exportProductsPdf);

    function renderProductList() {
      let filtered = productListMatches();

      let totalEntries = filtered.length;
      let totalPages = Math.max(1, Math.ceil(totalEntries / productListPageSize));
      productListPage = Math.min(Math.max(productListPage, 1), totalPages);

      let start = (productListPage - 1) * productListPageSize;
      let pageEntries = filtered.slice(start, start + productListPageSize);

      $("#product_list").html(
        pageEntries
          .map((entry) =>
            buildCategoryGroupHtml(entry.group, entry.itemsToShow, entry.expand)
          )
          .join("")
      );

      pageEntries.forEach((entry) => {
        entry.itemsToShow.forEach((pro) => {
          $("#" + pro?.barcode + "").JsBarcode(pro?.barcode, {
            width: 2,
            height: 25,
            fontSize: 14,
          });
        });
      });

      renderProductListPagination(totalEntries, totalPages);
    }

    function renderProductListPagination(totalEntries, totalPages) {
      let start = totalEntries === 0 ? 0 : (productListPage - 1) * productListPageSize + 1;
      let end = Math.min(productListPage * productListPageSize, totalEntries);

      $("#productListInfo").text(
        totalEntries === 0
          ? "No matching categories"
          : `Showing ${start} to ${end} of ${totalEntries} categories`
      );

      // same Bootstrap pagination markup as the DataTables pagers, so all
      // list tables look alike
      let pager = $("#productListPager").empty();
      let ul = $("<ul>", { class: "pagination" }).appendTo(pager);

      function pageItem(label, page, disabled, active, extraClass) {
        let li = $("<li>", {
          class:
            "paginate_button " +
            (extraClass || "") +
            (disabled ? " disabled" : "") +
            (active ? " active" : ""),
        });
        $("<a>", { href: "javascript:void(0)", text: label })
          .click(function () {
            if (disabled || active) return;
            productListPage = page;
            renderProductList();
          })
          .appendTo(li);
        return li.appendTo(ul);
      }

      pageItem("Previous", productListPage - 1, productListPage <= 1, false, "previous");
      for (let i = 1; i <= totalPages; i++) {
        pageItem(i, i, false, i === productListPage);
      }
      pageItem("Next", productListPage + 1, productListPage >= totalPages, false, "next");
    }

    // expand/collapse a category group in the products list
    $("#product_list").on("click", ".category-row", function () {
      let catId = $(this).data("category");
      let detail = $(
        '.category-detail[data-category="' + catId + '"]'
      );
      let expanded = detail.is(":visible");

      detail.toggle(!expanded);
      $(this)
        .find(".toggle-icon")
        .toggleClass("fa-chevron-right", expanded)
        .toggleClass("fa-chevron-down", !expanded);
    });

    $("#productListSearch").on("input", function () {
      productListPage = 1;
      renderProductList();
    });

    $("#productListPageSize").on("change", function () {
      productListPageSize = parseInt($(this).val(), 10);
      productListPage = 1;
      renderProductList();
    });

    function loadCategoryList() {
      let category_list = "";
      let counter = 0;
      $("#category_list").empty();
      $("#categoryList").DataTable().destroy();

      allCategories.forEach((category, index) => {
        counter++;

        category_list += `<tr>
     
            <td>${category.name}</td>
            <td><span class="btn-group"><button onClick="$(this).editCategory(${index})" class="btn btn-warning"><i class="fa fa-edit"></i></button><button onClick="$(this).deleteCategory(${category._id})" class="btn btn-danger"><i class="fa fa-trash"></i></button></span></td></tr>`;
      });

      if (counter == allCategories.length) {
        $("#category_list").html(category_list);
        $("#categoryList").DataTable(
          standardTableOptions({
            noun: "categories",
            searchPlaceholder: "Search categories...",
            exportTitle: "Categories",
            exportColumns: [0],
            actionColumns: [1],
          })
        );
      }
    }

    $.fn.serializeObject = function () {
      var o = {};
      var a = this.serializeArray();
      $.each(a, function () {
        if (o[this.name]) {
          if (!o[this.name].push) {
            o[this.name] = [o[this.name]];
          }
          o[this.name].push(this.value || "");
        } else {
          o[this.name] = this.value || "";
        }
      });
      return o;
    };

    $("#log-out").click(function () {
      Swal.fire({
        title: "Are you sure?",
        text: "You are about to log out.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#d33",
        cancelButtonColor: "#3085d6",
        confirmButtonText: "Logout",
      }).then((result) => {
        if (result.value) {
          $.get(api + "users/logout/" + user._id, function (data) {
            storage.delete("auth");
            storage.delete("user");
            sessionStorage.removeItem("auth");
            ipcRenderer.send("app-reload", "");
          });
        }
      });
    });

    $("#settings_form").on("submit", function (e) {
      e.preventDefault();
      let formData = $(this).serializeObject();
      let mac_address;

      api = "http://" + host + ":" + port + "/api/";

      macaddress.one(function (err, mac) {
        mac_address = mac;
      });

      formData["app"] = $("#app").find("option:selected").text();
      formData["mac"] = mac_address;
      formData["till"] = 1;

      $("#settings_form").append(
        '<input type="hidden" name="app" value="' + formData.app + '" />'
      );

      if (formData.percentage != "" && !$.isNumeric(formData.percentage)) {
        Swal.fire(
          "Oops!",
          "Please make sure the tax value is a number",
          "warning"
        );
      } else {
        storage.set("settings", formData);

        $(this).attr("action", api + "settings/post");
        $(this).attr("method", "POST");

        $(this).ajaxSubmit({
          contentType: "application/json",
          success: function (response) {
            ipcRenderer.send("app-reload", "");
          },
          error: function (data) {
            console.log(data);
          },
        });
      }
    });

    function isNumeric(n) {
      return !isNaN(parseFloat(n)) && isFinite(n);
    }

    function refreshDataLocationDisplay() {
      ipcRenderer.invoke("data:get-location").then(function (loc) {
        $("#data_location_display").val(loc.dataRoot);
      });
    }

    refreshDataLocationDisplay();

    $("#change_data_location").on("click", function () {
      ipcRenderer
        .invoke("data:choose-folder", { title: "Select New Data Location" })
        .then(function (picked) {
          if (picked.canceled) return;

          Swal.fire({
            title: "Move data to this folder?",
            text:
              "Your existing data will be copied to \"" +
              picked.path +
              "\" and the app will restart to use it.",
            icon: "warning",
            showCancelButton: true,
            confirmButtonText: "Move & Restart",
          }).then(function (result) {
            if (!result.value) return;

            Swal.fire({
              title: "Moving data...",
              allowOutsideClick: false,
              didOpen: () => Swal.showLoading(),
            });

            ipcRenderer
              .invoke("data:set-location", picked.path)
              .then(function (res) {
                if (res.success) {
                  ipcRenderer.send("app-relaunch", "");
                } else {
                  Swal.fire("Oops!", res.error || "Could not change the data location.", "error");
                }
              });
          });
        });
    });

    $("#backup_data").on("click", function () {
      ipcRenderer.invoke("data:backup").then(function (res) {
        if (res.canceled) return;
        if (res.success) {
          Swal.fire("Backup complete!", "Saved to \"" + res.path + "\"", "success");
        } else {
          Swal.fire("Oops!", res.error || "Backup failed.", "error");
        }
      });
    });

    $("#restore_data").on("click", function () {
      Swal.fire({
        title: "Restore data?",
        text: "This replaces ALL current data (products, customers, transactions, settings) with the contents of the backup you choose. This cannot be undone.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#d33",
        confirmButtonText: "Choose backup & Restore",
      }).then(function (result) {
        if (!result.value) return;

        ipcRenderer.invoke("data:restore").then(function (res) {
          if (res.canceled) return;

          if (res.success) {
            Swal.fire({
              title: "Restore complete!",
              text: "The app will now restart.",
              icon: "success",
              allowOutsideClick: false,
            }).then(function () {
              ipcRenderer.send("app-relaunch", "");
            });
          } else {
            Swal.fire("Oops!", res.error || "Restore failed.", "error");
          }
        });
      });
    });

    // ---- Reset Database (Settings) ----
    // Clears all data except the user accounts on the next start (see
    // data:reset in start.js), after making a backup that Restore Data can
    // bring back.
    const RESET_CLEARS = [
      ["Sales & transactions", "invoices, returns, credit payments and customer advances"],
      ["Customers", "customer list and credit details"],
      ["Expenses", "expenses and expense types"],
      ["Suppliers, GRNs & PRNs", "suppliers, goods received notes, purchase returns and supplier payments"],
      ["Products & categories", "products, stock, categories and product history"],
      ["Store settings", "store name, receipt details, tax and logo"],
      ["Uploaded images", "product pictures and the store logo"],
    ];

    $("#reset_database").on("click", function () {
      let clears = RESET_CLEARS.map(
        (c) => `<li><i class="fa fa-times-circle"></i><span><b>${c[0]}</b><small>${c[1]}</small></span></li>`
      ).join("");

      Swal.fire({
        title: "Reset database",
        icon: "warning",
        html: `<div class="reset-db-dialog">
                 <p>This clears all data. A backup is saved first, so it can be brought back with <b>Restore Data</b>.</p>
                 <ul class="reset-db-list">${clears}</ul>
                 <div class="reset-db-kept"><i class="fa fa-check-circle"></i><span><b>User accounts are kept</b><small>All users, passwords and permissions stay as they are.</small></span></div>
                 <label class="reset-db-confirm" for="resetConfirmText">Type <b>RESET</b> to confirm</label>
                 <input id="resetConfirmText" class="form-control" autocomplete="off" placeholder="RESET">
               </div>`,
        showCancelButton: true,
        confirmButtonColor: "#d33",
        confirmButtonText: "Back up & Reset",
        focusConfirm: false,
        preConfirm: () => {
          if ($.trim($(Swal.getPopup()).find("#resetConfirmText").val()) !== "RESET") {
            Swal.showValidationMessage("Type RESET (in capitals) to confirm.");
            return false;
          }
          return true;
        },
      }).then(function (result) {
        if (!result.value) return;

        // spinner started right away (not in didOpen, which can run after a
        // quick reply and would then put the spinner on the next dialog)
        Swal.fire({ title: "Backing up...", allowOutsideClick: false, allowEscapeKey: false });
        Swal.showLoading();

        ipcRenderer.invoke("data:reset").then(function (res) {
          // the "Backing up..." spinner would otherwise hide the next dialog's button
          Swal.hideLoading();
          if (!res || !res.success) {
            Swal.fire("Oops!", (res && res.error) || "Could not reset the database.", "error");
            return;
          }
          Swal.fire({
            title: "Ready to reset",
            html:
              `<p>All data except the user accounts will be cleared when the app restarts.</p>` +
              (res.backupPath
                ? `<p class="reset-db-backup">Backup saved to:<br><code>${$("<i>").text(res.backupPath).html()}</code></p>`
                : ""),
            icon: "success",
            allowOutsideClick: false,
            confirmButtonText: "Restart now",
          }).then(function () {
            ipcRenderer.send("app-relaunch", "");
          });
        });
      });
    });

    $("#net_settings_form").on("submit", function (e) {
      e.preventDefault();
      let formData = $(this).serializeObject();

      if (formData.till == 0 || formData.till == 1) {
        Swal.fire("Oops!", "Please enter a number greater than 1.", "warning");
      } else {
        if (isNumeric(formData.till)) {
          formData["app"] = $("#app").find("option:selected").text();
          storage.set("settings", formData);
          ipcRenderer.send("app-reload", "");
        } else {
          Swal.fire("Oops!", "Till number must be a number!", "warning");
        }
      }
    });

    $("#saveUser").on("submit", function (e) {
      e.preventDefault();
      let formData = $(this).serializeObject();

      // A new user (via the "+" button) has no existing password to fall
      // back to, so it must always be validated against the Repeat
      // Password field. Editing an existing account may keep its current
      // password unchanged without retyping/confirming it.
      let isNewUser = !formData.id;
      let originalPassword = isNewUser
        ? null
        : ownUserEdit
        ? atob(user.password)
        : atob(allUsers[user_index].password);

      let keepingOriginalPassword =
        !isNewUser && formData.password == originalPassword;
      let passwordsMatch = formData.password == formData.pass;

      if (!keepingOriginalPassword && !passwordsMatch) {
        Swal.fire("Oops!", "Passwords do not match!", "warning");
      } else {
        $.ajax({
          url: api + "users/post",
          type: "POST",
          data: JSON.stringify(formData),
          contentType: "application/json; charset=utf-8",
          cache: false,
          processData: false,
          success: function (data) {
            if (ownUserEdit) {
              ipcRenderer.send("app-reload", "");
            } else {
              $("#userModal").modal("hide");

              loadUserList();

              $("#Users").modal("show");
              Swal.fire("Ok!", "User details saved!", "success");
            }
          },
          error: function (data) {
            console.log(data);
          },
        });
      }
    });

    $("#app").change(function () {
      if (
        $(this).find("option:selected").text() ==
        "Network Point of Sale Terminal"
      ) {
        setSettingsMode(true);
        macaddress.one(function (err, mac) {
          $("#mac").val(mac);
        });
      } else {
        setSettingsMode(false);
      }
    });

    $("#cashier").click(function () {
      ownUserEdit = true;

      if (
        isCurrentUserAdministrator() &&
        platform?.app != "Network Point of Sale Terminal"
      ) {
        $(".perms").show();
      } else {
        $(".perms").hide();
      }

      $("#userModal").modal("show");

      $("#user_id").val(user._id);
      $("#fullname").val(user.fullname);
      $("#username").val(user.username);
      $("#password").val(atob(user.password));

      $("#perm_products").prop("checked", user.perm_products == 1);
      $("#perm_categories").prop("checked", user.perm_categories == 1);
      $("#perm_transactions").prop("checked", user.perm_transactions == 1);
      $("#perm_users").prop("checked", user.perm_users == 1);
      $("#perm_settings").prop("checked", user.perm_settings == 1);
      $("#perm_profit").prop("checked", user.perm_profit == 1);
      $("#perm_expenses").prop("checked", user.perm_expenses == 1);
      $("#perm_suppliers").prop("checked", user.perm_suppliers == 1);
      $("#perm_journal").prop("checked", user.perm_journal == 1);
    });

    $("#add-user").click(function () {
      ownUserEdit = false;

      if (
        isCurrentUserAdministrator() &&
        platform?.app != "Network Point of Sale Terminal"
      ) {
        $(".perms").show();
      } else {
        $(".perms").hide();
      }

      $("#saveUser").get(0).reset();
      $("#userModal").modal("show");
    });

    $("#settings").click(function () {
      if (platform?.app == "Network Point of Sale Terminal") {
        setSettingsMode(true);

        $("#ip").val(platform.ip);
        $("#till").val(platform.till);

        macaddress.one(function (err, mac) {
          $("#mac").val(mac);
        });

        $("#app option")
          .filter(function () {
            return $(this).text() == platform?.app;
          })
          .prop("selected", true);
      } else {
        setSettingsMode(false);

        $("#settings_id").val("1");
        $("#store").val(settings.store);
        $("#address_one").val(settings.address_one);
        $("#address_two").val(settings.address_two);
        $("#contact").val(settings.contact);
        $("#tax").val(settings.tax);
        $("#symbol").val(settings.symbol);
        $("#percentage").val(settings.percentage);
        $("#footer").val(settings.footer);
        $("#logo_img").val(settings.img);
        if (settings.charge_tax == "on") {
          $("#charge_tax").prop("checked", true);
        }
        if (settings.card_disabled == "on") {
          $("#card_disabled").prop("checked", true);
        }
        if (settings.bank_disabled == "on") {
          $("#bank_disabled").prop("checked", true);
        }
        if (settings.return_disabled == "on") {
          $("#return_disabled").prop("checked", true);
        }
        if (settings.exchange_disabled == "on") {
          $("#exchange_disabled").prop("checked", true);
        }
        if (settings.stock_check_disabled == "on") {
          $("#stock_check_disabled").prop("checked", true);
        }
        if (settings.img != "") {
          $("#logoname").hide();
          $("#current_logo").html(
            `<img src="${img_path + settings.img}" alt="">`
          );
          $("#rmv_logo").show();
        }

        $("#app option")
          .filter(function () {
            return $(this).text() == settings.app;
          })
          .prop("selected", true);
      }
    });
  });

// ---- Settings window: a menu on the left, one section at a time ----

// open one section (and highlight its menu item)
function showSettingsPane(id) {
  $("#settingsModal .settings-nav-item").removeClass("active").filter(`[data-pane="${id}"]`).addClass("active");
  $("#settingsModal .settings-pane").removeClass("active");
  $("#" + id).addClass("active");
  $("#settingsModal .settings-content").scrollTop(0);
}

// a network terminal only has its server / till form; the other modes have
// the store's settings and the data tools
function setSettingsMode(terminal) {
  $("#net_settings_form").toggle(!!terminal);
  $("#settingsModal .settings-nav-menu, #settingsModal .settings-panes").toggle(!terminal);
  $("#save_net_settings").toggle(!!terminal);
  $("#save_settings").toggle(!terminal);
  if (!terminal) {
    if (!$("#settingsModal .settings-pane.active").length) showSettingsPane("setPaneStore");
    updateSettingsPreview();
  }
}

// the Receipt & Logo section's preview: the receipt's header and footer as
// they'll print, from what's typed
let settingsPreviewLogo = "";
function updateSettingsPreview() {
  let esc = (v) => $("<div>").text(v == null ? "" : String(v)).html();
  let val = (id) => $.trim($("#" + id).val() || "");
  let logo = settingsPreviewLogo || ($("#current_logo").is(":visible") ? $("#current_logo img").attr("src") || "" : "");
  $("#setPreviewLogo").html(logo ? `<img src="${esc(logo)}" alt="">` : "");
  $("#setPreviewStore").text(val("store") || "Store Name");
  let lines = [val("address_one"), val("address_two")].filter(Boolean).map(esc);
  if (val("contact")) lines.push("Tel: " + esc(val("contact")));
  if (val("tax")) lines.push("Vat No: " + esc(val("tax")));
  $("#setPreviewLines").html(lines.join("<br>"));
  $("#setPreviewAmount").text((val("symbol") || "") + "150.00");
  $("#setPreviewFooter").html(esc(val("footer") || "Your receipt footer").replace(/\n/g, "<br>"));
}

$(document).on("click", "#settingsModal .settings-nav-item", function () {
  showSettingsPane($(this).data("pane"));
});
$(document).on("input change", "#settings_form input, #settings_form textarea", updateSettingsPreview);
// a new logo picked: preview it before saving
$(document).on("change", "#logoname", function () {
  let file = this.files && this.files[0];
  if (settingsPreviewLogo) URL.revokeObjectURL(settingsPreviewLogo);
  settingsPreviewLogo = file ? URL.createObjectURL(file) : "";
  updateSettingsPreview();
});
// every time it opens: the first section, the right mode, a fresh preview
$(document).on("show.bs.modal", "#settingsModal", function (e) {
  if (e.target !== this) return;
  showSettingsPane("setPaneStore");
  setSettingsMode($("#app option:selected").text() == "Network Point of Sale Terminal");
});

  $("#rmv_logo").click(function () {
    $("#remove_logo").val("1");
    $("#current_logo").hide(500);
    $(this).hide(500);
    $("#logoname").show(500);
    setTimeout(updateSettingsPreview, 520);
  });

  $("#rmv_img").click(function () {
    $("#remove_img").val("1");
    $("#current_img").hide(500);
    $(this).hide(500);
    $("#imagename").show(500);
  });
}

$.fn.print = function () {
  printJS({ printable: receipt, type: "raw-html" });
};

// ---- Profit (Transactions page) ----
// Works on the transactions currently loaded (so it follows the Till /
// Cashier / Status / Date filters):
//  - net sales: item price x qty, less the order discount (spread over the
//    order's items in proportion to their value), less refunds; tax excluded
//  - cost: the cost price saved with each sale; sales made before cost prices
//    were recorded use the product's current cost (flagged as estimated)
//  - refunds always reduce sales; they reduce cost only when the item was
//    restocked (an item that isn't restocked is still a loss)
//  - items with no cost price at all are left out of profit and margin
let profitRequestId = 0;

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  let n = parseFloat(value);
  return isNaN(n) ? null : n;
}

function computeProfit(transactions, returns, products) {
  let byProduct = {};
  let orders = {};
  let currentCost = {};
  (products || []).forEach((p) => (currentCost[p._id] = numberOrNull(p.cost_price)));

  function entry(id, name) {
    if (!byProduct[id]) {
      byProduct[id] = {
        id: id, name: name || "Unknown product",
        qty: 0, returned: 0,
        sales: 0, costedSales: 0, cost: 0, salesNoCost: 0,
        estimated: false, costKnown: false,
      };
    }
    return byProduct[id];
  }

  // unit cost for a sold/returned line: saved cost, else the product's current cost
  function unitCostFor(line, fallbackLine) {
    let saved = numberOrNull(line.cost_price);
    if (saved === null && fallbackLine) saved = numberOrNull(fallbackLine.cost_price);
    if (saved !== null) return { cost: saved, estimated: false };
    let current = currentCost[line.id];
    return current === undefined || current === null
      ? { cost: null, estimated: false }
      : { cost: current, estimated: true };
  }

  (transactions || []).forEach((t) => {
    let items = t.items || [];
    let gross = items.reduce((s, i) => s + (parseFloat(i.price) || 0) * (parseInt(i.quantity) || 0), 0);
    let net = parseFloat(t.subtotal);
    let ratio = gross > 0 && !isNaN(net) ? net / gross : 1;
    orders[String(t._id)] = { ratio: ratio, items: items };

    items.forEach((i) => {
      let qty = parseInt(i.quantity) || 0;
      let lineSales = (parseFloat(i.price) || 0) * qty * ratio;
      let e = entry(i.id, i.product_name);
      let c = unitCostFor(i);
      e.qty += qty;
      e.sales += lineSales;
      if (c.cost === null) {
        e.salesNoCost += lineSales;
      } else {
        e.costKnown = true;
        e.costedSales += lineSales;
        e.cost += c.cost * qty;
        if (c.estimated) e.estimated = true;
      }
    });
  });

  (returns || []).forEach((r) => {
    let order = orders[String(r.order_id)];
    if (!order) return; // the sale itself isn't in the current view
    (r.items || []).forEach((i) => {
      let qty = parseInt(i.quantity) || 0;
      let refund = (parseFloat(i.price) || 0) * qty; // what was paid back
      // the sale line it came from (a product can be on several lines, one per batch price)
      let byLine = i.line != null ? order.items[parseInt(i.line)] : null;
      let original = byLine && byLine.id == i.id ? byLine : order.items.find((o) => o.id == i.id);
      let e = entry(i.id, i.product_name);
      let c = unitCostFor(i, original);
      e.returned += qty;
      e.sales -= refund;
      if (c.cost === null) {
        e.salesNoCost -= refund;
      } else {
        e.costKnown = true;
        e.costedSales -= refund;
        if (r.restocked) e.cost -= c.cost * qty;
        if (c.estimated) e.estimated = true;
      }
    });
  });

  let rows = Object.values(byProduct).map((e) => {
    let hasCost = e.costKnown;
    let profit = hasCost ? e.costedSales - e.cost : null;
    return Object.assign(e, {
      hasCost: hasCost,
      missingCost: Math.abs(e.salesNoCost) > 0.0001,
      profit: profit,
      margin: hasCost && e.costedSales > 0 ? (profit / e.costedSales) * 100 : null,
    });
  });

  let totals = rows.reduce(
    (t, e) => {
      t.netSales += e.sales;
      t.costedSales += e.costedSales;
      t.cost += e.cost;
      t.salesNoCost += e.salesNoCost;
      return t;
    },
    { netSales: 0, costedSales: 0, cost: 0, salesNoCost: 0 }
  );
  totals.profit = totals.costedSales - totals.cost;
  totals.margin = totals.costedSales > 0 ? (totals.profit / totals.costedSales) * 100 : null;
  totals.missingCostProducts = rows.filter((e) => e.missingCost).map((e) => e.name);
  totals.estimatedProducts = rows.filter((e) => e.estimated).map((e) => e.name);
  return { rows: rows, totals: totals };
}

function renderProfit(result) {
  let sym = settings?.symbol || "";
  let money = (n) => (n < 0 ? "-" : "") + sym + Math.abs(n).toFixed(2);
  let t = result.totals;

  $("#profitPeriod").text(
    ($("#profitDateRange .date-range-label").text() || "All dates") +
      " · " +
      ($("#status option:selected").text() || "All") +
      (by_method ? " · " + $("#paymentMethodFilter option:selected").text() : "")
  );
  $("#profitNetSales").text(money(t.netSales));
  $("#profitCost").text(money(t.cost));
  $("#profitGross")
    .text(money(t.profit))
    .toggleClass("profit-negative", t.profit < 0);
  $("#profitMargin").text(t.margin === null ? "—" : t.margin.toFixed(1) + "%");
  // margin only counts sales that have a cost price
  $("#profitMarginNote").text(
    t.missingCostProducts.length
      ? "gross profit ÷ sales with a cost price (" + money(t.costedSales) + ")"
      : "gross profit ÷ net sales"
  );
  $("#profitGrossNote").text(t.profit < 0 ? "loss: cost is higher than sales" : "net sales − cost of goods");

  let notices = "";
  if (t.missingCostProducts.length) {
    notices += `<div class="alert alert-warning profit-notice"><i class="fa fa-exclamation-triangle"></i>
      <b>${t.missingCostProducts.length} product${t.missingCostProducts.length > 1 ? "s have" : " has"} no cost price</b>
      (${money(t.salesNoCost)} of sales), so ${t.missingCostProducts.length > 1 ? "they are" : "it is"} not included in profit or margin:
      ${t.missingCostProducts.map((n) => $("<i>").text(n).html()).join(", ")}.
      Add a cost price in <b>Products</b> to include ${t.missingCostProducts.length > 1 ? "them" : "it"}.</div>`;
  }
  $("#profitNotices").html(notices);

  let rows = "";
  result.rows.forEach((e) => {
    let profitCell = e.profit === null
      ? '<span class="text-muted" title="No cost price">&mdash;</span>'
      : `<span class="${e.profit < 0 ? "text-danger" : "text-success"}"><b>${money(e.profit)}</b></span>`;
    let flags =
      (e.missingCost && e.hasCost ? ' <span class="label label-warning" title="Some of these sales have no cost price">part no cost</span>' : "") +
      (e.estimated ? ' <span class="label label-info" title="Uses the current cost price for older sales">est.</span>' : "");
    rows += `<tr>
        <td>${$("<i>").text(e.name).html()}${flags}</td>
        <td class="text-right" data-order="${e.qty}">${e.qty}</td>
        <td class="text-right" data-order="${e.returned}">${e.returned || ""}</td>
        <td class="text-right nobr" data-order="${e.sales}">${money(e.sales)}</td>
        <td class="text-right nobr" data-order="${e.hasCost ? e.cost : -1e15}">${e.hasCost ? money(e.cost) : '<span class="text-muted">&mdash;</span>'}</td>
        <td class="text-right nobr" data-order="${e.profit === null ? -1e15 : e.profit}">${profitCell}</td>
        <td class="text-right nobr" data-order="${e.margin === null ? -1e15 : e.margin}">${e.margin === null ? '<span class="text-muted">&mdash;</span>' : e.margin.toFixed(1) + "%"}</td>
      </tr>`;
  });

  if ($.fn.DataTable.isDataTable("#profitTable")) {
    $("#profitTable").DataTable().destroy();
  }
  $("#profit_list").html(rows);
  $("#profitTable").DataTable(
    Object.assign(
      standardTableOptions({
        noun: "products",
        searchPlaceholder: "Search products...",
        exportTitle: "Profit",
        exportSubtitle: () => $("#profitPeriod").text(),
        sumColumns: [1, 2, 3, 4, 5], // Qty, Returned, Net Sales, Cost, Profit
        emptyTable: "No sales in the selected period",
      }),
      { order: [[5, "desc"]] }
    )
  );
}

// Profit has its own date range (set up with the Transactions date filter
// below); Till / Cashier / Status are shared with the Transactions page.
let profitDateFilter = null;

// The Profit section is only for users with the "View Profit" permission
// (the Administrator always has it). Users saved before this permission
// existed have no perm_profit value, so they don't see profit until it is
// granted in Users.
function canViewProfit() {
  return !!(user && (user._id === 1 || user.perm_profit == 1));
}

function applyProfitPermission() {
  $("#profitSection").toggle(canViewProfit());
}

// fetches the sales for the Profit date range + page filters, then shows profit
function refreshProfit() {
  if (!canViewProfit()) {
    $("#profitSection").hide();
    return;
  }
  let requestId = ++profitRequestId;
  let range = profitDateFilter ? profitDateFilter.getRange() : null;
  let start = range ? range.start.toDate().toJSON() : "";
  let end = range ? range.end.toDate().toJSON() : "";
  $.get(api + transactionFilterQuery(start, end))
    .done((transactions) => {
      if (requestId !== profitRequestId) return; // a newer filter change won
      loadProfit(transactions || [], requestId);
    })
    .fail(() => {
      if (requestId === profitRequestId) loadProfit([], requestId);
    });
}

// loads the refunds for the given transactions, then calculates and shows profit
function loadProfit(transactions, requestId) {
  requestId = requestId || ++profitRequestId;
  let ids = (transactions || []).map((t) => t._id);
  let done = (returns) => {
    if (requestId !== profitRequestId) return; // a newer filter change won
    renderProfit(computeProfit(transactions, returns, allProducts));
  };
  if (!ids.length) return done([]);
  $.ajax({
    url: api + "returns/for-orders",
    type: "POST",
    data: JSON.stringify({ ids: ids }),
    contentType: "application/json; charset=utf-8",
  })
    .done((returns) => done(returns || []))
    .fail(() => done([]));
}

// ---- Expenses page ----
// Expense types (Rent, Electricity, ...) are created on the Expense Types
// tab; every expense belongs to one type and has a date, amount, payment
// method (Cash / Card / Bank Transfer) and an optional description.
// Needs the "Manage Expenses" permission (the Administrator always has it;
// users saved before this permission existed don't, until it is granted).
let allExpenses = [];
let allExpenseTypes = [];
let expensesDateFilter = null;

function canManageExpenses() {
  return !!(user && (user._id === 1 || user.perm_expenses == 1));
}

function applyExpensesPermission() {
  let allowed = canManageExpenses();
  $("#expensesNav").toggle(allowed);
  // permission taken away while the page is open: back to the till
  if (!allowed && $("#expenses_view").is(":visible")) {
    $("#pointofsale").trigger("click");
  }
}

function expenseMoney(n) {
  let sym = settings?.symbol || "";
  return (n < 0 ? "-" : "") + sym + Math.abs(Number(n) || 0).toFixed(2);
}

function expenseTypeName(id) {
  let type = allExpenseTypes.find((t) => t._id == id);
  return type ? type.name : "Unknown type";
}

function expenseDateText(date) {
  let d = moment(date, "YYYY-MM-DD", true);
  return d.isValid() ? d.format("DD MMM YYYY") : String(date || "");
}

// the server's message for a refused request, or the fallback text
function expenseErrorText(xhr, fallback) {
  return xhr && xhr.status >= 400 && xhr.status < 500 && xhr.responseText
    ? xhr.responseText
    : fallback;
}

// loads the types first (the expense list shows their names), then the expenses
function loadExpensesPage() {
  loadExpenseTypes(loadExpenses);
}

function loadExpenseTypes(done) {
  $.get(api + "expenses/types")
    .done(function (types) {
      allExpenseTypes = types || [];
      renderExpenseTypes();
      fillExpenseTypeSelects();
    })
    .fail(function () {
      Swal.fire("Oops!", "Could not load the expense types.", "warning");
    })
    .always(function () {
      if (typeof done === "function") done();
    });
}

function loadExpenses() {
  $.get(api + "expenses/all")
    .done(function (expenses) {
      allExpenses = expenses || [];
      renderExpenses();
    })
    .fail(function () {
      allExpenses = [];
      renderExpenses();
      Swal.fire("Oops!", "Could not load the expenses.", "warning");
    });
}

// expense type drop-downs: the filter (keeps its choice) and the expense form
function fillExpenseTypeSelects() {
  let options = allExpenseTypes
    .map((t) => `<option value="${t._id}">${txnHtml(t.name)}</option>`)
    .join("");

  let $filter = $("#expenseTypeFilter");
  let chosen = $filter.val();
  $filter.html(`<option value="">All</option>` + options);
  if (chosen && allExpenseTypes.some((t) => String(t._id) === chosen)) $filter.val(chosen);

  let $form = $("#expenseType");
  let formChoice = $form.val();
  $form.html(
    `<option value="">${allExpenseTypes.length ? "Select an expense type" : "No expense types yet - add one"}</option>` +
      options
  );
  if (formChoice && allExpenseTypes.some((t) => String(t._id) === formChoice)) $form.val(formChoice);
}

function filteredExpenses() {
  let type = $("#expenseTypeFilter").val();
  let method = $("#expenseMethodFilter").val();
  return allExpenses.filter(
    (e) =>
      (!expensesDateFilter || expensesDateFilter.matches(e.date)) &&
      (!type || String(e.type_id) === type) &&
      (!method || e.payment_method === method)
  );
}

// what the Excel / PDF export says the list contains
function expensesExportSubtitle() {
  let parts = [$("#expensesDateRange .date-range-label").text() || "All dates"];
  if ($("#expenseTypeFilter").val()) parts.push($("#expenseTypeFilter option:selected").text());
  if ($("#expenseMethodFilter").val()) parts.push($("#expenseMethodFilter").val());
  return parts.join("  ·  ");
}

function renderExpenses() {
  let list = filteredExpenses();

  let totals = { all: 0, Cash: 0, Card: 0, "Bank Transfer": 0 };
  list.forEach((e) => {
    let amount = Number(e.amount) || 0;
    totals.all += amount;
    if (e.payment_method in totals) totals[e.payment_method] += amount;
  });
  $("#expensesTotal").text(expenseMoney(totals.all));
  $("#expensesTotalNote").text(list.length + (list.length === 1 ? " expense" : " expenses"));
  $("#expensesCash").text(expenseMoney(totals.Cash));
  $("#expensesCard").text(expenseMoney(totals.Card));
  $("#expensesBank").text(expenseMoney(totals["Bank Transfer"]));
  $("#expensesTabCount").text(list.length);

  let rows = list
    .map(
      (e) => `<tr>
        <td class="nobr" data-order="${txnHtml(e.date)}">${expenseDateText(e.date)}</td>
        <td>${txnHtml(expenseTypeName(e.type_id))}</td>
        <td class="nobr">${txnHtml(e.payment_method)}</td>
        <td class="expense-description" data-export="${txnHtml(e.description || "")}">${
          e.description ? txnHtml(e.description) : '<span class="text-muted">-</span>'
        }</td>
        <td class="text-right nobr" data-order="${Number(e.amount) || 0}">${expenseMoney(e.amount)}</td>
        <td>${txnHtml(e.created_by || "")}</td>
        <td class="nobr"><span class="btn-group">
          <button onClick="$(this).editExpense(${e._id})" class="btn btn-warning" title="Edit"><i class="fa fa-edit"></i></button>
          <button onClick="$(this).deleteExpense(${e._id})" class="btn btn-danger" title="Delete"><i class="fa fa-trash"></i></button>
        </span></td>
      </tr>`
    )
    .join("");

  if ($.fn.DataTable.isDataTable("#expenseList")) {
    $("#expenseList").DataTable().destroy();
  }
  $("#expense_list").html(rows);
  $("#expenseList").DataTable(
    Object.assign(
      standardTableOptions({
        noun: "expenses",
        searchPlaceholder: "Search expenses...",
        exportTitle: "Expenses",
        exportColumns: [0, 1, 2, 3, 4, 5],
        sumColumns: [4], // Amount
        exportSubtitle: expensesExportSubtitle,
        actionColumns: [6],
        emptyTable: allExpenses.length ? "No expenses match the filters" : "No expenses yet - click Add Expense",
      }),
      { order: [[0, "desc"]] }
    )
  );
}

function renderExpenseTypes() {
  $("#expenseTypesTabCount").text(allExpenseTypes.length);

  let rows = allExpenseTypes
    .map(
      (t) => `<tr>
        <td>${txnHtml(t.name)}</td>
        <td data-order="${t.expense_count || 0}">${t.expense_count || 0}</td>
        <td class="nobr"><span class="btn-group">
          <button onClick="$(this).editExpenseType(${t._id})" class="btn btn-warning" title="Rename"><i class="fa fa-edit"></i></button>
          <button onClick="$(this).deleteExpenseType(${t._id})" class="btn btn-danger" title="Delete"><i class="fa fa-trash"></i></button>
        </span></td>
      </tr>`
    )
    .join("");

  if ($.fn.DataTable.isDataTable("#expenseTypeList")) {
    $("#expenseTypeList").DataTable().destroy();
  }
  $("#expense_type_list").html(rows);
  $("#expenseTypeList").DataTable(
    standardTableOptions({
      noun: "expense types",
      searchPlaceholder: "Search expense types...",
      exportTitle: "Expense Types",
      exportColumns: [0, 1],
      actionColumns: [2],
      emptyTable: "No expense types yet - click Add Expense Type",
    })
  );
}

// ---- add / edit an expense ----
function openExpenseForm(expense) {
  $("#saveExpense").get(0).reset();
  hideExpenseNewTypeRow();
  fillExpenseTypeSelects();

  $("#expense_id").val(expense ? expense._id : "");
  $("#expenseModalTitle").text(expense ? "Edit Expense" : "Add Expense");
  $(".expense-currency").text(settings?.symbol ? "(" + settings.symbol + ")" : "");

  $("#expenseDate").val(expense ? expense.date : moment().format("YYYY-MM-DD"));
  $("#expenseAmount").val(expense ? (Number(expense.amount) || 0).toFixed(2) : "");
  $("#expenseType").val(
    expense
      ? String(expense.type_id)
      : allExpenseTypes.length === 1
      ? String(allExpenseTypes[0]._id)
      : ""
  );
  $("#expensePaymentMethod").val(expense ? expense.payment_method : "Cash");
  $("#expenseDescription").val(expense ? expense.description || "" : "");

  $("#expenseModal").modal("show");
  // nothing to choose from yet: start by creating the first type
  if (!allExpenseTypes.length) showExpenseNewTypeRow();
}

function showExpenseNewTypeRow() {
  $(".expense-newtype-row").show();
  $("#expenseNewTypeName").val("");
  setTimeout(() => $("#expenseNewTypeName").trigger("focus"), 300);
}

function hideExpenseNewTypeRow() {
  $(".expense-newtype-row").hide();
  $("#expenseNewTypeName").val("");
}

// ---- add / rename an expense type ----
function openExpenseTypeForm(type) {
  $("#saveExpenseType").get(0).reset();
  $("#expense_type_id").val(type ? type._id : "");
  $("#expenseTypeName").val(type ? type.name : "");
  $("#expenseTypeModalTitle").text(type ? "Rename Expense Type" : "Add Expense Type");
  $("#expenseTypeModal").modal("show");
}

function saveExpenseType(id, name) {
  return $.ajax({
    url: api + "expenses/types" + (id ? "/" + id : ""),
    type: id ? "PUT" : "POST",
    contentType: "application/json",
    data: JSON.stringify({ name: name }),
  });
}

$(function () {
  expensesDateFilter = initDateRangeFilter("#expensesDateRange", renderExpenses);
  $("#expenseTypeFilter, #expenseMethodFilter").on("change", renderExpenses);

  $("#addExpenseBtn").on("click", function () {
    openExpenseForm(null);
  });
  $("#addExpenseTypeBtn").on("click", function () {
    openExpenseTypeForm(null);
  });

  $("#expenseModal").on("shown.bs.modal", function () {
    if (!$(".expense-newtype-row").is(":visible")) $("#expenseAmount").trigger("focus");
  });
  $("#expenseTypeModal").on("shown.bs.modal", function () {
    $("#expenseTypeName").trigger("focus");
  });

  // the types table is measured while its tab is hidden
  $('#expenses_view .expenses-tabs a[href="#expensesTabTypes"]').on("shown.bs.tab", function () {
    if ($.fn.DataTable.isDataTable("#expenseTypeList")) {
      $("#expenseTypeList").DataTable().columns.adjust();
    }
  });

  $("#saveExpense").on("submit", function (e) {
    e.preventDefault();
    let id = $("#expense_id").val();
    let amount = parseFloat($("#expenseAmount").val());

    if (!$("#expenseDate").val()) {
      Swal.fire("Oops!", "Please enter the date of the expense.", "warning");
      return;
    }
    if (!(amount > 0)) {
      Swal.fire("Oops!", "Please enter an amount greater than zero.", "warning");
      return;
    }
    if (!$("#expenseType").val()) {
      Swal.fire("Oops!", "Please choose an expense type, or add one with New Type.", "warning");
      return;
    }

    let payload = {
      date: $("#expenseDate").val(),
      amount: amount,
      type_id: parseInt($("#expenseType").val()),
      payment_method: $("#expensePaymentMethod").val(),
      description: $.trim($("#expenseDescription").val()),
    };
    if (id) payload.updated_by = user?.fullname || "";
    else payload.created_by = user?.fullname || "";

    let $submit = $("#submitExpense").prop("disabled", true);
    $.ajax({
      url: api + "expenses/" + (id || ""),
      type: id ? "PUT" : "POST",
      contentType: "application/json",
      data: JSON.stringify(payload),
    })
      .done(function () {
        $("#expenseModal").modal("hide");
        loadExpensesPage(); // type usage counts change too
        Swal.fire({
          title: id ? "Expense Updated" : "Expense Saved",
          icon: "success",
          timer: 1400,
          showConfirmButton: false,
        });
      })
      .fail(function (xhr) {
        Swal.fire("Oops!", expenseErrorText(xhr, "Could not save the expense."), "warning");
      })
      .always(function () {
        $submit.prop("disabled", false);
      });
  });

  // quick add of an expense type from inside the expense form
  $("#expenseNewTypeBtn").on("click", showExpenseNewTypeRow);
  $("#expenseNewTypeCancel").on("click", hideExpenseNewTypeRow);
  $("#expenseNewTypeName").on("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault(); // don't submit the expense form
      $("#expenseNewTypeSave").trigger("click");
    }
  });
  $("#expenseNewTypeSave").on("click", function () {
    let name = $.trim($("#expenseNewTypeName").val());
    if (!name) {
      $("#expenseNewTypeName").trigger("focus");
      return;
    }
    let $btn = $(this).prop("disabled", true);
    saveExpenseType(null, name)
      .done(function (type) {
        hideExpenseNewTypeRow();
        loadExpenseTypes(function () {
          if (type && type._id) $("#expenseType").val(String(type._id));
        });
      })
      .fail(function (xhr) {
        Swal.fire("Oops!", expenseErrorText(xhr, "Could not save the expense type."), "warning");
      })
      .always(function () {
        $btn.prop("disabled", false);
      });
  });

  $("#saveExpenseType").on("submit", function (e) {
    e.preventDefault();
    let id = $("#expense_type_id").val();
    let name = $.trim($("#expenseTypeName").val());
    if (!name) {
      Swal.fire("Oops!", "Please enter a name for the expense type.", "warning");
      return;
    }
    saveExpenseType(id, name)
      .done(function () {
        $("#expenseTypeModal").modal("hide");
        // a renamed type shows its new name in the expense list too
        loadExpenseTypes(renderExpenses);
      })
      .fail(function (xhr) {
        Swal.fire("Oops!", expenseErrorText(xhr, "Could not save the expense type."), "warning");
      });
  });
});

$.fn.editExpense = function (id) {
  let expense = allExpenses.find((e) => e._id === id);
  if (expense) openExpenseForm(expense);
};

$.fn.deleteExpense = function (id) {
  let expense = allExpenses.find((e) => e._id === id);
  if (!expense) return;
  Swal.fire({
    title: "Delete this expense?",
    html:
      `<b>${txnHtml(expenseTypeName(expense.type_id))}</b> - ${expenseMoney(expense.amount)}` +
      `<br><small>${expenseDateText(expense.date)} · ${txnHtml(expense.payment_method)}</small>`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#d33",
    confirmButtonText: "Yes, delete it",
  }).then(function (result) {
    if (!result.value) return;
    $.ajax({ url: api + "expenses/" + id, type: "DELETE" })
      .done(function () {
        loadExpensesPage();
        Swal.fire({ title: "Expense Deleted", icon: "success", timer: 1400, showConfirmButton: false });
      })
      .fail(function (xhr) {
        Swal.fire("Oops!", expenseErrorText(xhr, "Could not delete the expense."), "warning");
      });
  });
};

$.fn.editExpenseType = function (id) {
  let type = allExpenseTypes.find((t) => t._id === id);
  if (type) openExpenseTypeForm(type);
};

$.fn.deleteExpenseType = function (id) {
  let type = allExpenseTypes.find((t) => t._id === id);
  if (!type) return;
  if (type.expense_count > 0) {
    Swal.fire(
      "Can't delete this type",
      `"${type.name}" is used by ${type.expense_count} ${type.expense_count === 1 ? "expense" : "expenses"}. ` +
        "Change or delete those expenses first.",
      "info"
    );
    return;
  }
  Swal.fire({
    title: "Delete this expense type?",
    html: `<b>${txnHtml(type.name)}</b>`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#d33",
    confirmButtonText: "Yes, delete it",
  }).then(function (result) {
    if (!result.value) return;
    $.ajax({ url: api + "expenses/types/" + id, type: "DELETE" })
      .done(function () {
        loadExpenseTypes();
      })
      .fail(function (xhr) {
        Swal.fire("Oops!", expenseErrorText(xhr, "Could not delete the expense type."), "warning");
      });
  });
};

// ---- Suppliers & GRN ----
// Suppliers page: the supplier list (with what is owed to each) and the Good
// Receive Notes (GRN). A GRN records goods received from a supplier or a
// walk-in seller and adds the quantities to the products' stock (server:
// api/suppliers.js). Credit GRNs are settled with "Pay Supplier" in the
// supplier's transactions window; paying more than is owed leaves the rest
// as the supplier's advance, which the next GRNs use up first (server-side).
// Needs the "Manage Suppliers & GRN"
// permission (the Administrator always has it).
let allSuppliers = [];
let allGrns = [];
let grnCache = {}; // GRNs by id, for the GRN details window
let grnDateFilter = null;
let grnProducts = []; // products offered in the GRN form (loaded when it opens)
let grnLines = []; // lines of the GRN being entered
let supplierTxnData = null; // { supplier, grns, payments } of the open supplier window

function canManageSuppliers() {
  return !!(user && (user._id === 1 || user.perm_suppliers == 1));
}

function applySuppliersPermission() {
  let allowed = canManageSuppliers();
  $("#suppliersNav").toggle(allowed);
  // permission taken away while the page is open: back to the till
  if (!allowed && $("#suppliers_view").is(":visible")) {
    $("#pointofsale").trigger("click");
  }
}

// A stock warning in the bottom-right corner (low stock / out of stock) with
// a close (x) button. Notiflix stops hiding a notice by itself when it has a
// close button, so it is closed after `timeout` by pressing that button
// (Notiflix's own close animation and clean-up).
function stockToast(kind, message, timeout) {
  notiflix.Notify.init({
    position: "right-bottom",
    cssAnimationDuration: 600,
    messageMaxLength: 150,
    cssAnimationStyle: "from-bottom",
    closeButton: true,
  });
  notiflix.Notify[kind](message);
  // right-bottom: the newest notice is the first one
  let wrap = document.getElementById("NotiflixNotifyWrap");
  let notice = wrap && wrap.firstElementChild;
  if (!notice) return;
  setTimeout(function () {
    let close = notice.isConnected && notice.querySelector(".nx-close-button");
    if (close) close.click();
  }, timeout);
}

function supMoney(n) {
  let sym = settings?.symbol || "";
  n = Number(n) || 0;
  return (n < 0 ? "-" : "") + sym + Math.abs(n).toFixed(2);
}

function supDate(date) {
  let d = moment(date, "YYYY-MM-DD", true);
  return d.isValid() ? d.format("DD MMM YYYY") : String(date || "");
}

function supError(xhr, fallback) {
  return xhr && xhr.status >= 400 && xhr.status < 500 && xhr.responseText
    ? xhr.responseText
    : fallback;
}

function supRound(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Opens window "to" in place of window "from" when "from" is open (Bootstrap
// can't stack them); when "to" closes, "from" comes back after onReturn().
function supSwapModal(from, to, onReturn) {
  let $from = $(from);
  let $to = $(to);
  if (!$from.hasClass("in")) {
    $to.modal("show");
    return;
  }
  $to.one("hidden.bs.modal", function () {
    if (typeof onReturn === "function") onReturn();
    $from.modal("show");
  });
  $from.one("hidden.bs.modal", function () {
    $to.modal("show");
  });
  $from.modal("hide");
}

// The Suppliers page is fixed to the window: it gets the height left below
// the toolbar, and its tables scroll inside it (body.suppliers-mode in
// components.css). Run when the page opens and whenever the window resizes.
function fitSuppliersView() {
  let el = document.getElementById("suppliers_view");
  if (!el || !$(el).is(":visible")) return;
  let top = el.getBoundingClientRect().top;
  el.style.height = Math.max(window.innerHeight - top - 15, 320) + "px";
  ["#supplierList", "#grnList", "#prnList"].forEach((sel) => {
    if ($.fn.DataTable.isDataTable(sel)) $(sel).DataTable().columns.adjust();
  });
}

function loadSuppliersPage() {
  loadSuppliers();
  loadGrns();
  loadPrns();
}

function loadSuppliers(done) {
  $.get(api + "suppliers/all")
    .done(function (suppliers) {
      allSuppliers = suppliers || [];
      renderSuppliers();
      fillSupplierSelects();
    })
    .fail(function () {
      Swal.fire("Oops!", "Could not load the suppliers.", "warning");
    })
    .always(function () {
      if (typeof done === "function") done();
    });
}

function loadGrns() {
  $.get(api + "suppliers/grns")
    .done(function (grns) {
      allGrns = grns || [];
      allGrns.forEach((g) => (grnCache[g._id] = g));
      renderGrns();
    })
    .fail(function () {
      Swal.fire("Oops!", "Could not load the GRNs.", "warning");
    });
}

// supplier drop-downs: the GRN filter (keeps its choice) and the GRN form
function fillSupplierSelects() {
  let options = allSuppliers
    .map((s) => `<option value="${s._id}">${txnHtml(s.name)}</option>`)
    .join("");

  let $filter = $("#grnSupplierFilter");
  let chosen = $filter.val();
  $filter.html(`<option value="">All</option><option value="0">Walk-in sellers</option>` + options);
  if (chosen === "0" || allSuppliers.some((s) => String(s._id) === chosen)) $filter.val(chosen);

  let $form = $("#grnSupplier");
  let formChoice = $form.val();
  $form.html(`<option value="0">Walk-in seller (not registered)</option>` + options);
  if (formChoice && allSuppliers.some((s) => String(s._id) === formChoice)) $form.val(formChoice);

  // the PRN filter and form
  let $prnFilter = $("#prnSupplierFilter");
  let prnChosen = $prnFilter.val();
  $prnFilter.html(`<option value="">All</option><option value="0">Walk-in sellers</option>` + options);
  if (prnChosen === "0" || allSuppliers.some((s) => String(s._id) === prnChosen)) $prnFilter.val(prnChosen);
  let $prnForm = $("#prnSupplier");
  let prnFormChoice = $prnForm.val();
  $prnForm.html(`<option value="0">Walk-in seller (not registered)</option>` + options);
  if (prnFormChoice && allSuppliers.some((s) => String(s._id) === prnFormChoice)) $prnForm.val(prnFormChoice);
}

function renderSuppliers() {
  let purchases = 0, owed = 0, owedCount = 0, advance = 0, advanceCount = 0;
  allSuppliers.forEach((s) => {
    purchases += Number(s.purchases) || 0;
    if (s.balance > 0.004) {
      owed += s.balance;
      owedCount++;
    }
    if (s.advance > 0.004) {
      advance += s.advance;
      advanceCount++;
    }
  });
  $("#suppliersAdvance").text(supMoney(advance));
  $("#suppliersAdvanceNote").text(
    advanceCount
      ? "held by " + advanceCount + (advanceCount === 1 ? " supplier" : " suppliers") + ", used by the next GRNs"
      : "paid in advance, used by the next GRNs"
  );
  $("#suppliersCount").text(allSuppliers.length);
  $("#suppliersTabCount").text(allSuppliers.length);
  $("#suppliersPurchases").text(supMoney(purchases));
  $("#suppliersOwed").text(supMoney(owed)).toggleClass("sup-owed", owed > 0.004);
  $("#suppliersOwedNote").text(
    owedCount ? owedCount + (owedCount === 1 ? " supplier" : " suppliers") + " to pay" : "nothing owed"
  );

  let rows = allSuppliers
    .map((s) => {
      let contact = [s.contact_person, s.phone, s.email].filter(Boolean);
      let owedCell =
        s.balance > 0.004
          ? `<span class="text-danger"><b>${supMoney(s.balance)}</b></span>`
          : `<span class="text-muted">${supMoney(0)}</span>`;
      let advanceCell =
        s.advance > 0.004
          ? `<span class="text-success"><b>${supMoney(s.advance)}</b></span>`
          : `<span class="text-muted">${supMoney(0)}</span>`;
      return `<tr>
        <td><b>${txnHtml(s.name)}</b>${s.address ? `<br><small class="text-muted">${txnHtml(s.address)}</small>` : ""}</td>
        <td data-export="${txnHtml(contact.join(", "))}">${contact.map(txnHtml).join("<br>")}</td>
        <td class="text-right">${s.grn_count || 0}</td>
        <td class="text-right nobr" data-order="${Number(s.purchases) || 0}">${supMoney(s.purchases)}</td>
        <td class="text-right nobr" data-order="${Number(s.balance) || 0}">${owedCell}</td>
        <td class="text-right nobr" data-order="${Number(s.advance) || 0}">${advanceCell}</td>
        <td class="nobr"><span class="btn-group">
          <button onClick="$(this).viewSupplier(${s._id})" class="btn btn-info" title="Transactions"><i class="fa fa-list"></i></button>
          <button onClick="$(this).paySupplier(${s._id})" class="btn btn-success" title="${s.balance > 0.004 ? "Pay supplier" : "Pay in advance"}"><i class="fa fa-money"></i></button>
          <button onClick="$(this).editSupplier(${s._id})" class="btn btn-warning" title="Edit"><i class="fa fa-edit"></i></button>
          <button onClick="$(this).deleteSupplier(${s._id})" class="btn btn-danger" title="Delete"><i class="fa fa-trash"></i></button>
        </span></td>
      </tr>`;
    })
    .join("");

  if ($.fn.DataTable.isDataTable("#supplierList")) $("#supplierList").DataTable().destroy();
  $("#supplier_list").html(rows);
  $("#supplierList").DataTable(
    standardTableOptions({
      noun: "suppliers",
      searchPlaceholder: "Search suppliers...",
      exportTitle: "Suppliers",
      exportColumns: [0, 1, 2, 3, 4, 5],
      sumColumns: [3, 4, 5],
      actionColumns: [6],
      emptyTable: "No suppliers yet - click Add Supplier",
    })
  );
}

function filteredGrns() {
  let supplier = $("#grnSupplierFilter").val();
  let paidBy = $("#grnPaidByFilter").val();
  return allGrns.filter(
    (g) =>
      (!grnDateFilter || grnDateFilter.matches(g.received_date)) &&
      (supplier === "" || supplier == null || String(g.supplier_id || 0) === supplier) &&
      (!paidBy || g.payment_method === paidBy)
  );
}

function grnsExportSubtitle() {
  let parts = [$("#grnDateRange .date-range-label").text() || "All dates"];
  if ($("#grnSupplierFilter").val() !== "") parts.push($("#grnSupplierFilter option:selected").text());
  if ($("#grnPaidByFilter").val()) parts.push($("#grnPaidByFilter").val());
  return parts.join("  ·  ");
}

function grnPaidByLabel(method) {
  return method === "Credit"
    ? `<span class="label label-warning">Credit</span>`
    : method === "Advance"
    ? `<span class="label label-success">Advance</span>`
    : txnHtml(method);
}

// what is left to pay after the supplier's advance (GRNs saved before
// advances existed have no amount_due: all of the total)
function grnAmountDue(g) {
  return g.amount_due != null ? Number(g.amount_due) || 0 : Number(g.total) || 0;
}

// "Cash", or "Advance 100.00 + Credit 300.00" when an advance was used
function grnPaymentText(g) {
  let used = Number(g.advance_used) || 0;
  if (!(used > 0) || g.payment_method === "Advance") return g.payment_method;
  return "Advance " + supMoney(used) + " + " + g.payment_method + " " + supMoney(grnAmountDue(g));
}

function grnPaymentHtml(g) {
  let used = Number(g.advance_used) || 0;
  if (!(used > 0) || g.payment_method === "Advance") return grnPaidByLabel(g.payment_method);
  return `${grnPaidByLabel(g.payment_method)} <span class="nobr">${supMoney(grnAmountDue(g))}</span>
    <br><small class="text-success nobr">+ advance ${supMoney(used)}</small>`;
}

function renderGrns() {
  let list = filteredGrns();
  let total = 0, credit = 0, units = 0, advance = 0;
  list.forEach((g) => {
    total += Number(g.total) || 0;
    if (g.payment_method === "Credit") credit += grnAmountDue(g);
    advance += Number(g.advance_used) || 0;
    units += Number(g.total_quantity) || 0;
  });
  $("#grnsTotal").text(supMoney(total));
  $("#grnsTotalNote").text(list.length + (list.length === 1 ? " GRN" : " GRNs"));
  $("#grnsPaid").text(supMoney(total - credit));
  $("#grnsPaidNote").text(
    advance > 0.004 ? "incl. " + supMoney(advance) + " from supplier advances" : "cash, card & bank transfer"
  );
  $("#grnsCredit").text(supMoney(credit));
  $("#grnsUnits").text(units);
  $("#grnsTabCount").text(list.length);

  let rows = list
    .map(
      (g) => `<tr>
        <td class="nobr" data-order="${Number(g.seq) || 0}"><b>${txnHtml(g.grn_no)}</b></td>
        <td class="nobr" data-order="${txnHtml(g.received_date)}">${supDate(g.received_date)}</td>
        <td data-export="${txnHtml(g.supplier_name)}">${txnHtml(g.supplier_name)}${
          g.walk_in ? ' <span class="label label-default">Walk-in</span>' : ""
        }</td>
        <td class="text-right">${g.item_count || (g.items || []).length}</td>
        <td class="text-right">${g.total_quantity || 0}</td>
        <td class="text-right nobr" data-order="${Number(g.total) || 0}">${supMoney(g.total)}</td>
        <td data-export="${txnHtml(grnPaymentText(g))}">${grnPaymentHtml(g)}</td>
        <td>${txnHtml(g.created_by || "")}</td>
        <td class="nobr"><button onClick="$(this).viewGrn(${g._id})" class="btn btn-info btn-sm" title="View GRN"><i class="fa fa-search-plus"></i></button>
          <button onClick="$(this).grnBill(${g._id})" class="btn btn-default btn-sm" title="GRN bill"><i class="fa fa-print"></i></button></td>
      </tr>`
    )
    .join("");

  if ($.fn.DataTable.isDataTable("#grnList")) $("#grnList").DataTable().destroy();
  $("#grn_list").html(rows);
  $("#grnList").DataTable(
    Object.assign(
      standardTableOptions({
        noun: "GRNs",
        searchPlaceholder: "Search GRNs...",
        exportTitle: "Goods Received Notes",
        exportColumns: [0, 1, 2, 3, 4, 5, 6, 7],
        sumColumns: [4, 5],
        exportSubtitle: grnsExportSubtitle,
        actionColumns: [8],
        emptyTable: allGrns.length ? "No GRNs match the filters" : "No GRNs yet - click New GRN",
      }),
      { order: [[1, "desc"], [0, "desc"]] }
    )
  );
}

// ---- supplier form ----
function openSupplierForm(supplier) {
  $("#saveSupplier").get(0).reset();
  $("#supplier_id").val(supplier ? supplier._id : "");
  $("#supplierModalTitle").text(supplier ? "Edit Supplier" : "Add Supplier");
  if (supplier) {
    $("#supplierName").val(supplier.name || "");
    $("#supplierContact").val(supplier.contact_person || "");
    $("#supplierPhone").val(supplier.phone || "");
    $("#supplierEmail").val(supplier.email || "");
    $("#supplierAddress").val(supplier.address || "");
  }
  $("#supplierModal").modal("show");
}

// ---- GRN form ----
function grnProduct(id) {
  return grnProducts.find((p) => String(p._id) === String(id));
}

let grnSellTyped = false; // the add bar's selling price was typed (not suggested)

function openGrnForm(supplierId) {
  // fresh stock figures and cost prices for the product list
  $.get(api + "inventory/products")
    .done(function (products) {
      // by name, and products with the same name by cost price
      grnProducts = (products || [])
        .slice()
        .sort(
          (a, b) =>
            String(a.name || "").localeCompare(String(b.name || "")) ||
            (parseFloat(a.cost_price) || 0) - (parseFloat(b.cost_price) || 0)
        );
      if (!grnProducts.length) {
        Swal.fire("No products yet", "Add your products first, then receive stock for them with a GRN.", "info");
        return;
      }
      // fresh supplier advances too (an advance pays for the GRN first)
      loadSuppliers(function () {
        prepareGrnForm(supplierId);
        if ($("#supplierTransactionsModal").hasClass("in")) {
          supSwapModal("#supplierTransactionsModal", "#grnModal", refreshSupplierTransactions);
        } else {
          $("#grnModal").modal("show");
        }
      });
    })
    .fail(function () {
      Swal.fire("Oops!", "Could not load the products.", "warning");
    });
}

function prepareGrnForm(supplierId) {
  grnLines = [];
  $("#saveGrn").get(0).reset();
  fillSupplierSelects();
  $("#grnSupplier").val(String(supplierId || 0));
  $("#grnDate").val(moment().format("YYYY-MM-DD"));
  $(".grn-currency").text(settings?.symbol ? "(" + settings.symbol + ")" : "");
  $("#grnSellPrice").prop("disabled", false);
  $("#grnNewBarcode").val("");
  $(".grn-add-barcode").hide();
  $("#grnAddHint").html("");
  grnSellTyped = false;

  $("#grnProduct").html(
    `<option value=""></option>` +
      grnProducts
        .map((p) => {
          // name — cost · stock · barcode: products with the same name (one
          // per cost price) can be told apart at a glance
          let barcode = p.barcode != null && String(p.barcode) !== "NaN" ? String(p.barcode) : "";
          let cost = grnCostOf(p);
          let parts = [cost === null ? "no cost yet" : "cost " + supMoney(cost)];
          if (p.stock == 1) parts.push("stock " + (parseInt(p.quantity) || 0));
          if (barcode) parts.push(barcode);
          return `<option value="${p._id}">${txnHtml(p.name)} — ${txnHtml(parts.join(" · "))}</option>`;
        })
        .join("")
  );
  if ($("#grnProduct").data("chosen")) $("#grnProduct").trigger("chosen:updated");

  updateGrnSupplierUi();
  renderGrnLines();
}

// walk-in seller: show the name box, and no credit
function updateGrnSupplierUi() {
  let walkIn = $("#grnSupplier").val() === "0";
  $(".grn-walkin-group").toggle(walkIn);
  $('#grnPaidBy option[value="Credit"]').prop("disabled", walkIn);
  if (walkIn && $("#grnPaidBy").val() === "Credit") $("#grnPaidBy").val("Cash");
  $(".grn-credit-hint").toggle(walkIn);
  updateGrnAdvanceInfo();
}

function grnFormTotal() {
  return supRound(
    grnLines.reduce((s, l) => s + (grnLineValid(l) ? Number(l.quantity) * Number(l.unit_cost) : 0), 0)
  );
}

// the chosen supplier's advance pays for the GRN first (the server does the
// same when saving; this shows the split while entering it)
function grnAdvanceSplit() {
  let supplier = allSuppliers.find((s) => String(s._id) === $("#grnSupplier").val());
  let advance = supplier ? Number(supplier.advance) || 0 : 0;
  let total = grnFormTotal();
  let used = supRound(Math.min(advance, total));
  return { advance: advance, total: total, used: used, due: supRound(total - used) };
}

function updateGrnAdvanceInfo() {
  let a = grnAdvanceSplit();
  let covered = a.advance > 0.004 && a.total > 0 && a.due <= 0;
  $("#grnPaidBy").prop("disabled", covered);
  if (!(a.advance > 0.004)) {
    $(".grn-advance-info").hide();
    return;
  }
  let text = `<i class="fa fa-info-circle"></i> This supplier holds an advance of <b>${supMoney(a.advance)}</b>. `;
  if (!(a.total > 0)) {
    text += "It will be used for this GRN first.";
  } else if (covered) {
    text += `It pays for this whole GRN (<b>${supMoney(a.used)}</b>), so there is nothing else to pay` +
      (a.advance - a.used > 0.004 ? `; <b>${supMoney(a.advance - a.used)}</b> stays as advance.` : ".");
  } else {
    text += `<b>${supMoney(a.used)}</b> of it is used for this GRN; the remaining <b>${supMoney(a.due)}</b> is paid by the method below.`;
  }
  $(".grn-advance-info").html(text).show();
}

function grnLineValid(line) {
  let target = grnLineTarget(line.product_id, line.unit_cost);
  return (
    Number.isInteger(Number(line.quantity)) &&
    Number(line.quantity) >= 1 &&
    Number(line.unit_cost) >= 0 &&
    line.unit_cost !== "" &&
    (target.kind !== "new" || (line.selling_price !== "" && Number(line.selling_price) >= 0))
  );
}

// ---- one product per cost price (the server decides the same way:
// api/suppliers.js resolveGrnProducts) ----
// Goods go to the product with the same name and category whose cost price
// is the unit cost; when there is none, a new product is created for them
// with its own selling price and barcode. A product without a cost price yet
// simply takes the goods.
function grnCostOf(p) {
  let c = parseFloat(p && p.cost_price);
  return isNaN(c) ? null : supRound(c);
}

function grnFamily(p) {
  let key = (x) => String(x.name || "").trim().toLowerCase() + "||" + String(x.category ?? "");
  return grnProducts.filter((x) => key(x) === key(p));
}

// { kind: "existing", product, setsCost } | { kind: "new", product (the one
// chosen) } | { kind: "unknown" } (no product / cost yet)
function grnLineTarget(productId, cost) {
  let p = grnProduct(productId);
  if (!p || cost === "" || cost == null || isNaN(Number(cost))) return { kind: "unknown", product: p };
  let c = supRound(cost);
  let same = [p].concat(grnFamily(p).filter((x) => x !== p)).find((x) => grnCostOf(x) === c);
  if (same) return { kind: "existing", product: same };
  if (grnCostOf(p) === null) return { kind: "existing", product: p, setsCost: true };
  return { kind: "new", product: p };
}

// a selling price for goods at a new cost that keeps the product's margin
function grnSuggestedPrice(costNow, priceNow, cost) {
  let c = parseFloat(costNow), p = parseFloat(priceNow);
  if (isNaN(p)) return "";
  if (isNaN(c) || supRound(c) === supRound(cost) || !(c > 0)) return supRound(p);
  return supRound((Number(cost) * p) / c);
}

// A new product needs a selling price none of the products with its name
// has. Returns the message, or "" when the line is fine.
function grnNewPriceProblem(l) {
  let t = grnLineTarget(l.product_id, l.unit_cost);
  if (t.kind !== "new") return "";
  let p = t.product;
  let suggested = grnSuggestedPrice(p.cost_price, p.price, l.unit_cost);
  let margin = suggested !== "" ? " Same margin: " + supMoney(suggested) + "." : "";
  let intro = `No "${p.name}" has the cost price ${supMoney(l.unit_cost)} yet, so a new product is created for these goods`;
  if (l.selling_price === "" || l.selling_price == null || isNaN(Number(l.selling_price))) {
    return intro + " and it needs its own selling price." + margin;
  }
  let taken = grnFamily(p).find((x) => supRound(x.price) === supRound(l.selling_price));
  if (taken) {
    return `${intro}, which needs a selling price of its own: ${supMoney(l.selling_price)} is already the price of "${taken.name}"${
      taken.barcode ? " (" + taken.barcode + ")" : ""
    }.${margin}`;
  }
  return "";
}

// A barcode typed / scanned for a new product must be free: not a product's
// barcode, and not the barcode of another new product in this GRN. Returns
// the message, or "" (an empty barcode is fine: one is made).
function grnNewBarcodeProblem(code, line) {
  code = String(code || "").trim();
  if (!code) return "";
  if (/\s/.test(code)) return `The barcode "${code}" contains spaces.`;
  let owner = grnProducts.find((x) => x.barcode != null && String(x.barcode) === code);
  if (owner) return `The barcode ${code} already belongs to "${owner.name}". Scan or type another one, or leave it empty to create one.`;
  let t = line ? grnLineTarget(line.product_id, line.unit_cost) : null;
  let other = grnLines.find((x) => {
    if (x === line || String(x.new_barcode || "").trim() !== code) return false;
    let xt = grnLineTarget(x.product_id, x.unit_cost);
    if (xt.kind !== "new") return false;
    // lines that become the same new product (same name, category and cost) may share it
    return !(t && t.kind === "new" && grnFamily(xt.product).includes(t.product) && supRound(x.unit_cost) === supRound(line.unit_cost));
  });
  if (other) return `The barcode ${code} is already given to another new product in this GRN ("${other.name}", cost ${supMoney(other.unit_cost)}).`;
  return "";
}

// A new barcode for a new product (the Fill buttons): 12 digits with a check
// digit, the same kind the product form's Fill button makes, and not used by
// any product or by another line of this GRN.
function grnFreshBarcode() {
  let used = {};
  grnProducts.forEach((p) => {
    if (p.barcode != null) used[String(p.barcode)] = true;
  });
  grnLines.forEach((l) => {
    if (l.new_barcode) used[String(l.new_barcode)] = true;
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    let digits = [];
    for (let i = 0; i < 11; i++) digits.push(Math.floor(Math.random() * 10));
    let odd = 0, even = 0;
    digits.forEach((d, i) => (i % 2 === 0 ? (odd += d) : (even += d)));
    let check = (odd * 3 + even) % 10;
    digits.push(check ? 10 - check : 0);
    let code = digits.join("");
    if (!used[code]) return code;
  }
  return "";
}

// under a line's selling price
function grnSellHint(l, t) {
  if (t.kind === "existing") return `<span class="text-muted">its price now</span>`;
  if (t.kind !== "new") return "";
  if (grnNewPriceProblem(l)) return `<span class="text-danger">needs its own price</span>`;
  if (l.selling_price !== "" && l.unit_cost !== "" && Number(l.selling_price) < Number(l.unit_cost)) {
    return `<span class="text-danger">below the unit cost</span>`;
  }
  return `<span class="text-muted">new product's price</span>`;
}

// under a line's name: where the goods go
function grnTargetNote(l, t) {
  if (t.kind === "new") {
    return `<span class="label label-warning">New product</span> <small class="text-muted">cost ${supMoney(l.unit_cost)}</small>`;
  }
  if (t.kind !== "existing") return "";
  let p = t.product;
  let code = p.barcode != null && String(p.barcode) !== "NaN" ? String(p.barcode) : "";
  if (t.setsCost) return `<small class="text-muted">${txnHtml(code)} · first cost price: ${supMoney(l.unit_cost)}</small>`;
  if (String(p._id) !== String(l.product_id)) {
    return `<small class="text-success" title="The product with this cost price gets the stock">adds to ${txnHtml(code) || "the product"} (cost ${supMoney(grnCostOf(p))})</small>`;
  }
  return `<small class="text-muted">${txnHtml(code)} · adds to its stock</small>`;
}

// Brings a line's row up to date with where its goods go (the existing
// product's price, or a suggested price for a new product), without
// re-drawing the inputs being typed in.
function refreshGrnLineRow(l, i) {
  let $row = $(`#grn_lines tr[data-index="${i}"]`);
  let t = grnLineTarget(l.product_id, l.unit_cost);
  let $sell = $row.find(".grn-line-sell");
  if (t.kind === "existing") {
    l.selling_price = supRound(t.product.price);
    $sell.prop("disabled", true).val(Number(l.selling_price).toFixed(2));
  } else if (t.kind === "new") {
    if ($sell.prop("disabled")) {
      // just became a new product: suggest a price (unless one was typed)
      if (!l.sell_typed || l.selling_price === "") {
        let s = grnSuggestedPrice(t.product.cost_price, t.product.price, l.unit_cost);
        l.selling_price = s;
        $sell.val(s === "" ? "" : Number(s).toFixed(2));
      }
      $sell.prop("disabled", false);
    }
  }
  let stockNow = t.kind === "existing" ? parseInt(t.product.quantity) || 0 : 0;
  let tracked = t.kind === "existing" ? t.product.stock == 1 : t.product ? t.product.stock == 1 : false;
  $row.find(".grn-line-target").html(grnTargetNote(l, t));
  // a new product: its barcode (typed or scanned; empty = one is made)
  let $code = $row.find(".grn-line-barcode-box");
  $code.toggle(t.kind === "new");
  let codeProblem = t.kind === "new" ? grnNewBarcodeProblem(l.new_barcode, l) : "";
  $code.toggleClass("has-error", !!codeProblem).attr("title", codeProblem || "Barcode of the new product: scan or type it, or leave it empty to create one");
  $row.find(".grn-line-stock").html(
    tracked ? String(stockNow) : '<span class="text-muted" title="Stock is not tracked for this product">not tracked</span>'
  );
  $row.find(".grn-line-after").text(tracked && grnLineValid(l) ? "→ " + (stockNow + Number(l.quantity)) : "");
  $row.find(".grn-line-sell-hint").html(grnSellHint(l, t));
}

function updateGrnTotals() {
  let qty = 0, total = 0;
  grnLines.forEach((l, i) => {
    refreshGrnLineRow(l, i);
    let lineTotal = grnLineValid(l) ? supRound(Number(l.quantity) * Number(l.unit_cost)) : 0;
    if (grnLineValid(l)) {
      qty += Number(l.quantity);
      total += lineTotal;
    }
    $(`#grn_lines tr[data-index="${i}"] .grn-line-total`).text(grnLineValid(l) ? supMoney(lineTotal) : "-");
  });
  $("#grnTotalQty").text(qty);
  $("#grnTotal").text(supMoney(total));
  updateGrnAdvanceInfo();
}

function renderGrnLines() {
  if (!grnLines.length) {
    $("#grn_lines").html(
      `<tr class="grn-empty"><td colspan="7">No products yet. Choose a product above, enter the quantity and unit cost, then click Add. Goods at a new cost price become a new product with its own selling price.</td></tr>`
    );
  } else {
    $("#grn_lines").html(
      grnLines
        .map((l, i) => {
          let t = grnLineTarget(l.product_id, l.unit_cost);
          return `<tr data-index="${i}">
            <td><b>${txnHtml(l.name)}</b><br><span class="grn-line-target"></span>
              <div class="input-group input-group-sm grn-line-barcode-box" style="display: none;">
                <span class="input-group-addon"><i class="fa fa-barcode"></i></span>
                <input type="text" class="form-control grn-line-barcode" placeholder="Scan, type or Fill" autocomplete="off" maxlength="64" value="${txnHtml(l.new_barcode || "")}">
                <span class="input-group-btn"><button type="button" class="btn btn-primary grn-line-fill" title="Create a barcode for the new product">Fill</button></span>
              </div></td>
            <td class="text-right nobr"><span class="grn-line-stock"></span>
              <br><small class="text-success grn-line-after"></small></td>
            <td><input type="number" class="form-control grn-line-qty" min="1" step="1" value="${txnHtml(l.quantity)}"></td>
            <td><input type="text" inputmode="decimal" autocomplete="off" class="form-control amount-input grn-line-cost" value="${txnHtml(amountInputText(l.unit_cost))}"></td>
            <td><input type="text" inputmode="decimal" autocomplete="off" class="form-control amount-input grn-line-sell" value="${txnHtml(amountInputText(l.selling_price))}"${
              t.kind === "existing" ? " disabled" : ""
            }>
              <small class="grn-line-sell-hint"></small></td>
            <td class="text-right nobr grn-line-total"></td>
            <td><button type="button" class="btn btn-danger btn-sm grn-line-remove" title="Remove"><i class="fa fa-times"></i></button></td>
          </tr>`;
        })
        .join("")
    );
  }
  updateGrnTotals();
}

// the add bar: where the goods will go, and the selling price that goes with it
function updateGrnAddBar() {
  let t = grnLineTarget($("#grnProduct").val(), $.trim($("#grnUnitCost").val()));
  let $sell = $("#grnSellPrice");
  if (t.kind === "existing") {
    $sell.prop("disabled", true).val((parseFloat(t.product.price) || 0).toFixed(2));
    let code = t.product.barcode != null && String(t.product.barcode) !== "NaN" ? String(t.product.barcode) : "";
    $("#grnAddHint").html(
      t.setsCost
        ? `<i class="fa fa-info-circle"></i> Adds to the stock of <b>${txnHtml(t.product.name)}</b>${code ? " (" + txnHtml(code) + ")" : ""} - its first cost price.`
        : `<i class="fa fa-check-circle text-success"></i> Same cost price as <b>${txnHtml(t.product.name)}</b>${code ? " (" + txnHtml(code) + ")" : ""}: its stock goes up; it keeps selling at ${supMoney(t.product.price)}.`
    );
  } else if (t.kind === "new") {
    if ($sell.prop("disabled") || !grnSellTyped) {
      let s = grnSuggestedPrice(t.product.cost_price, t.product.price, $("#grnUnitCost").val());
      $sell.val(s === "" ? "" : Number(s).toFixed(2));
    }
    $sell.prop("disabled", false);
    $(".grn-add-barcode").show();
    $("#grnAddHint").html(
      `<i class="fa fa-plus-circle text-warning"></i> No <b>${txnHtml(t.product.name)}</b> has this cost price yet: these goods become a <b>new product</b> (same name and category). Enter its selling price, and scan or type its barcode (or leave it empty to create one).`
    );
  } else {
    $sell.prop("disabled", false);
    $("#grnAddHint").html("");
  }
  if (t.kind !== "new") $(".grn-add-barcode").hide();
}

function addGrnLine() {
  let p = grnProduct($("#grnProduct").val());
  let qty = Number($("#grnQty").val());
  let costText = $.trim($("#grnUnitCost").val());
  let cost = Number(costText);
  let sellText = $.trim($("#grnSellPrice").val());
  let sell = Number(sellText);

  if (!p) {
    Swal.fire("Oops!", "Please choose a product.", "warning");
    return;
  }
  if (!Number.isInteger(qty) || qty < 1) {
    Swal.fire("Oops!", "Please enter the quantity received (a whole number of at least 1).", "warning");
    return;
  }
  if (costText === "" || !(cost >= 0)) {
    Swal.fire("Oops!", "Please enter the unit cost (0 or more).", "warning");
    return;
  }
  let target = grnLineTarget(p._id, cost);
  let newBarcode = target.kind === "new" ? $.trim($("#grnNewBarcode").val()) : "";
  if (target.kind === "new") {
    let problem = grnNewPriceProblem({ product_id: p._id, unit_cost: supRound(cost), selling_price: sellText === "" ? "" : supRound(sell) });
    if (problem) {
      Swal.fire("Selling price needed", problem, "warning");
      $("#grnSellPrice").trigger("focus").trigger("select");
      return;
    }
    let codeProblem = grnNewBarcodeProblem(newBarcode, { product_id: p._id, unit_cost: supRound(cost) });
    if (codeProblem) {
      Swal.fire("Barcode already used", codeProblem, "warning");
      $("#grnNewBarcode").trigger("focus").trigger("select");
      return;
    }
  }

  // the same product at the same cost again: add to its line
  let existing = grnLines.find((l) => String(l.product_id) === String(p._id) && supRound(l.unit_cost) === supRound(cost));
  if (existing) {
    existing.quantity = (Number(existing.quantity) || 0) + qty;
    if (target.kind === "new") {
      existing.selling_price = supRound(sell);
      existing.sell_typed = true;
      if (newBarcode) existing.new_barcode = newBarcode;
    }
  } else {
    grnLines.push({
      product_id: p._id,
      name: p.name,
      quantity: qty,
      unit_cost: supRound(cost),
      selling_price: target.kind === "existing" ? supRound(target.product.price) : supRound(sell),
      sell_typed: grnSellTyped, // typed by hand: a cost change doesn't re-suggest it
      new_barcode: newBarcode, // a new product's barcode (empty = one is made)
    });
  }

  $("#grnProduct").val("").trigger("chosen:updated");
  $("#grnQty, #grnUnitCost, #grnSellPrice, #grnNewBarcode").val("");
  $("#grnSellPrice").prop("disabled", false);
  $(".grn-add-barcode").hide();
  $("#grnAddHint").html("");
  grnSellTyped = false;
  renderGrnLines();
  $("#grnProduct").trigger("chosen:activate");
}

// ---- GRN details ----
function grnDetailsHtml(g) {
  let items = (g.items || [])
    .map(
      (i) => `<tr>
        <td>${txnHtml(i.product_name)}${i.new_product ? ' <span class="label label-warning" title="Created by this GRN: goods at a new cost price">New product</span>' : ""}${
          i.barcode ? `<br><small class="text-muted">${txnHtml(i.barcode)}</small>` : ""
        }</td>
        <td class="text-right">${i.quantity}</td>
        <td class="text-right nobr">${supMoney(i.unit_cost)}</td>
        <td class="text-right nobr">${i.selling_price != null ? supMoney(i.selling_price) : '<span class="text-muted">-</span>'}${
          i.batch_code ? `<br><small class="text-muted" title="The barcode of this price: label the goods with it">${txnHtml(i.batch_code)}</small>` : ""
        }</td>
        <td class="text-right nobr">${supMoney(i.total)}</td>
      </tr>`
    )
    .join("");
  let meta = [
    ["GRN No", `<b>${txnHtml(g.grn_no)}</b>`],
    ["Received", supDate(g.received_date)],
    ["Supplier", txnHtml(g.supplier_name) + (g.walk_in ? ' <span class="label label-default">Walk-in</span>' : "")],
    ["Paid By", grnPaidByLabel(g.payment_method) + (Number(g.advance_used) > 0 && g.payment_method !== "Advance" ? " " + supMoney(grnAmountDue(g)) : "")],
  ];
  if (Number(g.advance_used) > 0) meta.push(["From Supplier Advance", `<span class="text-success">${supMoney(g.advance_used)}</span>`]);
  meta = meta.concat([
    ["Added By", txnHtml(g.created_by || "-") + `<br><small>${moment(g.created_at).format("DD MMM YYYY, hh:mm A")}</small>`],
  ]);
  if (g.note) meta.push(["Note", txnHtml(g.note)]);
  // goods sent back against this GRN (PRNs)
  let returns = (allPrns || []).filter((r) => r.grn_ref === g.grn_no);
  if (returns.length) {
    meta.push([
      "Returned (PRN)",
      returns
        .map((r) => `<span class="text-danger">${txnHtml(r.prn_no)}</span> · ${r.total_quantity || 0} units · ${supMoney(r.total)}`)
        .join("<br>"),
    ]);
  }
  return `<div class="grn-view-meta">${meta
      .map((m) => `<div><small>${m[0].toUpperCase()}</small>${m[1]}</div>`)
      .join("")}</div>
    <div class="modal-fit-scroll grn-view-scroll">
    <table class="table table-bordered">
      <thead><tr><th>Product</th><th class="txn-num">Quantity</th><th class="txn-num">Unit Cost</th><th class="txn-num" title="The price of the product that got the goods">Selling Price</th><th class="txn-num">Line Total</th></tr></thead>
      <tbody>${items}</tbody>
      <tfoot><tr>
        <th class="text-right">Total</th>
        <th class="text-right">${g.total_quantity || 0}</th>
        <th></th>
        <th></th>
        <th class="text-right nobr">${supMoney(g.total)}</th>
      </tr></tfoot>
    </table>
    </div>`;
}

let grnViewing = null; // the GRN open in the GRN details window (its Print Bill button)

// Price labels for the goods: product name, the barcode of its selling price
// (each price has its own, see api/inventory.js) and the price, printed as a
// sheet. labels: [{ name, code, price, copies }]
function printPriceLabels(labels) {
  let cells = [];
  (labels || []).forEach((l) => {
    if (!l.code) return;
    let canvas = document.createElement("canvas");
    try {
      JsBarcode(canvas, String(l.code), { format: "CODE128", displayValue: true, height: 40, margin: 0, fontSize: 14 });
    } catch (e) {
      console.error("Barcode label failed for " + l.code, e);
      return;
    }
    let cell = `<div class="lbl">
        <div class="nm">${txnHtml(l.name)}</div>
        <img src="${canvas.toDataURL("image/png")}">
        <div class="pr">${l.price != null && l.price !== "" ? supMoney(l.price) : ""}</div>
      </div>`;
    let copies = Math.min(Math.max(parseInt(l.copies) || 1, 1), 1000);
    for (let i = 0; i < copies; i++) cells.push(cell);
  });
  if (!cells.length) {
    Swal.fire("Nothing to print", "There are no barcodes to print.", "info");
    return;
  }
  printJS({
    printable: `<div class="sheet">${cells.join("")}</div>`,
    type: "raw-html",
    style:
      ".sheet{display:flex;flex-wrap:wrap;gap:6px}" +
      ".lbl{width:48mm;border:1px dashed #999;padding:4px;text-align:center;font-family:Arial,sans-serif;page-break-inside:avoid}" +
      ".lbl img{max-width:100%;height:auto}" +
      ".nm{font-size:11px;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".pr{font-size:15px;font-weight:bold}",
  });
}

function showGrn(grn) {
  grnViewing = grn;
  $("#grnViewTitle").html(`<i class="fa fa-truck"></i> ${txnHtml(grn.grn_no)}`);
  $("#grnViewBody").html(grnDetailsHtml(grn));
  supSwapModal("#supplierTransactionsModal", "#grnViewModal", null);
}

// ---- bills: GRN and supplier payment, in the same style as the POS bill ----
// Shown in the sales bill window (#orderModal) and printed with its Print
// button ($.fn.print prints `receipt`). A supplier's balance on a bill is its
// position: + owed to the supplier, - advance held by the supplier.
let supBillPositionCache = {}; // "g<id>" / "p<id>" -> { before, after }, worked out in the supplier window

function supBillPositionFor(kind, doc) {
  if (doc.position_after !== undefined && doc.position_after !== null) {
    return { before: Number(doc.position_before) || 0, after: Number(doc.position_after) || 0 };
  }
  return supBillPositionCache[kind + doc._id] || null; // saved before bills existed
}

function supBillPositionText(pos) {
  pos = Number(pos) || 0;
  return pos > 0.004 ? "Owed " + supMoney(pos) : pos < -0.004 ? "Advance " + supMoney(-pos) : "Settled";
}

function supBillHeader(title) {
  return `<p style="text-align: center;">
      ${settings.img ? '<img style="max-width: 100px;" src="' + img_path + settings.img + '" /><br>' : ""}
      <span style="font-size: 22px;">${settings.store || ""}</span> <br>
      ${settings.address_one || ""} <br>
      ${settings.address_two || ""} <br>
      ${settings.contact ? "Tel: " + settings.contact + "<br>" : ""}
    </p>
    <hr>
    <p style="text-align: center; font-size: 13px;"><b>${title}</b></p>`;
}

// a summary line in a 4-column bill table: label : value
function supBillRow(label, value, big) {
  if (big) {
    let h = (t) => `<h3 style="margin: 4px 0;">${t}</h3>`;
    return `<tr><td colspan="2">${h(label)}</td><td>${h(":")}</td><td style="text-align: right;">${h(value)}</td></tr>`;
  }
  return `<tr><td colspan="2">${label}</td><td>:</td><td style="text-align: right;">${value}</td></tr>`;
}

function supBillSignatures(left, right) {
  let line = (t) =>
    `<td style="width: 45%; border-top: 1px dotted #000; text-align: center; padding-top: 3px;">${t}</td>`;
  return `<table width="100%" style="margin-top: 35px;"><tr>${line(left)}<td style="width: 10%;"></td>${line(right)}</tr></table>`;
}

function grnBillHtml(g) {
  let items = (g.items || [])
    .map(
      (i) => `<tr>
        <td>${txnHtml(i.product_name)}${i.selling_price != null ? `<br><small>sell @ ${supMoney(i.selling_price)}${i.batch_code ? " · " + txnHtml(i.batch_code) : ""}</small>` : ""}</td>
        <td>${i.quantity}</td>
        <td>${supMoney(i.unit_cost)}</td>
        <td style="text-align: right;">${supMoney(i.total)}</td>
      </tr>`
    )
    .join("");
  let used = Number(g.advance_used) || 0;
  let due = grnAmountDue(g);
  let payment = "";
  if (used > 0) payment += supBillRow("From supplier advance", supMoney(used));
  if (g.payment_method === "Credit") payment += supBillRow("On credit", "<b>" + supMoney(due) + "</b>");
  else if (g.payment_method !== "Advance") payment += supBillRow("Paid by " + txnHtml(g.payment_method), supMoney(due));
  let pos = g.walk_in ? null : supBillPositionFor("g", g);
  if (pos) payment += supBillRow("Supplier balance now", "<b>" + supBillPositionText(pos.after) + "</b>");

  return `<div style="font-size: 10px;">
    ${supBillHeader("GOODS RECEIVED NOTE")}
    <p>
      GRN No : <b>${txnHtml(g.grn_no)}</b> <br>
      Supplier : ${txnHtml(g.supplier_name)}${g.walk_in ? " (Walk-in)" : ""} <br>
      Received on : ${supDate(g.received_date)} <br>
      Received by : ${txnHtml(g.created_by || "-")} <br>
      Date : ${moment(g.created_at).format("DD MMM YYYY HH:mm:ss")}
    </p>
    <hr>
    <table width="100%">
      <thead style="text-align: left;">
        <tr><th>Item</th><th style="padding: 0 6px;">Qty</th><th style="padding: 0 6px;">Cost</th><th style="text-align: right;">Total</th></tr>
      </thead>
      <tbody>
        ${items}
        <tr><td colspan="4"><hr style="margin: 4px 0;"></td></tr>
        ${supBillRow("Products / Units", (g.item_count || (g.items || []).length) + " / " + (g.total_quantity || 0))}
        ${supBillRow("Total", supMoney(g.total), true)}
        ${payment}
      </tbody>
    </table>
    ${g.note ? "<p>Note : " + txnHtml(g.note) + "</p>" : ""}
    <hr>
    ${supBillSignatures("Received by", "Supplier")}
  </div>`;
}

function supplierPaymentBillHtml(p) {
  let pos = supBillPositionFor("p", p);
  let amount = Number(p.amount) || 0;
  let toAdvance = Number(p.to_advance) || 0;
  let toCredit = p.to_credit !== undefined ? Number(p.to_credit) || 0 : amount - toAdvance;
  let name = p.supplier_name || (supplierTxnData && supplierTxnData.supplier ? supplierTxnData.supplier.name : "");
  return `<div style="font-size: 10px;">
    ${supBillHeader(toCredit > 0 ? "SUPPLIER PAYMENT" : "ADVANCE PAYMENT TO SUPPLIER")}
    <p>
      Payment No : <b>${txnHtml(p.payment_no || p._id)}</b> <br>
      Supplier : ${txnHtml(name)} <br>
      Paid on : ${supDate(p.date)} <br>
      Paid by : ${txnHtml(p.created_by || "-")} <br>
      Date : ${moment(p.created_at).format("DD MMM YYYY HH:mm:ss")}
    </p>
    <hr>
    <table width="100%">
      <tbody>
        ${pos ? supBillRow("Balance before", supBillPositionText(pos.before)) : ""}
        ${supBillRow("Amount paid", supMoney(amount), true)}
        ${supBillRow("Method", txnHtml(p.payment_method))}
        ${toCredit > 0 && toAdvance > 0 ? supBillRow("Settled credit", supMoney(toCredit)) : ""}
        ${toAdvance > 0 ? supBillRow("Kept as advance", "<b>" + supMoney(toAdvance) + "</b>") : ""}
        ${pos ? supBillRow("Balance now", "<b>" + supBillPositionText(pos.after) + "</b>") : ""}
      </tbody>
    </table>
    ${p.note ? "<p>Note : " + txnHtml(p.note) + "</p>" : ""}
    ${toAdvance > 0 ? '<p style="text-align: center;">The advance is used by the next GRNs from this supplier.</p>' : ""}
    <hr>
    ${supBillSignatures("Paid by", "Received by (Supplier)")}
  </div>`;
}

// Shows a bill in the bill window; over the supplier window it takes its
// place and the supplier window comes back when the bill is closed.
function showSupplierBill(html) {
  receipt = html;
  $("#viewTransaction").html(html);
  if ($("#supplierTransactionsModal").hasClass("in")) supSwapModal("#supplierTransactionsModal", "#orderModal", null);
  else $("#orderModal").modal("show");
}

// After saving: close window "closing", then show the bill. When closing it
// brings the supplier window back, the bill waits until that has opened.
function showSupplierBillAfter(closing, html) {
  $(closing).one("hidden.bs.modal", function () {
    let $sup = $("#supplierTransactionsModal");
    let m = $sup.data("bs.modal");
    if (m && m.isShown && !$sup.hasClass("in")) $sup.one("shown.bs.modal", () => showSupplierBill(html));
    else showSupplierBill(html);
  });
  $(closing).modal("hide");
}

// ---- supplier transactions (GRNs + payments) ----
function openSupplierTransactions(id) {
  $.get(api + "suppliers/transactions/" + id)
    .done(function (data) {
      supplierTxnData = data;
      (data.grns || []).forEach((g) => (grnCache[g._id] = g));
      renderSupplierTransactions();
      $("#supplierTransactionsModal").modal("show");
    })
    .fail(function (xhr) {
      Swal.fire("Oops!", supError(xhr, "Could not load the supplier's transactions."), "warning");
    });
}

function refreshSupplierTransactions() {
  if (!supplierTxnData) return;
  $.get(api + "suppliers/transactions/" + supplierTxnData.supplier._id).done(function (data) {
    supplierTxnData = data;
    (data.grns || []).forEach((g) => (grnCache[g._id] = g));
    renderSupplierTransactions();
  });
}

function renderSupplierTransactions() {
  let s = supplierTxnData.supplier;
  $("#supplierTransactionsTitle").html(`<i class="fa fa-truck"></i> ${txnHtml(s.name)}`);
  $("#supplierTransactionsContact").html(
    [s.contact_person, s.phone, s.email, s.address].filter(Boolean).map(txnHtml).join(" &nbsp;·&nbsp; ") ||
      "No contact details"
  );
  $("#supTxnPurchases").text(supMoney(s.purchases));
  $("#supTxnGrnCount").text((s.grn_count || 0) + (s.grn_count === 1 ? " GRN" : " GRNs"));
  $("#supTxnCredit").text(supMoney(s.credit_purchases));
  $("#supTxnPaid").text(supMoney(s.credit_paid));
  $("#supTxnOwed").text(supMoney(s.balance)).toggleClass("sup-owed", s.balance > 0.004);
  $("#supTxnAdvance").text(supMoney(s.advance));
  $("#supTxnPayBtn").html('<i class="fa fa-money"></i> ' + (s.balance > 0.004 ? "Pay Supplier" : "Pay in Advance"));

  // Balance after each entry, in the order they were saved (the order the
  // server applied payments and advances): + owed, - advance
  let entries = []
    .concat((supplierTxnData.grns || []).map((g) => ({ kind: "grn", at: g.created_at, g: g })))
    .concat((supplierTxnData.payments || []).map((p) => ({ kind: "payment", at: p.created_at, p: p })))
    .concat((supplierTxnData.prns || []).map((r) => ({ kind: "prn", at: r.created_at, r: r })))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  let position = 0;
  let balanceCell = (pos) =>
    pos > 0.004
      ? `<td class="text-right nobr" data-export="Owed ${supMoney(pos)}"><span class="text-danger">Owed ${supMoney(pos)}</span></td>`
      : pos < -0.004
      ? `<td class="text-right nobr" data-export="Advance ${supMoney(-pos)}"><span class="text-success">Advance ${supMoney(-pos)}</span></td>`
      : `<td class="text-right nobr" data-export="Settled"><span class="text-muted">Settled</span></td>`;

  let rows = entries.map((e, i) => {
    if (e.kind === "grn") {
      let g = e.g;
      let before = position;
      position += (g.payment_method === "Credit" ? grnAmountDue(g) : 0) + (Number(g.advance_used) || 0);
      supBillPositionCache["g" + g._id] = { before: before, after: position };
      return `<tr>
        <td class="nobr" data-order="${i}">${supDate(g.received_date)}</td>
        <td><span class="label label-primary">GRN</span></td>
        <td>${txnHtml(g.grn_no)}${g.note ? `<br><small class="text-muted">${txnHtml(g.note)}</small>` : ""}</td>
        <td data-export="${txnHtml(grnPaymentText(g))}">${grnPaymentHtml(g)}</td>
        <td class="text-right nobr">${supMoney(g.total)}</td>
        ${balanceCell(position)}
        <td class="nobr"><button onClick="$(this).viewGrn(${g._id})" class="btn btn-info btn-sm" title="View GRN"><i class="fa fa-search-plus"></i></button>
          <button onClick="$(this).grnBill(${g._id})" class="btn btn-default btn-sm" title="GRN bill"><i class="fa fa-print"></i></button></td>
      </tr>`;
    }
    if (e.kind === "prn") {
      // goods sent back: a deduction lowers what is owed (or adds to the advance)
      let r = e.r;
      prnCache[r._id] = r;
      if (r.refund_method === "Credit") position -= Number(r.total) || 0;
      return `<tr>
        <td class="nobr" data-order="${i}">${supDate(r.return_date)}</td>
        <td><span class="label label-danger">PRN</span></td>
        <td>${txnHtml(r.prn_no)}${r.grn_ref ? ` <small class="text-muted">for ${txnHtml(r.grn_ref)}</small>` : ""}${r.note ? `<br><small class="text-muted">${txnHtml(r.note)}</small>` : ""}</td>
        <td data-export="${txnHtml(prnSettledText(r.refund_method))}">${prnSettledHtml(r.refund_method)}</td>
        <td class="text-right nobr" data-export="-${supMoney(r.total)}">-${supMoney(r.total)}</td>
        ${balanceCell(position)}
        <td><button onClick="$(this).viewPrn(${r._id})" class="btn btn-default btn-sm" title="PRN bill"><i class="fa fa-print"></i></button></td>
      </tr>`;
    }
    let p = e.p;
    let before = position;
    position -= Number(p.amount) || 0;
    supBillPositionCache["p" + p._id] = { before: before, after: position };
    let split =
      Number(p.to_advance) > 0
        ? `<br><small class="text-success">${
            Number(p.to_credit) > 0 ? supMoney(p.to_credit) + " settled credit, " : ""
          }${supMoney(p.to_advance)} to advance</small>`
        : "";
    return `<tr>
        <td class="nobr" data-order="${i}">${supDate(p.date)}</td>
        <td><span class="label label-success">Payment</span></td>
        <td>${p.note ? txnHtml(p.note) : '<span class="text-muted">-</span>'}${p.created_by ? `<br><small class="text-muted">by ${txnHtml(p.created_by)}</small>` : ""}${split}</td>
        <td>${txnHtml(p.payment_method)}</td>
        <td class="text-right nobr">${supMoney(p.amount)}</td>
        ${balanceCell(position)}
        <td><button onClick="$(this).supplierPaymentBill(${p._id})" class="btn btn-default btn-sm" title="Payment bill"><i class="fa fa-print"></i></button></td>
      </tr>`;
  });

  if ($.fn.DataTable.isDataTable("#supplierTxnList")) $("#supplierTxnList").DataTable().destroy();
  $("#supplier_txn_list").html(rows.join(""));
  $("#supplierTxnList").DataTable(
    Object.assign(
      standardTableOptions({
        noun: "transactions",
        searchPlaceholder: "Search...",
        exportTitle: "Supplier - " + s.name,
        exportColumns: [0, 1, 2, 3, 4, 5],
        exportSubtitle: () =>
          s.advance > 0.004 ? "Advance now: " + supMoney(s.advance) : "Owed now: " + supMoney(s.balance),
        actionColumns: [6],
        emptyTable: "No GRNs or payments for this supplier yet",
      }),
      { order: [[0, "desc"]] }
    )
  );
}

// ---- pay a supplier ----
// how a payment amount is split: what is owed first, the rest to advance
function updateSupplierPaymentHint() {
  let s = supplierTxnData && supplierTxnData.supplier;
  let amount = supRound($("#supPayAmount").val());
  let owed = s ? Number(s.balance) || 0 : 0;
  if (!s || !(amount > 0)) {
    $("#supPayHint").html(
      s && !(owed > 0.004)
        ? '<i class="fa fa-info-circle"></i> Nothing is owed to this supplier, so the whole payment is kept as an advance and used by the next GRNs from them.'
        : ""
    );
    return;
  }
  let toCredit = Math.min(amount, owed);
  let toAdvance = supRound(amount - toCredit);
  let parts = [];
  if (toCredit > 0) parts.push(supMoney(toCredit) + (toCredit >= owed - 0.004 ? " settles everything owed" : " goes to what is owed"));
  if (toAdvance > 0) parts.push(supMoney(toAdvance) + " becomes an advance, used by the next GRNs from this supplier");
  $("#supPayHint").html('<i class="fa fa-info-circle"></i> ' + txnHtml(parts.join("; ")) + ".");
}

function openSupplierPayment() {
  let s = supplierTxnData && supplierTxnData.supplier;
  if (!s) return;
  $("#saveSupplierPayment").get(0).reset();
  let owing = s.balance > 0.004;
  $("#supplierPaymentTitle").html('<i class="fa fa-money"></i> ' + (owing ? "Pay Supplier" : "Pay in Advance"));
  $("#submitSupplierPayment").text(owing ? "Save Payment" : "Save Advance Payment");
  $("#supPayName").text(s.name);
  $("#supPayOwed").text(supMoney(s.balance));
  $("#supPayAdvance").text(supMoney(s.advance));
  // owed: suggest paying it all; nothing owed: the amount is an advance
  $("#supPayAmount").val(s.balance > 0.004 ? supRound(s.balance).toFixed(2) : "");
  updateSupplierPaymentHint();
  $("#supPayDate").val(moment().format("YYYY-MM-DD"));
  $("#supPayMethod").val("Cash");
  $(".grn-currency").text(settings?.symbol ? "(" + settings.symbol + ")" : "");
  supSwapModal("#supplierTransactionsModal", "#supplierPaymentModal", refreshSupplierTransactions);
}

$(function () {
  grnDateFilter = initDateRangeFilter("#grnDateRange", renderGrns);

  // keep the Suppliers page fitted to the window (the toolbar can change
  // height on its own too, e.g. buttons shown/hidden or wrapping)
  $(window).on("resize", fitSuppliersView);
  if (window.ResizeObserver && document.querySelector(".main-toolbar-row")) {
    new ResizeObserver(fitSuppliersView).observe(document.querySelector(".main-toolbar-row"));
  }
  $("#grnSupplierFilter, #grnPaidByFilter").on("change", renderGrns);

  $("#addSupplierBtn").on("click", function () {
    openSupplierForm(null);
  });
  $("#newGrnBtn").on("click", function () {
    openGrnForm(0);
  });
  $("#supTxnGrnBtn").on("click", function () {
    if (supplierTxnData) openGrnForm(supplierTxnData.supplier._id);
  });
  $("#supTxnPayBtn").on("click", openSupplierPayment);
  // GRN details window: print its bill straight away (same printing as the bill window)
  $("#grnViewPrint").on("click", function () {
    if (!grnViewing) return;
    receipt = grnBillHtml(grnViewing);
    $(this).print();
  });
  // GRN details window: price labels for the goods received (each price has its own barcode)
  $("#grnViewLabels").on("click", function () {
    if (!grnViewing) return;
    let lines = (grnViewing.items || []).map((i) => ({
      name: i.product_name,
      code: i.batch_code || i.barcode || String(i.product_id),
      price: i.selling_price != null ? i.selling_price : null,
      units: parseInt(i.quantity) || 1,
    }));
    let units = lines.reduce((s, l) => s + l.units, 0);
    Swal.fire({
      title: "Print price labels",
      input: "radio",
      inputOptions: {
        unit: "One label per unit received (" + units + " labels)",
        line: "One label per product (" + lines.length + " labels)",
      },
      inputValue: units > 200 ? "line" : "unit",
      showCancelButton: true,
      confirmButtonText: '<i class="fa fa-print"></i> Print',
    }).then(function (result) {
      if (!result.value) return;
      printPriceLabels(lines.map((l) => Object.assign({}, l, { copies: result.value === "unit" ? l.units : 1 })));
    });
  });
  $("#supPayAmount").on("input", updateSupplierPaymentHint);

  // tables measured while hidden (other tab / closed window) need re-measuring
  $('#suppliers_view .suppliers-tabs a[data-toggle="tab"]').on("shown.bs.tab", function () {
    ["#supplierList", "#grnList", "#prnList"].forEach((sel) => {
      if ($.fn.DataTable.isDataTable(sel)) $(sel).DataTable().columns.adjust();
    });
  });
  $("#supplierTransactionsModal").on("shown.bs.modal", function () {
    if ($.fn.DataTable.isDataTable("#supplierTxnList")) $("#supplierTxnList").DataTable().columns.adjust();
  });

  $("#supplierModal").on("shown.bs.modal", function () {
    $("#supplierName").trigger("focus");
  });
  $("#supplierPaymentModal").on("shown.bs.modal", function () {
    $("#supPayAmount").trigger("focus").trigger("select");
  });
  // the product search box is set up once the window is visible (it measures itself)
  $("#grnModal").on("shown.bs.modal", function () {
    if (!$("#grnProduct").data("chosen")) {
      $("#grnProduct").chosen({ width: "100%", search_contains: true, no_results_text: "No product matches" });
    }
    $("#grnProduct").trigger("chosen:updated").trigger("chosen:activate");
  });

  // ---- supplier form ----
  $("#saveSupplier").on("submit", function (e) {
    e.preventDefault();
    let id = $("#supplier_id").val();
    let payload = {
      name: $.trim($("#supplierName").val()),
      contact_person: $.trim($("#supplierContact").val()),
      phone: $.trim($("#supplierPhone").val()),
      email: $.trim($("#supplierEmail").val()),
      address: $.trim($("#supplierAddress").val()),
    };
    if (!payload.name) {
      Swal.fire("Oops!", "Please enter the supplier's name.", "warning");
      return;
    }
    let $btn = $("#submitSupplier").prop("disabled", true);
    $.ajax({
      url: api + "suppliers/supplier" + (id ? "/" + id : ""),
      type: id ? "PUT" : "POST",
      contentType: "application/json",
      data: JSON.stringify(payload),
    })
      .done(function () {
        $("#supplierModal").modal("hide");
        loadSuppliersPage(); // a rename shows on its GRNs too
        Swal.fire({ title: id ? "Supplier Updated" : "Supplier Saved", icon: "success", timer: 1400, showConfirmButton: false });
      })
      .fail(function (xhr) {
        Swal.fire("Oops!", supError(xhr, "Could not save the supplier."), "warning");
      })
      .always(function () {
        $btn.prop("disabled", false);
      });
  });

  // ---- GRN form ----
  $("#grnSupplier").on("change", updateGrnSupplierUi);

  $("#grnProduct").on("change", function () {
    let p = grnProduct($(this).val());
    if (!p) return;
    // starts at the product's cost price: same cost = its stock goes up
    let cost = p.cost_price;
    $("#grnUnitCost").val(cost !== "" && cost != null && !isNaN(parseFloat(cost)) ? parseFloat(cost).toFixed(2) : "");
    $("#grnSellPrice").val("");
    grnSellTyped = false;
    updateGrnAddBar();
    setTimeout(() => $("#grnQty").trigger("focus"), 0);
  });

  $("#grnAddLine").on("click", addGrnLine);
  // a new unit cost: the goods may go to another product (same cost) or
  // become a new one (its price suggested until one is typed)
  $("#grnUnitCost").on("input", updateGrnAddBar);
  $("#grnSellPrice").on("input", function () {
    grnSellTyped = true;
  });

  // Fill: like the product form's Fill button, creates a barcode when the box is empty
  $("#grnFillBarcode").on("click", function () {
    if ($.trim($("#grnNewBarcode").val()) === "") $("#grnNewBarcode").val(grnFreshBarcode());
    let missing = ["#grnQty", "#grnUnitCost", "#grnSellPrice"].find((sel) => $.trim($(sel).val()) === "");
    $(missing || "#grnAddLine").trigger("focus");
  });

  // a barcode scanner types the code and presses Enter: then fill in what is
  // still missing, or add the line when everything is there
  $("#grnNewBarcode").on("keydown", function (e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    let missing = ["#grnQty", "#grnUnitCost", "#grnSellPrice"].find((sel) => $.trim($(sel).val()) === "");
    if (missing) $(missing).trigger("focus");
    else addGrnLine();
  });

  $("#grnQty, #grnUnitCost, #grnSellPrice").on("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault(); // add the line, don't save the GRN
      addGrnLine();
    }
  });

  $("#grn_lines")
    .on("input", ".grn-line-qty, .grn-line-cost, .grn-line-sell", function () {
      let i = parseInt($(this).closest("tr").data("index"));
      let line = grnLines[i];
      if (!line) return;
      let val = $.trim($(this).val());
      if ($(this).hasClass("grn-line-qty")) line.quantity = val === "" ? "" : Number(val);
      else if ($(this).hasClass("grn-line-sell")) {
        line.selling_price = val === "" ? "" : Number(val);
        line.sell_typed = true;
      } else {
        line.unit_cost = val === "" ? "" : Number(val);
        // a new product's price follows the cost (same margin) until one is typed
        let t = grnLineTarget(line.product_id, line.unit_cost);
        if (t.kind === "new" && !line.sell_typed) {
          let sell = grnSuggestedPrice(t.product.cost_price, t.product.price, line.unit_cost);
          line.selling_price = sell;
          $(this).closest("tr").find(".grn-line-sell").val(sell === "" ? "" : Number(sell).toFixed(2));
        }
      }
      updateGrnTotals(); // where the goods go, and the price that goes with it
    })
    .on("input", ".grn-line-barcode", function () {
      let line = grnLines[parseInt($(this).closest("tr").data("index"))];
      if (!line) return;
      line.new_barcode = $.trim($(this).val());
      updateGrnTotals();
    })
    // a line's Fill button: a barcode for its new product when the box is empty
    .on("click", ".grn-line-fill", function () {
      let line = grnLines[parseInt($(this).closest("tr").data("index"))];
      let $input = $(this).closest(".grn-line-barcode-box").find(".grn-line-barcode");
      if (!line || $.trim($input.val()) !== "") return;
      line.new_barcode = grnFreshBarcode();
      $input.val(line.new_barcode);
      updateGrnTotals();
    })
    .on("keydown", "input", function (e) {
      if (e.key === "Enter") e.preventDefault(); // a scanner's Enter doesn't save the GRN
    })
    .on("click", ".grn-line-remove", function () {
      grnLines.splice(parseInt($(this).closest("tr").data("index")), 1);
      renderGrnLines();
    });

  $("#saveGrn").on("submit", function (e) {
    e.preventDefault();
    let supplierId = parseInt($("#grnSupplier").val()) || 0;
    let paidBy = $("#grnPaidBy").val();
    let date = $("#grnDate").val();

    if (!date) {
      Swal.fire("Oops!", "Please enter the received date.", "warning");
      return;
    }
    if (!grnLines.length) {
      Swal.fire("Oops!", "Please add at least one product to the GRN.", "warning");
      return;
    }
    let bad = grnLines.find((l) => !grnLineValid(l));
    if (bad) {
      Swal.fire("Oops!", `Please check "${bad.name}": the quantity must be a whole number of at least 1, the unit cost 0 or more, and a new product needs its selling price.`, "warning");
      return;
    }
    let needsPrice = grnLines.map(grnNewPriceProblem).find(Boolean);
    if (needsPrice) {
      Swal.fire("Selling price needed", needsPrice, "warning");
      return;
    }
    let codeProblem = grnLines
      .filter((l) => grnLineTarget(l.product_id, l.unit_cost).kind === "new")
      .map((l) => grnNewBarcodeProblem(l.new_barcode, l))
      .find(Boolean);
    if (codeProblem) {
      Swal.fire("Barcode already used", codeProblem, "warning");
      return;
    }
    let newProducts = grnLines.filter((l) => grnLineTarget(l.product_id, l.unit_cost).kind === "new").length;
    if (paidBy === "Credit" && !supplierId) {
      Swal.fire("Oops!", "Credit is only possible with a registered supplier.", "warning");
      return;
    }

    let total = supRound(grnLines.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_cost), 0));
    let units = grnLines.reduce((s, l) => s + Number(l.quantity), 0);
    let split = grnAdvanceSplit();
    let paymentText =
      split.used > 0
        ? split.due > 0
          ? "Advance " + supMoney(split.used) + " + " + paidBy + " " + supMoney(split.due)
          : "Paid from the supplier's advance"
        : paidBy;
    let supplierName = supplierId
      ? $("#grnSupplier option:selected").text()
      : $.trim($("#grnWalkInName").val()) || "Walk-in seller";
    let payload = {
      supplier_id: supplierId,
      walk_in_name: supplierId ? "" : $.trim($("#grnWalkInName").val()),
      received_date: date,
      payment_method: paidBy,
      note: $.trim($("#grnNote").val()),
      created_by: user?.fullname || "",
      created_by_id: user?._id || "",
      items: grnLines.map((l) => ({
        product_id: l.product_id,
        quantity: Number(l.quantity),
        unit_cost: Number(l.unit_cost),
        // only used for a new product (goods at a new cost price)
        selling_price: grnLineTarget(l.product_id, l.unit_cost).kind === "new" ? Number(l.selling_price) : null,
        // a new product's barcode, typed or scanned (empty = one is made)
        new_barcode: grnLineTarget(l.product_id, l.unit_cost).kind === "new" ? String(l.new_barcode || "").trim() : "",
      })),
    };

    Swal.fire({
      title: "Save this GRN?",
      icon: "question",
      html: `<p><b>${txnHtml(supplierName)}</b> · ${supDate(date)}</p>
        <p>${grnLines.length} ${grnLines.length === 1 ? "product" : "products"}, ${units} units · <b>${supMoney(total)}</b></p>
        <p>${txnHtml(paymentText)}</p>
        ${
          newProducts
            ? `<p><span class="label label-warning">${newProducts} new ${newProducts === 1 ? "product" : "products"}</span> for goods at a new cost price, each with its own selling price and barcode.</p>`
            : ""
        }
        <p class="text-muted" style="font-size: 13px;">Goods at a cost price a product already has go into that product's stock. A saved GRN can't be changed.</p>`,
      showCancelButton: true,
      confirmButtonText: "Save GRN",
    }).then(function (result) {
      if (!result.value) return;
      let $btn = $("#submitGrn").prop("disabled", true);
      $.ajax({
        url: api + "suppliers/grn",
        type: "POST",
        contentType: "application/json",
        data: JSON.stringify(payload),
      })
        .done(function (grn) {
          grnCache[grn._id] = grn;
          // like a sale: the GRN's bill comes up, ready to print
          showSupplierBillAfter("#grnModal", grnBillHtml(grn));
          loadSuppliersPage();
          $(document).trigger("products:changed"); // new stock on the till and in Products
        })
        .fail(function (xhr) {
          Swal.fire("Oops!", supError(xhr, "Could not save the GRN."), "warning");
          if (xhr && xhr.status >= 500) {
            // it may have been saved before the error (see the message): refresh
            loadSuppliersPage();
            $(document).trigger("products:changed");
          }
        })
        .always(function () {
          $btn.prop("disabled", false);
        });
    });
  });

  // ---- supplier payment ----
  $("#saveSupplierPayment").on("submit", function (e) {
    e.preventDefault();
    let s = supplierTxnData && supplierTxnData.supplier;
    if (!s) return;
    let amount = supRound($("#supPayAmount").val());
    if (!(amount > 0)) {
      Swal.fire("Oops!", "Please enter an amount greater than zero.", "warning");
      return;
    }
    if (!$("#supPayDate").val()) {
      Swal.fire("Oops!", "Please enter the payment date.", "warning");
      return;
    }
    let $btn = $("#submitSupplierPayment").prop("disabled", true);
    $.ajax({
      url: api + "suppliers/payments",
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({
        supplier_id: s._id,
        amount: amount,
        date: $("#supPayDate").val(),
        payment_method: $("#supPayMethod").val(),
        note: $.trim($("#supPayNote").val()),
        created_by: user?.fullname || "",
      }),
    })
      .done(function (payment) {
        // back to the supplier window (refreshed) if it was open, and the
        // payment's bill comes up, ready to print
        showSupplierBillAfter("#supplierPaymentModal", supplierPaymentBillHtml(payment));
        loadSuppliers();
      })
      .fail(function (xhr) {
        Swal.fire("Oops!", supError(xhr, "Could not save the payment."), "warning");
      })
      .always(function () {
        $btn.prop("disabled", false);
      });
  });
});

// ======================================================================
// Purchase Return Notes (PRN): goods sent back to a supplier
// The returned quantities come out of stock (api/suppliers.js POST /prn).
// The supplier refunds the money (Cash / Bank Transfer / Card), or it is
// deducted from what is owed to them ("Credit"): less owed, or, with nothing
// owed, an advance the next GRNs use first.
// ======================================================================
let allPrns = [];
let prnCache = {}; // id -> PRN
let prnDateFilter = null;
let prnProducts = []; // products offered in the PRN form
let prnLines = []; // lines of the PRN being entered

function loadPrns() {
  $.get(api + "suppliers/prns")
    .done(function (prns) {
      allPrns = prns || [];
      allPrns.forEach((r) => (prnCache[r._id] = r));
      renderPrns();
    })
    .fail(function () {
      Swal.fire("Oops!", "Could not load the purchase returns.", "warning");
    });
}

// "Cash refund" / "Deducted from balance"
function prnSettledText(method) {
  return method === "Credit" ? "Deducted from balance" : (method || "") + " refund";
}

function prnSettledHtml(method) {
  return method === "Credit"
    ? `<span class="label label-warning" title="Deducted from what is owed to the supplier">Deducted from balance</span>`
    : `<span class="label label-success">${txnHtml(method || "")} refund</span>`;
}

function filteredPrns() {
  let supplier = $("#prnSupplierFilter").val();
  let refund = $("#prnRefundFilter").val();
  return allPrns.filter(
    (r) =>
      (!prnDateFilter || prnDateFilter.matches(r.return_date)) &&
      (supplier === "" || supplier == null || String(r.supplier_id || 0) === supplier) &&
      (!refund || r.refund_method === refund)
  );
}

function prnsExportSubtitle() {
  let parts = [$("#prnDateRange .date-range-label").text() || "All dates"];
  if ($("#prnSupplierFilter").val() !== "") parts.push($("#prnSupplierFilter option:selected").text());
  if ($("#prnRefundFilter").val()) parts.push($("#prnRefundFilter option:selected").text());
  return parts.join("  ·  ");
}

function renderPrns() {
  let list = filteredPrns();
  let total = 0, refunded = 0, credited = 0, units = 0;
  list.forEach((r) => {
    total += Number(r.total) || 0;
    if (r.refund_method === "Credit") credited += Number(r.total) || 0;
    else refunded += Number(r.total) || 0;
    units += Number(r.total_quantity) || 0;
  });
  $("#prnsTotal").text(supMoney(total));
  $("#prnsTotalNote").text(list.length + (list.length === 1 ? " PRN" : " PRNs"));
  $("#prnsRefunded").text(supMoney(refunded));
  $("#prnsCredited").text(supMoney(credited));
  $("#prnsUnits").text(units);
  $("#prnsTabCount").text(allPrns.length);

  let rows = list
    .map(
      (r) => `<tr>
        <td class="nobr" data-order="${Number(r.seq) || 0}"><b>${txnHtml(r.prn_no)}</b>${r.grn_ref ? `<br><small class="text-muted">for ${txnHtml(r.grn_ref)}</small>` : ""}</td>
        <td class="nobr" data-order="${txnHtml(r.return_date)}">${supDate(r.return_date)}</td>
        <td data-export="${txnHtml(r.supplier_name)}">${txnHtml(r.supplier_name)}${
          r.walk_in ? ' <span class="label label-default">Walk-in</span>' : ""
        }${r.note ? `<br><small class="text-muted">${txnHtml(r.note)}</small>` : ""}</td>
        <td class="text-right">${r.item_count || (r.items || []).length}</td>
        <td class="text-right">${r.total_quantity || 0}</td>
        <td class="text-right nobr" data-order="${Number(r.total) || 0}">${supMoney(r.total)}</td>
        <td data-export="${txnHtml(prnSettledText(r.refund_method))}">${prnSettledHtml(r.refund_method)}</td>
        <td>${txnHtml(r.created_by || "")}</td>
        <td><button onClick="$(this).viewPrn(${r._id})" class="btn btn-info btn-sm" title="PRN bill"><i class="fa fa-print"></i></button></td>
      </tr>`
    )
    .join("");

  if ($.fn.DataTable.isDataTable("#prnList")) $("#prnList").DataTable().destroy();
  $("#prn_list").html(rows);
  $("#prnList").DataTable(
    Object.assign(
      standardTableOptions({
        noun: "PRNs",
        searchPlaceholder: "Search PRNs...",
        exportTitle: "Purchase Returns",
        exportColumns: [0, 1, 2, 3, 4, 5, 6, 7],
        sumColumns: [4, 5],
        exportSubtitle: prnsExportSubtitle,
        actionColumns: [8],
        emptyTable: allPrns.length ? "No PRNs match the filters" : "No purchase returns yet - click New PRN",
      }),
      { order: [[1, "desc"], [0, "desc"]] }
    )
  );
}

// ---- the PRN form ----
function prnProduct(id) {
  return prnProducts.find((p) => String(p._id) === String(id));
}

// how many of a product the lines already return (the stock check)
function prnQtyOf(productId, exceptLine) {
  return prnLines.reduce(
    (s, l) => s + (l !== exceptLine && String(l.product_id) === String(productId) ? Number(l.quantity) || 0 : 0),
    0
  );
}

function openPrnForm(supplierId) {
  $.get(api + "inventory/products")
    .done(function (products) {
      // products with stock to send back (and those that don't track stock)
      prnProducts = (products || [])
        .filter((p) => p.stock != 1 || (parseInt(p.quantity) || 0) > 0)
        .sort(
          (a, b) =>
            String(a.name || "").localeCompare(String(b.name || "")) ||
            (parseFloat(a.cost_price) || 0) - (parseFloat(b.cost_price) || 0)
        );
      if (!prnProducts.length) {
        Swal.fire("Nothing to return", "No product has stock to send back.", "info");
        return;
      }
      // the GRNs for the optional "GRN No" (fresh, newest first; the ones
      // already loaded if that fails)
      $.when($.get(api + "suppliers/grns"), $.get(api + "suppliers/prns"))
        .done(function (grns, prns) {
          prnGrns = Array.isArray(grns[0]) ? grns[0] : [];
          prnExisting = Array.isArray(prns[0]) ? prns[0] : [];
        })
        .fail(function () {
          prnGrns = allGrns.slice();
          prnExisting = allPrns.slice();
        })
        .always(function () {
          loadSuppliers(function () {
            preparePrnForm(supplierId);
            if ($("#supplierTransactionsModal").hasClass("in")) {
              supSwapModal("#supplierTransactionsModal", "#prnModal", refreshSupplierTransactions);
            } else {
              $("#prnModal").modal("show");
            }
          });
        });
    })
    .fail(function () {
      Swal.fire("Oops!", "Could not load the products.", "warning");
    });
}

function preparePrnForm(supplierId) {
  prnLines = [];
  $("#savePrn").get(0).reset();
  fillSupplierSelects();
  $("#prnSupplier").val(String(supplierId || 0));
  $("#prnDate").val(moment().format("YYYY-MM-DD"));
  $(".grn-currency").text(settings?.symbol ? "(" + settings.symbol + ")" : "");
  $("#prnRefund").prop("disabled", false);
  updatePrnSupplierUi(); // also fills the GRN list
  onPrnGrnChange(); // no GRN yet: every product, any settlement
  renderPrnLines();
}

// ---- a PRN against a GRN ----
// The GRN picked (optional): only its products can go back, at the unit cost
// paid on it, and no more than it brought in minus what earlier PRNs already
// returned against it. A GRN bought on credit is covered by the return: it
// is deducted from the supplier's balance (not refunded).
let prnExisting = []; // all PRNs (what was already returned against each GRN)

function prnSelectedGrn() {
  let no = $("#prnGrnRef").val();
  return no ? prnGrns.find((g) => g.grn_no === no) || null : null;
}

// product id -> { product_id, name, unit_cost, received, returned, left }
function prnGrnReturnable(grn) {
  let out = {};
  (grn.items || []).forEach((i) => {
    let e = (out[i.product_id] = out[i.product_id] || { product_id: i.product_id, name: i.product_name, unit_cost: i.unit_cost, received: 0, returned: 0 });
    e.received += Number(i.quantity) || 0;
  });
  prnExisting
    .filter((r) => r.grn_ref === grn.grn_no)
    .forEach((r) =>
      (r.items || []).forEach((i) => {
        if (out[i.product_id]) out[i.product_id].returned += Number(i.quantity) || 0;
      })
    );
  Object.values(out).forEach((e) => (e.left = Math.max(e.received - e.returned, 0)));
  return out;
}

// the product list: the GRN's products (with what can still go back), or
// every product with stock
function fillPrnProductOptions() {
  let grn = prnSelectedGrn();
  let returnable = grn ? prnGrnReturnable(grn) : null;
  let list = grn
    ? Object.values(returnable).map((e) => Object.assign({}, prnProduct(e.product_id) || { _id: e.product_id, name: e.name, stock: 0 }, { grn: e }))
    : prnProducts;
  $("#prnProduct").html(
    `<option value=""></option>` +
      list
        .map((p) => {
          let barcode = p.barcode != null && String(p.barcode) !== "NaN" ? String(p.barcode) : "";
          let parts;
          if (p.grn) {
            parts = ["cost " + supMoney(p.grn.unit_cost), "received " + p.grn.received];
            if (p.grn.returned) parts.push(p.grn.returned + " returned");
            parts.push("can return " + p.grn.left);
          } else {
            let cost = parseFloat(p.cost_price);
            parts = [isNaN(cost) ? "no cost yet" : "cost " + supMoney(cost)];
          }
          if (p.stock == 1) parts.push("stock " + (parseInt(p.quantity) || 0));
          if (barcode) parts.push(barcode);
          let none = p.grn && (p.grn.left < 1 || !prnProduct(p._id));
          return `<option value="${p._id}"${none ? " disabled" : ""}>${txnHtml(p.name)} — ${txnHtml(parts.join(" · "))}</option>`;
        })
        .join("")
  );
  if ($("#prnProduct").data("chosen")) $("#prnProduct").trigger("chosen:updated");
}

// a GRN picked or cleared: products, settlement and the note follow it
function onPrnGrnChange() {
  let grn = prnSelectedGrn();
  fillPrnProductOptions();
  $("#prnQty, #prnUnitCost").val("");
  let $refund = $("#prnRefund");
  let $info = $(".prn-grn-info");
  if (!grn) {
    $refund.prop("disabled", false);
    $info.hide();
  } else if (grn.payment_method === "Credit") {
    // the return covers the credit GRN
    $refund.val("Credit").prop("disabled", true);
    $info
      .html(
        `<i class="fa fa-info-circle"></i> <b>${txnHtml(grn.grn_no)}</b> was on <b>credit</b>: the goods returned are <b>deducted from what ${txnHtml(grn.supplier_name)} is owed</b>, not refunded.`
      )
      .show();
  } else {
    $refund.prop("disabled", false);
    // suggest settling the way the GRN was paid
    let suggested = grn.payment_method === "Advance" ? "Credit" : grn.payment_method;
    if ($refund.find(`option[value="${suggested}"]`).length && !$refund.find(`option[value="${suggested}"]`).prop("disabled")) $refund.val(suggested);
    $info
      .html(
        `<i class="fa fa-info-circle"></i> Returning against <b>${txnHtml(grn.grn_no)}</b> (paid by ${txnHtml(grn.payment_method === "Advance" ? "the supplier's advance" : grn.payment_method)}): only its products, at the cost paid on it.`
      )
      .show();
  }
  updatePrnTotals();
}

// a line that doesn't fit the GRN picked: the message, or ""
function prnGrnProblem(l) {
  let grn = prnSelectedGrn();
  if (!grn) return "";
  let e = prnGrnReturnable(grn)[l.product_id];
  if (!e) return `"${l.name}" isn't on ${grn.grn_no}. Remove it, or clear the GRN.`;
  let total = prnQtyOf(l.product_id);
  if (total > e.left) {
    return `${grn.grn_no} brought in ${e.received} of "${l.name}"${e.returned ? ", " + e.returned + " already returned" : ""}, so at most ${e.left} can go back (the lines return ${total}).`;
  }
  return "";
}

// walk-in seller: a name box, and the money can only be refunded
function updatePrnSupplierUi() {
  let walkIn = $("#prnSupplier").val() === "0";
  $(".prn-walkin-group").toggle(walkIn);
  $('#prnRefund option[value="Credit"]').prop("disabled", walkIn);
  if (walkIn && $("#prnRefund").val() === "Credit") $("#prnRefund").val("Cash");
  $(".prn-credit-hint").toggle(walkIn);
  fillPrnGrnOptions();
  updatePrnBalanceInfo();
}

// The optional GRN the goods came with: a searchable list of the chosen
// supplier's GRNs (walk-in sellers' GRNs for a walk-in seller), newest first.
// Keeps the GRN picked if it still belongs to the supplier.
let prnGrns = [];

// The GRN list sits low in the form (below the lines): it opens upwards when
// there isn't room for it below, so no GRN is cut off at the bottom.
function placePrnGrnDrop() {
  let $box = $("#prnGrnRef_chosen");
  if (!$box.length) return;
  $box.removeClass("chosen-dropup");
  let rect = $box[0].getBoundingClientRect();
  let dropHeight = ($box.find(".chosen-drop").outerHeight() || 0) + 8;
  let below = window.innerHeight - rect.bottom;
  let above = rect.top;
  if (dropHeight > below && above > below) $box.addClass("chosen-dropup");
}

function fillPrnGrnOptions() {
  let supplier = String($("#prnSupplier").val() || "0");
  let $select = $("#prnGrnRef");
  let picked = $select.val();
  let list = prnGrns.filter((g) => String(g.supplier_id || 0) === supplier);
  $select.html(
    `<option value=""></option>` +
      list
        .map((g) => {
          let parts = [supDate(g.received_date), supMoney(g.total), journalCount(g.item_count || (g.items || []).length, "product", "products")];
          if (g.walk_in) parts.splice(1, 0, g.supplier_name || "Walk-in seller");
          return `<option value="${txnHtml(g.grn_no)}">${txnHtml(g.grn_no)} — ${txnHtml(parts.join(" · "))}</option>`;
        })
        .join("")
  );
  if (picked && list.some((g) => g.grn_no === picked)) $select.val(picked);
  else $select.val("");
  let changed = ($select.val() || "") !== (picked || "");

  // say whose GRNs are listed: only the supplier picked (short, as the field
  // shares its row; the full text shows on hover)
  let who = supplier === "0" ? "walk-in sellers" : $("#prnSupplier option:selected").text();
  let whose = supplier === "0" ? "walk-in sellers'" : who + "'s";
  let forText =
    supplier === "0"
      ? list.length ? journalCount(list.length, "walk-in GRN", "walk-in GRNs") : "no walk-in GRNs"
      : list.length ? journalCount(list.length, "GRN", "GRNs") + " from " + who : "no GRNs from " + who;
  $("#prnGrnFor")
    .text(forText)
    .attr("title", list.length ? journalCount(list.length, "GRN", "GRNs") + " from " + who : "No GRNs from " + who);
  let placeholder = list.length ? "Search " + whose + " GRNs (optional)" : "No GRNs from " + who;
  $select.attr("data-placeholder", placeholder);
  if ($select.data("chosen")) {
    $select.trigger("chosen:updated");
    // the placeholder text follows the supplier
    if (!$select.val()) $select.next(".chosen-container").find(".chosen-single > span").text(placeholder);
  }
  if (changed || !$("#prnProduct option").length) onPrnGrnChange();
}

function prnFormTotal() {
  return supRound(prnLines.reduce((s, l) => s + (prnLineValid(l) ? Number(l.quantity) * Number(l.unit_cost) : 0), 0));
}

// what a deduction does to the supplier's balance
function updatePrnBalanceInfo() {
  let supplier = allSuppliers.find((s) => String(s._id) === $("#prnSupplier").val());
  let total = prnFormTotal();
  if (!supplier || $("#prnRefund").val() !== "Credit" || !(total > 0)) {
    $(".prn-balance-info").hide();
    return;
  }
  let position = (Number(supplier.balance) || 0) - (Number(supplier.advance) || 0);
  let after = supRound(position - total);
  let now = position > 0.004 ? "owed " + supMoney(position) : position < -0.004 ? "advance " + supMoney(-position) : "nothing owed";
  let then =
    after > 0.004
      ? "<b>" + supMoney(after) + "</b> still owed"
      : after < -0.004
      ? "the supplier holds an advance of <b>" + supMoney(-after) + "</b>, used by the next GRNs"
      : "nothing owed";
  $(".prn-balance-info")
    .html(`<i class="fa fa-info-circle"></i> ${txnHtml(supplier.name)}: ${now} now. After deducting ${supMoney(total)}: ${then}.`)
    .show();
}

function prnLineValid(l) {
  return Number.isInteger(Number(l.quantity)) && Number(l.quantity) >= 1 && l.unit_cost !== "" && Number(l.unit_cost) >= 0;
}

// a line returning more than the product has in stock: the message, or ""
function prnStockProblem(l) {
  let p = prnProduct(l.product_id);
  if (!p || p.stock != 1) return "";
  let stock = parseInt(p.quantity) || 0;
  let total = prnQtyOf(l.product_id);
  return total > stock ? `Only ${stock} of "${p.name}" in stock, but the lines return ${total}.` : "";
}

function updatePrnTotals() {
  let qty = 0, total = 0;
  prnLines.forEach((l, i) => {
    let valid = prnLineValid(l);
    let lineTotal = valid ? supRound(Number(l.quantity) * Number(l.unit_cost)) : 0;
    if (valid) {
      qty += Number(l.quantity);
      total += lineTotal;
    }
    let $row = $(`#prn_lines tr[data-index="${i}"]`);
    $row.find(".grn-line-total").text(valid ? supMoney(lineTotal) : "-");
    let p = prnProduct(l.product_id);
    let problem = prnGrnProblem(l) || prnStockProblem(l);
    $row.find(".prn-line-after").html(
      p && p.stock == 1 && valid
        ? problem
          ? `<span class="text-danger" title="${txnHtml(problem)}">${prnGrnProblem(l) ? "check GRN" : "not enough"}</span>`
          : "→ " + ((parseInt(p.quantity) || 0) - prnQtyOf(l.product_id))
        : ""
    );
  });
  $("#prnTotalQty").text(qty);
  $("#prnTotal").text(supMoney(total));
  updatePrnBalanceInfo();
}

function renderPrnLines() {
  if (!prnLines.length) {
    $("#prn_lines").html(
      `<tr class="grn-empty"><td colspan="6">No products yet. Choose a product above, enter the quantity going back and its unit cost, then click Add.</td></tr>`
    );
  } else {
    $("#prn_lines").html(
      prnLines
        .map((l, i) => {
          let p = prnProduct(l.product_id) || {};
          let code = p.barcode != null && String(p.barcode) !== "NaN" ? String(p.barcode) : "";
          return `<tr data-index="${i}">
            <td><b>${txnHtml(l.name)}</b>${code ? `<br><small class="text-muted">${txnHtml(code)}</small>` : ""}</td>
            <td class="text-right nobr">${p.stock == 1 ? parseInt(p.quantity) || 0 : '<span class="text-muted">not tracked</span>'}
              <br><small class="text-danger prn-line-after"></small></td>
            <td><input type="number" class="form-control prn-line-qty" min="1" step="1" value="${txnHtml(l.quantity)}"></td>
            <td><input type="text" inputmode="decimal" autocomplete="off" class="form-control amount-input prn-line-cost" value="${txnHtml(amountInputText(l.unit_cost))}"></td>
            <td class="text-right nobr grn-line-total"></td>
            <td><button type="button" class="btn btn-danger btn-sm prn-line-remove" title="Remove"><i class="fa fa-times"></i></button></td>
          </tr>`;
        })
        .join("")
    );
  }
  updatePrnTotals();
}

function addPrnLine() {
  let p = prnProduct($("#prnProduct").val());
  let qty = Number($("#prnQty").val());
  let costText = $.trim($("#prnUnitCost").val());
  let cost = Number(costText);
  if (!p) {
    Swal.fire("Oops!", "Please choose a product.", "warning");
    return;
  }
  if (!Number.isInteger(qty) || qty < 1) {
    Swal.fire("Oops!", "Please enter the quantity going back (a whole number of at least 1).", "warning");
    return;
  }
  if (costText === "" || !(cost >= 0)) {
    Swal.fire("Oops!", "Please enter the unit cost (0 or more).", "warning");
    return;
  }
  let grn = prnSelectedGrn();
  if (grn) {
    let e = prnGrnReturnable(grn)[p._id];
    if (!e) {
      Swal.fire("Not on this GRN", `"${p.name}" isn't on ${grn.grn_no}.`, "warning");
      return;
    }
    if (prnQtyOf(p._id) + qty > e.left) {
      Swal.fire(
        "Too many",
        `${grn.grn_no} brought in ${e.received} of "${p.name}"${e.returned ? ", " + e.returned + " already returned" : ""}` +
          (prnQtyOf(p._id) ? `, ${prnQtyOf(p._id)} already on this PRN` : "") +
          `: at most ${Math.max(e.left - prnQtyOf(p._id), 0)} more can go back.`,
        "warning"
      );
      return;
    }
  }
  if (p.stock == 1) {
    let stock = parseInt(p.quantity) || 0;
    if (prnQtyOf(p._id) + qty > stock) {
      Swal.fire("Not enough stock", `Only ${stock} of "${p.name}" in stock` + (prnQtyOf(p._id) ? ` (${prnQtyOf(p._id)} already on this PRN).` : "."), "warning");
      return;
    }
  }
  let existing = prnLines.find((l) => String(l.product_id) === String(p._id) && supRound(l.unit_cost) === supRound(cost));
  if (existing) existing.quantity = (Number(existing.quantity) || 0) + qty;
  else prnLines.push({ product_id: p._id, name: p.name, quantity: qty, unit_cost: supRound(cost) });

  $("#prnProduct").val("").trigger("chosen:updated");
  $("#prnQty, #prnUnitCost").val("");
  renderPrnLines();
  $("#prnProduct").trigger("chosen:activate");
}

// ---- the PRN bill (like the GRN bill) ----
function prnBillHtml(r) {
  let items = (r.items || [])
    .map(
      (i) => `<tr>
        <td>${txnHtml(i.product_name)}</td>
        <td style="padding: 0 6px;">${i.quantity}</td>
        <td style="padding: 0 6px; white-space: nowrap;">${supMoney(i.unit_cost)}</td>
        <td style="text-align: right; white-space: nowrap;">${supMoney(i.total)}</td>
      </tr>`
    )
    .join("");
  let settle =
    r.refund_method === "Credit"
      ? supBillRow("Deducted from supplier's balance", "<b>" + supMoney(r.total) + "</b>")
      : supBillRow("Refunded by " + txnHtml(r.refund_method), "<b>" + supMoney(r.total) + "</b>");
  let balance = !r.walk_in && r.position_after != null ? supBillRow("Supplier balance now", "<b>" + supBillPositionText(r.position_after) + "</b>") : "";
  return `<div style="font-size: 10px;">
    ${supBillHeader("PURCHASE RETURN NOTE")}
    <p>
      PRN No : <b>${txnHtml(r.prn_no)}</b> <br>
      Returned to : ${txnHtml(r.supplier_name)}${r.walk_in ? " (Walk-in)" : ""} <br>
      Return date : ${supDate(r.return_date)} <br>
      ${r.grn_ref ? "GRN : " + txnHtml(r.grn_ref) + " <br>" : ""}
      Returned by : ${txnHtml(r.created_by || "-")} <br>
      Date : ${moment(r.created_at).format("DD MMM YYYY HH:mm:ss")}
    </p>
    <hr>
    <table width="100%">
      <thead style="text-align: left;">
        <tr><th>Item</th><th style="padding: 0 6px;">Qty</th><th style="padding: 0 6px;">Cost</th><th style="text-align: right;">Total</th></tr>
      </thead>
      <tbody>
        ${items}
        <tr><td colspan="4"><hr style="margin: 4px 0;"></td></tr>
        ${supBillRow("Products / Units", (r.item_count || (r.items || []).length) + " / " + (r.total_quantity || 0))}
        ${supBillRow("Total", supMoney(r.total), true)}
        ${settle}
        ${balance}
      </tbody>
    </table>
    ${r.note ? "<p>Reason : " + txnHtml(r.note) + "</p>" : ""}
    <hr>
    ${supBillSignatures("Returned by", "Received by (Supplier)")}
  </div>`;
}

// PRN bill: from the PRN list, the supplier window and the Quick Journal
$.fn.viewPrn = function (id) {
  if (prnCache[id]) return showSupplierBill(prnBillHtml(prnCache[id]));
  $.get(api + "suppliers/prn/" + id)
    .done(function (r) {
      prnCache[r._id] = r;
      showSupplierBill(prnBillHtml(r));
    })
    .fail(function (xhr) {
      Swal.fire("Oops!", supError(xhr, "Could not load the PRN."), "warning");
    });
};

$(function () {
  prnDateFilter = initDateRangeFilter("#prnDateRange", renderPrns);
  $("#prnSupplierFilter, #prnRefundFilter").on("change", renderPrns);

  $("#newPrnBtn").on("click", function () {
    openPrnForm(0);
  });
  // from the supplier window: a return to that supplier
  $("#supTxnPrnBtn").on("click", function () {
    if (supplierTxnData) openPrnForm(supplierTxnData.supplier._id);
  });
  $("#prnSupplier").on("change", updatePrnSupplierUi);
  $("#prnRefund").on("change", updatePrnBalanceInfo);
  $("#prnGrnRef").on("change", onPrnGrnChange);

  $("#prnModal").on("shown.bs.modal", function () {
    if (!$("#prnProduct").data("chosen")) {
      $("#prnProduct").chosen({ width: "100%", search_contains: true, no_results_text: "No product matches" });
    }
    // the optional GRN: searchable, and can be cleared (x)
    if (!$("#prnGrnRef").data("chosen")) {
      $("#prnGrnRef")
        .chosen({ width: "100%", search_contains: true, allow_single_deselect: true, no_results_text: "No GRN matches" })
        .on("chosen:showing_dropdown", placePrnGrnDrop);
    }
    fillPrnGrnOptions();
    $("#prnProduct").trigger("chosen:updated").trigger("chosen:activate");
  });

  // a product chosen: its cost price is what the supplier gives back per unit
  $("#prnProduct").on("change", function () {
    let p = prnProduct($(this).val());
    if (!p) return;
    let grn = prnSelectedGrn();
    let fromGrn = grn ? prnGrnReturnable(grn)[p._id] : null;
    let cost = fromGrn ? Number(fromGrn.unit_cost) : parseFloat(p.cost_price);
    $("#prnUnitCost").val(isNaN(cost) ? "" : cost.toFixed(2));
    setTimeout(() => $("#prnQty").trigger("focus"), 0);
  });
  $("#prnAddLine").on("click", addPrnLine);
  $("#prnQty, #prnUnitCost").on("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault(); // add the line, don't save the PRN
      addPrnLine();
    }
  });

  $("#prn_lines")
    .on("input", ".prn-line-qty, .prn-line-cost", function () {
      let line = prnLines[parseInt($(this).closest("tr").data("index"))];
      if (!line) return;
      let val = $.trim($(this).val());
      if ($(this).hasClass("prn-line-qty")) line.quantity = val === "" ? "" : Number(val);
      else line.unit_cost = val === "" ? "" : Number(val);
      updatePrnTotals();
    })
    .on("keydown", "input", function (e) {
      if (e.key === "Enter") e.preventDefault();
    })
    .on("click", ".prn-line-remove", function () {
      prnLines.splice(parseInt($(this).closest("tr").data("index")), 1);
      renderPrnLines();
    });

  $("#savePrn").on("submit", function (e) {
    e.preventDefault();
    let supplierId = parseInt($("#prnSupplier").val()) || 0;
    let refund = $("#prnRefund").val();
    let date = $("#prnDate").val();
    if (!date) {
      Swal.fire("Oops!", "Please enter the return date.", "warning");
      return;
    }
    if (!prnLines.length) {
      Swal.fire("Oops!", "Please add at least one product to return.", "warning");
      return;
    }
    let bad = prnLines.find((l) => !prnLineValid(l));
    if (bad) {
      Swal.fire("Oops!", `Please check "${bad.name}": the quantity must be a whole number of at least 1 and the unit cost 0 or more.`, "warning");
      return;
    }
    let grnProblem = prnLines.map(prnGrnProblem).find(Boolean);
    if (grnProblem) {
      Swal.fire("Check the GRN", grnProblem, "warning");
      return;
    }
    let stockProblem = prnLines.map(prnStockProblem).find(Boolean);
    if (stockProblem) {
      Swal.fire("Not enough stock", stockProblem, "warning");
      return;
    }
    if (refund === "Credit" && !supplierId) {
      Swal.fire("Oops!", "Only a registered supplier's balance can be reduced.", "warning");
      return;
    }

    let total = prnFormTotal();
    let units = prnLines.reduce((s, l) => s + Number(l.quantity), 0);
    let supplierName = supplierId ? $("#prnSupplier option:selected").text() : $.trim($("#prnWalkInName").val()) || "Walk-in seller";
    let payload = {
      supplier_id: supplierId,
      walk_in_name: supplierId ? "" : $.trim($("#prnWalkInName").val()),
      return_date: date,
      refund_method: refund,
      grn_ref: $.trim($("#prnGrnRef").val() || ""), // optional
      note: $.trim($("#prnNote").val()),
      created_by: user?.fullname || "",
      created_by_id: user?._id || "",
      items: prnLines.map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity), unit_cost: Number(l.unit_cost) })),
    };

    Swal.fire({
      title: "Save this PRN?",
      icon: "question",
      html: `<p>Return to <b>${txnHtml(supplierName)}</b> · ${supDate(date)}</p>
        <p>${prnLines.length} ${prnLines.length === 1 ? "product" : "products"}, ${units} units · <b>${supMoney(total)}</b></p>
        <p>${txnHtml(prnSettledText(refund))}</p>
        <p class="text-muted" style="font-size: 13px;">The stock of these products goes down by the quantities returned. A saved PRN can't be changed.</p>`,
      showCancelButton: true,
      confirmButtonText: "Save PRN",
      confirmButtonColor: "#d33",
    }).then(function (result) {
      if (!result.value) return;
      let $btn = $("#submitPrn").prop("disabled", true);
      $.ajax({ url: api + "suppliers/prn", type: "POST", contentType: "application/json", data: JSON.stringify(payload) })
        .done(function (prn) {
          prnCache[prn._id] = prn;
          // like a GRN: the bill comes up, ready to print
          showSupplierBillAfter("#prnModal", prnBillHtml(prn));
          loadSuppliersPage();
          $(document).trigger("products:changed"); // less stock on the till and in Products
        })
        .fail(function (xhr) {
          Swal.fire("Oops!", supError(xhr, "Could not save the PRN."), "warning");
          if (xhr && xhr.status >= 500) {
            loadSuppliersPage();
            $(document).trigger("products:changed");
          }
        })
        .always(function () {
          $btn.prop("disabled", false);
        });
    });
  });
});

// Pay button in the supplier list: straight to the payment window (paying
// what is owed, or in advance when nothing is owed)
$.fn.paySupplier = function (id) {
  $.get(api + "suppliers/transactions/" + id)
    .done(function (data) {
      supplierTxnData = data;
      openSupplierPayment();
    })
    .fail(function (xhr) {
      Swal.fire("Oops!", supError(xhr, "Could not load the supplier."), "warning");
    });
};

$.fn.viewSupplier = function (id) {
  openSupplierTransactions(id);
};

$.fn.editSupplier = function (id) {
  let s = allSuppliers.find((x) => x._id === id);
  if (s) openSupplierForm(s);
};

$.fn.deleteSupplier = function (id) {
  let s = allSuppliers.find((x) => x._id === id);
  if (!s) return;
  if (s.grn_count > 0 || s.prn_count > 0) {
    let parts = [];
    if (s.grn_count > 0) parts.push(s.grn_count + (s.grn_count === 1 ? " GRN" : " GRNs"));
    if (s.prn_count > 0) parts.push(s.prn_count + (s.prn_count === 1 ? " PRN" : " PRNs"));
    Swal.fire("Can't delete this supplier", `"${s.name}" has ${parts.join(" and ")}, which stay linked to it.`, "info");
    return;
  }
  Swal.fire({
    title: "Delete this supplier?",
    html: `<b>${txnHtml(s.name)}</b>`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#d33",
    confirmButtonText: "Yes, delete it",
  }).then(function (result) {
    if (!result.value) return;
    $.ajax({ url: api + "suppliers/supplier/" + id, type: "DELETE" })
      .done(function () {
        loadSuppliers();
      })
      .fail(function (xhr) {
        Swal.fire("Oops!", supError(xhr, "Could not delete the supplier."), "warning");
      });
  });
};

// GRN bill (print button in the GRN list and the supplier window)
$.fn.grnBill = function (id) {
  if (grnCache[id]) {
    showSupplierBill(grnBillHtml(grnCache[id]));
    return;
  }
  $.get(api + "suppliers/grn/" + id)
    .done(function (g) {
      grnCache[g._id] = g;
      showSupplierBill(grnBillHtml(g));
    })
    .fail(function (xhr) {
      Swal.fire("Oops!", supError(xhr, "Could not load the GRN."), "warning");
    });
};

// supplier payment / advance payment bill (print button in the supplier window)
$.fn.supplierPaymentBill = function (id) {
  let p = supplierTxnData && (supplierTxnData.payments || []).find((x) => x._id === id);
  if (p) showSupplierBill(supplierPaymentBillHtml(p));
};

$.fn.viewGrn = function (id) {
  let grn = grnCache[id];
  if (grn) {
    showGrn(grn);
    return;
  }
  $.get(api + "suppliers/grn/" + id)
    .done(function (g) {
      grnCache[g._id] = g;
      showGrn(g);
    })
    .fail(function (xhr) {
      Swal.fire("Oops!", supError(xhr, "Could not load the GRN."), "warning");
    });
};

// ======================================================================
// Quick Journal: everything that happened on a day in one list - sales,
// returns & exchanges, customer credit payments, expenses, GRNs and supplier
// payments - with the money in / out by method (api/journal.js). Opens on
// today; the arrows / date pick another day. Print gives a bill-style summary.
// ======================================================================
// A customer's credit payment receipt (Customers -> Transactions -> Payments,
// and the Quick Journal), shown in the sales bill window
function creditPaymentReceiptHtml(p) {
  let esc = (t) => $("<i>").text(t || "").html();
  let row = (label, value, strong) =>
    `<tr><td>${label}</td><td>:</td><td style="text-align:right">${strong ? "<b>" + value + "</b>" : value}</td></tr>`;
  return `<div style="font-size: 10px;">
        <p style="text-align: center;">
          ${settings.img ? '<img style="max-width: 100px;" src="' + img_path + settings.img + '" /><br>' : ""}
          <span style="font-size: 22px;">${settings.store || ""}</span> <br>
          ${settings.address_one || ""} <br>
          ${settings.address_two || ""} <br>
          ${settings.contact ? "Tel: " + settings.contact + "<br>" : ""}
        </p>
        <hr>
        <p style="text-align: center; font-size: 13px;"><b>CREDIT PAYMENT RECEIPT</b></p>
        <p>
          Receipt No : ${p.receipt_no || ""} <br>
          Customer : ${esc(p.customer_name)} <br>
          Received by : ${esc(p.user)} <br>
          Date : ${moment(p.date).format("DD MMM YYYY HH:mm:ss")}
        </p>
        <hr>
        <table width="100%">
          ${row("Balance before", supMoney(parseFloat(p.balance_before) || 0))}
          ${row("<h3 style='margin:4px 0'>Amount paid</h3>", "<h3 style='margin:4px 0'>" + supMoney(parseFloat(p.received ?? p.amount) || 0) + "</h3>")}
          ${parseFloat(p.advance_added) > 0 ? row("Applied to credit", supMoney(parseFloat(p.amount) || 0)) + row("Saved as advance", supMoney(parseFloat(p.advance_added)), true) : ""}
          ${row("Method", esc(p.method))}
          ${p.reference ? row("Reference", esc(p.reference)) : ""}
          ${row("Balance now", supMoney(parseFloat(p.balance_after) || 0), true)}
        </table>
        ${p.note ? "<p>Note: " + esc(p.note) + "</p>" : ""}
        <hr>
        <p style="text-align: center;">${settings.footer || "Thank you!"}</p>
      </div>`;
}

let journalData = null; // { from, to, entries, summary } of the day shown
let journalRequestId = 0;

const JOURNAL_TYPE_CSS = {
  sale: "label-primary",
  return: "label-danger",
  exchange: "label-warning",
  customer_credit_payment: "label-success",
  customer_advance: "label-success",
  expense: "label-default",
  grn: "label-info",
  supplier_credit_payment: "label-warning",
  supplier_advance: "label-warning",
  prn: "label-danger",
  adjustment: "label-inverse",
  transfer: "label-purple",
};

function canViewJournal() {
  return !!(user && (user._id === 1 || user.perm_journal == 1));
}

function applyJournalPermission() {
  let allowed = canViewJournal();
  $("#journalNav, #dayEndNav, #accountsNav").toggle(allowed);
  // permission taken away while the Accounts page is open: back to the till
  if (!allowed && $("#accounts_view").is(":visible")) $("#pointofsale").trigger("click");
  if (!allowed && $("#journalModal").hasClass("in")) $("#journalModal").modal("hide");
  if (!allowed && $("#dayEndModal").hasClass("in")) $("#dayEndModal").modal("hide");
}

function journalDay() {
  let d = moment($("#journalDate").val(), "YYYY-MM-DD", true);
  return d.isValid() ? d : moment().startOf("day");
}

function journalCount(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}

function openJournal() {
  if (!canViewJournal()) return;
  $("#journalDate").val(moment().format("YYYY-MM-DD"));
  $("#journalKind").val("");
  loadJournal();
  $("#journalModal").modal("show");
}

function loadJournal() {
  let day = journalDay();
  $("#journalDate").val(day.format("YYYY-MM-DD"));
  $("#journalDayLabel").text((day.isSame(moment(), "day") ? "Today, " : "") + day.format("dddd D MMM YYYY"));
  let requestId = ++journalRequestId;
  $.get(api + "journal", { from: day.format("YYYY-MM-DD") })
    .done(function (data) {
      if (requestId !== journalRequestId) return; // another day was asked for meanwhile
      journalData = data;
      renderJournal();
    })
    .fail(function (xhr) {
      if (requestId !== journalRequestId) return;
      Swal.fire("Oops!", supError(xhr, "Could not load the journal."), "warning");
    });
}

function renderJournal() {
  let s = journalData.summary;
  $("#jnSales").text(supMoney(s.sales.total));
  $("#jnSalesNote").text(
    journalCount(s.sales.count, "bill", "bills") +
      (s.sales.on_credit > 0 ? " · " + supMoney(s.sales.on_credit) + " on credit" : "")
  );
  $("#jnCreditIn").text(supMoney(s.credit_received.total));
  $("#jnCreditInNote").text(journalCount(s.credit_received.count, "payment", "payments") + " from customers");
  $("#jnAdvanceIn").text(supMoney(s.advance_received.total));
  $("#jnAdvanceInNote").text(
    journalCount(s.advance_received.count, "payment", "payments") +
      (s.advance_used.customers > 0 ? " · " + supMoney(s.advance_used.customers) + " used on bills" : "")
  );
  $("#jnCreditOut").text(supMoney(s.credit_paid.total));
  $("#jnCreditOutNote").text(journalCount(s.credit_paid.count, "payment", "payments") + " to suppliers");
  $("#jnAdvanceOut").text(supMoney(s.advance_paid.total));
  $("#jnAdvanceOutNote").text(
    journalCount(s.advance_paid.count, "payment", "payments") +
      (s.advance_used.suppliers > 0 ? " · " + supMoney(s.advance_used.suppliers) + " used by GRNs" : "")
  );
  $("#jnRefunds").text(supMoney(s.returns.refunded));
  $("#jnRefundsNote").text(
    journalCount(s.returns.count, "return", "returns") +
      (s.exchanges.count ? " · " + journalCount(s.exchanges.count, "exchange", "exchanges") : "")
  );
  $("#jnGrns").text(supMoney(s.grns.total));
  $("#jnGrnsNote").text(
    journalCount(s.grns.count, "GRN", "GRNs") +
      (s.grns.on_credit > 0 ? " · " + supMoney(s.grns.on_credit) + " on credit" : "") +
      (s.prns && s.prns.count ? " · " + supMoney(s.prns.total) + " returned" : "")
  );
  $("#jnExpenses").text(supMoney(s.expenses.total));
  $("#jnExpensesNote").text(journalCount(s.expenses.count, "expense", "expenses"));

  let rows = Object.keys(s.methods).map((m) => {
    let v = s.methods[m];
    return `<tr>
        <td>${txnHtml(m)}</td>
        <td class="text-right journal-in">${supMoney(v.in)}</td>
        <td class="text-right journal-out">${supMoney(v.out)}</td>
        <td class="text-right">${v.transfers ? (v.transfers > 0 ? "+" : "") + supMoney(v.transfers) : '<span class="text-muted">-</span>'}</td>
        <td class="text-right"><b>${supMoney(v.net)}</b></td>
      </tr>`;
  });
  rows.push(`<tr class="journal-total">
      <td>Total</td>
      <td class="text-right">${supMoney(s.money_in)}</td>
      <td class="text-right">${supMoney(s.money_out)}</td>
      <td class="text-right">${s.transfers && s.transfers.count ? supMoney(0) : '<span class="text-muted">-</span>'}</td>
      <td class="text-right ${s.net < 0 ? "text-danger" : ""}">${supMoney(s.net)}</td>
    </tr>`);
  $("#journalMethods").html(rows.join(""));

  renderJournalList();
}

function journalViewButton(e, index) {
  let title = {
    sale: "View the bill",
    return: "View the original bill",
    exchange: "View the original bill",
    grn: "GRN bill",
    customer_credit_payment: "Credit payment receipt",
    customer_advance: e.sale_id ? "View the bill" : "Credit payment receipt",
    supplier_credit_payment: "Payment bill",
    supplier_advance: "Payment bill",
    prn: "PRN bill",
    adjustment: "Adjustment note",
    transfer: "Transfer slip",
  }[e.kind];
  if (!title) return "";
  return `<button onClick="$(this).viewJournalEntry(${index})" class="btn btn-info btn-sm" title="${title}"><i class="fa fa-search-plus"></i></button>`;
}

function renderJournalList() {
  let kind = $("#journalKind").val();
  let entries = journalData.entries;
  let money = (v, css) =>
    v > 0
      ? `<td class="text-right nobr ${css}" data-order="${v}" data-export="${supMoney(v)}">${supMoney(v)}</td>`
      : `<td class="text-right" data-order="0" data-export=""><span class="text-muted">-</span></td>`;

  let rows = entries
    .map((e, index) => ({ e: e, index: index }))
    .filter(({ e }) => !kind || e.group === kind)
    .map(({ e, index }) => {
      let methodText = e.method + (e.on_credit > 0 ? " (" + supMoney(e.on_credit) + " on credit)" : "");
      return `<tr>
        <td class="nobr" data-order="${txnHtml(e.at)}">${
          e.time_known ? moment(e.at).format("hh:mm A") : '<span class="text-muted" title="Entered on another day">-</span>'
        }</td>
        <td class="nobr" data-export="${txnHtml(e.type)}"><span class="label ${JOURNAL_TYPE_CSS[e.kind] || "label-default"}">${txnHtml(e.type)}</span></td>
        <td>${txnHtml(e.reference)}</td>
        <td>${txnHtml(e.party)}</td>
        <td class="journal-details" data-export="${txnHtml(e.details)}">${txnHtml(e.details)}${
          e.user ? `${e.details ? "<br>" : ""}<small class="text-muted">by ${txnHtml(e.user)}</small>` : ""
        }</td>
        <td data-export="${txnHtml(methodText)}">${txnHtml(e.method)}${
          e.on_credit > 0 ? `<br><small class="text-warning">${supMoney(e.on_credit)} on credit</small>` : ""
        }</td>
        <td class="text-right nobr" data-order="${e.amount}">${supMoney(e.amount)}</td>
        ${money(e.money_in, "journal-in")}
        ${money(e.money_out, "journal-out")}
        <td>${journalViewButton(e, index)}</td>
      </tr>`;
    });

  if ($.fn.DataTable.isDataTable("#journalList")) $("#journalList").DataTable().destroy();
  $("#journal_list").html(rows.join(""));
  $("#journalList").DataTable(
    Object.assign(
      standardTableOptions({
        noun: "entries",
        searchPlaceholder: "Search the journal...",
        exportTitle: "Quick Journal",
        exportColumns: [0, 1, 2, 3, 4, 5, 6, 7, 8],
        sumColumns: [7, 8],
        exportSubtitle: () =>
          journalDay().format("dddd D MMM YYYY") +
          "   ·   In: " + supMoney(journalData.summary.money_in) +
          "   ·   Out: " + supMoney(journalData.summary.money_out) +
          "   ·   Net: " + supMoney(journalData.summary.net),
        actionColumns: [9],
        pageLength: 50,
        emptyTable: kind ? "No entries of this kind on this day" : "Nothing was recorded on this day",
      }),
      { order: [[0, "asc"]] }
    )
  );
}

// Bootstrap can't stack popups: the journal steps aside while a bill is open
// and comes back when the bill is closed
function journalShowBill(show) {
  $("#orderModal").one("hidden.bs.modal", function () {
    $("#journalModal").modal("show");
  });
  $("#journalModal").one("hidden.bs.modal", show);
  $("#journalModal").modal("hide");
}

$.fn.viewJournalEntry = function (index) {
  let e = journalData && journalData.entries[index];
  if (!e) return;
  let fail = (xhr) => Swal.fire("Oops!", supError(xhr, "Could not load it. It may have been deleted."), "warning");

  if (e.kind === "sale" || e.kind === "return" || e.kind === "exchange" || (e.kind === "customer_advance" && e.sale_id)) {
    let id = e.kind === "return" || e.kind === "exchange" ? e.order_id : e.id;
    $.get(api + encodeURIComponent(id))
      .done(function (t) {
        journalShowBill(() => $(document).viewTransaction(0, [t]));
      })
      .fail(fail);
  } else if ((e.kind === "customer_credit_payment" || e.kind === "customer_advance") && e.receipt) {
    let html = creditPaymentReceiptHtml(e.receipt);
    journalShowBill(function () {
      receipt = html;
      $("#viewTransaction").html(html);
      $("#orderModal").modal("show");
    });
  } else if (e.kind === "prn") {
    $.get(api + "suppliers/prn/" + e.id)
      .done(function (r) {
        prnCache[r._id] = r;
        journalShowBill(() => showSupplierBill(prnBillHtml(r)));
      })
      .fail(fail);
  } else if (e.kind === "transfer") {
    $.get(api + "transfers/transfer/" + e.id)
      .done(function (t) {
        journalShowBill(() => showSupplierBill(transferSlipHtml(t)));
      })
      .fail(fail);
  } else if (e.kind === "adjustment") {
    $.get(api + "adjustments/adjustment/" + e.id)
      .done(function (a) {
        adjCache[a._id] = a;
        journalShowBill(() => showSupplierBill(adjBillHtml(a)));
      })
      .fail(fail);
  } else if (e.kind === "grn") {
    $.get(api + "suppliers/grn/" + e.id)
      .done(function (g) {
        grnCache[g._id] = g;
        journalShowBill(() => showSupplierBill(grnBillHtml(g)));
      })
      .fail(fail);
  } else if (e.kind === "supplier_credit_payment" || e.kind === "supplier_advance") {
    $.get(api + "suppliers/transactions/" + e.supplier_id)
      .done(function (data) {
        let p = (data.payments || []).find((x) => x._id === e.id);
        if (!p) return fail(null);
        journalShowBill(() => showSupplierBill(supplierPaymentBillHtml(p)));
      })
      .fail(fail);
  }
};

// the day's summary, printed like a bill
function journalPrintHtml() {
  let s = journalData.summary;
  let row = supBillRow;
  let heading = (t) => `<tr><td colspan="4" style="padding-top: 6px;"><b>${t}</b></td></tr>`;
  let sub = (label, value) => row("&nbsp;&nbsp;" + label, value);

  let methods = Object.keys(s.methods)
    .map((m) => {
      let v = s.methods[m];
      return `<tr><td>${txnHtml(m)}</td><td style="text-align: right;">${supMoney(v.in)}</td><td style="text-align: right;">${supMoney(v.out)}</td><td style="text-align: right;">${v.transfers ? (v.transfers > 0 ? "+" : "") + supMoney(v.transfers) : "-"}</td><td style="text-align: right;"><b>${supMoney(v.net)}</b></td></tr>`;
    })
    .join("");

  let entries = journalData.entries
    .map((e) => {
      let flow = e.money_in > 0 ? "+" + supMoney(e.money_in) : e.money_out > 0 ? "-" + supMoney(e.money_out) : "-";
      return `<tr>
        <td style="vertical-align: top;">${e.time_known ? moment(e.at).format("HH:mm") : ""}</td>
        <td>${txnHtml(e.type)} ${txnHtml(e.reference)}${e.party ? "<br>" + txnHtml(e.party) : ""}</td>
        <td style="text-align: right; vertical-align: top;">${supMoney(e.amount)}</td>
        <td style="text-align: right; vertical-align: top;">${flow}</td>
      </tr>`;
    })
    .join("");

  return `<div style="font-size: 10px;">
    ${supBillHeader("QUICK JOURNAL")}
    <p>
      Date : <b>${journalDay().format("dddd D MMM YYYY")}</b> <br>
      Printed : ${moment().format("DD MMM YYYY HH:mm:ss")} <br>
      Printed by : ${txnHtml((user && user.fullname) || "")}
    </p>
    <hr>
    <table width="100%">
      <tbody>
        ${heading("SALES &amp; RECEIPTS")}
        ${row("Sales (" + journalCount(s.sales.count, "bill", "bills") + ")", supMoney(s.sales.total))}
        ${sub("Received now", supMoney(s.sales.received))}
        ${s.sales.on_credit > 0 ? sub("On credit", supMoney(s.sales.on_credit)) : ""}
        ${row("Credit received (" + s.credit_received.count + ")", supMoney(s.credit_received.total))}
        ${row("Advance received (" + s.advance_received.count + ")", supMoney(s.advance_received.total))}
        ${row("Refunds (" + journalCount(s.returns.count, "return", "returns") + ")", supMoney(s.returns.refunded))}
        ${s.exchanges.count ? row("Exchanges (" + s.exchanges.count + ")", supMoney(s.exchanges.total)) : ""}
        ${heading("PURCHASES &amp; PAYMENTS")}
        ${row("GRN purchases (" + s.grns.count + ")", supMoney(s.grns.total))}
        ${s.grns.count ? sub("Paid now", supMoney(s.grns.paid)) : ""}
        ${s.grns.on_credit > 0 ? sub("On credit", supMoney(s.grns.on_credit)) : ""}
        ${s.prns && s.prns.count ? row("Purchase returns (" + s.prns.count + ")", supMoney(s.prns.total)) : ""}
        ${s.prns && s.prns.refunded > 0 ? sub("Refunded", supMoney(s.prns.refunded)) : ""}
        ${s.prns && s.prns.credited > 0 ? sub("Deducted from balances", supMoney(s.prns.credited)) : ""}
        ${row("Credit paid to suppliers (" + s.credit_paid.count + ")", supMoney(s.credit_paid.total))}
        ${row("Advance paid to suppliers (" + s.advance_paid.count + ")", supMoney(s.advance_paid.total))}
        ${row("Expenses (" + s.expenses.count + ")", supMoney(s.expenses.total))}
        ${
          (s.written_off && s.written_off.count) || (s.stock_added && s.stock_added.count)
            ? heading("STOCK ADJUSTMENTS (at cost, no money moved)") +
              (s.written_off.count ? row("Written off (" + s.written_off.count + ")", supMoney(s.written_off.total)) : "") +
              (s.stock_added.count ? row("Stock added (" + s.stock_added.count + ")", supMoney(s.stock_added.total)) : "")
            : ""
        }
        ${
          s.transfers && s.transfers.count
            ? heading("MONEY TRANSFERS (between methods)") +
              journalData.entries
                .filter((e) => e.kind === "transfer")
                .map((e) => row(txnHtml(e.transfer_from) + " &rarr; " + txnHtml(e.transfer_to), supMoney(e.amount)))
                .join("")
            : ""
        }
        ${
          s.advance_used.customers > 0 || s.advance_used.suppliers > 0
            ? heading("ADVANCES USED (no money moved)") +
              (s.advance_used.customers > 0 ? row("By customers on bills", supMoney(s.advance_used.customers)) : "") +
              (s.advance_used.suppliers > 0 ? row("From suppliers on GRNs", supMoney(s.advance_used.suppliers)) : "")
            : ""
        }
      </tbody>
    </table>
    <hr>
    <table width="100%">
      <thead style="text-align: left;">
        <tr><th>Money</th><th style="text-align: right;">In</th><th style="text-align: right;">Out</th><th style="text-align: right;">Moved</th><th style="text-align: right;">Net</th></tr>
      </thead>
      <tbody>
        ${methods}
        <tr><td><b>Total</b></td><td style="text-align: right;"><b>${supMoney(s.money_in)}</b></td><td style="text-align: right;"><b>${supMoney(s.money_out)}</b></td><td></td><td style="text-align: right;"><b>${supMoney(s.net)}</b></td></tr>
      </tbody>
    </table>
    <table width="100%"><tbody>${row("Net", supMoney(s.net), true)}</tbody></table>
    <hr>
    ${
      entries
        ? `<p style="text-align: center;"><b>ENTRIES (${journalData.entries.length})</b></p>
    <table width="100%" style="font-size: 9px;">
      <thead style="text-align: left;">
        <tr><th>Time</th><th>Entry</th><th style="text-align: right;">Amount</th><th style="text-align: right;">In / Out</th></tr>
      </thead>
      <tbody>${entries}</tbody>
    </table>`
        : '<p style="text-align: center;">Nothing was recorded on this day.</p>'
    }
    <hr>
    ${supBillSignatures("Prepared by", "Checked by")}
  </div>`;
}

$(function () {
  $("#journalNav").on("click", openJournal);
  $("#journalDate").on("change", loadJournal);
  $("#journalPrevDay").on("click", function () {
    $("#journalDate").val(journalDay().subtract(1, "day").format("YYYY-MM-DD"));
    loadJournal();
  });
  $("#journalNextDay").on("click", function () {
    $("#journalDate").val(journalDay().add(1, "day").format("YYYY-MM-DD"));
    loadJournal();
  });
  $("#journalToday").on("click", function () {
    $("#journalDate").val(moment().format("YYYY-MM-DD"));
    loadJournal();
  });
  $("#journalRefresh").on("click", loadJournal);
  $("#journalKind").on("change", function () {
    if (journalData) renderJournalList();
  });
  $("#journalPrint").on("click", function () {
    if (!journalData) return;
    receipt = journalPrintHtml();
    $(this).print();
  });
  // the list was measured while the popup was hidden
  $("#journalModal").on("shown.bs.modal", function () {
    if ($.fn.DataTable.isDataTable("#journalList")) $("#journalList").DataTable().columns.adjust();
  });
});

function loadTransactions() {
  let users = [];
  let sales = 0;
  let transact = 0;
  let unique = 0;

  sold_items = [];
  sold = [];

  let counter = 0;
  let transaction_list = "";
  let query = transactionFilterQuery(start_date, end_date);

  $.get(api + query, function (transactions) {
    if (transactions.length > 0) {
      $("#transaction_list").empty();
      $("#transactionList").DataTable().destroy();

      allTransactions = [...transactions];
      refreshProfit();

      transactions?.forEach((trans, index) => {
        const total = parseFloat(trans?.total);
        if (!isNaN(total)) {
          sales += total;
        }
        transact++;

        trans?.items?.forEach((item) => {
          sold_items.push(item);
        });

        if (!users.includes(trans?.user_id)) {
          users.push(trans?.user_id);
        }

        counter++;
        let returnBadge =
          trans?.return_status == "full"
            ? ' <span class="label label-danger">Returned</span>'
            : trans?.return_status == "partial"
            ? ' <span class="label label-warning">Partial Return</span>'
            : "";

        // customer: registered (name) or walk-in
        let custName = transactionCustomerName(trans?.customer);
        let customerCell = custName
          ? `<span class="txn-customer">${txnHtml(custName)}</span>`
          : '<span class="txn-walkin">Walk in customer</span>';

        // what's left on the customer's credit: the whole bill for a Credit
        // sale, the unpaid part for a partial payment
        let remaining = txnCreditPart(trans);
        let isPartial = trans?.payment_type !== "Credit" && remaining > 0;
        let remainingCell =
          remaining > 0
            ? `<span class="txn-remaining" title="Put on the customer's credit">${remaining.toFixed(2)}</span>`
            : "";
        // amounts without the currency (it's in the column headings) to save width
        let num = (v) => {
          let n = parseFloat(v);
          return isNaN(n) ? "" : n.toFixed(2);
        };
        let changeAmount = Math.abs(parseFloat(trans?.change) || 0);
        let when = moment(trans?.date);

        let methodCell =
          trans?.payment_type === "Credit"
            ? '<span class="label label-warning">Credit</span>'
            : isPartial
            ? `${txnHtml(trans?.payment_type || "")} + Credit<span class="label label-info txn-partial">Partial payment</span>`
            : txnHtml(trans?.payment_type || "");

        transaction_list += `<tr>
                                <td class="txn-invoice">${trans?.order}${returnBadge}</td>
                                <td data-order="${when.valueOf() || 0}" data-export="${when.format(
                                  "DD MMM YYYY, hh:mm:ss A"
                                )}"><span class="nobr">${when.format("DD MMM YYYY")}</span><small class="txn-sub">${when.format(
                                  "hh:mm A"
                                )}</small></td>
                                <td data-export="${txnHtml(custName || "Walk in customer")}">${customerCell}</td>
                                <td class="txn-num">${num(trans?.total)}</td>
                                <td class="txn-num" data-export="${trans?.paid == "" ? "" : num(trans?.paid)}">${
                                  trans?.paid == "" ? "" : num(trans?.paid)
                                }${
                                  changeAmount > 0.004
                                    ? `<small class="txn-sub">change ${changeAmount.toFixed(2)}</small>`
                                    : ""
                                }</td>
                                <td class="txn-num">${changeAmount > 0.004 ? changeAmount.toFixed(2) : ""}</td>
                                <td class="txn-num">${remainingCell}</td>
                                <td data-export="${txnHtml(
                                  trans?.payment_type === "Credit"
                                    ? "Credit"
                                    : isPartial
                                    ? (trans?.payment_type || "") + " + Credit (Partial)"
                                    : trans?.payment_type || ""
                                )}">${methodCell}</td>
                                <td>${txnHtml(trans?.user || "")}</td>
                                <td><button onClick="$(this).viewTransaction(${index})" class="btn btn-info btn-sm txn-view" title="View invoice"><i class="fa fa-search-plus"></i></button></td></tr>
                    `;

        if (counter == transactions?.length) {
          $("#total_sales #counter").text(
            settings.symbol + parseFloat(sales).toFixed(2)
          );
          $("#total_transactions #counter").text(transact);

          const result = {};

          for (const { product_name, price, quantity, id } of sold_items) {
            if (!result[product_name]) result[product_name] = [];
            result[product_name].push({ id, price, quantity });
          }

          for (item in result) {
            let price = 0;
            let quantity = 0;
            let id = 0;

            result[item].forEach((i) => {
              id = i.id;
              price = i.price;
              quantity += i.quantity;
            });

            sold.push({
              id: id,
              product: item,
              qty: quantity,
              price: price,
            });
          }

          loadSoldProducts();

          if (by_user == 0) {
            userFilter(users);
          }

          $("#transaction_list").html(transaction_list);
          // the currency is shown once in the amount headings
          let cur = String(settings.symbol || "").trim();
          $("#transactionList .txn-cur").text(cur ? "(" + cur + ")" : "");
          $("#transactionList").DataTable(
            Object.assign(
              standardTableOptions({
                noun: "transactions",
                searchPlaceholder: "Search transactions...",
                exportTitle: "Transactions",
                exportSubtitle: () =>
                  [
                    $("#transactionsDateRange .date-range-label").text() || "All dates",
                    "Status: " + $("#status option:selected").text(),
                    by_method ? "Method: " + $("#paymentMethodFilter option:selected").text() : "",
                    $("#users").val() && $("#users").val() != 0 ? "Cashier: " + $("#users option:selected").text() : "",
                  ].filter(Boolean).join("   ·   "),
                exportColumns: [0, 1, 2, 3, 4, 5, 6, 7, 8],
                sumColumns: [3, 4, 6], // Total, Paid, Remaining
                actionColumns: [9],
                hiddenColumns: [5], // Change: shown under Paid on screen, own column in exports
              }),
              { order: [[1, "desc"]] }
            )
          );
        }
      });
    } else {
      // Clear stale results from the previous filter
      if ($.fn.DataTable.isDataTable("#transactionList")) {
        $("#transactionList").DataTable().destroy();
      }
      $("#transaction_list").empty();
      $("#product_sales").empty();
      allTransactions = [];
      refreshProfit();
      $("#total_sales #counter").text(settings.symbol + "0.00");
      $("#total_transactions #counter").text(0);
      $("#total_items #counter").text(0);
      $("#total_products #counter").text(0);

      Swal.fire(
        "No data!",
        "No transactions available within the selected criteria",
        "warning"
      );
    }
  });
}

function discend(a, b) {
  if (a.qty > b.qty) {
    return -1;
  }
  if (a.qty < b.qty) {
    return 1;
  }
  return 0;
}

function loadSoldProducts() {
  sold.sort(discend);

  let counter = 0;
  let sold_list = "";
  let items = 0;
  let products = 0;
  $("#product_sales").empty();

  sold.forEach((item, index) => {
    items += item.qty;
    products++;

    let product = allProducts?.filter(function (selected) {
      return selected._id == item.id;
    });

    counter++;

    sold_list += `<tr>
            <td>${item?.product}</td>
            <td>${item?.qty}</td>
            <td>${
              product[0]?.stock == 1
                ? product.length > 0
                  ? product[0]?.quantity
                  : ""
                : "N/A"
            }</td>
            <td>${
              settings.symbol + (item?.qty * parseFloat(item.price))?.toFixed(2)
            }</td>
            </tr>`;

    if (counter == sold.length) {
      $("#total_items #counter").text(items);
      $("#total_products #counter").text(products);
      $("#product_sales").html(sold_list);
    }
  });
}

function userFilter(users) {
  $("#users").empty();
  $("#users").append(`<option value="0">All</option>`);

  users.forEach((user) => {
    let u = allUsers?.filter(function (usr) {
      return usr._id == user;
    });

    $("#users").append(`<option value="${user}">${u[0]?.fullname}</option>`);
  });
}

// index: position in `source` (defaults to the Transactions page list)
$.fn.viewTransaction = function (index, source) {
  transaction_index = index;
  let trans = (source || allTransactions)[index];
  if (!trans) return;

  let payment = 0;
  let discount = trans.discount;
  let refNumber =
    trans?.ref_number != ""
      ? trans.ref_number
      : trans?.order;
  let orderNumber = trans?.order;
  let type = "";
  let tax_row = "";
  let items = "";
  let products = trans?.items;

  products.forEach((item) => {
    items +=
      "<tr><td>" +
      item.product_name +
      "</td><td>" +
      item.quantity +
      "</td><td>" +
      settings.symbol +
      parseFloat(item.price).toFixed(2) +
      "</td></tr>";
  });

  switch (trans?.payment_type) {
    case 1:
      type = "Cash";
      break;
    case 2:
      type = "Card";
      break;
    default:
      type = "Cash";
  }

  // console.log("Method Type: ", type)

  if (trans?.paid != "") {
    let advUsed = parseFloat(trans?.advance_used) || 0;
    let advKept = parseFloat(trans?.advance_deposit) || 0;
    let advAfter = trans?.advance_balance_after;
    let onCredit = trans?.payment_type !== "Credit" ? parseFloat(trans?.credit_amount) || 0 : 0;
    payment = `${
                  advUsed > 0
                    ? `<tr>
                    <td>Advance used</td>
                    <td>:</td>
                    <td>-${settings.symbol + advUsed.toFixed(2)}</td>
                </tr>
                <tr>
                    <td><b>Amount to pay</b></td>
                    <td>:</td>
                    <td><b>${settings.symbol + Math.max((parseFloat(trans?.total) || 0) - advUsed, 0).toFixed(2)}</b></td>
                </tr>`
                    : ""
                }                <tr>
                    <td>Paid${onCredit > 0 ? " (" + trans?.payment_type + ")" : ""}</td>
                    <td>:</td>
                    <td>${settings.symbol + trans?.paid}</td>
                </tr>${
                  onCredit > 0
                    ? `<tr>
                    <td><b>On credit</b></td>
                    <td>:</td>
                    <td><b>${settings.symbol + onCredit.toFixed(2)}</b></td>
                </tr>`
                    : ""
                }
                <tr>
                    <td>Change</td>
                    <td>:</td>
                    <td>${
                      settings.symbol +
                      Math.abs(trans?.change).toFixed(2)
                    }</td>
                </tr>${
                  advKept > 0
                    ? `<tr>
                    <td>Saved as advance</td>
                    <td>:</td>
                    <td>${settings.symbol + advKept.toFixed(2)}</td>
                </tr>`
                    : ""
                }
                <tr>
                    <td>Method</td>
                    <td>:</td>
                    <td>${trans?.payment_type}${onCredit > 0 ? " + Credit" : ""}</td>
                </tr>${
                  advAfter !== undefined && advAfter !== null && advAfter !== ""
                    ? `<tr>
                    <td>Advance balance</td>
                    <td>:</td>
                    <td>${settings.symbol + (parseFloat(advAfter) || 0).toFixed(2)}</td>
                </tr>`
                    : ""
                }
                ${
                  trans?.payment_info
                    ? `<tr>
                    <td>Transaction Code</td>
                    <td>:</td>
                    <td>${trans?.payment_info}</td>
                </tr>`
                    : ""
                }`;
  } else if (trans?.payment_type) {
    payment = `<tr>
                    <td>Method</td>
                    <td>:</td>
                    <td>${trans.payment_type}</td>
                </tr>`;
  }

  if (settings.charge_tax) {
    tax_row = `<tr>
                <td>Vat(${settings.percentage})% </td>
                <td>:</td>
                <td>${settings.symbol}${parseFloat(
      trans.tax
    ).toFixed(2)}</td>
            </tr>`;
  }

  receipt = `<div style="font-size: 10px;">                            
        <p style="text-align: center;">
        ${
          settings.img == ""
            ? settings.img
            : '<img style="max-width: 50px;max-width: 100px;" src ="' +
              img_path +
              settings.img +
              '" /><br>'
        }
            <span style="font-size: 22px;">${settings.store}</span> <br>
            ${settings.address_one} <br>
            ${settings.address_two} <br>
            ${
              settings.contact != "" ? "Tel: " + settings.contact + "<br>" : ""
            } 
            ${settings.tax != "" ? "Vat No: " + settings.tax + "<br>" : ""} 
    </p>
    <hr>
    <left>
        <p>
        Invoice : ${orderNumber} <br>
        Ref No : ${refNumber} <br>
        Customer : ${
          trans?.customer == 0
            ? "Walk in Customer"
            : trans?.customer?.name
        } <br>
        Cashier : ${trans?.user} <br>
        Date : ${moment(trans?.date).format(
          "DD MMM YYYY HH:mm:ss"
        )}<br>
        </p>

    </left>
    <hr>
    <table width="100%">
        <thead style="text-align: left;">
        <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Price</th>
        </tr>
        </thead>
        <tbody>
        ${items}                
 
        <tr>                        
            <td><b>Subtotal</b></td>
            <td>:</td>
            <td><b>${settings.symbol}${
    trans?.subtotal
  }</b></td>
        </tr>
        <tr>
            <td>Discount</td>
            <td>:</td>
            <td>${
              discount > 0
                ? settings.symbol +
                  parseFloat(trans?.discount).toFixed(2)
                : ""
            }</td>
        </tr>
        
        ${tax_row}
    
        <tr>
            <td><h3>Total</h3></td>
            <td><h3>:</h3></td>
            <td>
                <h3>${settings.symbol}${trans?.total}</h3>
            </td>
        </tr>
        ${payment == 0 ? "" : payment}
        </tbody>
        </table>
        <br>
        <hr>
        <br>
        <p style="text-align: center;">
         ${settings.footer}
         </p>
        </div>`;

  $("#viewTransaction").html("");
  $("#viewTransaction").html(receipt);

  if (trans?.return_status == "partial") {
    $("#viewTransaction").append(
      '<p style="text-align:center;"><span class="label label-warning">Partially Returned</span></p>'
    );
  } else if (trans?.return_status == "full") {
    $("#viewTransaction").append(
      '<p style="text-align:center;"><span class="label label-danger">Returned</span></p>'
    );
  }

  // the returns of this bill, added below it when they arrive (only if the
  // same bill is still shown)
  let shownOrder = String(trans?._id);
  $("#viewTransaction").attr("data-order", shownOrder);
  $.get(
    api + "returns/order/" + trans?._id,
    function (returns) {
      if ($("#viewTransaction").attr("data-order") !== shownOrder) return;
      if (returns && returns.length > 0) {
        // one block per return (the bill window is narrow: no wide table)
        let entries = returns
          .slice()
          .sort((a, b) => new Date(a.date) - new Date(b.date))
          .map((ret) => {
            let items = (ret.items || [])
              .map((i) => txnHtml(i.product_name) + " ×" + (parseInt(i.quantity) || 0))
              .join(", ");
            return `<div class="bill-return">
                <div class="bill-return-head">
                  <b>${ret.type == "exchange" ? "Exchange" : "Return"}</b>
                  <span>${settings.symbol}${(parseFloat(ret.refund_amount) || 0).toFixed(2)}</span>
                </div>
                <div>${moment(ret.date).format("DD MMM YYYY, hh:mm A")}${ret.user ? " · " + txnHtml(ret.user) : ""}</div>
                <div>${items}</div>
                ${ret.reason ? `<div>Reason: ${txnHtml(ret.reason)}</div>` : ""}
              </div>`;
          })
          .join("");

        $("#viewTransaction").append(`
                    <div class="bill-returns">
                      <hr>
                      <p style="text-align:center; margin-bottom: 6px;"><b>Return / Exchange History</b></p>
                      ${entries}
                    </div>
                `);
      }
    }
  );

  $("#orderModal").modal("show");
};

// the bill window is shared by several kinds of bill: a sale's return history
// still on its way must not land on the next one
$(function () {
  $("#orderModal").on("hidden.bs.modal", function () {
    $("#viewTransaction").removeAttr("data-order");
  });
});

let currentReturnMode = "return";
let returnableItems = [];
let selectableOrders = [];
let selectedReturnOrder = null;

$.fn.openSelectOrderModal = function (mode) {
  currentReturnMode = mode;

  $("#selectOrderModalLabel").text(
    mode == "exchange" ? "Select Order to Exchange" : "Select Order to Return/Refund"
  );
  selectOrderDateFilter.reset();
  selectOrderSearchText = "";
  selectableOrders = [];
  if ($.fn.DataTable.isDataTable("#selectOrderTable")) {
    selectOrderPageLength = $("#selectOrderTable").DataTable().page.len();
    $("#selectOrderTable").DataTable().destroy();
  }
  $("#selectOrderList").html("<tr><td colspan='5'>Loading...</td></tr>");

  $.get(api + "all", function (data) {
    selectableOrders = (data || [])
      .filter(function (order) {
        return order.status == 1 && order.paid != "";
      })
      .sort(function (a, b) {
        return new Date(b.date) - new Date(a.date);
      });

    applySelectOrderFilters();
  });

  $("#selectOrderModal").modal("show");
};

let selectOrderPageLength = 10;
let selectOrderSearchText = "";

function selectOrderEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// Builds the orders table (DataTable with the same toolbar/footer as Product
// History). The date range is applied here; the toolbar search box searches
// invoice, reference, date, customer and total.
$.fn.renderSelectOrderList = function (orders) {
  let sym = settings.symbol;
  let rows = "";

  orders.forEach((order) => {
    let badge =
      order.return_status == "full"
        ? ' <span class="label label-danger">Returned</span>'
        : order.return_status == "partial"
        ? ' <span class="label label-warning">Partial Return</span>'
        : "";
    let ref =
      order.ref_number && String(order.ref_number) !== String(order.order)
        ? `<br><small class="text-muted">Ref: ${selectOrderEscape(order.ref_number)}</small>`
        : "";
    let customer =
      order.customer == 0 ? "Walk in Customer" : order.customer?.name || "";
    let total = parseFloat(order.total) || 0;

    rows += `<tr>
        <td>${selectOrderEscape(order.order)}${badge}${ref}</td>
        <td class="nobr" data-order="${moment(order.date).valueOf()}">${moment(order.date).format("DD MMM YYYY, hh:mm A")}</td>
        <td>${selectOrderEscape(customer)}</td>
        <td class="text-right nobr" data-order="${total}">${sym}${total.toFixed(2)}</td>
        <td><button class="btn btn-info btn-sm" onclick="$(this).selectOrderForReturn('${order._id}')"><i class="fa fa-check"></i> Select</button></td>
      </tr>`;
  });

  // keep the chosen page size and search text when the table is rebuilt
  if ($.fn.DataTable.isDataTable("#selectOrderTable")) {
    let dt = $("#selectOrderTable").DataTable();
    selectOrderPageLength = dt.page.len();
    selectOrderSearchText = dt.search();
    dt.destroy();
  }
  $("#selectOrderList").html(rows);

  let exportTitle = $("#selectOrderModalLabel").text() || "Select Order";

  $("#selectOrderTable").DataTable({
    order: [[1, "desc"]],
    autoWidth: false,
    info: true,
    ordering: true,
    paging: true,
    pageLength: selectOrderPageLength,
    lengthMenu: [10, 25, 50, 100],
    search: { search: selectOrderSearchText },
    dom:
      "<'ph-toolbar'<'ph-toolbar-left'Bl><'ph-toolbar-right'f>>" +
      "r<'ph-table-scroll't>" + // table in its own scroll area (see .modal-fit)
      "<'ph-footer'<'ph-footer-left'i><'ph-footer-right'p>>",
    columnDefs: [{ targets: [4], orderable: false, searchable: false }],
    buttons: tableExportButtons(exportTitle, {
      exportOptions: { columns: [0, 1, 2, 3] }, // not the Select button
      subtitle: () => $("#selectOrderDateRange .date-range-label").text(),
    }),
    language: {
      search: "_INPUT_",
      searchPlaceholder: "Search invoice, reference or customer...",
      lengthMenu: "Show _MENU_ rows",
      info: "Showing _START_ to _END_ of _TOTAL_ orders",
      infoEmpty: "Showing 0 orders",
      infoFiltered: "(filtered from _MAX_)",
      emptyTable: selectableOrders.length
        ? "No orders in the selected date range."
        : "No paid orders found.",
      zeroRecords: "No orders match your search.",
    },
  });
};

// date range filter (the search box is part of the table toolbar)
function applySelectOrderFilters() {
  let filtered = selectableOrders.filter(function (order) {
    return selectOrderDateFilter.matches(order.date);
  });

  $(document).renderSelectOrderList(filtered);
}

// pos.js is required before the daterangepicker plugin's <script> tag runs,
// so set the picker up once the page (and its plugins) have loaded
let selectOrderDateFilter = {
  matches: () => true,
  isActive: () => false,
  reset: () => {},
};
$(function () {
  selectOrderDateFilter = initDateRangeFilter(
    "#selectOrderDateRange",
    applySelectOrderFilters
  );
});

$.fn.selectOrderForReturn = function (orderId) {
  let order = selectableOrders.find(function (o) {
    return o._id == orderId;
  });

  if (!order) {
    return;
  }

  selectedReturnOrder = order;
  $("#selectOrderModal").modal("hide");
  $(this).openReturnModal(currentReturnMode);
};

$.fn.openReturnModal = function (mode) {
  currentReturnMode = mode;
  let order = selectedReturnOrder;

  if (!order) {
    return;
  }

  $("#returnModalLabel").text(
    mode == "exchange" ? "Exchange Items" : "Return / Refund"
  );
  $("#refundMethodGroup").toggle(mode != "exchange");
  $("#confirmReturnBtn").text(mode == "exchange" ? "Confirm Exchange" : "Confirm Return");
  $("#returnReason").val("");

  $.get(api + "returns/order/" + order._id, function (returns) {
    // per line of the sale: a product sold from stock batches at different
    // prices is on several lines. Returns saved with a line number count for
    // that line; older ones (by product) fill the product's lines in order.
    let returnedPerLine = order.items.map(() => 0);
    let byProduct = {};
    (returns || []).forEach((ret) => {
      ret.items.forEach((item) => {
        let qty = parseInt(item.quantity) || 0;
        let line = parseInt(item.line);
        if (!isNaN(line) && returnedPerLine[line] !== undefined) returnedPerLine[line] += qty;
        else byProduct[item.id] = (byProduct[item.id] || 0) + qty;
      });
    });
    Object.keys(byProduct).forEach((id) => {
      let left = byProduct[id];
      order.items.forEach((item, n) => {
        if (left <= 0 || String(item.id) !== String(id)) return;
        let take = Math.min(Math.max((parseInt(item.quantity) || 0) - returnedPerLine[n], 0), left);
        returnedPerLine[n] += take;
        left -= take;
      });
    });

    returnableItems = [];
    let rows = "";

    order.items.forEach((item, line) => {
      let returnedQty = returnedPerLine[line];
      let remaining = parseInt(item.quantity) - returnedQty;

      returnableItems.push({
        line: line,
        id: item.id,
        product_name: item.product_name,
        sku: item.sku,
        price: item.price,
        cost_price: item.cost_price ?? "",
        remaining: remaining,
      });

      rows += `<tr>
                    <td><input type="checkbox" class="return-item-check" data-line="${line}" ${remaining <= 0 ? "disabled" : ""}></td>
                    <td>${item.product_name}</td>
                    <td>${item.quantity}</td>
                    <td>${returnedQty}</td>
                    <td><input type="number" class="form-control return-item-qty" data-line="${line}" min="0" max="${remaining}" value="0" ${remaining <= 0 ? "disabled" : ""}></td>
                    <td>${settings.symbol}${parseFloat(item.price).toFixed(2)}</td>
                </tr>`;
    });

    $("#returnItemsList").html(rows);
  });

  $("#returnModal").modal("show");
};

$.fn.submitReturn = function () {
  let order = selectedReturnOrder;
  let items = [];

  $("#returnItemsList tr").each(function () {
    let checked = $(this).find(".return-item-check").is(":checked");
    let line = parseInt($(this).find(".return-item-check").data("line"));
    let qty = parseInt($(this).find(".return-item-qty").val()) || 0;

    if (checked && qty > 0) {
      let match = returnableItems.find((i) => i.line === line);

      if (!match) return;

      if (qty > match.remaining) {
        Swal.fire(
          "Oops!",
          "Cannot return " + qty + " of " + match.product_name + ". Only " + match.remaining + " remaining.",
          "warning"
        );
        items = null;
        return false;
      }

      items.push({
        line: match.line, // which line of the sale (its price and stock batches)
        id: match.id,
        product_name: match.product_name,
        sku: match.sku,
        price: match.price,
        cost_price: match.cost_price,
        quantity: qty,
      });
    }
  });

  if (items === null) {
    return;
  }

  if (items.length == 0) {
    Swal.fire("Oops!", "Please select at least one item to return.", "warning");
    return;
  }

  let payload = {
    order_id: order._id,
    type: currentReturnMode,
    items: items,
    reason: $("#returnReason").val(),
    refund_method: $("#refundMethod").val(),
    restock: true,
    till: platform?.till,
    mac: platform?.mac,
    user: user?.fullname,
    user_id: user._id,
  };

  $.ajax({
    url: api + "returns",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify(payload),
    success: function (response) {
      $("#returnModal").modal("hide");
      loadTransactions();

      if (currentReturnMode == "exchange") {
        cart = [];
        holdOrder = 0;
        $("#inputDiscount").val(parseFloat(response.refund_amount).toFixed(2));
        $(document).renderTable(cart);
        $("#pointofsale").trigger("click");

        Swal.fire(
          "Items Returned!",
          "Exchange credit of " + settings.symbol + parseFloat(response.refund_amount).toFixed(2) + " has been applied as a discount on the new sale. Adjust or clear it if not needed.",
          "success"
        );
      } else {
        Swal.fire(
          "Refunded!",
          "Refund amount: " + settings.symbol + parseFloat(response.refund_amount).toFixed(2),
          "success"
        );
      }
    },
    error: function (xhr) {
      Swal.fire("Oops!", xhr.responseText || "Something went wrong.", "warning");
    },
  });
};

$("#status").change(function () {
  let selectedStatus = parseInt($(this).find("option:selected").val());
  by_status = isNaN(selectedStatus) ? 2 : selectedStatus;
  loadTransactions();
});

$("#paymentMethodFilter").change(function () {
  by_method = $(this).val() || "";
  loadTransactions();
});

$("#users").change(function () {
  by_user = parseInt($(this).find("option:selected").val()) || 0;
  loadTransactions();
});


function authenticate() {
  $("#loading").append(
    `<div id="load">
    <div class="text-center"><img src="assets/images/Nexora-Logo.png" alt="Nexora" style="max-height: 90px; margin-bottom: 20px;"></div>
    <form id="account"><div class="form-group"><input type="text" placeholder="Username" name="username" class="form-control"></div>
        <div class="form-group"><input type="password" placeholder="Password" name="password" class="form-control"></div>
        <div class="form-group"><input type="submit" class="btn btn-block btn-default" value="Login"></div></form>`
  );
}

// ---- First-run setup: create the administrator account ----
// Shown instead of the login when the app has no user accounts yet (a new
// installation). The account gets full access; more users are added later
// in Users.
function showFirstRunSetup() {
  $("#loading").addClass("first-run");
  $("#loading #load").remove();
  $("#loading").append(
    `<div id="load" class="setup-card">
      <div class="text-center"><img src="assets/images/Nexora-Logo.png" alt="Nexora" style="max-height: 80px; margin-bottom: 14px;"></div>
      <h3 class="setup-title">Welcome to NEXORA POS</h3>
      <p class="setup-intro">Create the administrator account to get started. This account has full access and can add other users later.</p>
      <form id="firstRunSetup" autocomplete="off" novalidate>
        <div class="form-group">
          <label for="setupFullname">Full name</label>
          <input type="text" id="setupFullname" name="fullname" class="form-control" maxlength="60" placeholder="e.g. Mohamed Musthaque">
        </div>
        <div class="form-group">
          <label for="setupUsername">Username</label>
          <input type="text" id="setupUsername" name="username" class="form-control" maxlength="30" placeholder="e.g. admin">
          <span class="help-block">3-30 characters: letters, numbers, dot, dash or underscore.</span>
        </div>
        <div class="form-group">
          <label for="setupPassword">Password</label>
          <input type="password" id="setupPassword" name="password" class="form-control" placeholder="At least 6 characters">
        </div>
        <div class="form-group">
          <label for="setupPassword2">Confirm password</label>
          <input type="password" id="setupPassword2" name="password2" class="form-control" placeholder="Type the password again">
        </div>
        <div class="setup-error text-danger" style="display: none;"></div>
        <div class="form-group" style="margin-bottom: 0;">
          <button type="submit" class="btn btn-block btn-success"><i class="fa fa-check"></i> Create account &amp; start</button>
        </div>
      </form>
    </div>`
  );
  setTimeout(() => $("#setupFullname").trigger("focus"), 50);
}

// the same rules the server checks (api/users.js POST /setup)
function firstRunSetupError(f) {
  if (!f.fullname) return "Please enter the administrator's full name.";
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(f.username))
    return "Username must be 3-30 characters: letters, numbers, dot, dash or underscore.";
  if (f.password.length < 6) return "Password must be at least 6 characters.";
  if (f.password !== f.password2) return "The two passwords don't match.";
  return "";
}

$("body").on("submit", "#firstRunSetup", function (e) {
  e.preventDefault();
  let $form = $(this);
  let f = {
    fullname: $.trim($form.find("[name=fullname]").val()),
    username: $.trim($form.find("[name=username]").val()),
    password: $form.find("[name=password]").val() || "",
    password2: $form.find("[name=password2]").val() || "",
  };
  let showError = (msg) => $form.find(".setup-error").text(msg).toggle(!!msg);
  let problem = firstRunSetupError(f);
  if (problem) return showError(problem);
  showError("");

  let $btn = $form.find("button[type=submit]").prop("disabled", true);
  $.ajax({
    url: api + "users/setup",
    type: "POST",
    data: JSON.stringify({ fullname: f.fullname, username: f.username, password: f.password }),
    contentType: "application/json; charset=utf-8",
  })
    .done(function () {
      // log straight in with the new account
      $.ajax({
        url: api + "users/login",
        type: "POST",
        data: JSON.stringify({ username: f.username, password: f.password }),
        contentType: "application/json; charset=utf-8",
      })
        .done(function (data) {
          if (data && data._id) {
            storage.set("auth", { auth: true });
            storage.set("user", data);
            sessionStorage.setItem("auth", "1");
            Swal.fire({
              title: "Administrator account created",
              text: "Welcome, " + f.fullname + "! Next, add your store details in Settings.",
              icon: "success",
              allowOutsideClick: false,
            }).then(() => ipcRenderer.send("app-reload", ""));
          } else {
            backToLogin();
          }
        })
        .fail(backToLogin);
    })
    .fail(function (xhr) {
      $btn.prop("disabled", false);
      if (xhr && xhr.status === 409) {
        // someone already set it up (e.g. another till): go to the login
        Swal.fire("Already set up", xhr.responseText || "Please log in.", "info").then(backToLogin);
      } else {
        showError((xhr && xhr.status === 400 && xhr.responseText) || "Could not create the account. Please try again.");
      }
    });

  function backToLogin() {
    $("#loading").removeClass("first-run");
    $("#loading #load").remove();
    authenticate();
  }
});

$("body").on("submit", "#account", function (e) {
  e.preventDefault();
  let formData = $(this).serializeObject();

  if (formData.username == "" || formData.password == "") {
    Swal.fire("Incomplete form!", auth_empty, "warning");
  } else {
    $.ajax({
      url: api + "users/login",
      type: "POST",
      data: JSON.stringify(formData),
      contentType: "application/json; charset=utf-8",
      cache: false,
      processData: false,
      success: function (data) {
        if (data._id) {
          storage.set("auth", { auth: true });
          storage.set("user", data);
          sessionStorage.setItem("auth", "1");
          ipcRenderer.send("app-reload", "");
        } else {
          Swal.fire("Oops!", auth_error, "warning");
        }
      },
      error: function (data) {
        console.log(data);
      },
    });
  }
});

$("#quit").click(function () {
  Swal.fire({
    title: "Are you sure?",
    text: "You are about to close the application.",
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#d33",
    cancelButtonColor: "#3085d6",
    confirmButtonText: "Close Application",
  }).then((result) => {
    if (result.value) {
      ipcRenderer.send("app-quit", "");
    }
  });
});


// ======================================================================
// Stock adjustments: stock that leaves without a sale or a supplier return
// (expired, damaged, lost, stolen, used in the shop, short in a stock count),
// or stock found that wasn't on record. Products window > Stock Adjustments;
// saving an adjustment moves the stock (api/adjustments.js) and values it at
// cost: the units' batch cost, else the product's cost price.
// ======================================================================
// the same reasons as api/adjustments.js
const ADJ_REASONS = {
  out: ["Expired", "Damaged", "Lost / Missing", "Theft", "Own / Staff use", "Stock count shortage", "Other"],
  in: ["Stock count surplus", "Found", "Other"],
};
let allAdjustments = [];
let adjCache = {}; // id -> adjustment
let adjDateFilter = null;
let adjProducts = []; // products offered in the form (the ones that track stock)
let adjLines = []; // lines of the adjustment being entered
let adjPreselect = null; // product to start the form with ("Adjust stock" on a product)

function loadAdjustments() {
  $.get(api + "adjustments")
    .done(function (list) {
      allAdjustments = list || [];
      allAdjustments.forEach((a) => (adjCache[a._id] = a));
      renderAdjustments();
    })
    .fail(function () {
      $("#adj_list").html('<tr><td colspan="8">Could not load the stock adjustments.</td></tr>');
    });
}

function adjTypeHtml(a) {
  return a.direction === "out"
    ? '<span class="label label-danger"><i class="fa fa-arrow-down"></i> Stock out</span>'
    : '<span class="label label-success"><i class="fa fa-arrow-up"></i> Stock in</span>';
}

function filteredAdjustments() {
  let type = $("#adjTypeFilter").val();
  let reason = $("#adjReasonFilter").val();
  return allAdjustments.filter(
    (a) =>
      (!adjDateFilter || adjDateFilter.matches(a.date)) &&
      (!type || a.direction === type) &&
      (!reason || a.reason === reason)
  );
}

function adjExportSubtitle() {
  let parts = [$("#adjDateRange .date-range-label").text() || "All dates"];
  if ($("#adjTypeFilter").val()) parts.push($("#adjTypeFilter option:selected").text());
  if ($("#adjReasonFilter").val()) parts.push($("#adjReasonFilter option:selected").text());
  return parts.join("  ·  ");
}

function renderAdjustments() {
  let list = filteredAdjustments();
  let outValue = 0, outUnits = 0, inValue = 0, inUnits = 0;
  let byReason = {};
  list.forEach((a) => {
    let value = Number(a.total_value) || 0;
    let units = Number(a.total_quantity) || 0;
    if (a.direction === "out") {
      outValue += value;
      outUnits += units;
      let r = (byReason[a.reason] = byReason[a.reason] || { value: 0, units: 0 });
      r.value += value;
      r.units += units;
    } else {
      inValue += value;
      inUnits += units;
    }
  });
  // the reason that cost the most (by units when nothing has a cost)
  let top = Object.keys(byReason).sort(
    (x, y) => byReason[y].value - byReason[x].value || byReason[y].units - byReason[x].units
  )[0];
  $("#adjOutValue").text(supMoney(outValue));
  $("#adjOutNote").text("at cost · " + outUnits + (outUnits === 1 ? " unit" : " units"));
  $("#adjInValue").text(supMoney(inValue));
  $("#adjInNote").text("at cost · " + inUnits + (inUnits === 1 ? " unit" : " units"));
  $("#adjTopReason").text(top || "-").attr("title", top || "");
  $("#adjTopReasonNote").text(
    top ? supMoney(byReason[top].value) + " · " + byReason[top].units + " units" : "for stock taken out"
  );
  $("#adjCount").text(list.length);
  $("#adjTabCount").text(allAdjustments.length);

  let rows = list
    .map((a) => {
      let items = a.items || [];
      // one entry per product (lines from different batches added up)
      let perProduct = [];
      items.forEach((i) => {
        let e = perProduct.find((x) => x.id === i.product_id);
        if (e) e.qty += Number(i.quantity) || 0;
        else perProduct.push({ id: i.product_id, name: i.product_name, qty: Number(i.quantity) || 0 });
      });
      let names = perProduct.map((i) => txnHtml(i.name) + " ×" + i.qty);
      let shown = names.slice(0, 3).join(", ") + (names.length > 3 ? ` <span class="text-muted">and ${names.length - 3} more</span>` : "");
      let sign = a.direction === "out" ? "-" : "+";
      return `<tr>
        <td class="nobr" data-order="${Number(a.seq) || 0}"><b>${txnHtml(a.adj_no)}</b></td>
        <td class="nobr" data-order="${txnHtml(a.date)}">${supDate(a.date)}</td>
        <td data-export="${txnHtml((a.direction === "out" ? "Stock out: " : "Stock in: ") + a.reason)}">${adjTypeHtml(a)} ${txnHtml(a.reason)}${
          a.note ? `<br><small class="text-muted">${txnHtml(a.note)}</small>` : ""
        }</td>
        <td data-export="${txnHtml(perProduct.map((i) => i.name + " x" + i.qty).join(", "))}">${shown}</td>
        <td class="text-right" data-order="${(a.direction === "out" ? -1 : 1) * (Number(a.total_quantity) || 0)}">
          <b class="${a.direction === "out" ? "text-danger" : "text-success"}">${sign}${a.total_quantity || 0}</b></td>
        <td class="text-right nobr" data-order="${Number(a.total_value) || 0}">${supMoney(a.total_value)}${
          a.no_cost ? ' <i class="fa fa-exclamation-circle text-warning" title="Some products had no cost price: valued at 0"></i>' : ""
        }</td>
        <td>${txnHtml(a.created_by || "")}</td>
        <td><button type="button" onClick="$(this).viewAdjustment(${a._id})" class="btn btn-info btn-sm" title="Adjustment note"><i class="fa fa-print"></i></button></td>
      </tr>`;
    })
    .join("");

  if ($.fn.DataTable.isDataTable("#adjList")) $("#adjList").DataTable().destroy();
  $("#adj_list").html(rows);
  $("#adjList").DataTable(
    Object.assign(
      standardTableOptions({
        noun: "adjustments",
        searchPlaceholder: "Search adjustments...",
        exportTitle: "Stock Adjustments",
        exportColumns: [0, 1, 2, 3, 4, 5, 6],
        sumColumns: [5],
        exportSubtitle: adjExportSubtitle,
        actionColumns: [7],
        emptyTable: allAdjustments.length
          ? "No adjustments match the filters"
          : "No stock adjustments yet - click New Adjustment when stock expires, gets damaged or goes missing",
      }),
      { order: [[1, "desc"], [0, "desc"]] }
    )
  );
}

// ---- the form ----
function adjDirection() {
  return $("input[name=adjDirection]:checked").val() === "in" ? "in" : "out";
}

function adjProduct(id) {
  return adjProducts.find((p) => String(p._id) === String(id));
}

function adjNum(v) {
  if (v === "" || v === null || v === undefined) return null;
  let n = parseFloat(v);
  return isFinite(n) ? n : null;
}

function adjStock(p) {
  return parseInt(p && p.quantity) || 0;
}

// how many of a product (or of one of its batches) the lines already take
function adjQtyOf(productId, batchId, exceptLine) {
  return adjLines.reduce(
    (s, l) =>
      s +
      (l !== exceptLine && String(l.product_id) === String(productId) && (batchId === undefined || String(l.batch_id) === String(batchId))
        ? Number(l.quantity) || 0
        : 0),
    0
  );
}

function adjBatchText(b) {
  let cost = adjNum(b.unit_cost);
  return b.reference + " · " + b.qty_left + " left" + (cost === null ? "" : " · cost " + supMoney(cost));
}

// What each line will move and what it's worth (the same rules as the
// server: stock out takes the batch picked first, then the oldest; stock in
// goes into the batch picked, else the batch being sold now). Per line:
// { value, unit_cost, no_cost, from: [{ reference, qty }] } or null.
function adjEstimate() {
  let out = adjDirection() === "out";
  let left = {}; // batch id -> what is left of it after the lines above
  return adjLines.map((l) => {
    let qty = Number(l.quantity);
    if (!Number.isInteger(qty) || qty < 1) return null;
    let p = adjProduct(l.product_id) || {};
    let batches = p.batches || [];
    let cost = adjNum(p.cost_price);
    let costOf = (b) => (adjNum(b.unit_cost) !== null ? adjNum(b.unit_cost) : cost);
    let picked = l.batch_id != null ? batches.find((b) => String(b._id) === String(l.batch_id)) : null;
    let moved = [];
    if (batches.length) {
      if (out) {
        let remaining = qty;
        let take = (b) => {
          let have = left[b._id] !== undefined ? left[b._id] : b.qty_left;
          let n = Math.min(have, remaining);
          if (n <= 0) return;
          left[b._id] = have - n;
          remaining -= n;
          let m = moved.find((x) => x.b === b);
          if (m) m.qty += n;
          else moved.push({ b: b, qty: n });
        };
        if (picked) take(picked);
        batches.forEach((b) => {
          if (remaining > 0) take(b);
        });
      } else {
        moved.push({ b: picked || batches[0], qty: qty });
      }
    }
    let inBatches = moved.reduce((s, m) => s + m.qty, 0);
    let noCost = moved.some((m) => costOf(m.b) === null) || (qty > inBatches && cost === null);
    let value = supRound(moved.reduce((s, m) => s + m.qty * (costOf(m.b) || 0), 0) + Math.max(qty - inBatches, 0) * (cost || 0));
    return { value: value, unit_cost: supRound(value / qty), no_cost: noCost, from: moved.map((m) => ({ reference: m.b.reference, qty: m.qty })) };
  });
}

// a line taking out more than there is: the message, or ""
function adjStockProblem(l) {
  if (adjDirection() !== "out") return "";
  let p = adjProduct(l.product_id);
  if (!p) return "";
  let stock = adjStock(p);
  let total = adjQtyOf(l.product_id);
  if (total > stock) return `Only ${Math.max(stock, 0)} of "${p.name}" in stock, but the lines take out ${total}.`;
  if (l.batch_id != null) {
    let b = (p.batches || []).find((x) => String(x._id) === String(l.batch_id));
    let fromBatch = adjQtyOf(l.product_id, l.batch_id);
    if (b && fromBatch > b.qty_left) return `Only ${b.qty_left} of "${p.name}" left in ${b.reference}, but the lines take ${fromBatch} from it.`;
  }
  return "";
}

function adjLineValid(l) {
  return Number.isInteger(Number(l.quantity)) && Number(l.quantity) >= 1;
}

function fillAdjReasons() {
  let dir = adjDirection();
  let current = $("#adjReason").val();
  $("#adjReason").html(
    `<option value="">Choose a reason...</option>` +
      ADJ_REASONS[dir].map((r) => `<option value="${txnHtml(r)}">${txnHtml(r)}</option>`).join("")
  );
  if (ADJ_REASONS[dir].includes(current)) $("#adjReason").val(current);
  updateAdjNoteHint();
}

function updateAdjNoteHint() {
  let other = $("#adjReason").val() === "Other";
  $("#adjNoteHint").text(other ? "(required: say what happened)" : "(optional)").toggleClass("text-danger", other).toggleClass("text-muted", !other);
}

function fillAdjProductOptions() {
  let out = adjDirection() === "out";
  $("#adjProduct").html(
    `<option value=""></option>` +
      adjProducts
        .map((p) => {
          let barcode = p.barcode != null && String(p.barcode) !== "NaN" ? String(p.barcode) : "";
          let cost = adjNum(p.cost_price);
          let parts = ["stock " + adjStock(p), cost === null ? "no cost yet" : "cost " + supMoney(cost)];
          if (barcode) parts.push(barcode);
          let none = out && adjStock(p) < 1;
          return `<option value="${p._id}"${none ? " disabled" : ""}>${txnHtml(p.name)} — ${txnHtml(parts.join(" · "))}</option>`;
        })
        .join("")
  );
  if ($("#adjProduct").data("chosen")) $("#adjProduct").trigger("chosen:updated");
}

// the batch list follows the product: only offered when it has several
function fillAdjBatchOptions() {
  let p = adjProduct($("#adjProduct").val());
  let batches = (p && p.batches) || [];
  let out = adjDirection() === "out";
  let first = out ? "Oldest first" : "Batch selling now";
  $("#adjBatch")
    .html(`<option value="">${first}</option>` + (batches.length > 1 ? batches.map((b) => `<option value="${b._id}">${txnHtml(adjBatchText(b))}</option>`).join("") : ""))
    .prop("disabled", batches.length < 2)
    .attr("title", batches.length > 1 ? "Pick the delivery the units come from (e.g. the one that expired)" : "This product has one batch (or none)");
}

function updateAdjTotals() {
  let est = adjEstimate();
  let out = adjDirection() === "out";
  let qty = 0, total = 0, noCost = false;
  adjLines.forEach((l, i) => {
    let e = est[i];
    let $row = $(`#adj_lines tr[data-index="${i}"]`);
    let p = adjProduct(l.product_id);
    if (e) {
      qty += Number(l.quantity);
      total += e.value;
      noCost = noCost || e.no_cost;
    }
    $row.find(".adj-line-cost").html(e ? (e.no_cost ? '<span class="text-warning" title="No cost price yet: valued at 0">' + supMoney(e.unit_cost) + "</span>" : supMoney(e.unit_cost)) : "-");
    $row.find(".grn-line-total").text(e ? supMoney(e.value) : "-");
    $row.find(".adj-line-from").text(e && e.from.length ? e.from.map((f) => f.reference + " ×" + f.qty).join(", ") : "");
    let problem = adjStockProblem(l);
    $row.find(".prn-line-after").html(
      p && adjLineValid(l)
        ? problem
          ? `<span class="text-danger" title="${txnHtml(problem)}">not enough</span>`
          : `<span class="${out ? "text-danger" : "text-success"}">→ ${adjStock(p) + (out ? -1 : 1) * adjQtyOf(l.product_id)}</span>`
        : ""
    );
  });
  total = supRound(total);
  $("#adjTotalQty").text(qty ? (out ? "-" : "+") + qty : "0");
  $("#adjTotal").text(supMoney(total));
  let $info = $(".adj-info");
  if (!qty) {
    $info.hide();
    return;
  }
  $info
    .removeClass("alert-warning alert-success")
    .addClass(out ? "alert-warning" : "alert-success")
    .html(
      `<i class="fa fa-info-circle"></i> ` +
        (out
          ? `Stock goes <b>down</b> by ${qty} ${qty === 1 ? "unit" : "units"}: <b>${supMoney(total)}</b> written off at cost.`
          : `Stock goes <b>up</b> by ${qty} ${qty === 1 ? "unit" : "units"}, worth <b>${supMoney(total)}</b> at cost.`) +
        (noCost ? " Products without a cost price count as 0." : "")
    )
    .show();
}

function renderAdjLines() {
  if (!adjLines.length) {
    $("#adj_lines").html(
      `<tr class="grn-empty"><td colspan="7">No products yet. Choose a product above, enter the quantity, then click Add.</td></tr>`
    );
  } else {
    $("#adj_lines").html(
      adjLines
        .map((l, i) => {
          let p = adjProduct(l.product_id) || {};
          let code = p.barcode != null && String(p.barcode) !== "NaN" ? String(p.barcode) : "";
          let b = l.batch_id != null ? (p.batches || []).find((x) => String(x._id) === String(l.batch_id)) : null;
          return `<tr data-index="${i}">
            <td><b>${txnHtml(l.name)}</b>${code ? `<br><small class="text-muted">${txnHtml(code)}</small>` : ""}</td>
            <td class="text-right nobr">${adjStock(p)}<br><small class="prn-line-after"></small></td>
            <td class="adj-line-batch">${b ? txnHtml(b.reference) : '<span class="text-muted">' + (adjDirection() === "out" ? "Oldest first" : "Selling now") + "</span>"}
              <br><small class="text-muted adj-line-from"></small></td>
            <td><input type="number" class="form-control adj-line-qty" min="1" step="1" value="${txnHtml(l.quantity)}"></td>
            <td class="text-right nobr adj-line-cost"></td>
            <td class="text-right nobr grn-line-total"></td>
            <td><button type="button" class="btn btn-danger btn-sm adj-line-remove" title="Remove"><i class="fa fa-times"></i></button></td>
          </tr>`;
        })
        .join("")
    );
  }
  updateAdjTotals();
}

function addAdjLine() {
  let p = adjProduct($("#adjProduct").val());
  let qty = Number($("#adjQty").val());
  let batchId = $("#adjBatch").val() ? Number($("#adjBatch").val()) : null;
  if (!p) {
    Swal.fire("Oops!", "Please choose a product.", "warning");
    return;
  }
  if (!Number.isInteger(qty) || qty < 1) {
    Swal.fire("Oops!", "Please enter the quantity (a whole number of at least 1).", "warning");
    return;
  }
  if (adjDirection() === "out") {
    let already = adjQtyOf(p._id);
    if (already + qty > adjStock(p)) {
      Swal.fire("Not enough stock", `Only ${Math.max(adjStock(p), 0)} of "${p.name}" in stock` + (already ? ` (${already} already on this adjustment).` : "."), "warning");
      return;
    }
    let b = batchId != null ? (p.batches || []).find((x) => x._id === batchId) : null;
    if (b && adjQtyOf(p._id, batchId) + qty > b.qty_left) {
      Swal.fire("Not that many in this batch", `Only ${b.qty_left} of "${p.name}" left in ${b.reference}.`, "warning");
      return;
    }
  }
  let existing = adjLines.find((l) => String(l.product_id) === String(p._id) && String(l.batch_id) === String(batchId));
  if (existing) existing.quantity = (Number(existing.quantity) || 0) + qty;
  else adjLines.push({ product_id: p._id, name: p.name, batch_id: batchId, quantity: qty });

  $("#adjProduct").val("").trigger("chosen:updated");
  $("#adjQty").val("");
  fillAdjBatchOptions();
  renderAdjLines();
  $("#adjProduct").trigger("chosen:activate");
}

// from the Stock Adjustments tab, or "Adjust stock" on a product
function openAdjForm(productId) {
  $.get(api + "inventory/products")
    .done(function (products) {
      adjProducts = (products || [])
        .filter((p) => p.stock == 1)
        .sort(
          (a, b) =>
            String(a.name || "").localeCompare(String(b.name || "")) ||
            (parseFloat(a.cost_price) || 0) - (parseFloat(b.cost_price) || 0)
        );
      if (!adjProducts.length) {
        Swal.fire("Nothing to adjust", "No product tracks stock. Turn on stock tracking in a product to adjust its stock.", "info");
        return;
      }
      adjPreselect = productId != null ? productId : null;
      prepareAdjForm();
      // the Products window steps aside and comes back when the form closes
      supSwapModal("#Products", "#adjModal", loadAdjustments);
    })
    .fail(function () {
      Swal.fire("Oops!", "Could not load the products.", "warning");
    });
}

function prepareAdjForm() {
  adjLines = [];
  $("#saveAdj").get(0).reset();
  $("#adjNote").val("");
  $("input[name=adjDirection][value=out]").prop("checked", true);
  $("#adjDate").val(moment().format("YYYY-MM-DD"));
  $("#adjDate").attr("max", moment().format("YYYY-MM-DD"));
  updateAdjTypeUi();
  fillAdjReasons();
  fillAdjProductOptions();
  fillAdjBatchOptions();
  renderAdjLines();
}

function updateAdjTypeUi() {
  let out = adjDirection() === "out";
  $("#adjModal .adj-type").removeClass("active");
  $("#adjModal .adj-type-" + (out ? "out" : "in")).addClass("active");
}

// the note: printed like the PRN bill
function adjBillHtml(a) {
  let out = a.direction === "out";
  let items = (a.items || [])
    .map(
      (i) => `<tr>
        <td>${txnHtml(i.product_name)}${
          (i.batches || []).length ? `<br><small>${i.batches.map((b) => txnHtml(b.reference) + " ×" + b.qty).join(", ")}</small>` : ""
        }</td>
        <td style="padding: 0 6px; vertical-align: top;">${out ? "-" : "+"}${i.quantity}</td>
        <td style="padding: 0 6px; white-space: nowrap; vertical-align: top;">${i.unit_cost != null ? supMoney(i.unit_cost) : "-"}</td>
        <td style="text-align: right; white-space: nowrap; vertical-align: top;">${i.value != null ? supMoney(i.value) : "-"}</td>
      </tr>`
    )
    .join("");
  return `<div style="font-size: 10px;">
    ${supBillHeader("STOCK ADJUSTMENT")}
    <p>
      Adj. No : <b>${txnHtml(a.adj_no)}</b> <br>
      Type : <b>${out ? "Stock out (written off at cost)" : "Stock in (at cost)"}</b> <br>
      Reason : ${txnHtml(a.reason)} <br>
      Date : ${supDate(a.date)} <br>
      Adjusted by : ${txnHtml(a.created_by || "-")} <br>
      Entered : ${moment(a.created_at).format("DD MMM YYYY HH:mm:ss")}
    </p>
    <hr>
    <table width="100%">
      <thead style="text-align: left;">
        <tr><th>Item</th><th style="padding: 0 6px;">Qty</th><th style="padding: 0 6px;">Cost</th><th style="text-align: right;">Value</th></tr>
      </thead>
      <tbody>
        ${items}
        <tr><td colspan="4"><hr style="margin: 4px 0;"></td></tr>
        ${supBillRow("Products / Units", (a.item_count || (a.items || []).length) + " / " + (out ? "-" : "+") + (a.total_quantity || 0))}
        ${supBillRow("Total", supMoney(a.total_value), true)}
      </tbody>
    </table>
    ${a.note ? "<p>Note : " + txnHtml(a.note) + "</p>" : ""}
    ${a.no_cost ? "<p>Products without a cost price are valued at 0.</p>" : ""}
    <hr>
    ${supBillSignatures("Adjusted by", "Checked by")}
  </div>`;
}

// the note in the bill window; over the Products window it takes its place
// and the Products window comes back when the note is closed
function adjShowBill(html) {
  receipt = html;
  $("#viewTransaction").html(html);
  if ($("#Products").hasClass("in")) supSwapModal("#Products", "#orderModal", null);
  else $("#orderModal").modal("show");
}

// after saving: the form closes, the Products window comes back (when the
// form came from it), then the note comes up, ready to print
function adjShowBillAfterSave(html) {
  $("#adjModal").one("hidden.bs.modal", function () {
    let $p = $("#Products");
    let m = $p.data("bs.modal");
    if (m && m.isShown && !$p.hasClass("in")) $p.one("shown.bs.modal", () => adjShowBill(html));
    else adjShowBill(html);
  });
  $("#adjModal").modal("hide");
}

$.fn.viewAdjustment = function (id) {
  if (adjCache[id]) return adjShowBill(adjBillHtml(adjCache[id]));
  $.get(api + "adjustments/adjustment/" + id)
    .done(function (a) {
      adjCache[a._id] = a;
      adjShowBill(adjBillHtml(a));
    })
    .fail(function (xhr) {
      Swal.fire("Oops!", supError(xhr, "Could not load the adjustment."), "warning");
    });
};

// "Adjust stock" on a product in the Products window
$.fn.adjustProductStock = function (productId) {
  openAdjForm(productId);
};

$(function () {
  adjDateFilter = initDateRangeFilter("#adjDateRange", renderAdjustments);
  let reasons = ADJ_REASONS.out.concat(ADJ_REASONS.in.filter((r) => !ADJ_REASONS.out.includes(r)));
  $("#adjReasonFilter").append(reasons.map((r) => `<option value="${txnHtml(r)}">${txnHtml(r)}</option>`).join(""));
  $("#adjTypeFilter, #adjReasonFilter").on("change", renderAdjustments);

  // the list loads with the Products window, and is measured when its tab opens
  $("#productModal").on("click", loadAdjustments);
  $('#Products .products-tabs a[href="#productsTabAdjustments"]').on("shown.bs.tab", function () {
    if ($.fn.DataTable.isDataTable("#adjList")) $("#adjList").DataTable().columns.adjust();
  });

  $("#newAdjBtn").on("click", function () {
    openAdjForm(null);
  });

  $("input[name=adjDirection]").on("change", function () {
    updateAdjTypeUi();
    fillAdjReasons();
    let keep = $("#adjProduct").val();
    fillAdjProductOptions();
    let p = adjProduct(keep);
    if (p && !(adjDirection() === "out" && adjStock(p) < 1)) $("#adjProduct").val(keep).trigger("chosen:updated");
    fillAdjBatchOptions();
    renderAdjLines();
  });
  $("#adjReason").on("change", updateAdjNoteHint);

  $("#adjModal").on("shown.bs.modal", function () {
    if (!$("#adjProduct").data("chosen")) {
      $("#adjProduct").chosen({ width: "100%", search_contains: true, no_results_text: "No product matches" });
    }
    $("#adjProduct").trigger("chosen:updated");
    if (adjPreselect != null && adjProduct(adjPreselect)) {
      $("#adjProduct").val(String(adjPreselect)).trigger("chosen:updated");
      fillAdjBatchOptions();
      adjPreselect = null;
      $("#adjQty").trigger("focus");
    } else {
      $("#adjProduct").trigger("chosen:activate");
    }
  });

  $("#adjProduct").on("change", function () {
    fillAdjBatchOptions();
    if (adjProduct($(this).val())) setTimeout(() => $("#adjQty").trigger("focus"), 0);
  });
  $("#adjAddLine").on("click", addAdjLine);
  $("#adjQty").on("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault(); // add the line, don't save
      addAdjLine();
    }
  });

  $("#adj_lines")
    .on("input", ".adj-line-qty", function () {
      let line = adjLines[parseInt($(this).closest("tr").data("index"))];
      if (!line) return;
      let val = $.trim($(this).val());
      line.quantity = val === "" ? "" : Number(val);
      updateAdjTotals();
    })
    .on("keydown", "input", function (e) {
      if (e.key === "Enter") e.preventDefault();
    })
    .on("click", ".adj-line-remove", function () {
      adjLines.splice(parseInt($(this).closest("tr").data("index")), 1);
      renderAdjLines();
    });

  $("#saveAdj").on("submit", function (e) {
    e.preventDefault();
    let dir = adjDirection();
    let reason = $("#adjReason").val();
    let date = $("#adjDate").val();
    let note = $.trim($("#adjNote").val());
    if (!reason) {
      Swal.fire("Oops!", "Please choose the reason.", "warning");
      return;
    }
    if (!date) {
      Swal.fire("Oops!", "Please enter the date.", "warning");
      return;
    }
    if (!adjLines.length) {
      Swal.fire("Oops!", "Please add at least one product.", "warning");
      return;
    }
    let bad = adjLines.find((l) => !adjLineValid(l));
    if (bad) {
      Swal.fire("Oops!", `Please check "${bad.name}": the quantity must be a whole number of at least 1.`, "warning");
      return;
    }
    let stockProblem = adjLines.map(adjStockProblem).find(Boolean);
    if (stockProblem) {
      Swal.fire("Not enough stock", stockProblem, "warning");
      return;
    }
    if (reason === "Other" && !note) {
      Swal.fire("Oops!", "Please write what happened in the note (the reason is \"Other\").", "warning");
      $("#adjNote").trigger("focus");
      return;
    }

    let est = adjEstimate();
    let total = supRound(est.reduce((s, x) => s + (x ? x.value : 0), 0));
    let units = adjLines.reduce((s, l) => s + Number(l.quantity), 0);
    let out = dir === "out";
    let payload = {
      direction: dir,
      reason: reason,
      date: date,
      note: note,
      created_by: user?.fullname || "",
      created_by_id: user?._id || "",
      items: adjLines.map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity), batch_id: l.batch_id })),
    };

    Swal.fire({
      title: "Save this adjustment?",
      icon: "question",
      html: `<p><b>${out ? "Stock out" : "Stock in"}</b> · ${txnHtml(reason)} · ${supDate(date)}</p>
        <p>${adjLines.length} ${adjLines.length === 1 ? "product" : "products"}, ${out ? "-" : "+"}${units} units · <b>${supMoney(total)}</b> at cost</p>
        <p class="text-muted" style="font-size: 13px;">The stock of these products goes ${out ? "down" : "up"} by these quantities. A saved adjustment can't be changed; a mistake is put right with another adjustment.</p>`,
      showCancelButton: true,
      confirmButtonText: "Save Adjustment",
      confirmButtonColor: out ? "#d33" : "#5fbeaa",
    }).then(function (result) {
      if (!result.value) return;
      let $btn = $("#submitAdj").prop("disabled", true);
      $.ajax({ url: api + "adjustments", type: "POST", contentType: "application/json", data: JSON.stringify(payload) })
        .done(function (a) {
          adjCache[a._id] = a;
          showAdjustmentsTabOnReturn();
          adjShowBillAfterSave(adjBillHtml(a));
          $(document).trigger("products:changed"); // new stock on the till and in Products
        })
        .fail(function (xhr) {
          Swal.fire("Oops!", supError(xhr, "Could not save the adjustment."), "warning");
          if (xhr && xhr.status >= 500) {
            loadAdjustments();
            $(document).trigger("products:changed");
          }
        })
        .always(function () {
          $btn.prop("disabled", false);
        });
    });
  });
});

// after saving, the Products window comes back on the Stock Adjustments tab
function showAdjustmentsTabOnReturn() {
  $('#Products .products-tabs a[href="#productsTabAdjustments"]').tab("show");
}


// ======================================================================
// Day End: what each payment method (Cash, Card, Bank Transfer) took in and
// paid out on a day, what went on credit, and money moved between methods
// (api/transfers.js), e.g. cash banked or card takings settled into the bank.
// The numbers come from the Quick Journal (api/journal.js), which counts the
// transfers too. Same permission as the Quick Journal.
// ======================================================================
const DAY_END_METHODS = ["Cash", "Card", "Bank Transfer"];
const DAY_END_ICONS = { Cash: "fa-money", Card: "fa-credit-card", "Bank Transfer": "fa-university" };
let dayEndData = null; // the journal of the day shown
let dayEndOwed = { customers: null, suppliers: null }; // outstanding credit now
let dayEndRequestId = 0;

function dayEndDay() {
  let d = moment($("#dayEndDate").val(), "YYYY-MM-DD", true);
  return d.isValid() ? d : moment().startOf("day");
}

function openDayEnd() {
  if (!canViewJournal()) return;
  $("#dayEndDate").val(moment().format("YYYY-MM-DD"));
  loadDayEnd();
  $("#dayEndModal").modal("show");
}

function loadDayEnd() {
  let day = dayEndDay();
  $("#dayEndDate").val(day.format("YYYY-MM-DD")).attr("max", moment().format("YYYY-MM-DD"));
  $("#dayEndNextDay").prop("disabled", !day.isBefore(moment(), "day"));
  $("#dayEndDayLabel").text((day.isSame(moment(), "day") ? "Today, " : "") + day.format("dddd D MMM YYYY"));
  let requestId = ++dayEndRequestId;
  $.get(api + "journal", { from: day.format("YYYY-MM-DD") })
    .done(function (data) {
      if (requestId !== dayEndRequestId) return; // another day was asked for meanwhile
      dayEndData = data;
      renderDayEnd();
    })
    .fail(function (xhr) {
      if (requestId !== dayEndRequestId) return;
      Swal.fire("Oops!", supError(xhr, "Could not load the day."), "warning");
    });
  // what customers owe and what is owed to suppliers, now
  $.get(api + "credit-balances").done(function (balances) {
    dayEndOwed.customers = supRound(Object.values(balances || {}).reduce((s, b) => s + (Number(b.balance) || 0), 0));
    if (dayEndData) renderDayEndCards();
  });
  $.get(api + "suppliers/all").done(function (suppliers) {
    dayEndOwed.suppliers = supRound((suppliers || []).reduce((s, x) => s + (Number(x.balance) || 0), 0));
    if (dayEndData) renderDayEndCards();
  });
}

// the methods to show: the usual three, then any other the day used
function dayEndMethods() {
  let seen = Object.keys((dayEndData && dayEndData.summary.methods) || {});
  return DAY_END_METHODS.concat(seen.filter((m) => !DAY_END_METHODS.includes(m)));
}

function dayEndMethod(m) {
  let v = (dayEndData && dayEndData.summary.methods[m]) || {};
  return {
    in: Number(v.in) || 0,
    out: Number(v.out) || 0,
    transfer_in: Number(v.transfer_in) || 0,
    transfer_out: Number(v.transfer_out) || 0,
    net: Number(v.net) || 0,
  };
}

// the day's credit: given to customers / collected, bought on credit / paid
function dayEndCredit() {
  let s = dayEndData.summary;
  return {
    sold: Number(s.sales.on_credit) || 0,
    collected: Number(s.credit_received.total) || 0,
    bought: Number(s.grns.on_credit) || 0,
    paid: Number(s.credit_paid.total) || 0,
  };
}

function dayEndSigned(n, sign) {
  return n ? sign + supMoney(n) : '<span class="text-muted">-</span>';
}

function renderDayEndCards() {
  let cards = DAY_END_METHODS.map((m) => {
    let v = dayEndMethod(m);
    let key = m === "Bank Transfer" ? "bank" : m.toLowerCase();
    return `<div class="dayend-card dayend-card-${key}">
        <div class="dayend-card-head"><i class="fa ${DAY_END_ICONS[m]}"></i> ${txnHtml(m)}</div>
        <div class="dayend-card-value ${v.net < 0 ? "text-danger" : ""}">${supMoney(v.net)}</div>
        <div class="dayend-card-caption">net for the day</div>
        <table class="dayend-card-rows">
          <tr><td>Received</td><td class="dayend-in">${dayEndSigned(v.in, "+")}</td></tr>
          <tr><td>Paid out</td><td class="dayend-out">${dayEndSigned(v.out, "-")}</td></tr>
          <tr><td>Moved in</td><td>${dayEndSigned(v.transfer_in, "+")}</td></tr>
          <tr><td>Moved out</td><td>${dayEndSigned(v.transfer_out, "-")}</td></tr>
        </table>
        <button type="button" class="btn btn-default btn-sm btn-block dayend-move" data-from="${txnHtml(m)}"${v.net > 0 ? "" : ' title="Nothing left from this day, but you can still move money"'}>
          <i class="fa fa-exchange"></i> Move ${txnHtml(m === "Bank Transfer" ? "bank money" : m.toLowerCase())}
        </button>
      </div>`;
  });
  let c = dayEndCredit();
  let owed = (n) => (n === null ? '<span class="text-muted">...</span>' : supMoney(n));
  cards.push(`<div class="dayend-card dayend-card-credit">
      <div class="dayend-card-head"><i class="fa fa-clock-o"></i> Credit</div>
      <div class="dayend-card-value">${supMoney(c.sold)}</div>
      <div class="dayend-card-caption">sold on credit (no money yet)</div>
      <table class="dayend-card-rows">
        <tr><td>Collected from customers</td><td class="dayend-in">${dayEndSigned(c.collected, "+")}</td></tr>
        <tr><td>Bought on credit (GRNs)</td><td>${c.bought ? supMoney(c.bought) : '<span class="text-muted">-</span>'}</td></tr>
        <tr><td>Paid to suppliers</td><td class="dayend-out">${dayEndSigned(c.paid, "-")}</td></tr>
      </table>
      <div class="dayend-owed">
        <div><span>Customers owe now</span><b>${owed(dayEndOwed.customers)}</b></div>
        <div><span>Owed to suppliers now</span><b>${owed(dayEndOwed.suppliers)}</b></div>
      </div>
    </div>`);
  $("#dayEndCards").html(cards.join(""));
}

// rows of the "By method" table: [label, kind filter, "in" | "out"]
const DAY_END_ROWS = [
  ["Sales", (e) => e.kind === "sale", "in"],
  ["Customer credit payments", (e) => e.kind === "customer_credit_payment", "in"],
  ["Customer advances", (e) => e.kind === "customer_advance", "in"],
  ["Purchase return refunds", (e) => e.kind === "prn", "in"],
  ["Refunds to customers", (e) => e.kind === "return" || e.kind === "exchange", "out"],
  ["GRN purchases", (e) => e.kind === "grn", "out"],
  ["Supplier credit payments", (e) => e.kind === "supplier_credit_payment", "out"],
  ["Supplier advances", (e) => e.kind === "supplier_advance", "out"],
  ["Expenses", (e) => e.kind === "expense", "out"],
];

function renderDayEndMatrix() {
  let methods = dayEndMethods();
  let entries = dayEndData.entries || [];
  let cell = (n, cls) => `<td class="text-right ${cls || ""}">${n ? supMoney(n) : '<span class="text-muted">-</span>'}</td>`;
  let head = `<thead><tr><th></th>${methods.map((m) => `<th class="text-right">${txnHtml(m)}</th>`).join("")}<th class="text-right">Total money</th><th class="text-right dayend-credit-col" title="Not money: owed by customers / to suppliers">On credit</th></tr></thead>`;
  let body = "";
  ["in", "out"].forEach((flow) => {
    let rows = "";
    DAY_END_ROWS.filter((r) => r[2] === flow).forEach(([label, match]) => {
      let per = {}, credit = 0, any = false;
      entries.filter(match).forEach((e) => {
        any = true;
        if (flow === "in" && e.money_in > 0) per[e.in_method] = (per[e.in_method] || 0) + e.money_in;
        if (flow === "out" && e.money_out > 0) per[e.out_method] = (per[e.out_method] || 0) + e.money_out;
        credit += Number(e.on_credit) || 0;
      });
      let total = methods.reduce((s, m) => s + (per[m] || 0), 0);
      if (!any || (!total && !credit)) return; // e.g. an exchange: no money either way
      rows += `<tr><td>${label}</td>${methods.map((m) => cell(per[m])).join("")}${cell(total, "dayend-total-col")}${cell(credit, "dayend-credit-col")}</tr>`;
    });
    // a heading only when something came in / went out
    if (rows) body += `<tr class="dayend-group"><td colspan="${methods.length + 3}">${flow === "in" ? "Money in" : "Money out"}</td></tr>` + rows;
  });
  if (!body) body = `<tr><td colspan="${methods.length + 3}" class="text-muted dayend-empty">No money came in or went out on this day.</td></tr>`;
  let s = dayEndData.summary;
  if (s.transfers && s.transfers.count) {
    body += `<tr class="dayend-group"><td colspan="${methods.length + 3}">Moved between methods</td></tr>`;
    body += `<tr><td>Transfers</td>${methods
      .map((m) => {
        let t = dayEndMethod(m).transfer_in - dayEndMethod(m).transfer_out;
        return `<td class="text-right">${t ? (t > 0 ? "+" : "") + supMoney(t) : '<span class="text-muted">-</span>'}</td>`;
      })
      .join("")}<td class="text-right dayend-total-col">${supMoney(0)}</td><td class="dayend-credit-col"></td></tr>`;
  }
  body += `<tr class="dayend-net"><td>Net for the day</td>${methods
    .map((m) => {
      let n = dayEndMethod(m).net;
      return `<td class="text-right ${n < 0 ? "text-danger" : ""}">${supMoney(n)}</td>`;
    })
    .join("")}<td class="text-right dayend-total-col ${s.net < 0 ? "text-danger" : ""}">${supMoney(s.net)}</td><td class="dayend-credit-col"></td></tr>`;
  $("#dayEndMatrix").html(head + "<tbody>" + body + "</tbody>");
}

function renderDayEndTransfers() {
  let list = (dayEndData.entries || []).filter((e) => e.kind === "transfer");
  if (!list.length) {
    $("#dayEndTransfers").html(
      `<tr><td colspan="7" class="text-muted dayend-empty">No money moved between methods on this day. Use <b>Transfer Money</b> to record e.g. cash banked or card takings settled.</td></tr>`
    );
    return;
  }
  $("#dayEndTransfers").html(
    list
      .map(
        (e) => `<tr>
          <td><b>${txnHtml(e.reference)}</b></td>
          <td class="nobr">${e.time_known ? moment(e.at).format("hh:mm A") : '<span class="text-muted">-</span>'}</td>
          <td class="nobr">${txnHtml(e.transfer_from)} <i class="fa fa-long-arrow-right text-muted"></i> ${txnHtml(e.transfer_to)}</td>
          <td class="text-right nobr"><b>${supMoney(e.amount)}</b></td>
          <td>${txnHtml(e.details)}</td>
          <td>${txnHtml(e.user)}</td>
          <td><button type="button" class="btn btn-info btn-xs" onClick="$(this).viewTransfer(${e.id})" title="Transfer slip"><i class="fa fa-print"></i></button></td>
        </tr>`
      )
      .join("")
  );
}

function renderDayEnd() {
  renderDayEndCards();
  renderDayEndMatrix();
  renderDayEndTransfers();
}

// ---- moving money between methods ----
function openTransferForm(from) {
  let day = dayEndDay();
  $("#saveTransfer").get(0).reset();
  $(".transfer-currency").text(settings?.symbol ? "(" + String(settings.symbol).trim() + ")" : "");
  $("#transferDate").val(day.format("YYYY-MM-DD")).attr("max", moment().format("YYYY-MM-DD"));
  setTransferRoute(from || "Cash", from === "Bank Transfer" ? "Cash" : "Bank Transfer");
  supSwapModal("#dayEndModal", "#transferModal", loadDayEnd);
}

function setTransferRoute(from, to) {
  $("#transferFrom").val(from);
  $("#transferTo").val(to === from ? DAY_END_METHODS.find((m) => m !== from) : to);
  updateTransferHint();
}

// what the "from" method has from the day shown (only for that day)
function updateTransferHint() {
  let from = $("#transferFrom").val();
  let $hint = $("#transferHint").removeClass("text-warning text-danger").empty();
  $("#transferModal .transfer-presets .btn").each(function () {
    $(this).toggleClass("active", $(this).data("from") === from && $(this).data("to") === $("#transferTo").val());
  });
  if (from === $("#transferTo").val()) {
    $hint.addClass("text-danger").text("Choose a different method to move the money to.");
    return;
  }
  if (!dayEndData || $("#transferDate").val() !== dayEndData.from) return;
  let net = supRound(dayEndMethod(from).net);
  let amount = supRound($("#transferAmount").val());
  let day = moment(dayEndData.from, "YYYY-MM-DD");
  let when = day.isSame(moment(), "day") ? "today" : "on " + day.format("D MMM");
  if (net > 0) {
    $hint.html(
      `${txnHtml(from)} ${when}: <b>${supMoney(net)}</b> <a href="#" class="transfer-use-all">move all of it</a>` +
        (amount > net ? ` <span class="text-warning">· this is more than the day's ${txnHtml(from.toLowerCase())}</span>` : "")
    );
  } else {
    $hint.addClass("text-warning").text(`${from} ${when}: ${supMoney(net)}. Nothing came in by ${from.toLowerCase()} that day (money from earlier days can still be moved).`);
  }
}

// the transfer slip, printed like the other bills
function transferSlipHtml(t) {
  return `<div style="font-size: 10px;">
    ${supBillHeader("MONEY TRANSFER")}
    <p>
      Transfer No : <b>${txnHtml(t.transfer_no)}</b> <br>
      Date : ${supDate(t.date)} <br>
      ${t.reference ? "Reference : " + txnHtml(t.reference) + " <br>" : ""}
      Recorded by : ${txnHtml(t.created_by || "-")} <br>
      Entered : ${moment(t.created_at).format("DD MMM YYYY HH:mm:ss")}
    </p>
    <hr>
    <table width="100%">
      <tbody>
        ${supBillRow("From", "<b>" + txnHtml(t.from) + "</b>")}
        ${supBillRow("To", "<b>" + txnHtml(t.to) + "</b>")}
        ${supBillRow("Amount", supMoney(t.amount), true)}
      </tbody>
    </table>
    ${t.note ? "<p>Note : " + txnHtml(t.note) + "</p>" : ""}
    <hr>
    ${supBillSignatures("Handed over by", "Received by")}
  </div>`;
}

// the day end report, printed like a bill (with lines to write the cash count on)
function dayEndPrintHtml() {
  let s = dayEndData.summary;
  let row = supBillRow;
  let heading = (t) => `<tr><td colspan="2" style="padding-top: 6px;"><b>${t}</b></td></tr>`;
  let methods = dayEndMethods();
  let methodBlocks = methods
    .map((m) => {
      let v = dayEndMethod(m);
      if (!DAY_END_METHODS.includes(m) && !v.in && !v.out && !v.transfer_in && !v.transfer_out) return "";
      return (
        heading(txnHtml(m).toUpperCase()) +
        row("&nbsp;&nbsp;Received", supMoney(v.in)) +
        row("&nbsp;&nbsp;Paid out", "-" + supMoney(v.out)) +
        (v.transfer_in ? row("&nbsp;&nbsp;Moved in", "+" + supMoney(v.transfer_in)) : "") +
        (v.transfer_out ? row("&nbsp;&nbsp;Moved out", "-" + supMoney(v.transfer_out)) : "") +
        row("&nbsp;&nbsp;<b>Net</b>", "<b>" + supMoney(v.net) + "</b>")
      );
    })
    .join("");
  let c = dayEndCredit();
  let transfers = (dayEndData.entries || [])
    .filter((e) => e.kind === "transfer")
    .map((e) => row(txnHtml(e.reference) + " " + txnHtml(e.transfer_from) + " &rarr; " + txnHtml(e.transfer_to), supMoney(e.amount)))
    .join("");
  return `<div style="font-size: 10px;">
    ${supBillHeader("DAY END")}
    <p>
      Date : <b>${moment(dayEndData.from, "YYYY-MM-DD").format("dddd D MMM YYYY")}</b> <br>
      Printed : ${moment().format("DD MMM YYYY HH:mm:ss")} <br>
      Printed by : ${txnHtml((user && user.fullname) || "")}
    </p>
    <hr>
    <table width="100%"><tbody>
      ${methodBlocks}
      ${heading("CREDIT (no money)")}
      ${row("&nbsp;&nbsp;Sold on credit", supMoney(c.sold))}
      ${row("&nbsp;&nbsp;Collected from customers", supMoney(c.collected))}
      ${row("&nbsp;&nbsp;Bought on credit (GRNs)", supMoney(c.bought))}
      ${row("&nbsp;&nbsp;Paid to suppliers", supMoney(c.paid))}
      ${dayEndOwed.customers !== null ? row("&nbsp;&nbsp;Customers owe now", supMoney(dayEndOwed.customers)) : ""}
      ${dayEndOwed.suppliers !== null ? row("&nbsp;&nbsp;Owed to suppliers now", supMoney(dayEndOwed.suppliers)) : ""}
      ${transfers ? heading("MONEY TRANSFERS") + transfers : ""}
    </tbody></table>
    <hr>
    <table width="100%"><tbody>
      ${row("Money in", supMoney(s.money_in))}
      ${row("Money out", "-" + supMoney(s.money_out))}
      ${row("Net", supMoney(s.net), true)}
    </tbody></table>
    <hr>
    <p style="line-height: 2.2;">
      Cash counted : ________________ <br>
      Difference : ________________
    </p>
    ${supBillSignatures("Prepared by", "Checked by")}
  </div>`;
}

// Bootstrap can't stack popups: Day End steps aside while a bill is open and
// comes back when the bill is closed
function dayEndShowBill(html) {
  receipt = html;
  $("#viewTransaction").html(html);
  supSwapModal("#dayEndModal", "#orderModal", null);
}

$.fn.viewTransfer = function (id) {
  $.get(api + "transfers/transfer/" + id)
    .done(function (t) {
      dayEndShowBill(transferSlipHtml(t));
    })
    .fail(function (xhr) {
      Swal.fire("Oops!", supError(xhr, "Could not load the transfer."), "warning");
    });
};

$(function () {
  $("#dayEndNav").on("click", openDayEnd);
  $("#dayEndDate").on("change", loadDayEnd);
  $("#dayEndPrevDay").on("click", function () {
    $("#dayEndDate").val(dayEndDay().subtract(1, "day").format("YYYY-MM-DD"));
    loadDayEnd();
  });
  $("#dayEndNextDay").on("click", function () {
    $("#dayEndDate").val(dayEndDay().add(1, "day").format("YYYY-MM-DD"));
    loadDayEnd();
  });
  $("#dayEndToday").on("click", function () {
    $("#dayEndDate").val(moment().format("YYYY-MM-DD"));
    loadDayEnd();
  });
  $("#dayEndRefresh").on("click", loadDayEnd);
  $("#dayEndPrint").on("click", function () {
    if (dayEndData) dayEndShowBill(dayEndPrintHtml());
  });
  $("#dayEndTransferBtn").on("click", function () {
    openTransferForm("Cash");
  });
  $("#dayEndCards").on("click", ".dayend-move", function () {
    openTransferForm($(this).data("from"));
  });

  $("#transferModal .transfer-presets").on("click", ".btn", function () {
    setTransferRoute($(this).data("from"), $(this).data("to"));
    $("#transferAmount").trigger("focus");
  });
  $("#transferSwap").on("click", function () {
    setTransferRoute($("#transferTo").val(), $("#transferFrom").val());
  });
  $("#transferFrom, #transferTo, #transferDate").on("change", updateTransferHint);
  $("#transferAmount").on("input", updateTransferHint);
  $("#transferHint").on("click", ".transfer-use-all", function (e) {
    e.preventDefault();
    $("#transferAmount").val(supRound(dayEndMethod($("#transferFrom").val()).net).toFixed(2));
    updateTransferHint();
  });
  $("#transferModal").on("shown.bs.modal", function () {
    $("#transferAmount").trigger("focus");
  });

  $("#saveTransfer").on("submit", function (e) {
    e.preventDefault();
    let from = $("#transferFrom").val();
    let to = $("#transferTo").val();
    let text = $.trim($("#transferAmount").val());
    let amount = Number(text);
    let date = $("#transferDate").val();
    if (from === to) {
      Swal.fire("Oops!", "Choose a different method to move the money to.", "warning");
      return;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(text) || !(amount > 0)) {
      Swal.fire("Oops!", "Please enter an amount greater than 0 (e.g. 5000 or 5000.50).", "warning");
      return;
    }
    if (!date) {
      Swal.fire("Oops!", "Please enter the date.", "warning");
      return;
    }
    Swal.fire({
      title: "Save this transfer?",
      icon: "question",
      html: `<p><b>${supMoney(amount)}</b> from <b>${txnHtml(from)}</b> to <b>${txnHtml(to)}</b> · ${supDate(date)}</p>
        <p class="text-muted" style="font-size: 13px;">${txnHtml(from)} goes down and ${txnHtml(to)} goes up by this amount. A saved transfer can't be changed; a mistake is put right with a transfer the other way.</p>`,
      showCancelButton: true,
      confirmButtonText: "Save Transfer",
      confirmButtonColor: "#7266ba",
    }).then(function (result) {
      if (!result.value) return;
      let $btn = $("#submitTransfer").prop("disabled", true);
      $.ajax({
        url: api + "transfers",
        type: "POST",
        contentType: "application/json",
        data: JSON.stringify({
          date: date,
          from: from,
          to: to,
          amount: text,
          reference: $.trim($("#transferReference").val()),
          note: $.trim($("#transferNote").val()),
          created_by: user?.fullname || "",
          created_by_id: user?._id || "",
        }),
      })
        .done(function (t) {
          // Day End comes back (showing the transfer's day) with the new numbers
          $("#dayEndDate").val(t.date);
          $("#transferModal").modal("hide");
          Swal.fire({
            icon: "success",
            title: t.transfer_no + " saved",
            text: supMoney(t.amount) + " moved from " + t.from + " to " + t.to + ".",
            timer: 2200,
            showConfirmButton: false,
          });
        })
        .fail(function (xhr) {
          Swal.fire("Oops!", supError(xhr, "Could not save the transfer."), "warning");
        })
        .always(function () {
          $btn.prop("disabled", false);
        });
    });
  });
});


// ======================================================================
// Accounts page: every transaction posted to the accounts it touches
// (api/accounts.js) - money (Cash, Card, Bank Transfer), customer and
// supplier credit and advances (balances carried over from day to day),
// and what happened in the period (sales, returns, GRNs, PRNs, expenses,
// stock adjustments, money transfers). Same permission as the Quick Journal.
// ======================================================================
let accountsData = null; // every account's totals for the period
let accountsLedgerData = null; // the statement shown
let accountsSelected = "overview";
let accountsDateFilter = null;
let accountsRequestId = 0;

function loadAccountsPage() {
  if (!accountsDateFilter) {
    // this month to start with
    accountsDateFilter = initDateRangeFilter("#accountsDateRange", loadAccounts, {
      initial: { start: moment().startOf("month"), end: moment() },
    });
  }
  loadAccounts();
}

function accountsRangeQuery() {
  let range = accountsDateFilter && accountsDateFilter.getRange();
  return range ? { from: range.start.format("YYYY-MM-DD"), to: range.end.format("YYYY-MM-DD") } : {};
}

function accountsPeriodText() {
  let range = accountsDateFilter && accountsDateFilter.getRange();
  if (!range) return "all dates";
  return range.start.isSame(range.end, "day")
    ? range.start.format("D MMM YYYY")
    : range.start.format("D MMM YYYY") + " - " + range.end.format("D MMM YYYY");
}

function loadAccounts() {
  let requestId = ++accountsRequestId;
  $.get(api + "accounts", accountsRangeQuery())
    .done(function (data) {
      if (requestId !== accountsRequestId) return;
      accountsData = data;
      renderAccountsList();
      let keep = accountsSelected.indexOf("by:") === 0 || accountsData.accounts.some((a) => a.id === accountsSelected);
      showAccount(keep ? accountsSelected : "overview");
    })
    .fail(function (xhr) {
      Swal.fire("Oops!", supError(xhr, "Could not load the accounts."), "warning");
    });
}

function accountById(id) {
  return accountsData && accountsData.accounts.find((a) => a.id === id);
}

// what an account shows in the list: the balance, or the period's total
function accountValue(a) {
  return a.type === "balance" ? a.closing : a.in;
}

function accountMoney(n, cls) {
  return `<span class="${n < 0 ? "text-danger" : cls || ""}">${supMoney(n)}</span>`;
}

// The menu is kept short enough to be fully in view: Overview and the
// breakdowns in a 2 x 2 grid, then one line per account in three sections.
const ACCOUNTS_MENU_GROUPS = {
  Money: "Money",
  Customers: "Credit & Advances",
  Suppliers: "Credit & Advances",
  "Sales & Purchases": "Sales, Purchases & Stock",
  Stock: "Sales, Purchases & Stock",
};
const ACCOUNTS_MENU_NAMES = { prn: "Purchase Returns" }; // the full name is on the account's page

// the menu's amounts: without the currency symbol, to fit on the line
function accountMenuMoney(n) {
  n = Number(n) || 0;
  let text = (n < 0 ? "-" : "") + Math.abs(n).toFixed(2);
  return n < 0 ? `<span class="text-danger">${text}</span>` : text;
}

function renderAccountsList() {
  let groups = [];
  accountsData.accounts.forEach((a) => {
    let name = ACCOUNTS_MENU_GROUPS[a.group] || a.group;
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push((g = { name: name, accounts: [] }));
    g.accounts.push(a);
  });
  let quick = [{ id: "overview", title: "Overview", icon: "fa-th-large", note: "All accounts at a glance" }].concat(
    Object.keys(PARTY_VIEWS).map((by) => Object.assign({ id: "by:" + by }, PARTY_VIEWS[by]))
  );
  let html =
    `<div class="accounts-quick">` +
    quick
      .map(
        (q) => `<button type="button" class="accounts-item" data-account="${q.id}" title="${txnHtml(q.note)}">
          <i class="fa ${q.icon}"></i><span class="accounts-item-name">${txnHtml(q.title)}</span></button>`
      )
      .join("") +
    `</div>`;
  groups.forEach((g) => {
    html += `<div class="accounts-group">${txnHtml(g.name)}</div>`;
    g.accounts.forEach((a) => {
      let quiet = a.type === "activity" && !a.count;
      let tip = a.name + (a.note ? " - " + a.note : "") + ": " + supMoney(accountValue(a));
      html += `<button type="button" class="accounts-item${quiet ? " accounts-item-quiet" : ""}" data-account="${txnHtml(a.id)}" title="${txnHtml(tip)}">
          <i class="fa ${txnHtml(a.icon)}"></i>
          <span class="accounts-item-name">${txnHtml(ACCOUNTS_MENU_NAMES[a.id] || a.name)}</span>
          <span class="accounts-item-value">${accountMenuMoney(accountValue(a))}</span>
        </button>`;
    });
  });
  $("#accountsList").html(html);
}

// The Accounts page is fixed to the window: it gets the height left below
// the toolbar; the menu stays in view and the open account scrolls
// (body.accounts-mode in components.css). Run when the page opens and
// whenever the window resizes.
function fitAccountsView() {
  let el = document.getElementById("accounts_view");
  if (!el || !$(el).is(":visible")) return;
  let top = el.getBoundingClientRect().top;
  el.style.height = Math.max(window.innerHeight - top - 15, 360) + "px";
}

function showAccount(id) {
  accountsSelected = id;
  // "by:customer" (every customer) or "by:customer:<key>" (one customer)
  let party = id.indexOf("by:") === 0 ? id.split(":") : null;
  let menuId = party ? "by:" + party[1] : id;
  $("#accountsList .accounts-item").removeClass("active");
  $(`#accountsList .accounts-item[data-account="${menuId}"]`).addClass("active");
  $("#accounts_view .accounts-detail").scrollTop(0);
  if (id === "overview") renderAccountsOverview();
  else if (party && party.length > 2) loadPartyStatement(party[1], party.slice(2).join(":"));
  else if (party) loadParties(party[1]);
  else loadAccountLedger(id);
}

// the statement / list table (#accountsLedger) with new columns
function accountsShowTable(headHtml, rowsHtml, options, order) {
  if ($.fn.DataTable.isDataTable("#accountsLedger")) $("#accountsLedger").DataTable().destroy();
  $("#accountsLedgerHead").html(headHtml);
  $("#accounts_ledger").html(rowsHtml);
  $("#accountsLedger").DataTable(Object.assign(standardTableOptions(options), { order: order || [[0, "asc"]] }));
  $("#accountsOverview").hide();
  $("#accountsLedgerBox").show();
}

function accountsTile(title, value, note, cls) {
  return `<div class="sup-tile ${cls || ""}"><h5>${title}</h5><div class="sup-value">${value}</div>${note ? `<small>${note}</small>` : ""}</div>`;
}

function renderAccountsOverview() {
  let a = (id) => accountById(id) || { closing: 0, in: 0, count: 0 };
  let money = accountsData.accounts.filter((x) => x.group === "Money" && x.type === "balance");
  let moneyTotal = supRound(money.reduce((s, x) => s + x.closing, 0));
  $("#accountsDetailHead").html(
    `<h4><i class="fa fa-th-large"></i> Overview</h4><p>All accounts · ${txnHtml(accountsPeriodText())}</p>`
  );
  $("#accountsTiles").html(
    accountsTile("MONEY", accountMoney(moneyTotal), money.map((x) => txnHtml(x.name) + " " + supMoney(x.closing)).join(" · "), "sup-tile-main") +
      accountsTile("CUSTOMERS OWE YOU", supMoney(a("receivable").closing), "customer credit") +
      accountsTile("YOU OWE SUPPLIERS", supMoney(a("payable").closing), "supplier credit") +
      accountsTile("SALES", supMoney(a("sales").in), a("sales").count + (a("sales").count === 1 ? " bill" : " bills") + " in the period")
  );

  let row = (x) => `<tr class="accounts-row" data-account="${txnHtml(x.id)}">
      <td><i class="fa ${txnHtml(x.icon)} text-muted"></i> <b>${txnHtml(x.name)}</b><br><small class="text-muted">${txnHtml(x.note || "")}</small></td>
      <td class="text-right">${accountMoney(x.opening)}</td>
      <td class="text-right accounts-in">${x.in ? "+" + supMoney(x.in) : '<span class="text-muted">-</span>'}</td>
      <td class="text-right accounts-out">${x.out ? "-" + supMoney(x.out) : '<span class="text-muted">-</span>'}</td>
      <td class="text-right"><b>${accountMoney(x.closing)}</b></td>
    </tr>`;
  let activityRow = (x) => `<tr class="accounts-row" data-account="${txnHtml(x.id)}">
      <td><i class="fa ${txnHtml(x.icon)} text-muted"></i> <b>${txnHtml(x.name)}</b><br><small class="text-muted">${txnHtml(x.note || "")}</small></td>
      <td class="text-right">${x.count || '<span class="text-muted">-</span>'}</td>
      <td class="text-right"><b>${x.in ? supMoney(x.in) : '<span class="text-muted">-</span>'}</b></td>
    </tr>`;
  let balances = accountsData.accounts.filter((x) => x.type === "balance");
  let activity = accountsData.accounts.filter((x) => x.type === "activity");
  $("#accountsOverview").html(`
    <h5 class="accounts-section-title">Balances <small>carried from day to day</small></h5>
    <div class="accounts-table-wrap"><table class="table accounts-table">
      <thead><tr><th>Account</th><th class="text-right">Opening</th><th class="text-right">In</th><th class="text-right">Out</th><th class="text-right">Closing</th></tr></thead>
      <tbody>${balances.map(row).join("")}</tbody>
    </table></div>
    <h5 class="accounts-section-title">Activity <small>in ${txnHtml(accountsPeriodText())}</small></h5>
    <div class="accounts-table-wrap"><table class="table accounts-table">
      <thead><tr><th>Account</th><th class="text-right">Entries</th><th class="text-right">Total</th></tr></thead>
      <tbody>${activity.map(activityRow).join("")}</tbody>
    </table></div>
    <p class="text-muted accounts-footnote"><i class="fa fa-info-circle"></i> Balances start from zero with the first record in the app; money held before that isn't included. Click an account to see its entries.</p>`);
  $("#accountsLedgerBox").hide();
  $("#accountsOverview").show();
}

function loadAccountLedger(id) {
  let requestId = ++accountsRequestId;
  $.get(api + "accounts/ledger", Object.assign({ account: id }, accountsRangeQuery()))
    .done(function (data) {
      if (requestId !== accountsRequestId) return;
      accountsLedgerData = data;
      renderAccountLedger();
    })
    .fail(function (xhr) {
      Swal.fire("Oops!", supError(xhr, "Could not load the account."), "warning");
    });
}

function renderAccountLedger() {
  let d = accountsLedgerData;
  let a = d.account;
  let isBalance = a.type === "balance";
  $("#accountsDetailHead").html(
    `<h4><i class="fa ${txnHtml(a.icon)}"></i> ${txnHtml(a.name)}</h4><p>${txnHtml(a.note || "")} · ${txnHtml(accountsPeriodText())}</p>`
  );
  $("#accountsTiles").html(
    isBalance
      ? accountsTile("OPENING", accountMoney(d.opening), "at the start of the period") +
          accountsTile("IN", "+" + supMoney(d.in), "", "accounts-tile-in") +
          accountsTile("OUT", "-" + supMoney(d.out), "", "accounts-tile-out") +
          accountsTile("CLOSING", accountMoney(d.closing), "at the end of the period", "sup-tile-main")
      : accountsTile("ENTRIES", d.rows.length, "in the period") + accountsTile("TOTAL", supMoney(d.in), "in the period", "sup-tile-main")
  );

  let head =
    `<tr><th>Date</th><th>Type</th><th>Reference</th><th>Customer / Supplier</th><th>Details</th>` +
    (isBalance
      ? `<th class="txn-num">In</th><th class="txn-num">Out</th><th class="txn-num">Balance</th>`
      : `<th class="txn-num">Amount</th><th class="txn-num">Running Total</th>`) +
    `<th>View</th></tr>`;
  let canView = (p) => ["sale", "return", "exchange", "customer_credit_payment", "grn", "prn", "supplier_credit_payment", "supplier_advance", "adjustment", "transfer"].includes(p.kind) || (p.kind === "customer_advance" && (p.sale_id || p.receipt));
  let rows = d.rows
    .map((p, i) => {
      let when = moment(p.at);
      return `<tr>
        <td class="nobr" data-order="${i}">${when.format("DD MMM YYYY")}${p.time_known ? `<br><small class="text-muted">${when.format("hh:mm A")}</small>` : ""}</td>
        <td class="nobr" data-export="${txnHtml(p.type)}"><span class="label ${JOURNAL_TYPE_CSS[p.kind] || "label-default"}">${txnHtml(p.type)}</span></td>
        <td>${txnHtml(p.reference)}</td>
        <td>${txnHtml(p.party)}</td>
        <td class="accounts-details" data-export="${txnHtml(p.details)}">${txnHtml(p.details)}${
          p.method ? `${p.details ? "<br>" : ""}<small class="text-muted">${txnHtml(p.method)}${p.user ? " · by " + txnHtml(p.user) : ""}</small>` : ""
        }</td>` +
        (isBalance
          ? `<td class="text-right nobr accounts-in" data-order="${p.in}">${p.in ? supMoney(p.in) : ""}</td>
             <td class="text-right nobr accounts-out" data-order="${p.out}">${p.out ? supMoney(p.out) : ""}</td>`
          : `<td class="text-right nobr" data-order="${p.in}">${supMoney(p.in)}</td>`) +
        `<td class="text-right nobr" data-order="${p.balance}"><b>${accountMoney(p.balance)}</b></td>
        <td>${canView(p) ? `<button type="button" class="btn btn-info btn-sm" onClick="$(this).viewAccountEntry(${i})" title="View"><i class="fa fa-search-plus"></i></button>` : ""}</td>
      </tr>`;
    })
    .join("");

  let last = isBalance ? 8 : 7;
  accountsShowTable(head, rows, {
    noun: "entries",
    searchPlaceholder: "Search " + a.name + "...",
    exportTitle: "Account - " + a.name,
    exportColumns: Array.from({ length: last }, (x, i) => i),
    sumColumns: isBalance ? [5, 6] : [5],
    exportSubtitle: () =>
      accountsPeriodText() +
      (isBalance ? "   ·   Opening " + supMoney(d.opening) + "   ·   Closing " + supMoney(d.closing) : "   ·   Total " + supMoney(d.in)),
    actionColumns: [last],
    pageLength: 25,
    emptyTable: "Nothing in this account in " + accountsPeriodText(),
  });
}

// the bill / receipt / slip behind an entry
$.fn.viewAccountEntry = function (index) {
  let p = accountsLedgerData && accountsLedgerData.rows[index];
  if (!p) return;
  let fail = (xhr) => Swal.fire("Oops!", supError(xhr, "Could not load it. It may have been deleted."), "warning");
  let showHtml = (html) => showSupplierBill(html);
  if (p.kind === "sale" || p.kind === "return" || p.kind === "exchange" || (p.kind === "customer_advance" && p.sale_id)) {
    let id = p.kind === "return" || p.kind === "exchange" ? p.order_id : p.sale_id || p.id;
    $.get(api + encodeURIComponent(id))
      .done((t) => $(document).viewTransaction(0, [t]))
      .fail(fail);
  } else if ((p.kind === "customer_credit_payment" || p.kind === "customer_advance") && p.receipt) {
    showHtml(creditPaymentReceiptHtml(p.receipt));
  } else if (p.kind === "grn") {
    $.get(api + "suppliers/grn/" + p.id)
      .done((g) => {
        grnCache[g._id] = g;
        showHtml(grnBillHtml(g));
      })
      .fail(fail);
  } else if (p.kind === "prn") {
    $.get(api + "suppliers/prn/" + p.id)
      .done((r) => {
        prnCache[r._id] = r;
        showHtml(prnBillHtml(r));
      })
      .fail(fail);
  } else if (p.kind === "supplier_credit_payment" || p.kind === "supplier_advance") {
    $.get(api + "suppliers/transactions/" + p.supplier_id)
      .done((data) => {
        let pay = (data.payments || []).find((x) => x._id === p.id);
        if (pay) showHtml(supplierPaymentBillHtml(pay));
        else fail(null);
      })
      .fail(fail);
  } else if (p.kind === "adjustment") {
    $.get(api + "adjustments/adjustment/" + p.id)
      .done((a) => showHtml(adjBillHtml(a)))
      .fail(fail);
  } else if (p.kind === "transfer") {
    $.get(api + "transfers/transfer/" + p.id)
      .done((t) => showHtml(transferSlipHtml(t)))
      .fail(fail);
  }
};

$(function () {
  $("#accountsList").on("click", ".accounts-item", function () {
    showAccount(String($(this).data("account")));
  });
  $("#accountsOverview").on("click", ".accounts-row", function () {
    showAccount(String($(this).data("account")));
  });
  $("#accountsRefresh").on("click", loadAccounts);
  $(window).on("resize", fitAccountsView);
  if (window.ResizeObserver && document.querySelector(".main-toolbar-row")) {
    new ResizeObserver(fitAccountsView).observe(document.querySelector(".main-toolbar-row"));
  }
});


// ---- Accounts: customer-wise, supplier-wise, expense-wise ------------------
// (api/accounts.js /parties and /party) a list with one row per customer /
// supplier / expense type; click a row for its statement.
const PARTY_VIEWS = {
  customer: { title: "Customer-wise", icon: "fa-users", one: "customer", many: "customers", note: "Sales, payments, credit and advances by customer" },
  supplier: { title: "Supplier-wise", icon: "fa-industry", one: "supplier", many: "suppliers", note: "GRNs, PRNs, payments, credit and advances by supplier" },
  expense: { title: "Expense-wise", icon: "fa-tags", one: "expense type", many: "expense types", note: "Expenses by expense type" },
};
let accountsPartiesData = null;

// a customer's / supplier's balance: owed (due) or an advance held
function partyBalanceHtml(n) {
  if (!n) return '<span class="text-muted">0</span>';
  return n > 0
    ? `<span class="text-danger">${supMoney(n)}</span> <small class="text-muted">due</small>`
    : `<span class="accounts-in">${supMoney(-n)}</span> <small class="text-muted">advance</small>`;
}
function partyBalanceText(n) {
  if (!n) return "0";
  return n > 0 ? supMoney(n) + " due" : supMoney(-n) + " advance";
}
function signedMoney(n) {
  if (!n) return '<span class="text-muted">-</span>';
  return n > 0 ? `<span class="accounts-in">+${supMoney(n)}</span>` : `<span class="accounts-out">-${supMoney(-n)}</span>`;
}
function dashMoney(n) {
  return n ? supMoney(n) : '<span class="text-muted">-</span>';
}

function loadParties(by) {
  let requestId = ++accountsRequestId;
  $.get(api + "accounts/parties", Object.assign({ by: by }, accountsRangeQuery()))
    .done(function (data) {
      if (requestId !== accountsRequestId) return;
      accountsPartiesData = data;
      renderParties();
    })
    .fail(function (xhr) {
      Swal.fire("Oops!", supError(xhr, "Could not load the list."), "warning");
    });
}

function renderParties() {
  let d = accountsPartiesData;
  let v = PARTY_VIEWS[d.by];
  let t = d.totals;
  let n = d.parties.length;
  $("#accountsDetailHead").html(
    `<h4><i class="fa ${v.icon}"></i> ${txnHtml(v.title)}</h4><p>${txnHtml(v.note)} · ${txnHtml(accountsPeriodText())} · click a row for its statement</p>`
  );
  let open = (p) => `data-party="${txnHtml(d.by + ":" + p.key)}"`;
  let nameCell = (p) =>
    `<td data-export="${txnHtml(p.name)}"><b>${txnHtml(p.name)}</b>${
      p.walk_in ? `<br><small class="text-muted">${d.by === "customer" ? "sales without a customer" : "GRNs from walk-in sellers"}</small>` : ""
    }</td>`;
  let action = `<td><button type="button" class="btn btn-info btn-sm" title="Statement"><i class="fa fa-file-text-o"></i></button></td>`;
  let dash = '<span class="text-muted">-</span>';
  let head;
  let rows;
  let options = {
    noun: v.many,
    searchPlaceholder: "Search " + v.many + "...",
    exportTitle: v.title + " Transactions",
    exportSubtitle: () => accountsPeriodText(),
    pageLength: 25,
    emptyTable: "No " + v.many + " with transactions in " + accountsPeriodText(),
  };

  if (d.by === "customer" || d.by === "supplier") {
    let isCustomer = d.by === "customer";
    let net = (p) => supRound(isCustomer ? p.money_in - p.money_out : p.money_out - p.money_in);
    $("#accountsTiles").html(
      isCustomer
        ? accountsTile("CUSTOMERS", n, "with transactions or a balance") +
            accountsTile("SALES", supMoney(t.sales), t.bills + (t.bills === 1 ? " bill" : " bills")) +
            accountsTile("RECEIVED", supMoney(net(t)), "after refunds", "accounts-tile-in") +
            accountsTile("CUSTOMERS OWE YOU", supMoney(t.owes), "advance held " + supMoney(t.advance), "sup-tile-main")
        : accountsTile("SUPPLIERS", n, "with transactions or a balance") +
            accountsTile("PURCHASES", supMoney(t.purchases), t.grns + (t.grns === 1 ? " GRN" : " GRNs")) +
            accountsTile("PAID", supMoney(net(t)), "after refunds", "accounts-tile-out") +
            accountsTile("YOU OWE SUPPLIERS", supMoney(t.owes), "advance paid " + supMoney(t.advance), "sup-tile-main")
    );
    head = isCustomer
      ? `<tr><th>Customer</th><th class="txn-num">Bills</th><th class="txn-num">Sales</th><th class="txn-num">Returns</th>
          <th class="txn-num" title="Money received from the customer, less refunds">Received</th><th class="txn-num">Owes You</th>
          <th class="txn-num" title="Paid in advance, not used yet">Advance Held</th><th>Statement</th></tr>`
      : `<tr><th>Supplier</th><th class="txn-num">GRNs</th><th class="txn-num">Purchases</th><th class="txn-num">Returns (PRN)</th>
          <th class="txn-num" title="Money paid to the supplier, less refunds">Paid</th><th class="txn-num">You Owe</th>
          <th class="txn-num" title="Paid in advance, not used by GRNs yet">Advance Paid</th><th>Statement</th></tr>`;
    rows = d.parties
      .map((p) => {
        let count = isCustomer ? p.bills : p.grns;
        let total = isCustomer ? p.sales : p.purchases;
        return `<tr class="accounts-row" ${open(p)}>${nameCell(p)}
        <td class="text-right">${count || dash}</td>
        <td class="text-right nobr" data-order="${total}">${dashMoney(total)}</td>
        <td class="text-right nobr" data-order="${p.returns}">${dashMoney(p.returns)}</td>
        <td class="text-right nobr" data-order="${net(p)}">${dashMoney(net(p))}</td>
        <td class="text-right nobr" data-order="${p.owes}">${p.owes ? `<b class="text-danger">${supMoney(p.owes)}</b>` : dash}</td>
        <td class="text-right nobr" data-order="${p.advance}">${dashMoney(p.advance)}</td>${action}</tr>`;
      })
      .join("");
    Object.assign(options, { exportColumns: [0, 1, 2, 3, 4, 5, 6], sumColumns: [1, 2, 3, 4, 5, 6], actionColumns: [7] });
  } else {
    let biggest = d.parties.slice().sort((a, b) => b.total - a.total)[0];
    $("#accountsTiles").html(
      accountsTile("EXPENSE TYPES", n, "used in the period") +
        accountsTile("EXPENSES", t.count, t.count === 1 ? "entry" : "entries") +
        accountsTile("BIGGEST", biggest ? txnHtml(biggest.name) : "-", biggest ? supMoney(biggest.total) : "") +
        accountsTile("TOTAL EXPENSES", supMoney(t.total), "", "sup-tile-main")
    );
    head = `<tr><th>Expense Type</th><th class="txn-num">Entries</th><th class="txn-num">Total</th><th class="txn-num">Share</th>
      <th>Paid By</th><th>Last</th><th>Statement</th></tr>`;
    rows = d.parties
      .map((p) => {
        let share = t.total ? Math.round((p.total / t.total) * 1000) / 10 : 0;
        let methods = Object.keys(p.methods).map((m) => txnHtml(m) + " " + supMoney(p.methods[m])).join(", ");
        return `<tr class="accounts-row" ${open(p)}>${nameCell(p)}
        <td class="text-right">${p.count}</td>
        <td class="text-right nobr" data-order="${p.total}"><b>${supMoney(p.total)}</b></td>
        <td class="text-right nobr" data-order="${share}" data-export="${share}%"><span class="accounts-share"><span style="width: ${Math.min(share, 100)}%"></span></span> ${share}%</td>
        <td data-export="${methods}"><small>${methods}</small></td>
        <td class="nobr" data-order="${txnHtml(p.last_at || "")}">${p.last_at ? moment(p.last_at).format("DD MMM YYYY") : ""}</td>${action}</tr>`;
      })
      .join("");
    Object.assign(options, { exportColumns: [0, 1, 2, 3, 4, 5], sumColumns: [1, 2], actionColumns: [6] });
  }
  // biggest expense first; customers / suppliers by name
  accountsShowTable(head, rows, options, d.by === "expense" ? [[2, "desc"]] : [[0, "asc"]]);
}

function loadPartyStatement(by, key) {
  let requestId = ++accountsRequestId;
  $.get(api + "accounts/party", Object.assign({ by: by, key: key }, accountsRangeQuery()))
    .done(function (data) {
      if (requestId !== accountsRequestId) return;
      accountsLedgerData = data; // the View buttons read rows from here
      renderPartyStatement();
    })
    .fail(function (xhr) {
      if (requestId !== accountsRequestId) return;
      // nothing for it in the new period: back to the list
      if (xhr && xhr.status === 404) return showAccount("by:" + by);
      Swal.fire("Oops!", supError(xhr, "Could not load the statement."), "warning");
    });
}

function renderPartyStatement() {
  let d = accountsLedgerData;
  let v = PARTY_VIEWS[d.by];
  let p = d.party;
  let isExpense = d.by === "expense";
  let isCustomer = d.by === "customer";
  $("#accountsDetailHead").html(
    `<a href="#" class="accounts-back" data-account="by:${d.by}"><i class="fa fa-angle-left"></i> All ${txnHtml(v.many)}</a>
     <h4><i class="fa ${v.icon}"></i> ${txnHtml(p.name)}</h4>
     <p>${txnHtml(v.one.charAt(0).toUpperCase() + v.one.slice(1))} statement · ${txnHtml(accountsPeriodText())}</p>`
  );
  if (isExpense) {
    let methods = Object.keys(p.methods).map((m) => txnHtml(m) + " " + supMoney(p.methods[m])).join(" · ");
    $("#accountsTiles").html(
      accountsTile("ENTRIES", p.count, "in the period") +
        accountsTile("PAID BY", methods || "-", "") +
        accountsTile("TOTAL", supMoney(p.total), "in the period", "sup-tile-main")
    );
  } else {
    let net = supRound(isCustomer ? p.money_in - p.money_out : p.money_out - p.money_in);
    let returns = p.returns ? " · returns " + supMoney(p.returns) : "";
    $("#accountsTiles").html(
      accountsTile("OPENING BALANCE", partyBalanceHtml(p.opening_balance), "at the start of the period") +
        (isCustomer
          ? accountsTile("SALES", supMoney(p.sales), p.bills + (p.bills === 1 ? " bill" : " bills") + returns)
          : accountsTile("PURCHASES", supMoney(p.purchases), p.grns + (p.grns === 1 ? " GRN" : " GRNs") + returns)) +
        accountsTile(isCustomer ? "RECEIVED" : "PAID", supMoney(net), "after refunds", isCustomer ? "accounts-tile-in" : "accounts-tile-out") +
        accountsTile(
          "CLOSING BALANCE",
          partyBalanceHtml(p.balance),
          (isCustomer ? "owes you " : "you owe ") + supMoney(p.owes) + " · advance " + supMoney(p.advance),
          "sup-tile-main"
        )
    );
  }

  let canView = (r) => r.kind !== "expense" && (r.kind !== "customer_advance" || r.sale_id || r.receipt);
  let head;
  let rows;
  let options = {
    noun: "entries",
    searchPlaceholder: "Search " + p.name + "...",
    exportTitle: v.title + " - " + p.name,
    pageLength: 25,
    emptyTable: "Nothing for " + p.name + " in " + accountsPeriodText(),
  };
  let dateCell = (r, i) => {
    let when = moment(r.at);
    return `<td class="nobr" data-order="${i}">${when.format("DD MMM YYYY")}${r.time_known ? `<br><small class="text-muted">${when.format("hh:mm A")}</small>` : ""}</td>`;
  };

  if (isExpense) {
    head = `<tr><th>Date</th><th>Details</th><th>Method</th><th class="txn-num">Amount</th><th class="txn-num">Running Total</th></tr>`;
    rows = d.rows
      .map(
        (r, i) => `<tr>${dateCell(r, i)}
        <td class="accounts-details">${txnHtml(r.details)}${r.user ? `<br><small class="text-muted">by ${txnHtml(r.user)}</small>` : ""}</td>
        <td>${txnHtml(r.method)}</td>
        <td class="text-right nobr" data-order="${r.amount}">${supMoney(r.amount)}</td>
        <td class="text-right nobr" data-order="${r.balance}"><b>${supMoney(r.balance)}</b></td></tr>`
      )
      .join("");
    Object.assign(options, {
      exportColumns: [0, 1, 2, 3, 4],
      sumColumns: [3],
      exportSubtitle: () => accountsPeriodText() + "   ·   Total " + supMoney(p.total),
    });
  } else {
    head = `<tr><th>Date</th><th>Type</th><th>Reference</th><th>Details</th><th class="txn-num">Amount</th>
      <th class="txn-num" title="${isCustomer ? "Money received from the customer (- refunded)" : "Money paid to the supplier (- refunded)"}">${isCustomer ? "Received" : "Paid"}</th>
      <th class="txn-num" title="${isCustomer ? "Owed by the customer, or the advance held" : "Owed to the supplier, or the advance paid"}">Balance</th><th>View</th></tr>`;
    rows = d.rows
      .map((r, i) => {
        let money = supRound(isCustomer ? r.money_in - r.money_out : r.money_out - r.money_in);
        return `<tr>${dateCell(r, i)}
        <td class="nobr" data-export="${txnHtml(r.type)}"><span class="label ${JOURNAL_TYPE_CSS[r.kind] || "label-default"}">${txnHtml(r.type)}</span></td>
        <td>${txnHtml(r.reference)}</td>
        <td class="accounts-details" data-export="${txnHtml(r.details)}">${txnHtml(r.details)}${
          r.method ? `${r.details ? "<br>" : ""}<small class="text-muted">${txnHtml(r.method)}${r.user ? " · by " + txnHtml(r.user) : ""}</small>` : ""
        }</td>
        <td class="text-right nobr" data-order="${r.amount}">${supMoney(r.amount)}</td>
        <td class="text-right nobr" data-order="${money}" data-export="${money}">${signedMoney(money)}</td>
        <td class="text-right nobr" data-order="${r.balance}" data-export="${txnHtml(partyBalanceText(r.balance))}"><b>${partyBalanceHtml(r.balance)}</b></td>
        <td>${canView(r) ? `<button type="button" class="btn btn-info btn-sm" onClick="$(this).viewAccountEntry(${i})" title="View"><i class="fa fa-search-plus"></i></button>` : ""}</td>
      </tr>`;
      })
      .join("");
    Object.assign(options, {
      exportColumns: [0, 1, 2, 3, 4, 5, 6],
      sumColumns: [5],
      actionColumns: [7],
      exportSubtitle: () =>
        accountsPeriodText() + "   ·   Opening " + partyBalanceText(p.opening_balance) + "   ·   Closing " + partyBalanceText(p.balance),
    });
  }
  accountsShowTable(head, rows, options);
}

$(function () {
  // a row of the customer / supplier / expense list: its statement
  $("#accounts_ledger").on("click", "tr[data-party]", function () {
    showAccount("by:" + $(this).attr("data-party"));
  });
  $("#accountsDetailHead").on("click", ".accounts-back", function (e) {
    e.preventDefault();
    showAccount($(this).attr("data-account"));
  });
});
