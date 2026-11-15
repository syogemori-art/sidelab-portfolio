/**
 * ============================================================
 *  メニュー・初期設定・テスト用の機能
 * ============================================================
 */

/** スプレッドシートを開いたときに「予約管理」メニューを追加します */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('予約管理')
    .addItem('初期設定（自動実行を登録）', 'setupTriggers')
    .addItem('サンプルの予約フォームを作成', 'setupSampleForm')
    .addSeparator()
    .addItem('テスト予約を1件入れる', 'addTestBooking')
    .addSeparator()
    .addItem('選択した予約を「確定」にする', 'confirmSelectedBookings')
    .addItem('選択した予約をキャンセルにする', 'cancelSelectedBookings')
    .addItem('明日分のリマインドを今すぐ送る', 'sendRemindersNow')
    .addToUi();
}

// ============================================================
//  初期設定
// ============================================================

/**
 * 自動実行（トリガー）を登録します。
 *   ・フォームが送信されたら handleFormSubmit を実行
 *   ・毎日 CONFIG.REMINDER_HOUR 時台に sendReminders を実行
 * 何回実行しても二重登録にならないよう、古い登録は消してから作り直します。
 */
function setupTriggers() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 設定の確認（カレンダーが見つかるか等）。問題があればここでエラーを表示して止まります
  getCalendar_();
  getBookingSheet_();

  const targets = ['handleFormSubmit', 'sendReminders'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (targets.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('handleFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('sendReminders').timeBased().everyDays(1).atHour(CONFIG.REMINDER_HOUR).create();

  let msg = '自動実行を登録しました。\n\n' +
    '・フォームに予約が入ると「' + CONFIG.SHEET_NAME + '」シートに記録し、確認メールとカレンダー登録を行います\n' +
    '・毎日 ' + CONFIG.REMINDER_HOUR + '時台に、翌日の予約のお客様へリマインドを送ります\n\n' +
    '通知先（オーナー）：' + getOwnerEmail_();
  if (!ss.getFormUrl()) {
    msg += '\n\n⚠ このスプレッドシートにはまだフォームがつながっていません。\n' +
      'メニュー「サンプルの予約フォームを作成」を使うか、お持ちのフォームの「回答」タブから、このスプレッドシートを回答先に設定してください。';
  }
  ui.alert('初期設定が完了しました', msg, ui.ButtonSet.OK);
}

/**
 * CONFIG の内容に合わせたサンプルの予約フォームを作り、このスプレッドシートを回答先にします。
 * （すでに予約フォームをお持ちの場合は不要です。質問名を CONFIG.FIELDS に合わせてください）
 */
function setupSampleForm() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (ss.getFormUrl()) {
    const ans = ui.alert('確認', 'このスプレッドシートにはすでにフォームがつながっています。\nそれでも新しいサンプルフォームを作りますか？', ui.ButtonSet.OK_CANCEL);
    if (ans !== ui.Button.OK) return;
  }

  const f = CONFIG.FIELDS;
  const form = FormApp.create(CONFIG.SHOP_NAME + ' ご予約フォーム（サンプル）');
  form.setDescription(
    '※これはサイドラボの動作サンプルです。店名は架空です。\n' +
      'ご予約内容を確認後、自動で確認メールをお送りします。'
  );
  form.addTextItem().setTitle(f.NAME).setRequired(true);
  form.addTextItem().setTitle(f.EMAIL).setRequired(true)
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().setHelpText('メールアドレスの形式で入力してください').build());
  form.addTextItem().setTitle(f.TEL);
  form.addDateItem().setTitle(f.DATE).setRequired(true)
    .setHelpText(CONFIG.CLOSED_WEEKDAYS.length ? '定休日：' + CONFIG.CLOSED_WEEKDAYS.map(function (d) { return '日月火水木金土'.charAt(d) + '曜'; }).join('・') : '');
  form.addListItem().setTitle(f.TIME).setRequired(true).setChoiceValues(buildSlotLabels_());
  form.addMultipleChoiceItem().setTitle(f.MENU).setRequired(true).setChoiceValues(CONFIG.MENUS);
  form.addParagraphTextItem().setTitle(f.NOTE);

  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  getBookingSheet_();

  ui.alert(
    'サンプルフォームを作成しました',
    '回答用URL（お客様に案内するURL）：\n' + form.getPublishedUrl() + '\n\n' +
      '編集用URL：\n' + form.getEditUrl() + '\n\n' +
      '次に、メニュー「初期設定（自動実行を登録）」を実行してください。',
    ui.ButtonSet.OK
  );
}

/** 「10:00〜11:00」のような予約枠の一覧を作ります */
function buildSlotLabels_() {
  const labels = [];
  const pad = function (n) { return ('0' + n).slice(-2); };
  for (let m = toMinutes_(CONFIG.OPEN_TIME); m <= toMinutes_(CONFIG.LAST_START_TIME); m += CONFIG.SLOT_MINUTES) {
    const e = m + CONFIG.SLOT_MINUTES;
    labels.push(Math.floor(m / 60) + ':' + pad(m % 60) + '〜' + Math.floor(e / 60) + ':' + pad(e % 60));
  }
  return labels;
}

// ============================================================
//  テスト
// ============================================================

/**
 * フォームを使わずに、テスト予約を1件入れます（明日以降の最初の営業日・最初の枠）。
 * お客様のメールアドレスにはオーナー自身のアドレスを使うので、確認メールが自分に届きます。
 * 2回続けて実行すると、同じ枠への「重複予約」の検知を試せます。
 */
