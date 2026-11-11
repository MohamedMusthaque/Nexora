// Loading animation while data loads or saves.
//
// Every request to the local API goes through jQuery ($.get / $.ajax /
// ajaxSubmit), so its global events tell us when something is pending:
//  - a thin animated bar across the top of the window, and
//  - a spinner over the part of the screen that is waiting: the open window
//    (its body), else the open page (Point of Sale: the product grid).
// Both appear only when a request takes longer than SHOW_DELAY (quick loads
// don't flicker) and stay at least MIN_VISIBLE once shown. The spinner never
// blocks clicks (pointer-events: none), so a request that hangs can't lock
// the till. Styles: components.css "Loading animation".

(function () {
  const SHOW_DELAY = 250; // ms before anything shows
  const MIN_VISIBLE = 350; // ms it stays once shown

  let pendingReads = 0; // GET requests in flight
  let pendingWrites = 0; // POST / PUT / DELETE in flight
  let showTimer = null;
  let hideTimer = null;
  let shownAt = 0;
  let $bar = null;
  let $overlay = null;

  function pending() {
    return pendingReads + pendingWrites;
  }

  function ensureElements() {
    if (!$bar) {
      $bar = $('<div id="appLoadBar" aria-hidden="true"><span></span></div>').appendTo("body");
    }
    if (!$overlay) {
      $overlay = $(
        '<div class="ui-loader" role="status" aria-live="polite">' +
          '<div class="ui-loader-box"><span class="ui-spinner"></span><span class="ui-loader-text">Loading…</span></div>' +
          "</div>"
      );
    }
  }

  // the topmost open window, else the page that is open
  function loaderTarget() {
    let $open = $(".modal").filter(function () {
      let m = $(this).data("bs.modal");
      return m && m.isShown;
    });
    if ($open.length) {
      // the last one opened is on top (highest z-index)
      let top = $open.toArray().sort(
        (a, b) => (parseInt($(a).css("z-index")) || 0) - (parseInt($(b).css("z-index")) || 0)
      );
      let $body = $(top[top.length - 1]).find(".modal-body").first();
      if ($body.length) return $body;
    }
    if ($("#pos_view").is(":visible")) return $("#pos_view .pos-products").first();
    let $page = $('[id$="_view"]').filter(":visible").first();
    if ($page.length) return $page.find(".card-box").first();
    return $();
  }

  function placeOverlay() {
    if (!$overlay) return;
    let $target = loaderTarget();
    if (!$target.length) {
      $overlay.detach();
      return;
    }
    if ($overlay.parent()[0] !== $target[0]) {
      $(".ui-loading-host").removeClass("ui-loading-host");
      // the spinner is placed over its target: that needs a positioned box
      if ($target.css("position") === "static") $target.addClass("ui-loading-host");
      $overlay.appendTo($target);
    }
    $overlay.find(".ui-loader-text").text(pendingWrites ? "Saving…" : "Loading…");
  }

  function show() {
    showTimer = null;
    if (!pending()) return;
    ensureElements();
    shownAt = Date.now();
    $bar.addClass("active");
    placeOverlay();
    $overlay.addClass("active");
  }

  function hide() {
    hideTimer = null;
    if (pending()) return;
    if ($bar) $bar.removeClass("active");
    if ($overlay) {
      $overlay.removeClass("active").detach();
      $(".ui-loading-host").removeClass("ui-loading-host");
    }
  }

  function isWrite(settings) {
    return String(settings.type || settings.method || "GET").toUpperCase() !== "GET";
  }

  $(document).on("ajaxSend", function (e, xhr, settings) {
    if (isWrite(settings)) pendingWrites++;
    else pendingReads++;
    clearTimeout(hideTimer);
    hideTimer = null;
    if (shownAt && $bar && $bar.hasClass("active")) {
      placeOverlay(); // already showing: follow the label (Saving / Loading)
    } else if (!showTimer) {
      showTimer = setTimeout(show, SHOW_DELAY);
    }
  });

  // ajaxComplete fires after the request's own success / error callbacks,
  // so the spinner stays until the data has been put on screen
  $(document).on("ajaxComplete", function (e, xhr, settings) {
    if (isWrite(settings)) pendingWrites = Math.max(0, pendingWrites - 1);
    else pendingReads = Math.max(0, pendingReads - 1);
    if (pending()) {
      if ($overlay && $overlay.hasClass("active")) placeOverlay();
      return;
    }
    if (showTimer) {
      // finished before anything showed: nothing to hide
      clearTimeout(showTimer);
      showTimer = null;
      return;
    }
    let wait = Math.max(0, MIN_VISIBLE - (Date.now() - shownAt));
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, wait);
  });

  // a window opened or closed while loading: move the spinner to what is in front
  $(document).on("shown.bs.modal hidden.bs.modal", ".modal", function () {
    if ($overlay && $overlay.hasClass("active")) placeOverlay();
  });
})();
