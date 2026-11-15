(function () {
  "use strict";

  // ---- スマホ用メニュー開閉 ----
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("global-nav");
  if (toggle && nav) {
    var label = toggle.querySelector(".visually-hidden");
    var setOpen = function (open) {
      toggle.setAttribute("aria-expanded", String(open));
      nav.classList.toggle("is-open", open);
      if (label) label.textContent = open ? "メニューを閉じる" : "メニューを開く";
    };
    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setOpen(false);
    });
  }

  // ---- コピーライトの年 ----
  var year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  // ---- 今日の曜日をハイライト＆営業状況 ----
  var now = new Date();
  var day = now.getDay(); // 0=日
  var row = document.querySelector('.hours-table tr[data-day="' + day + '"]');
  if (row) row.classList.add("is-today");

  var isThirdTuesday = day === 2 && Math.ceil(now.getDate() / 7) === 3;
  var closeHour = day === 0 || day === 6 ? 16 : 17;
  var minutes = now.getHours() * 60 + now.getMinutes();
  var status = document.getElementById("today-status");
  if (!status) return;

  var wrap = status.parentNode;
  if (day === 1 || isThirdTuesday) {
    status.textContent = "本日は定休日です。またのお越しをお待ちしています";
    wrap.classList.add("is-closed");
  } else if (minutes >= 7 * 60 && minutes < closeHour * 60) {
    status.textContent = "ただいま営業中（本日は " + closeHour + ":00 まで）";
  } else {
    status.textContent = "本日の営業時間 7:00〜" + closeHour + ":00";
    wrap.classList.add("is-closed");
  }
})();
