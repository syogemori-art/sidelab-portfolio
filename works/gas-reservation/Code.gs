/**
 * ============================================================
 *  Googleフォームの予約を自動で管理（サンプル）
 *  制作：サイドラボ　※ポートフォリオ用サンプル。店名・お客様情報はすべて架空です。
 * ============================================================
 *
 * ■ できること
 *   フォームから予約が入ると自動で…
 *     1.「予約管理」シートに1行追加（ステータス付き）
 *     2. 同じ時間帯に予約が重なっていないかチェック
 *        ・重なっていない → Googleカレンダーに予定を登録し、お客様へ確認メール
 *        ・重なっている   → 「要確認」として色付けし、お店側（オーナー）にだけメールで通知
 *   さらに毎朝、翌日の予約のお客様へリマインドメールを送ります。
 *
 * ■ ファイル構成
 *   Code.gs  … このファイル。設定と、予約受付・リマインドの本体
 *   Setup.gs … メニュー、トリガー（自動実行）の登録、サンプルフォーム作成、テスト用の機能
 *
 * ■ 使い方（くわしくは README.md）
 *   1. 予約を集めたいスプレッドシートの「拡張機能 → Apps Script」に Code.gs と Setup.gs を貼り付けて保存
 *   2. 下の CONFIG（店名・オーナーのメールなど）を書き換えて保存
 *   3. スプレッドシートを再読み込み → メニュー「予約管理 → サンプルの予約フォームを作成」（自前のフォームがあれば不要）
 *   4. メニュー「予約管理 → 初期設定（自動実行を登録）」
 */

// ============================================================
//  設定（ここだけ書き換えれば動きを変えられます）
// ============================================================
const CONFIG = {
  // --- お店の情報 ---
  SHOP_NAME: 'さくら整体院（架空）', // メールの差出人名・本文に使います
  OWNER_EMAIL: '', // 重複予約などの通知先。空欄なら、このスクリプトを設定した人の Gmail に届きます
  CALENDAR_ID: '', // 予定を入れるカレンダーのID。空欄ならメインのカレンダー（例：xxxx@group.calendar.google.com）

  // --- 予約枠 ---
  SLOT_MINUTES: 60, // 1枠の長さ（分）
  OPEN_TIME: '10:00', // 最初の枠の開始時刻
  LAST_START_TIME: '17:00', // 最後の枠の開始時刻
  CLOSED_WEEKDAYS: [3], // 定休日（0=日 1=月 2=火 3=水 4=木 5=金 6=土）。定休日なしなら []
  CAPACITY_PER_SLOT: 1, // 同じ時間に受けられる人数（ベッドが2台なら 2）

  // --- チェック ---
  // true にすると、カレンダーに手入力した予定（私用・休憩など）と重なる予約も「要確認」にします
  CHECK_CALENDAR_CONFLICTS: true,

  // --- メール ---
  REMINDER_HOUR: 9, // 前日リマインドを送る時刻（9 = 毎朝9時台）
  SEND_PENDING_NOTICE: true, // 要確認のとき、お客様に「確認して改めて連絡します」メールを送るか
  NOTIFY_OWNER_EVERY_BOOKING: false, // true にすると、問題のない予約でもオーナーに通知します

  // --- シート ---
  SHEET_NAME: '予約管理',

  // --- フォームの質問名（フォームの質問タイトルと完全に同じ文字にしてください） ---
  FIELDS: {
    NAME: 'お名前',
    EMAIL: 'メールアドレス',
    TEL: '電話番号',
    DATE: 'ご希望日',
    TIME: 'ご希望の時間',
    MENU: 'メニュー',
    NOTE: 'ご要望・ご質問',
  },

  // サンプルフォームに表示するメニュー
  MENUS: ['初回カウンセリング＋整体（60分）', '整体（60分）', '肩こり集中ケア（60分）'],

  // このツールが作ったカレンダー予定につける目印（手入力の予定と区別するため）
  EVENT_TAG_KEY: 'createdBy',
  EVENT_TAG_VALUE: 'sidelab-reservation-sample',
};

