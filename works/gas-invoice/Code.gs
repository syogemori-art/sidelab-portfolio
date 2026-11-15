/**
 * ============================================================
 *  売上一覧から請求書を一括作成（サンプル）
 *  制作：サイドラボ　※ポートフォリオ用サンプル。データはすべて架空です。
 * ============================================================
 *
 * ■ できること
 *   「売上一覧」シートの中から指定した月の売上を取引先ごとにまとめ、
 *   「請求書テンプレート」をもとに請求書を作って PDF で Google ドライブに保存します。
 *   設定で ON にすると、PDF を添付した Gmail の「下書き」も作ります（自動送信はしません）。
 *
 * ■ ファイル構成
 *   Code.gs  … このファイル。設定・メニュー・請求書作成の本体
 *   Setup.gs … 空のスプレッドシートにサンプルデータとテンプレートを作る初期設定
 *
 * ■ 使い方（くわしくは README.md）
 *   1. スプレッドシートを開き「拡張機能 → Apps Script」に Code.gs と Setup.gs を貼り付けて保存
 *   2. スプレッドシートを再読み込み → メニュー「請求書 → 初期設定（サンプルデータを作成）」
 *   3. 「請求書テンプレート」の発行元・登録番号・振込先を自社の情報に書き換え
 *   4. メニュー「請求書 → 今月分の請求書を作成」
 */

// ============================================================
//  設定（ここだけ書き換えれば動きを変えられます）
// ============================================================
const CONFIG = {
  // --- シート名 ---
  SHEET_SALES: '売上一覧',
  SHEET_CLIENTS: '取引先',
  SHEET_TEMPLATE: '請求書テンプレート',
  SHEET_LOG: '作成履歴',

  // --- 消費税 ---
  TAX_RATE: 0.10, // 10%
  // 端数処理：'floor'＝切り捨て / 'round'＝四捨五入 / 'ceil'＝切り上げ
  // ※インボイス制度では「1枚の請求書につき、税率ごとに1回」端数処理します（このツールもその方式です）
  TAX_ROUNDING: 'floor',

  // --- 出力 ---
  PDF_FOLDER_NAME: '請求書PDF', // マイドライブ直下に作るフォルダ名（中に「2026年11月」などの月別フォルダを作ります）
  CREATE_GMAIL_DRAFT: true, // true＝Gmailの下書きを作る / false＝PDFだけ作る（どちらでも自動送信はしません）
  KEEP_INVOICE_SHEETS: false, // true＝作成した請求書シートを残す / false＝PDF化したら削除してシートを散らかさない

  // --- 日付 ---
  // 請求日：'END_OF_MONTH'＝対象月の末日（月末締め） / 'TODAY'＝作成した日
  ISSUE_DATE_MODE: 'END_OF_MONTH',
  PAYMENT_DUE_MONTHS: 1, // 支払期限＝請求月の◯か月後の末日（1＝翌月末）

  // --- 取引先シートに敬称がないときの既定値 ---
  DEFAULT_HONORIFIC: '御中',

  // --- Gmail下書きの件名・本文（{ } の部分は自動で差し込まれます） ---
  MAIL_SUBJECT: '【ご請求書】{年月}分（{発行元}）',
  MAIL_BODY: [
    '{取引先} {敬称}',
    '',
    'いつもお世話になっております。{発行元}です。',
    '{年月}分のご請求書をお送りいたします。',
    '',
    '　請求書番号：{請求書番号}',
    '　ご請求金額：{合計}円（税込）',
    '　お支払期限：{支払期限}',
    '',
    '添付のPDFをご確認のうえ、期日までにお振込みいただけますと幸いです。',
    '何卒よろしくお願いいたします。',
    '',
    '{発行元}',
  ].join('\n'),

  // --- テンプレートのセル位置（自社オリジナルの請求書に差し替えるときはここを合わせます） ---
  CELLS: {
    CLIENT_NAME: 'A3', // 宛名（取引先名＋敬称）
    CLIENT_ADDRESS: 'A4', // 宛先住所
    ISSUE_DATE: 'E3', // 請求日
    INVOICE_NO: 'E4', // 請求書番号
    DUE_DATE: 'E5', // お支払期限
    ISSUER_NAME: 'D7', // 発行元（自社名）… 読み取り専用。メール本文に使います
    ISSUER_REG_NO: 'D10', // 登録番号 … 読み取り専用。未入力チェックに使います
    HEADLINE_TOTAL: 'B9', // 「ご請求金額（税込）」の大きな金額
    BANK: 'B32', // 振込先 … 読み取り専用。未入力チェックに使います
    SUBTOTAL: 'E28', // 小計（税抜）
    TAX: 'E29', // 消費税
    TOTAL: 'E30', // 合計（税込）
  },
  ITEM_START_ROW: 13, // 明細の1行目
  ITEM_ROWS: 15, // テンプレートに用意した明細の行数（超えたら自動で行を増やします）
  // 明細は A列から「日付・品目・数量・単価・金額」の5列

  // テンプレートに残っていたら「書き換え忘れ」として警告する目印
  PLACEHOLDER_MARK: '【要変更】',

  // 1回の実行で使う時間の上限（Apps Script は1回6分まで。余裕をみて5分で止めます）
  TIME_LIMIT_MS: 5 * 60 * 1000,
};