function addTestBooking() {
  const ui = SpreadsheetApp.getUi();
  const ans = ui.alert(
    'テスト予約',
    'テスト予約を1件入れます。\n・カレンダーに予定が1件入ります\n・確認メールが ' + getOwnerEmail_() + ' に届きます\n\n続けますか？',
    ui.ButtonSet.OK_CANCEL
  );
  if (ans !== ui.Button.OK) return;

  // 明日以降で、定休日でない最初の日
  const d = new Date();
  do {
    d.setDate(d.getDate() + 1);
  } while (CONFIG.CLOSED_WEEKDAYS.indexOf(d.getDay()) !== -1);

  const nv = {};
  nv[CONFIG.FIELDS.NAME] = ['テスト 太郎'];
  nv[CONFIG.FIELDS.EMAIL] = [getOwnerEmail_()];
  nv[CONFIG.FIELDS.TEL] = ['000-0000-0000'];
  nv[CONFIG.FIELDS.DATE] = [Utilities.formatDate(d, tz_(), 'yyyy/MM/dd')];
  nv[CONFIG.FIELDS.TIME] = [buildSlotLabels_()[0]];
  nv[CONFIG.FIELDS.MENU] = [CONFIG.MENUS[0]];
  nv[CONFIG.FIELDS.NOTE] = ['（動作確認用のテスト予約です）'];

  handleFormSubmit({ namedValues: nv });
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(getBookingSheet_());
  ui.alert('テスト予約を入れました。「' + CONFIG.SHEET_NAME + '」シートの最終行と、メール・カレンダーを確認してください。');
}

// ============================================================
//  オーナーが手で使う機能
// ============================================================

/**
 * 選択した行の予約を「確定」にします（カレンダー登録＋お客様へ確認メール）。
 * 「要確認」になった予約を、お客様と調整したあとに使います。
 * ※日時を変更する場合は、先に「予約日」「開始」「終了」のセルを書き換えてから実行してください。
 */
function confirmSelectedBookings() {
  const ui = SpreadsheetApp.getUi();
  const sheet = getBookingSheet_();
  const rows = getSelectedRows_(sheet);
  if (rows.length === 0) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(30 * 1000);
  try {
    const done = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const values = sheet.getRange(row, 1, 1, COLUMNS.length).getValues()[0];
      const b = rowToBooking_(values);
      const status = values[COL['ステータス'] - 1];

      if (status === STATUS.CONFIRMED) continue; // すでに確定
      if (!b.start || !b.end) {
        ui.alert(row + '行目：「開始」「終了」に日時が入っていないため確定できません。');
        continue;
      }
      // 念のため重複を再チェックし、問題があれば確認する
      const problems = findProblems_(b, sheet, row);
      if (problems.length > 0) {
        const ans = ui.alert('確認', row + '行目（' + b.name + ' 様）：' + problems.join('・') + '\nそれでも確定しますか？', ui.ButtonSet.YES_NO);
        if (ans !== ui.Button.YES) continue;
      }
      confirmBooking_(sheet, row, b);
      sheet.getRange(row, COL['メモ']).setValue('手動で確定（' + Utilities.formatDate(new Date(), tz_(), 'M/d H:mm') + '）');
      done.push(b.name + ' 様');
    }
    ui.alert(done.length > 0 ? '確定しました：\n' + done.join('\n') : '確定した予約はありません。');
  } finally {
    lock.releaseLock();
  }
}

/**
 * 選択した行の予約をキャンセルにします（カレンダーの予定も削除）。
 * ※お客様へのキャンセル連絡は自動では送りません。必要に応じてご連絡ください。
 */
function cancelSelectedBookings() {
  const ui = SpreadsheetApp.getUi();
  const sheet = getBookingSheet_();
  const rows = getSelectedRows_(sheet);
  if (rows.length === 0) return;

  const ans = ui.alert('確認', rows.length + ' 件の予約をキャンセルにして、カレンダーの予定を削除します。\nよろしいですか？', ui.ButtonSet.OK_CANCEL);
  if (ans !== ui.Button.OK) return;

  const cal = getCalendar_();
  rows.forEach(function (row) {
    const eventId = sheet.getRange(row, COL['カレンダー予定ID']).getValue();
    if (eventId) {
      const ev = cal.getEventById(eventId);
      if (ev) ev.deleteEvent();
      sheet.getRange(row, COL['カレンダー予定ID']).setValue('');
    }
    sheet.getRange(row, COL['ステータス']).setValue(STATUS.CANCELED);
    sheet.getRange(row, COL['メモ']).setValue('キャンセル（' + Utilities.formatDate(new Date(), tz_(), 'M/d H:mm') + '）');
  });
  ui.alert(rows.length + ' 件をキャンセルにしました。');
}

/** 明日分のリマインドを今すぐ送ります（送信済みの人には送りません） */
function sendRemindersNow() {
  const count = sendReminders();
  SpreadsheetApp.getUi().alert('リマインドを ' + count + ' 件送信しました。');
}

/** 予約管理シートで選択されている行番号の一覧（見出し行を除く）。選択がおかしいときは案内を出して空を返します */
function getSelectedRows_(sheet) {
  const ui = SpreadsheetApp.getUi();
  const active = SpreadsheetApp.getActiveSheet();
  if (active.getName() !== sheet.getName()) {
    ui.alert('「' + CONFIG.SHEET_NAME + '」シートで、対象の予約の行を選択してから実行してください。');
    return [];
  }
  const rows = [];
  const ranges = active.getActiveRangeList() ? active.getActiveRangeList().getRanges() : [];
  ranges.forEach(function (r) {
    for (let i = r.getRow(); i <= r.getLastRow(); i++) {
      if (i >= 2 && i <= sheet.getLastRow() && rows.indexOf(i) === -1) rows.push(i);
    }
  });
  if (rows.length === 0) ui.alert('対象の予約の行（2行目以降）を選択してから実行してください。');
  return rows;
}