// --- メール文面（{ } の部分は自動で差し込まれます） ---
const MAIL = {
  CONFIRM_SUBJECT: '【{店名}】ご予約を承りました（{日時}）',
  CONFIRM_BODY: [
    '{お名前} 様',
    '',
    'このたびは{店名}をご予約いただき、ありがとうございます。',
    '以下の内容でご予約を承りました。',
    '',
    '━━━━━━━━━━━━━━━━',
    '予約番号：{予約ID}',
    '日時　　：{日時}',
    'メニュー：{メニュー}',
    '━━━━━━━━━━━━━━━━',
    '',
    '変更・キャンセルをご希望の場合は、このメールにご返信ください。',
    '当日お会いできるのを楽しみにしております。',
    '',
    '{店名}',
  ].join('\n'),

  PENDING_SUBJECT: '【{店名}】ご予約のお申し込みを受け付けました',
  PENDING_BODY: [
    '{お名前} 様',
    '',
    'このたびは{店名}にお申し込みいただき、ありがとうございます。',
    'ご希望の日時（{日時}）について空き状況を確認のうえ、担当者より改めてご連絡いたします。',
    '',
    '※このメールの時点では、ご予約はまだ確定しておりません。',
    '',
    '{店名}',
  ].join('\n'),

  REMINDER_SUBJECT: '【{店名}】明日のご予約のお知らせ（{日時}）',
  REMINDER_BODY: [
    '{お名前} 様',
    '',
    '明日のご予約のお知らせです。',
    '',
    '━━━━━━━━━━━━━━━━',
    '予約番号：{予約ID}',
    '日時　　：{日時}',
    'メニュー：{メニュー}',
    '━━━━━━━━━━━━━━━━',
    '',
    'ご都合が悪くなった場合は、お手数ですがこのメールにご返信ください。',
    'お気をつけてお越しください。',
    '',
    '{店名}',
  ].join('\n'),
};

// 予約管理シートの列（この順番で並びます）
const COLUMNS = ['予約ID', '受付日時', 'お名前', 'メールアドレス', '電話番号', '予約日', '開始', '終了',
  'メニュー', 'ご要望', 'ステータス', 'カレンダー予定ID', '確認メール', 'リマインド', 'メモ'];
const COL = {}; // COL['ステータス'] → 11 のように「何列目か」を引けるようにする
COLUMNS.forEach(function (name, i) { COL[name] = i + 1; });

// ステータスの文字
const STATUS = {
  CONFIRMED: '確定',
  NEEDS_CHECK: '要確認',
  CANCELED: 'キャンセル',
  PROCESSING: '処理中',
};

// ============================================================
//  フォーム送信時に自動で動く処理（トリガーから呼ばれます）
// ============================================================

/**
 * フォームから予約が送信されたときに実行されます。
 * ※「初期設定（自動実行を登録）」で登録したトリガーから呼ばれるので、手で実行する必要はありません。
 */