// 売上一覧の見出し（列の順番が入れ替わっていても、見出しの文字で列を探します）
const SALES_HEADERS = {
  DATE: '日付',
  CLIENT: '取引先',
  ITEM: '品目',
  QTY: '数量',
  PRICE: '単価',
  AMOUNT: '金額',
};

// 取引先シートの見出し
const CLIENT_HEADERS = {
  NAME: '取引先名',
  HONORIFIC: '敬称',
  EMAIL: 'メール',
  ADDRESS: '住所',
};

// ============================================================
//  メニュー
// ============================================================

/** スプレッドシートを開いたときに「請求書」メニューを追加します */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('請求書')
    .addItem('今月分の請求書を作成', 'createMonthlyInvoices')
    .addSeparator()
    .addItem('初期設定（サンプルデータを作成）', 'setupSampleData')
    .addToUi();
}

// ============================================================
//  メイン処理
// ============================================================

/**
 * 対象月を聞いて、取引先ごとの請求書（PDF・Gmail下書き）を一括作成します。
 * メニュー「請求書 → 今月分の請求書を作成」から実行されます。
 */
function createMonthlyInvoices() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const startedAt = Date.now();

  try {
    // --- 1. 必要なシートがそろっているか確認 ---
    const salesSheet = getRequiredSheet_(ss, CONFIG.SHEET_SALES);
    const clientSheet = getRequiredSheet_(ss, CONFIG.SHEET_CLIENTS);
    const template = getRequiredSheet_(ss, CONFIG.SHEET_TEMPLATE);

    // --- 2. 対象月を入力してもらう（空欄なら今月） ---
    const thisMonth = Utilities.formatDate(new Date(), tz, 'yyyy/MM');
    const res = ui.prompt(
      '請求書の作成',
      '対象の月を入力してください（例：' + thisMonth + '）\n空欄のまま OK を押すと今月分（' + thisMonth + '）を作成します。',
      ui.ButtonSet.OK_CANCEL
    );
    if (res.getSelectedButton() !== ui.Button.OK) return;
    const ym = parseYearMonth_(res.getResponseText() || thisMonth);
    if (!ym) {
      ui.alert('月の形式が読み取れませんでした。「2026/11」のように入力してください。');
      return;
    }

    // --- 3. 売上を取引先ごとにまとめる ---
    const clients = readClients_(clientSheet);
    const groups = groupSalesByClient_(salesSheet, ym, tz, clients);
    if (groups.length === 0) {
      ui.alert(ym.label + 'の売上が「' + CONFIG.SHEET_SALES + '」に見つかりませんでした。');
      return;
    }

    // --- 4. 実行前の確認（テンプレートの書き換え忘れもここで警告） ---
    const warnings = checkTemplatePlaceholders_(template);
    let msg = ym.label + '分の請求書を ' + groups.length + ' 件作成します。\n\n' +
      groups.map(function (g) { return '・' + g.client.name + '（明細 ' + g.items.length + ' 行）'; }).join('\n') +
      '\n\nPDF の保存先：マイドライブ / ' + CONFIG.PDF_FOLDER_NAME + ' / ' + ym.label +
      '\nGmail 下書き：' + (CONFIG.CREATE_GMAIL_DRAFT ? '作成する（送信はしません）' : '作成しない');
    if (warnings.length > 0) {
      msg += '\n\n⚠ 注意：テンプレートに書き換え前の項目があります\n' + warnings.join('\n');
    }
    msg += '\n\nよろしいですか？';
    if (ui.alert('確認', msg, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;

    // --- 5. 1社ずつ請求書を作成 ---
    const folder = getOrCreateMonthFolder_(ym);
    const issuerName = String(template.getRange(CONFIG.CELLS.ISSUER_NAME).getDisplayValue()).trim();
    const results = [];
    let stoppedAt = -1;

    for (let i = 0; i < groups.length; i++) {
      // 6分制限に引っかかる前に止める
      if (Date.now() - startedAt > CONFIG.TIME_LIMIT_MS) {
        stoppedAt = i;
        break;
      }
      try {
        results.push(createInvoiceForClient_(ss, template, groups[i], ym, folder, issuerName));
      } catch (err) {
        // 1社でエラーが出ても、残りの取引先の処理は続けます
        results.push({ client: groups[i].client, error: err.message });
      }
    }

    // --- 6. 履歴シートに記録して結果を表示 ---
    writeLog_(ss, ym, results);
    showSummary_(ui, ym, results, groups, stoppedAt, folder);
  } catch (err) {
    ui.alert('エラーが発生しました', err.message, ui.ButtonSet.OK);
  }
}

/**
 * 1社分の請求書を作ります。
 * テンプレートをコピー → 値を書き込み → PDF化 → （設定がONなら）Gmail下書き作成
 */
function createInvoiceForClient_(ss, template, group, ym, folder, issuerName) {
  const client = group.client;
  const items = group.items;
  const invoiceNo = ym.key + '-' + ('000' + client.number).slice(-3); // 例：202611-001
  const fileName = '請求書_' + ym.key + '_' + client.name;

  // --- 金額計算（消費税は請求書1枚につき1回だけ端数処理） ---
  const subtotal = items.reduce(function (sum, it) { return sum + it.amount; }, 0);
  const tax = roundYen_(subtotal * CONFIG.TAX_RATE);
  const total = subtotal + tax;

  // --- 日付 ---
  const issueDate = CONFIG.ISSUE_DATE_MODE === 'TODAY' ? new Date() : new Date(ym.year, ym.month, 0); // 0日＝前月末
  const dueDate = new Date(ym.year, ym.month + CONFIG.PAYMENT_DUE_MONTHS, 0);

  // --- テンプレートをコピー（同じ名前のシートが残っていれば作り直す） ---
  const sheetName = safeSheetName_(fileName);
  const old = ss.getSheetByName(sheetName);
  if (old) ss.deleteSheet(old);
  const sheet = template.copyTo(ss).setName(sheetName);
  // テンプレートの「メモ」（書き換え案内）はPDFに脚注として印刷されてしまうため、コピー側では消す
  sheet.getDataRange().clearNote();

  try {
    const c = CONFIG.CELLS;
    sheet.getRange(c.CLIENT_NAME).setValue(client.name + '　' + client.honorific);
    sheet.getRange(c.CLIENT_ADDRESS).setValue(client.address);
    sheet.getRange(c.ISSUE_DATE).setValue(issueDate);
    sheet.getRange(c.INVOICE_NO).setValue(invoiceNo);
    sheet.getRange(c.DUE_DATE).setValue(dueDate);
    sheet.getRange(c.HEADLINE_TOTAL).setValue(total);

    // --- 明細：テンプレートの行数を超える場合は行を追加（書式も引き継がれます） ---
    const extraRows = Math.max(0, items.length - CONFIG.ITEM_ROWS);
    if (extraRows > 0) {
      sheet.insertRowsAfter(CONFIG.ITEM_START_ROW + CONFIG.ITEM_ROWS - 2, extraRows);
    }
    const rowCount = CONFIG.ITEM_ROWS + extraRows;
    const values = [];
    for (let r = 0; r < rowCount; r++) {
      const it = items[r];
      values.push(it ? [it.date, it.item, it.qty, it.price, it.amount] : ['', '', '', '', '']);
    }
    sheet.getRange(CONFIG.ITEM_START_ROW, 1, rowCount, 5).setValues(values);

    // 行を追加した分だけ、合計欄の位置を下にずらして書き込む
    sheet.getRange(c.SUBTOTAL).offset(extraRows, 0).setValue(subtotal);
    sheet.getRange(c.TAX).offset(extraRows, 0).setValue(tax);
    sheet.getRange(c.TOTAL).offset(extraRows, 0).setValue(total);

    SpreadsheetApp.flush(); // 書き込みを確定させてから PDF にする

    // --- PDF を作ってドライブに保存（同名ファイルがあればゴミ箱へ移して置き換え） ---
    const pdfBlob = exportSheetAsPdf_(ss, sheet, fileName + '.pdf');
    trashSameNameFiles_(folder, fileName + '.pdf');
    const pdfFile = folder.createFile(pdfBlob);

    // --- Gmail 下書き（送信はしません） ---
    let draftNote = '作成しない設定';
    if (CONFIG.CREATE_GMAIL_DRAFT) {
      if (isValidEmail_(client.email)) {
        const vars = {
          '取引先': client.name,
          '敬称': client.honorific,
          '年月': ym.label,
          '請求書番号': invoiceNo,
          '合計': formatYen_(total),
          '支払期限': Utilities.formatDate(dueDate, ss.getSpreadsheetTimeZone(), 'yyyy年M月d日'),
          '発行元': issuerName,
        };
        GmailApp.createDraft(client.email, fillTemplate_(CONFIG.MAIL_SUBJECT, vars), fillTemplate_(CONFIG.MAIL_BODY, vars), {
          attachments: [pdfFile.getBlob()],
          name: issuerName,
        });
        draftNote = '下書き作成済み';
      } else {
        draftNote = 'メールアドレス未登録のため下書きなし';
      }
    }

    return {
      client: client,
      invoiceNo: invoiceNo,
      subtotal: subtotal,
      tax: tax,
      total: total,
      pdfUrl: pdfFile.getUrl(),
      draftNote: draftNote,
    };
  } finally {
    // 設定に応じて作業用シートを片付ける（エラー時も残さない）
    if (!CONFIG.KEEP_INVOICE_SHEETS) ss.deleteSheet(sheet);
  }
}

// ============================================================
//  データの読み込み
// ============================================================

/** 取引先シートを読み込み、{ 取引先名: {name, honorific, email, address, number} } の形にします */
function readClients_(sheet) {
  const data = sheet.getDataRange().getValues();
  const col = findColumns_(data[0], CLIENT_HEADERS, CONFIG.SHEET_CLIENTS);
  const map = {};
  for (let r = 1; r < data.length; r++) {
    const name = String(data[r][col.NAME]).trim();
    if (!name) continue;
    map[name] = {
      name: name,
      honorific: String(data[r][col.HONORIFIC]).trim() || CONFIG.DEFAULT_HONORIFIC,
      email: String(data[r][col.EMAIL]).trim(),
      address: String(data[r][col.ADDRESS]).trim(),
      number: r, // 請求書番号の連番に使う（取引先シートの何行目か）
      order: r,
    };
  }
  return map;
}

/**
 * 売上一覧から対象月の行だけを取り出し、取引先ごとにまとめます。
 * 戻り値：[{ client, items:[{date,item,qty,price,amount}] }, ...]（取引先シートの並び順）
 */
function groupSalesByClient_(sheet, ym, tz, clients) {
  const data = sheet.getDataRange().getValues();
  const col = findColumns_(data[0], SALES_HEADERS, CONFIG.SHEET_SALES);
  const groups = {};
  let unknownCount = 0;

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const date = toDate_(row[col.DATE]);
    const clientName = String(row[col.CLIENT]).trim();
    if (!date || !clientName) continue; // 空行や日付のない行は飛ばす
    if (Utilities.formatDate(date, tz, 'yyyyMM') !== ym.key) continue; // 対象月以外は飛ばす

    const qty = toNumber_(row[col.QTY]);
    const price = toNumber_(row[col.PRICE]);
    // 金額欄が空なら「数量 × 単価」で計算
    const amountCell = row[col.AMOUNT];
    const amount = amountCell === '' || amountCell === null ? Math.round(qty * price) : toNumber_(amountCell);

    if (!groups[clientName]) {
      let client = clients[clientName];
      if (!client) {
        // 取引先シートに無い名前でも請求書は作る（宛名だけの請求書。メール下書きは作られません）
        unknownCount++;
        client = {
          name: clientName,
          honorific: CONFIG.DEFAULT_HONORIFIC,
          email: '',
          address: '',
          number: 900 + unknownCount,
          order: 100000 + unknownCount,
        };
      }
      groups[clientName] = { client: client, items: [] };
    }
    groups[clientName].items.push({
      date: date,
      item: String(row[col.ITEM]).trim(),
      qty: qty,
      price: price,
      amount: amount,
    });
  }

  return Object.keys(groups)
    .map(function (k) {
      // 明細は日付の古い順に並べる
      groups[k].items.sort(function (a, b) { return a.date - b.date; });
      return groups[k];
    })
    .sort(function (a, b) { return a.client.order - b.client.order; });
}

