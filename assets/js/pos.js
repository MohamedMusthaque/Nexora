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
let by_till = 0;
let by_user = 0;
let by_status = 1;

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
    columnDefs: o.actionColumns
      ? [{ targets: o.actionColumns, orderable: false, searchable: false }]
      : [],
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
  $.get(api + "users/check/", function (data) {});
  $("#loading").show();
  authenticate();
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
    if (0 == user.perm_transactions) {
      $(".p_three").hide();
    }
    if (0 == user.perm_users) {
      $(".p_four").hide();
    }
    if (0 == user.perm_settings) {
      $(".p_five").hide();
    }

    // function to load products
    function loadProducts() {
      $.get(api + "inventory/products", function (data) {
        data.forEach((item) => {
          item.price = parseFloat(item.price).toFixed(2);
        });

        allProducts = [...data];
        loadProductList();
        const capitalizeFirstLetter = (word) =>
          `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

        let delay = 0;
        allProducts?.forEach((product) => {
          if (product.quantity <= 5 && product.quantity > 2) {
            notiflix.Notify.init({
              position: "right-bottom",
              cssAnimationDuration: 600,
              timeout: 4000 + delay,
              messageMaxLength: 150,
              cssAnimationStyle: "from-bottom",
            });
            notiflix.Notify.warning(
              `${capitalizeFirstLetter(product.name)} has only ${
                product.quantity
              } left in the inventory`
            );
          } else if (product.quantity >= 1 && product.quantity <= 2) {
            notiflix.Notify.init({
              position: "right-bottom",
              cssAnimationDuration: 600,
              timeout: 8000 + delay * 2,
              messageMaxLength: 150,
              cssAnimationStyle: "from-bottom",
            });
            notiflix.Notify.failure(
              `${capitalizeFirstLetter(product.name)} has only ${
                product.quantity
              } left in the inventory`
            );
          } else if (product.quantity < 1) {
            notiflix.Notify.init({
              position: "right-bottom",
              cssAnimationDuration: 600,
              timeout: 8000 + delay * 2,
              messageMaxLength: 150,
              cssAnimationStyle: "from-bottom",
            });
            notiflix.Notify.failure(
              `${capitalizeFirstLetter(
                product.name
              )} is out of stock. Please restock.`
            );
          }
          delay += 100;
        });

        $("#parent").text("");
        categories = [];

        // group products with the same name inside the same category so
        // they share one tile; each group's variants keep their own price,
        // barcode and stock, picked via a popup when the tile is clicked
        let groupsByKey = {};
        data.forEach((item) => {
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
          let prices = group.variants.map((v) => parseFloat(v.price));
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
                                    group.variants.length > 1
                                      ? group.variants.length + " prices"
                                      : representative.sku || ""
                                  }</span>
                                  <span class="stock">STOCK </span><span class="count">${stockLabel}</span></div>
                                  <sp class="text-success text-center"><b data-plugin="counterup">${priceLabel}</b> </sp>
                      </div>
                  </div>`;
          $("#parent").append(item_info);
        });

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

    // called when a POS tile is clicked; tiles that group several
    // same-name/different-price products show a popup so the user can pick
    // which price to ring up, otherwise the single variant is added directly
    $.fn.selectVariant = function (groupIndex) {
      let group = posProductGroups[groupIndex];
      if (!group || group.variants.length === 0) return;

      if (group.variants.length === 1) {
        let v = group.variants[0];
        $(this).addToCart(v._id, v.quantity, v.stock);
        return;
      }

      let optionsHtml = group.variants
        .map(
          (v) =>
            `<button type="button" class="btn btn-white btn-block variant-option" data-id="${
              v._id
            }" data-quantity="${v.quantity}" data-stock="${
              v.stock
            }" style="display:flex; justify-content:space-between; margin-bottom:6px;">
              <span>${v.barcode ? "Barcode: " + v.barcode : ""}</span>
              <span>${settings.symbol}${v.price}</span>
            </button>`
        )
        .join("");

      Swal.fire({
        title: `Select price for ${group.name}`,
        html: `<div class="variant-list">${optionsHtml}</div>`,
        showConfirmButton: false,
        showCloseButton: true,
        didOpen: (popup) => {
          $(popup)
            .find(".variant-option")
            .on("click", function () {
              let id = $(this).data("id");
              let quantity = $(this).data("quantity");
              let stock = $(this).data("stock");
              Swal.close();
              $(document).addToCart(id, quantity, stock);
            });
        },
      });
    };

    $.fn.addToCart = function (id, count, stock) {
      if (stock == 1) {
        if (count > 0) {
          $.get(api + "inventory/product/" + id, function (data) {
            $(this).addProductToCart(data);
          });
        } else {
          Swal.fire(
            "Out of stock!",
            "This item is currently unavailable",
            "info"
          );
        }
      } else {
        $.get(api + "inventory/product/" + id, function (data) {
          $(this).addProductToCart(data);
        });
      }
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
            $(this).addProductToCart(data);
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

    $.fn.addProductToCart = function (data) {
      item = {
        id: data._id,
        product_name: data.name,
        sku: data.sku,
        price: data.price,
        // cost at the time of sale, saved with the transaction for profit
        cost_price: data.cost_price ?? "",
        img: data.img,
        quantity: 1,
      };

      if ($(this).isExist(item)) {
        $(this).qtIncrement(index);
      } else {
        cart.push(item);
        $(this).renderTable(cart);
      }
    };

    $.fn.isExist = function (data) {
      let toReturn = false;
      $.each(cart, function (index, value) {
        if (value.id == data.id) {
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
            $("<td>", { text: data.product_name }),
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

      let product = allProducts.filter(function (selected) {
        return selected._id == parseInt(item.id);
      });

      if (product[0].stock == 1) {
        if (item.quantity < product[0].quantity) {
          item.quantity += 1;
          $(this).renderTable(cart);
        } else {
          Swal.fire(
            "No more stock!",
            "You have already added all the available stock.",
            "info"
          );
        }
      } else {
        item.quantity += 1;
        $(this).renderTable(cart);
      }
    };

    $.fn.qtDecrement = function (i) {
      if (item.quantity > 1) {
        item = cart[i];
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
      $("#advancePanel").hide();
      $("#advanceKeepRow").hide();
      applyPaymentAdvance();
      if (!registered) return;

      let requestId = paymentAdvance.requestId;
      $.get(api + "customer-advance/" + customer.id).done(function (data) {
        if (requestId !== paymentAdvance.requestId) return; // window reopened meanwhile
        paymentAdvance.balance = parseFloat(data && data.balance) || 0;
        $("#advanceAvailable").text(advanceMoney(paymentAdvance.balance));
        updateAdvanceForPaymentType();
      });
    }

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
    $("#keepAsAdvance").on("change", function () {
      $(this).calculateChange();
    });

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
      if (paymentType === 5 && status != 3 && !creditChecked) {
        let creditCustomer = JSON.parse($("#customer").val());
        if (creditCustomer != 0) {
          let self = this;
          checkCreditLimit(creditCustomer, orderTotal, holdOrder || null).then(
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
      if (status == 1 && type !== "Credit" && paymentAdvance.customer) {
        advanceUsed = paymentAdvance.applied || 0;
        if ($("#keepAsAdvance").is(":checked") && $("#advanceKeepRow").is(":visible")) {
          let toPay = parseFloat($("#payablePrice").val()) || 0;
          advanceDeposit = Math.max(Math.round(((parseFloat(paid) || 0) - toPay) * 100) / 100, 0);
          if (advanceDeposit > 0) change = "0.00"; // no change given: it's kept
        }
      }
      // the customer's advance after this bill (shown on the receipt, saved with the sale)
      let advanceAfter =
        status == 1 && type !== "Credit" && paymentAdvance.customer
          ? Math.max(Math.round((paymentAdvance.balance - advanceUsed + advanceDeposit) * 100) / 100, 0)
          : null;

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
                    }<tr>
                        <td>Paid</td>
                        <td>:</td>
                        <td>${settings.symbol + paid}</td>
                    </tr>
                    <tr>
                        <td>Change</td>
                        <td>:</td>
                        <td>${
                          settings.symbol + Math.abs(change).toFixed(2)
                        }</td>
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
                        <td>${type}</td>
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

    $("#transactions").click(function () {
      loadTransactions();
      loadUserList();

      $("#pos_view").hide();
      $("#pointofsale").show();
      $("#transactions_view").show();
      $(this).hide();

      $("body").addClass("transactions-mode").removeClass("totals-compact");
      window.scrollTo(0, 0);
      updateTransactionsStickyOffset();
    });

    $("#pointofsale").click(function () {
      $("#pos_view").show();
      $("#transactions").show();
      $("#transactions_view").hide();
      $(this).hide();

      $("body").removeClass("transactions-mode totals-compact");
      window.scrollTo(0, 0);
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

    // ---- Cost / Selling price: positive numbers only ----
    // Keeps digits and a single decimal point (max 2 decimals). Anything else
    // (letters, "-", "+", "e", symbols, pasted text) is removed as it's typed.
    function cleanPriceText(value) {
      // drop thousands separators, then keep the first number in the text, so
      // pasting "Rs. 1,250.00" gives "1250.00" (not the "." from "Rs.")
      let text = String(value).replace(/,/g, "");
      let match = text.match(/\d+(\.\d*)?|\.\d+|^\.$/);
      let cleaned = match ? match[0] : "";
      let dot = cleaned.indexOf(".");
      if (dot !== -1) cleaned = cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1, dot + 3);
      return cleaned;
    }

    function showPriceInputError(input, message) {
      let $err = $(input).siblings(".price-input-error");
      $(input).closest(".form-group").toggleClass("has-error", !!message);
      $err.text(message || "");
      clearTimeout(input._priceErrorTimer);
      if (message) {
        input._priceErrorTimer = setTimeout(() => showPriceInputError(input, ""), 2500);
      }
    }

    $(".price-input")
      .on("keydown", function (e) {
        // block the characters number fields usually let through: - + e E ,
        if (["-", "+", "e", "E", ","].includes(e.key)) {
          e.preventDefault();
          showPriceInputError(this, "Only positive numbers are allowed.");
        }
      })
      .on("input", function () {
        let before = this.value;
        let cleaned = cleanPriceText(before);
        if (cleaned !== before) {
          let caret = this.selectionStart - (before.length - cleaned.length);
          this.value = cleaned;
          try { this.setSelectionRange(Math.max(0, caret), Math.max(0, caret)); } catch (e) {}
          showPriceInputError(
            this,
            /[^0-9.]/.test(before)
              ? "Only numbers are allowed."
              : "Use one decimal point and up to 2 decimals."
          );
          updateProductMarginHint();
        }
      });

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

      $("#userModal").modal("show");
    };

    $.fn.editCategory = function (index) {
      $("#Categories").modal("hide");
      $("#categoryName").val(allCategories[index].name);
      $("#category_id").val(allCategories[index]._id);
      $("#newCategory").modal("show");
    };

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
    });

    $("#usersModal").click(function () {
      loadUserList();
    });

    $("#categoryModal").click(function () {
      loadCategoryList();
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
          (filter === "all" || t.payment_type === filter) &&
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
        if (trans.payment_type === "Credit") creditTotal += amount;
        else paidTotal += amount;

        let settle = creditSaleStatus[String(trans._id)];
        let typeLabel =
          trans.payment_type === "Credit"
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
            <td class="nobr" data-order="${moment(trans.date).valueOf()}">${moment(trans.date).format("DD MMM YYYY, hh:mm A")}</td>
            <td>${itemCount}</td>
            <td class="nobr">${sym + amount.toFixed(2)}</td>
            <td class="nobr">${trans.paid === "" || trans.paid == null ? "" : sym + parseFloat(trans.paid).toFixed(2)}</td>
            <td>${typeLabel}</td>
            <td>${trans.user || ""}</td>
            <td><button onClick="$(this).viewCustomerTransaction(${index})" class="btn btn-info"><i class="fa fa-search-plus"></i></button></td>
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
        dom:
          "<'ph-toolbar'<'ph-toolbar-left'Bl><'ph-toolbar-right'f>>" +
          "rt" +
          "<'ph-footer'<'ph-footer-left'i><'ph-footer-right'p>>",
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

    function computeCreditSaleStatus() {
      creditSaleStatus = {};
      let left = creditState.paid;
      customerTransactionsAll
        .filter((t) => t.payment_type === "Credit")
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .forEach((t) => {
          let total = parseFloat(t.total) || 0;
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
      let row = (label, value, strong) =>
        `<tr><td>${label}</td><td>:</td><td style="text-align:right">${strong ? "<b>" + value + "</b>" : value}</td></tr>`;
      receipt = `<div style="font-size: 10px;">
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
          Customer : ${$("<i>").text(p.customer_name || "").html()} <br>
          Received by : ${$("<i>").text(p.user || "").html()} <br>
          Date : ${moment(p.date).format("DD MMM YYYY HH:mm:ss")}
        </p>
        <hr>
        <table width="100%">
          ${row("Balance before", creditMoney(parseFloat(p.balance_before) || 0))}
          ${row("<h3 style='margin:4px 0'>Amount paid</h3>", "<h3 style='margin:4px 0'>" + creditMoney(parseFloat(p.received ?? p.amount) || 0) + "</h3>")}
          ${parseFloat(p.advance_added) > 0 ? row("Applied to credit", creditMoney(parseFloat(p.amount) || 0)) + row("Saved as advance", creditMoney(parseFloat(p.advance_added)), true) : ""}
          ${row("Method", $("<i>").text(p.method || "").html())}
          ${p.reference ? row("Reference", $("<i>").text(p.reference).html()) : ""}
          ${row("Balance now", creditMoney(parseFloat(p.balance_after) || 0), true)}
        </table>
        ${p.note ? "<p>Note: " + $("<i>").text(p.note).html() + "</p>" : ""}
        <hr>
        <p style="text-align: center;">${settings.footer || "Thank you!"}</p>
      </div>`;
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
      stock_adjustment: { label: "Stock adjustment", css: "label-info", group: "changes" },
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
          return escapeHtml(e.payment_type) + " · " + escapeHtml(e.customer) + badge;
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
            <td class="text-right nobr">${e.price != null && meta.group !== "changes" ? sym + parseFloat(e.price).toFixed(2) : ""}</td>
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

    $.fn.viewProductHistory = function (productId) {
      let product = allProducts.find((p) => p._id == productId);
      if (!product) return;
      productHistoryProduct = product;
      productHistoryEvents = [];

      $("#productHistoryTitle").text("Product History - " + product.name);
      $("#productHistoryInfo").html(
        `Barcode: <b>${escapeHtml(product.barcode)}</b> &nbsp;·&nbsp; ` +
          `Category: <b>${escapeHtml(historyCategoryName(product.category))}</b> &nbsp;·&nbsp; ` +
          `Price: <b>${settings.symbol}${(parseFloat(product.price) || 0).toFixed(2)}</b> &nbsp;·&nbsp; ` +
          `Stock tracking: <b>${product.stock == 1 ? "On" : "Off"}</b>`
      );
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
          <td>${settings.symbol}${product.price}</td>
          <td>${product.stock == 1 ? product.quantity : "N/A"}</td>
          <td class="nobr">
          <span class="btn-group" style="display: flex;">
            <button onClick="$(this).printBarcode('${product.name}', '${
        product.barcode
      }', '${
        product.price
      }')" class="btn btn-dark btn-sm" title="Print barcode"><i class="fa fa-print"></i></button>
            <button onClick="$(this).viewProductHistory(${product._id})" class="btn btn-info btn-sm" title="History"><i class="fa fa-history"></i></button>
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
        $("#net_settings_form").show(500);
        $("#settings_form, #data_management_section").hide(500);
        macaddress.one(function (err, mac) {
          $("#mac").val(mac);
        });
      } else {
        $("#net_settings_form").hide(500);
        $("#settings_form, #data_management_section").show(500);
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
        $("#net_settings_form").show(500);
        $("#settings_form, #data_management_section").hide(500);

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
        $("#net_settings_form").hide(500);
        $("#settings_form, #data_management_section").show(500);

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

  $("#rmv_logo").click(function () {
    $("#remove_logo").val("1");
    $("#current_logo").hide(500);
    $(this).hide(500);
    $("#logoname").show(500);
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
      let original = order.items.find((o) => o.id == i.id);
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
      ($("#status option:selected").text() || "Paid")
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

// fetches the sales for the Profit date range + page filters, then shows profit
function refreshProfit() {
  let requestId = ++profitRequestId;
  let range = profitDateFilter ? profitDateFilter.getRange() : null;
  let start = range ? range.start.toDate().toJSON() : "";
  let end = range ? range.end.toDate().toJSON() : "";
  $.get(api + `by-date?start=${start}&end=${end}&user=${by_user}&status=${by_status}&till=${by_till}`)
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

function loadTransactions() {
  let tills = [];
  let users = [];
  let sales = 0;
  let transact = 0;
  let unique = 0;

  sold_items = [];
  sold = [];

  let counter = 0;
  let transaction_list = "";
  let query = `by-date?start=${start_date}&end=${end_date}&user=${by_user}&status=${by_status}&till=${by_till}`;

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

        if (!tills?.includes(trans?.till)) {
          tills.push(trans?.till);
        }

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

        transaction_list += `<tr>
                                <td>${trans?.order}${returnBadge}</td>
                                <td class="nobr" data-order="${moment(trans?.date).valueOf() || 0}">${moment(trans?.date).format(
                                  "DD MMM YYYY, hh:mm:ss A"
                                )}</td>
                                <td>${settings.symbol + trans?.total}</td>
                                <td>${
                                  trans?.paid == ""
                                    ? ""
                                    : settings.symbol + trans?.paid
                                }</td>
                                <td>${
                                  trans?.change
                                    ? settings.symbol +
                                      Math.abs(trans?.change).toFixed(2)
                                    : ""
                                }</td>
                                <td>${trans?.payment_type}</td>
                                <td>${trans?.till}</td>
                                <td>${trans?.user}</td>
                                <td>${
                                  trans?.paid == ""
                                    ? '<button class="btn btn-dark"><i class="fa fa-search-plus"></i></button>'
                                    : '<button onClick="$(this).viewTransaction(' +
                                      index +
                                      ')" class="btn btn-info"><i class="fa fa-search-plus"></i></button></td>'
                                }</tr>
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

          if (by_user == 0 && by_till == 0) {
            userFilter(users);
            tillFilter(tills);
          }

          $("#transaction_list").html(transaction_list);
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
                    $("#tills").val() && $("#tills").val() != 0 ? "Till: " + $("#tills option:selected").text() : "",
                    $("#users").val() && $("#users").val() != 0 ? "Cashier: " + $("#users option:selected").text() : "",
                  ].filter(Boolean).join("   ·   "),
                exportColumns: [0, 1, 2, 3, 4, 5, 6, 7],
                sumColumns: [2, 3], // Total, Paid
                actionColumns: [8],
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

function tillFilter(tills) {
  $("#tills").empty();
  $("#tills").append(`<option value="0">All</option>`);
  tills.forEach((till) => {
    $("#tills").append(`<option value="${till}">${till}</option>`);
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
                }<tr>
                    <td>Paid</td>
                    <td>:</td>
                    <td>${settings.symbol + trans?.paid}</td>
                </tr>
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
                    <td>${trans?.payment_type}</td>
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

  $.get(
    api + "returns/order/" + trans?._id,
    function (returns) {
      if (returns && returns.length > 0) {
        let historyRows = "";
        returns.forEach((ret) => {
          let itemsSummary = ret.items
            .map((i) => i.product_name + " x" + i.quantity)
            .join(", ");
          historyRows += `<tr>
                        <td>${moment(ret.date).format("DD MMM YYYY, hh:mm A")}</td>
                        <td>${ret.type == "exchange" ? "Exchange" : "Return"}</td>
                        <td>${itemsSummary}</td>
                        <td>${settings.symbol}${parseFloat(ret.refund_amount).toFixed(2)}</td>
                        <td>${ret.reason || ""}</td>
                        <td>${ret.user || ""}</td>
                    </tr>`;
        });

        $("#viewTransaction").append(`
                    <hr>
                    <p style="text-align:center;"><b>Return / Exchange History</b></p>
                    <table width="100%" style="font-size: 9px;">
                        <thead style="text-align: left;">
                        <tr>
                            <th>Date</th>
                            <th>Type</th>
                            <th>Items</th>
                            <th>Amount</th>
                            <th>Reason</th>
                            <th>Cashier</th>
                        </tr>
                        </thead>
                        <tbody>${historyRows}</tbody>
                    </table>
                `);
      }
    }
  );

  $("#orderModal").modal("show");
};

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
    let alreadyReturned = {};
    (returns || []).forEach((ret) => {
      ret.items.forEach((item) => {
        alreadyReturned[item.id] =
          (alreadyReturned[item.id] || 0) + parseInt(item.quantity);
      });
    });

    returnableItems = [];
    let rows = "";

    order.items.forEach((item) => {
      let returnedQty = alreadyReturned[item.id] || 0;
      let remaining = parseInt(item.quantity) - returnedQty;

      returnableItems.push({
        id: item.id,
        product_name: item.product_name,
        sku: item.sku,
        price: item.price,
        cost_price: item.cost_price ?? "",
        remaining: remaining,
      });

      rows += `<tr>
                    <td><input type="checkbox" class="return-item-check" data-id="${item.id}" ${remaining <= 0 ? "disabled" : ""}></td>
                    <td>${item.product_name}</td>
                    <td>${item.quantity}</td>
                    <td>${returnedQty}</td>
                    <td><input type="number" class="form-control return-item-qty" data-id="${item.id}" min="0" max="${remaining}" value="0" ${remaining <= 0 ? "disabled" : ""}></td>
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
    let id = $(this).find(".return-item-check").data("id");
    let qty = parseInt($(this).find(".return-item-qty").val()) || 0;

    if (checked && qty > 0) {
      let match = returnableItems.find((i) => i.id == id);

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
  by_status = isNaN(selectedStatus) ? 1 : selectedStatus;
  loadTransactions();
});

$("#tills").change(function () {
  by_till = parseInt($(this).find("option:selected").val()) || 0;
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