function handleFormSubmit(e) {
  if (!e || !e.namedValues) {
    throw new Error('この関数はフォーム送信時に自動で動きます。試すときはメニュー「予約管理 → テスト予約を1件入れる」を使ってください。');
  }

  // 同時に2件の予約が来ても順番に処理する（ダブルブッキング防止のため必須）
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30 * 1000);
  } catch (err) {
    notifyOwner_('【要確認】予約の自動処理が混み合いました',
      '同時に多数の予約が届いたため、1件の自動処理ができませんでした。\n「フォームの回答」シートの最新の行を確認してください。\n\n' +
      JSON.stringify(e.namedValues, null, 2));
    return;
  }

  let sheet = null;
  let row = 0;
  try {
    sheet = getBookingSheet_();
    const b = parseAnswers_(e.namedValues);

    // まず「処理中」で1行追加（途中でメール送信などに失敗しても、予約の記録だけは必ず残す）
    row = sheet.getLastRow() + 1;
    b.id = 'R' + Utilities.formatDate(new Date(), tz_(), 'yyMMdd-HHmmss'); // 例：R261120-093015（受付日時から作る）
    sheet.getRange(row, 1, 1, COLUMNS.length).setValues([[
      b.id, new Date(), b.name, b.email, b.tel, b.date || b.rawDate, b.start || b.rawTime, b.end || '',
      b.menu, b.note, STATUS.PROCESSING, '', '', '', '',
    ]]);
    SpreadsheetApp.flush();

    // 日時・重複のチェック
    const problems = findProblems_(b, sheet, row);

    if (problems.length === 0) {
      confirmBooking_(sheet, row, b); // カレンダー登録＋確認メール
      if (CONFIG.NOTIFY_OWNER_EVERY_BOOKING) {
        notifyOwner_('【新規予約】' + b.name + ' 様 ' + formatDateTime_(b.start), bookingSummary_(b));
      }
    } else {
      markNeedsCheck_(sheet, row, b, problems);
    }
  } catch (err) {
    // 想定外のエラーもオーナーに知らせる
    if (sheet && row) {
      sheet.getRange(row, COL['ステータス']).setValue(STATUS.NEEDS_CHECK + '（エラー）');
      sheet.getRange(row, COL['メモ']).setValue(err.message);
    }
    notifyOwner_('【要確認】予約の自動処理でエラーが発生しました',
      'エラー内容：' + err.message + '\n\n受け付けた内容：\n' + JSON.stringify(e.namedValues, null, 2));
  } finally {
    lock.releaseLock();
  }
}

/** 予約を確定させる：カレンダーに予定を入れて、お客様に確認メールを送る */
function confirmBooking_(sheet, row, b) {
  const event = getCalendar_().createEvent(
    '【予約】' + b.name + ' 様（' + (b.menu || 'メニュー未選択') + '）',
    b.start,
    b.end,
    { description: bookingSummary_(b) }
  );
  event.setTag(CONFIG.EVENT_TAG_KEY, CONFIG.EVENT_TAG_VALUE);

  sheet.getRange(row, COL['ステータス']).setValue(STATUS.CONFIRMED);
  sheet.getRange(row, COL['カレンダー予定ID']).setValue(event.getId());

  const sent = sendCustomerMail_(b, MAIL.CONFIRM_SUBJECT, MAIL.CONFIRM_BODY);
  sheet.getRange(row, COL['確認メール']).setValue(sent ? new Date() : '未送信');
}

/** 「要確認」にして、オーナーへ通知する（お客様へは確定メールを送らない） */
function markNeedsCheck_(sheet, row, b, problems) {
  sheet.getRange(row, COL['ステータス']).setValue(STATUS.NEEDS_CHECK + '（' + problems.join('・') + '）');
  sheet.getRange(row, COL['メモ']).setValue('自動では確定していません。お客様と日時を調整後、行を選んで「選択した予約を確定にする」を実行してください。');

  notifyOwner_(
    '【要確認】' + problems.join('・') + '：' + b.name + ' 様の予約',
    '次の予約は自動では確定していません（理由：' + problems.join('・') + '）。\n' +
      'お客様と日時を調整してください。\n\n' + bookingSummary_(b) + '\n\n' +
      '予約管理シート：' + SpreadsheetApp.getActiveSpreadsheet().getUrl()
  );

  if (CONFIG.SEND_PENDING_NOTICE && b.email) {
    const sent = sendCustomerMail_(b, MAIL.PENDING_SUBJECT, MAIL.PENDING_BODY);
    sheet.getRange(row, COL['確認メール']).setValue(sent ? '仮受付メール送信済' : '未送信');
  }
}

// ============================================================
//  重複・日時のチェック
// ============================================================