/** 見出し行から、必要な列が何列目かを探します。見つからなければ分かりやすいエラーにします */
function findColumns_(headerRow, headers, sheetName) {
  const trimmed = headerRow.map(function (h) { return String(h).trim(); });
  const col = {};
  const missing = [];
  Object.keys(headers).forEach(function (key) {
    const idx = trimmed.indexOf(headers[key]);
    if (idx === -1) missing.push(headers[key]);
    col[key] = idx;
  });
  if (missing.length > 0) {
    throw new Error('「' + sheetName + '」シートの1行目に、次の見出しが見つかりません：' + missing.join('、'));
  }
  return col;
}

// ============================================================
//  PDF・ドライブ
// ============================================================

/**
 * 指定したシートだけを A4縦・枠線なしの PDF にします。
 * Google の書き出し機能は短時間に連続で呼ぶと一時的に断られる（429）ことがあるため、少し待って再試行します。
 */
function exportSheetAsPdf_(ss, sheet, fileName) {
  const params = {
    format: 'pdf',
    size: 'A4',
    portrait: 'true',
    fitw: 'true', // 横幅をページに合わせる
    gridlines: 'false', // 枠線（グリッド）を印刷しない
    printtitle: 'false',
    sheetnames: 'false',
    pagenum: 'UNDEFINED',
    fzr: 'false',
    top_margin: '0.6',
    bottom_margin: '0.6',
    left_margin: '0.6',
    right_margin: '0.6',
    horizontal_alignment: 'CENTER',
    gid: String(sheet.getSheetId()),
  };
  const query = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  const url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?' + query;

  const maxTries = 4;
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    const res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code === 200) {
      Utilities.sleep(1000); // 次の書き出しまで少し間をあける
      return res.getBlob().setName(fileName);
    }
    if ((code === 429 || code >= 500) && attempt < maxTries) {
      Utilities.sleep(3000 * attempt); // 3秒、6秒、9秒…と待ってから再試行
      continue;
    }
    throw new Error('PDF の作成に失敗しました（コード ' + code + '）。少し時間をおいて再実行してください。');
  }
  throw new Error('PDF の作成に失敗しました。');
}

/** マイドライブ / 請求書PDF / 2026年11月 のようなフォルダを用意します（無ければ作る） */
function getOrCreateMonthFolder_(ym) {
  const parent = getOrCreateChildFolder_(DriveApp.getRootFolder(), CONFIG.PDF_FOLDER_NAME);
  return getOrCreateChildFolder_(parent, ym.label);
}

function getOrCreateChildFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** 同じ名前の古い PDF をゴミ箱へ移します（完全削除ではないので、ゴミ箱から戻せます） */
function trashSameNameFiles_(folder, name) {
  const files = folder.getFilesByName(name);
  while (files.hasNext()) files.next().setTrashed(true);
}

// ============================================================
//  記録・結果表示
// ============================================================

/** 「作成履歴」シートに今回の結果を追記します */
function writeLog_(ss, ym, results) {
  if (results.length === 0) return;
  let sheet = ss.getSheetByName(CONFIG.SHEET_LOG);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_LOG);
    sheet.appendRow(['作成日時', '対象月', '取引先', '請求書番号', '小計（税抜）', '消費税', '合計（税込）', 'PDF', 'Gmail', 'エラー']);
    sheet.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#f1f3f4');
    sheet.setFrozenRows(1);
  }
  const now = new Date();
  const rows = results.map(function (r) {
    return [now, ym.label, r.client.name, r.invoiceNo || '', r.subtotal || '', r.tax || '', r.total || '',
      r.pdfUrl || '', r.draftNote || '', r.error || ''];
  });
  const start = sheet.getLastRow() + 1;
  sheet.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
  sheet.getRange(start, 1, rows.length, 1).setNumberFormat('yyyy/mm/dd hh:mm');
  sheet.getRange(start, 5, rows.length, 3).setNumberFormat('#,##0');
}