/**
 * 予約に問題がないか調べ、問題の一覧（例：['重複予約']）を返します。何もなければ空の配列。
 * @param {number} selfRow チェック対象の予約自身の行（自分自身と重複判定しないため）
 */
function findProblems_(b, sheet, selfRow) {
  if (!b.start) return ['日時が読み取れません'];
  if (!isValidEmail_(b.email)) return ['メールアドレス不備'];

  const problems = [];
  if (b.start.getTime() < Date.now()) problems.push('過去の日時');
  if (CONFIG.CLOSED_WEEKDAYS.indexOf(b.start.getDay()) !== -1) problems.push('定休日');
  if (!isWithinHours_(b.start)) problems.push('営業時間外');

  // --- 予約管理シートの「確定」済み予約と時間が重なっていないか ---
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const data = sheet.getRange(2, 1, lastRow - 1, COLUMNS.length).getValues();
    let overlapCount = 0;
    data.forEach(function (r, i) {
      if (i + 2 === selfRow) return; // 自分自身は数えない
      if (r[COL['ステータス'] - 1] !== STATUS.CONFIRMED) return; // 確定済みだけを数える
      const s = r[COL['開始'] - 1];
      const en = r[COL['終了'] - 1];
      if (!(s instanceof Date) || !(en instanceof Date)) return;
      if (isOverlapping_(b.start, b.end, s, en)) overlapCount++;
    });
    if (overlapCount >= CONFIG.CAPACITY_PER_SLOT) problems.push('重複予約');
  }

  // --- カレンダーに手入力した予定（このツール以外が作った予定）と重なっていないか ---
  if (CONFIG.CHECK_CALENDAR_CONFLICTS) {
    const others = getCalendar_().getEvents(b.start, b.end).filter(function (ev) {
      return ev.getTag(CONFIG.EVENT_TAG_KEY) !== CONFIG.EVENT_TAG_VALUE && !ev.isAllDayEvent();
    });
    if (others.length > 0) problems.push('カレンダーに別の予定あり');
  }

  return problems;
}

/** 2つの時間帯が少しでも重なっていれば true（10:00-11:00 と 11:00-12:00 は重ならない扱い） */
function isOverlapping_(start1, end1, start2, end2) {
  return start1.getTime() < end2.getTime() && start2.getTime() < end1.getTime();
}

/** 開始時刻が営業時間（最初の枠〜最後の枠）の範囲内か */
function isWithinHours_(start) {
  const minutes = start.getHours() * 60 + start.getMinutes();
  return minutes >= toMinutes_(CONFIG.OPEN_TIME) && minutes <= toMinutes_(CONFIG.LAST_START_TIME);
}

// ============================================================
//  前日リマインド（毎日1回、トリガーから呼ばれます）
// ============================================================

/** 明日「確定」の予約があるお客様へ、リマインドメールを送ります（送信済みの人には再送しません） */
function sendReminders() {
  const sheet = getBookingSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const now = new Date();
  const tomorrowKey = Utilities.formatDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), tz_(), 'yyyyMMdd');
  const data = sheet.getRange(2, 1, lastRow - 1, COLUMNS.length).getValues();
  let count = 0;

  data.forEach(function (r, i) {
    const row = i + 2;
    const start = r[COL['開始'] - 1];
    if (r[COL['ステータス'] - 1] !== STATUS.CONFIRMED) return;
    if (!(start instanceof Date)) return;
    if (Utilities.formatDate(start, tz_(), 'yyyyMMdd') !== tomorrowKey) return;
    if (r[COL['リマインド'] - 1] !== '') return; // 送信済み

    const b = rowToBooking_(r);
    if (sendCustomerMail_(b, MAIL.REMINDER_SUBJECT, MAIL.REMINDER_BODY)) {
      sheet.getRange(row, COL['リマインド']).setValue(new Date());
      count++;
    } else {
      sheet.getRange(row, COL['メモ']).setValue('リマインド未送信（メール送信の上限に達した可能性があります）');
    }
  });
  return count;
}