/** 終了メッセージを表示します */
function showSummary_(ui, ym, results, groups, stoppedAt, folder) {
  const ok = results.filter(function (r) { return !r.error; });
  const ng = results.filter(function (r) { return r.error; });
  let msg = ym.label + '分：' + ok.length + ' 件の請求書を作成しました。\n\n';
  msg += ok.map(function (r) {
    return '・' + r.client.name + '　' + formatYen_(r.total) + '円（' + r.draftNote + '）';
  }).join('\n');
  if (ng.length > 0) {
    msg += '\n\n▼ 作成できなかった取引先\n' + ng.map(function (r) { return '・' + r.client.name + '：' + r.error; }).join('\n');
  }
  if (stoppedAt >= 0) {
    msg += '\n\n▼ 時間の上限に近づいたため途中で止めました。未作成：\n' +
      groups.slice(stoppedAt).map(function (g) { return '・' + g.client.name; }).join('\n') +
      '\n（作成済みの分は上書きされるだけなので、もう一度実行して大丈夫です）';
  }
  msg += '\n\nPDF の保存先：' + folder.getUrl();
  if (CONFIG.CREATE_GMAIL_DRAFT) msg += '\nGmail の「下書き」フォルダを確認してから送信してください。';
  ui.alert('完了', msg, ui.ButtonSet.OK);
}