// ============================================================
//  データの読み取り・変換
// ============================================================

/** フォームの回答（質問名 → 回答）から予約データを作ります */
function parseAnswers_(nv) {
  const get = function (key) {
    const v = nv[CONFIG.FIELDS[key]];
    return v ? String(Array.isArray(v) ? v.join(', ') : v).trim() : '';
  };
  const b = {
    name: get('NAME'),
    email: get('EMAIL'),
    tel: get('TEL'),
    menu: get('MENU'),
    note: get('NOTE'),
    rawDate: get('DATE'),
    rawTime: get('TIME'),
    start: null,
    end: null,
    date: null,
  };

  // 日付：「2026/11/20」「2026-11-20」「2026年11月20日」のどれでも読めるようにする
  const dm = b.rawDate.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  // 時間：「10:00」「10:00〜11:00」の最初の時刻を開始時刻とする
  const tm = b.rawTime.match(/(\d{1,2}):(\d{2})/);
  if (dm && tm) {
    b.start = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
    b.end = new Date(b.start.getTime() + CONFIG.SLOT_MINUTES * 60 * 1000);
    b.date = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]));
  }
  return b;
}

/** 予約管理シートの1行から予約データを作ります */
function rowToBooking_(r) {
  return {
    id: r[COL['予約ID'] - 1],
    name: r[COL['お名前'] - 1],
    email: String(r[COL['メールアドレス'] - 1]).trim(),
    tel: r[COL['電話番号'] - 1],
    menu: r[COL['メニュー'] - 1],
    note: r[COL['ご要望'] - 1],
    start: r[COL['開始'] - 1] instanceof Date ? r[COL['開始'] - 1] : null,
    end: r[COL['終了'] - 1] instanceof Date ? r[COL['終了'] - 1] : null,
  };
}

// ============================================================
//  メール
// ============================================================

/**
 * お客様へメールを送ります。送れたら true。
 * Gmail の1日の送信上限を超えそうなときは送らずに false を返します（オーナーにも知らせます）。
 */
function sendCustomerMail_(b, subjectTpl, bodyTpl) {
  if (!isValidEmail_(b.email)) return false;
  if (MailApp.getRemainingDailyQuota() < 2) { // オーナー通知の分を1通残しておく
    notifyOwner_('【要確認】本日のメール送信上限に達しました', b.name + ' 様へのメールが送れませんでした。\n\n' + bookingSummary_(b));
    return false;
  }
  const vars = mailVars_(b);
  MailApp.sendEmail({
    to: b.email,
    subject: fillTemplate_(subjectTpl, vars),
    body: fillTemplate_(bodyTpl, vars),
    name: CONFIG.SHOP_NAME,
    replyTo: getOwnerEmail_(), // お客様が「返信」したらお店に届く
  });
  return true;
}

/** オーナー（お店側）へ通知メールを送ります */
function notifyOwner_(subject, body) {
  try {
    if (MailApp.getRemainingDailyQuota() < 1) return;
    MailApp.sendEmail({ to: getOwnerEmail_(), subject: subject, body: body, name: CONFIG.SHOP_NAME + ' 予約システム' });
  } catch (err) {
    console.error('オーナーへの通知に失敗しました：' + err.message);
  }
}

function mailVars_(b) {
  return {
    '店名': CONFIG.SHOP_NAME,
    'お名前': b.name,
    '予約ID': b.id || '',
    '日時': b.start ? formatDateTime_(b.start, b.end) : '（日時不明）',
    'メニュー': b.menu || '（未選択）',
  };
}

/** 予約内容をメールやカレンダーに載せる文章にします */
function bookingSummary_(b) {
  return [
    '予約番号：' + (b.id || ''),
    'お名前　：' + b.name + ' 様',
    '日時　　：' + (b.start ? formatDateTime_(b.start, b.end) : (b.rawDate || '') + ' ' + (b.rawTime || '') + '（読み取れませんでした）'),
    'メニュー：' + (b.menu || ''),
    'メール　：' + (b.email || ''),
    '電話　　：' + (b.tel || ''),
    'ご要望　：' + (b.note || ''),
  ].join('\n');
}