/** テンプレートに「【要変更】」が残っていないかチェックします */
function checkTemplatePlaceholders_(template) {
  const checks = [
    ['発行元', CONFIG.CELLS.ISSUER_NAME],
    ['登録番号', CONFIG.CELLS.ISSUER_REG_NO],
    ['振込先', CONFIG.CELLS.BANK],
  ];
  return checks
    .filter(function (c) { return String(template.getRange(c[1]).getDisplayValue()).indexOf(CONFIG.PLACEHOLDER_MARK) !== -1; })
    .map(function (c) { return '・' + c[0] + '（「' + CONFIG.SHEET_TEMPLATE + '」シートの ' + c[1] + '）'; });
}

// ============================================================
//  小さな便利関数
// ============================================================

function getRequiredSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error('「' + name + '」シートが見つかりません。\nメニュー「請求書 → 初期設定（サンプルデータを作成）」を実行するか、シート名を確認してください。');
  }
  return sheet;
}

/** 「2026/11」「2026-11」「202611」「2026年11月」などを読み取ります */
function parseYearMonth_(text) {
  const s = String(text).replace(/[０-９]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0xFEE0); }).trim();
  const m = s.match(/^(\d{4})\D*(\d{1,2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return {
    year: year,
    month: month, // 1〜12
    key: year + ('0' + month).slice(-2), // 202611
    label: year + '年' + month + '月', // 2026年11月
  };
}

/** セルの値を日付に変換します（日付として読めなければ null） */
function toDate_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (v === '' || v === null) return null;
  const d = new Date(String(v).replace(/-/g, '/'));
  return isNaN(d.getTime()) ? null : d;
}

/** 「1,200」「￥1,200」のような文字も数値に変換します */
function toNumber_(v) {
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** 設定に従って1円未満を処理します */
function roundYen_(n) {
  if (CONFIG.TAX_ROUNDING === 'round') return Math.round(n);
  if (CONFIG.TAX_ROUNDING === 'ceil') return Math.ceil(n);
  return Math.floor(n);
}

/** シート名に使えない文字を置き換え、長すぎる名前を切り詰めます */
function safeSheetName_(name) {
  return name.replace(/[:\\\/?*\[\]]/g, '_').slice(0, 90);
}

function isValidEmail_(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s));
}

/** 「{取引先}」のような目印を実際の値に置き換えます */
function fillTemplate_(text, vars) {
  return String(text).replace(/\{([^}]+)\}/g, function (all, key) {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : all;
  });
}

/** 12345 → "12,345" のように3桁ごとにカンマを入れます */
function formatYen_(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