// ============================================================
//  小さな便利関数
// ============================================================

function tz_() {
  return Session.getScriptTimeZone();
}

function getOwnerEmail_() {
  return CONFIG.OWNER_EMAIL || Session.getEffectiveUser().getEmail();
}

function getCalendar_() {
  const cal = CONFIG.CALENDAR_ID ? CalendarApp.getCalendarById(CONFIG.CALENDAR_ID) : CalendarApp.getDefaultCalendar();
  if (!cal) throw new Error('カレンダーが見つかりません。CONFIG の CALENDAR_ID を確認してください。');
  return cal;
}

/** 予約管理シートを取得します（無ければ見出し・書式つきで作ります） */
function getBookingSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (sheet) return sheet;

  sheet = ss.insertSheet(CONFIG.SHEET_NAME, 0);
  sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]).setFontWeight('bold').setBackground('#eef2f7');
  sheet.setFrozenRows(1);
  sheet.getRange(2, COL['受付日時'], sheet.getMaxRows() - 1, 1).setNumberFormat('yyyy/mm/dd hh:mm');
  sheet.getRange(2, COL['予約日'], sheet.getMaxRows() - 1, 1).setNumberFormat('yyyy/mm/dd(ddd)');
  sheet.getRange(2, COL['開始'], sheet.getMaxRows() - 1, 2).setNumberFormat('hh:mm');
  sheet.getRange(2, COL['確認メール'], sheet.getMaxRows() - 1, 2).setNumberFormat('mm/dd hh:mm');
  sheet.setColumnWidth(COL['予約ID'], 110);
  sheet.setColumnWidth(COL['お名前'], 110);
  sheet.setColumnWidth(COL['メールアドレス'], 200);
  sheet.setColumnWidth(COL['メニュー'], 200);
  sheet.setColumnWidth(COL['ご要望'], 200);
  sheet.setColumnWidth(COL['ステータス'], 170);
  sheet.setColumnWidth(COL['メモ'], 300);
  sheet.hideColumns(COL['カレンダー予定ID']); // 機械用の列なので隠しておく

  // ステータスで行に色をつける（要確認＝赤、キャンセル＝グレー）
  const all = sheet.getRange(2, 1, sheet.getMaxRows() - 1, COLUMNS.length);
  const statusCol = columnLetter_(COL['ステータス']);
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=LEFT($' + statusCol + '2,3)="' + STATUS.NEEDS_CHECK + '"')
      .setBackground('#fde2e1').setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + statusCol + '2="' + STATUS.CANCELED + '"')
      .setBackground('#eeeeee').setFontColor('#888888').setRanges([all]).build(),
  ]);
  return sheet;
}

/** 列番号 → 列の英字（11 → K） */
function columnLetter_(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 「10:00」→ 600（分） */
function toMinutes_(hhmm) {
  const m = String(hhmm).match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** 2026年11月20日(金) 10:00〜11:00 の形にします */
function formatDateTime_(start, end) {
  const week = ['日', '月', '火', '水', '木', '金', '土'][start.getDay()];
  if (!end) end = new Date(start.getTime() + CONFIG.SLOT_MINUTES * 60 * 1000);
  return Utilities.formatDate(start, tz_(), 'yyyy年M月d日') + '(' + week + ') ' +
    Utilities.formatDate(start, tz_(), 'H:mm') + '〜' + Utilities.formatDate(end, tz_(), 'H:mm');
}

function isValidEmail_(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s));
}

/** 「{お名前}」のような目印を実際の値に置き換えます */
function fillTemplate_(text, vars) {
  return String(text).replace(/\{([^}]+)\}/g, function (all, key) {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : all;
  });
}
