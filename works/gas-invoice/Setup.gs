/**
 * ============================================================
 *  初期設定：サンプルデータと請求書テンプレートを作成します
 *  ※ここで作るデータ（会社名・住所・メールなど）はすべて架空です。
 * ============================================================
 *
 * 空のスプレッドシートで「請求書 → 初期設定（サンプルデータを作成）」を実行すると、
 *   ・売上一覧（今月と先月のサンプル売上）
 *   ・取引先（架空の3社）
 *   ・請求書テンプレート（A4で印刷できるレイアウト）
 * の3つのシートができ、すぐに「今月分の請求書を作成」を試せます。
 */

/** メニューから呼ばれる初期設定 */
function setupSampleData() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // すでに同じ名前のシートがあれば、上書きしてよいか確認する
  const names = [CONFIG.SHEET_SALES, CONFIG.SHEET_CLIENTS, CONFIG.SHEET_TEMPLATE];
  const existing = names.filter(function (n) { return ss.getSheetByName(n); });
  if (existing.length > 0) {
    const ans = ui.alert(
      '確認',
      '次のシートはすでにあります：\n' + existing.join('、') +
        '\n\nサンプルデータで作り直しますか？（今の内容は消えます）\n※実データを入れている場合は「キャンセル」を押してください。',
      ui.ButtonSet.OK_CANCEL
    );
    if (ans !== ui.Button.OK) return;
  }

  const clientSheet = recreateSheet_(ss, CONFIG.SHEET_CLIENTS);
  buildSampleClients_(clientSheet);

  const salesSheet = recreateSheet_(ss, CONFIG.SHEET_SALES);
  buildSampleSales_(salesSheet);

  const templateSheet = recreateSheet_(ss, CONFIG.SHEET_TEMPLATE);
  buildInvoiceTemplate_(templateSheet);

  removeEmptyDefaultSheet_(ss);
  ss.setActiveSheet(salesSheet);

  ui.alert(
    '初期設定が完了しました',
    'サンプルデータ（架空）を作成しました。\n\n' +
      '次の手順：\n' +
      '1.「' + CONFIG.SHEET_TEMPLATE + '」シートの【要変更】の部分（発行元・登録番号・振込先）を自社の情報に書き換え\n' +
      '2. メニュー「請求書 → 今月分の請求書を作成」を実行\n\n' +
      '※サンプルの取引先メールは example.com（実在しない練習用アドレス）なので、下書きを作っても誰にも届きません。',
    ui.ButtonSet.OK
  );
}

// ------------------------------------------------------------
//  サンプルデータ
// ------------------------------------------------------------

/** 架空の取引先3社 */
function buildSampleClients_(sheet) {
  const rows = [
    ['取引先名', '敬称', 'メール', '住所'],
    ['株式会社サンプル商事', '御中', 'keiri@sample-shoji.example.com', '〒100-0000 東京都千代田区見本町1-2-3 サンプルビル5F'],
    ['合同会社テスト企画', '御中', 'info@test-kikaku.example.com', '〒530-0000 大阪府大阪市北区架空町4-5-6'],
    ['山田 花子', '様', 'hanako@example.com', '〒810-0000 福岡県福岡市中央区仮町7-8-9'],
  ];
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  styleHeader_(sheet, rows[0].length);
  sheet.setColumnWidths(1, 1, 200);
  sheet.setColumnWidths(2, 1, 60);
  sheet.setColumnWidths(3, 1, 260);
  sheet.setColumnWidths(4, 1, 380);
}

/** 今月と先月の架空の売上（日付は実行した日を基準に自動で作ります） */
function buildSampleSales_(sheet) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0〜11
  const d = function (monthOffset, day) { return new Date(y, m + monthOffset, day); };

  // [日付, 取引先, 品目, 数量, 単価]
  const data = [
    [d(-1, 5), '株式会社サンプル商事', 'ホームページ保守（月額）', 1, 15000],
    [d(-1, 12), '合同会社テスト企画', 'チラシデザイン（A4両面）', 1, 30000],
    [d(-1, 20), '山田 花子', '名刺デザイン', 1, 8000],
    [d(0, 3), '株式会社サンプル商事', 'ホームページ保守（月額）', 1, 15000],
    [d(0, 7), '株式会社サンプル商事', 'お知らせページ更新', 3, 3000],
    [d(0, 10), '合同会社テスト企画', '商品撮影（半日）', 1, 25000],
    [d(0, 10), '合同会社テスト企画', '画像加工', 12, 500],
    [d(0, 14), '山田 花子', 'ブログ記事作成', 2, 6000],
    [d(0, 18), '株式会社サンプル商事', 'バナー作成', 2, 4500],
    [d(0, 21), '合同会社テスト企画', 'SNS投稿画像作成', 4, 2500],
  ];

  const header = ['日付', '取引先', '品目', '数量', '単価', '金額'];
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  sheet.getRange(2, 1, data.length, 5).setValues(data);
  // 金額は「数量 × 単価」の式にしておく（手で入力しても OK）
  const formulas = data.map(function (_, i) { return ['=D' + (i + 2) + '*E' + (i + 2)]; });
  sheet.getRange(2, 6, data.length, 1).setFormulas(formulas);

  styleHeader_(sheet, header.length);
  sheet.getRange('A:A').setNumberFormat('yyyy/mm/dd');
  sheet.getRange('D:F').setNumberFormat('#,##0');
  sheet.getRange(1, 1, 1, header.length).setNumberFormat('@'); // 見出し行は文字のまま
  sheet.setColumnWidth(1, 100);
  sheet.setColumnWidth(2, 200);
  sheet.setColumnWidth(3, 240);
  sheet.setColumnWidths(4, 3, 90);
}

// ------------------------------------------------------------
//  請求書テンプレート（A4縦・A〜E列）
// ------------------------------------------------------------

/**
 * 請求書のひな形を作ります。
 * セルの位置は Code.gs の CONFIG.CELLS と対応しています（変えるときは両方そろえてください）。
 */
function buildInvoiceTemplate_(sheet) {
  const MARK = CONFIG.PLACEHOLDER_MARK;
  const start = CONFIG.ITEM_START_ROW; // 13
  const end = start + CONFIG.ITEM_ROWS - 1; // 27

  // 列は A〜E の5列だけにする（余分な列があると PDF が縮んでしまうため）
  if (sheet.getMaxColumns() > 5) sheet.deleteColumns(6, sheet.getMaxColumns() - 5);
  if (sheet.getMaxRows() < 40) sheet.insertRowsAfter(sheet.getMaxRows(), 40 - sheet.getMaxRows());
  sheet.setColumnWidth(1, 95); // 日付
  sheet.setColumnWidth(2, 240); // 品目
  sheet.setColumnWidth(3, 60); // 数量
  sheet.setColumnWidth(4, 115); // 単価
  sheet.setColumnWidth(5, 125); // 金額
  sheet.getRange('A1:E40').setFontSize(10).setVerticalAlignment('middle');
  sheet.setHiddenGridlines(true);

  // タイトル
  sheet.getRange('A1:E1').merge().setValue('請　求　書').setFontSize(20).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.setRowHeight(1, 44);

  // 宛名・住所（請求書を作るときに自動で入ります）
  sheet.getRange('A3:C3').merge().setValue('（取引先名）　御中').setFontSize(14).setFontWeight('bold')
    .setBorder(null, null, true, null, null, null);
  sheet.getRange('A4:C4').merge().setValue('（住所）').setFontSize(9).setFontColor('#555555');

  // 請求日・番号・期限
  sheet.getRange('D3:D5').setValues([['請求日'], ['請求書番号'], ['お支払期限']]).setHorizontalAlignment('right').setFontColor('#555555');
  sheet.getRange('E3').setNumberFormat('yyyy"年"m"月"d"日"');
  sheet.getRange('E5').setNumberFormat('yyyy"年"m"月"d"日"');
  sheet.getRange('E4').setNumberFormat('@'); // 請求書番号は文字として扱う（日付などに変換されないように）
  sheet.getRange('E3:E5').setHorizontalAlignment('right');

  // 本文と発行元（ここは自社の情報に書き換えます）
  sheet.getRange('A7').setValue('下記のとおりご請求申し上げます。');
  sheet.getRange('D7:E7').merge().setValue(MARK + 'サンプル制作室').setFontWeight('bold')
    .setNote('自社名（屋号）に書き換えてください。メールの差出人名にも使われます。');
  sheet.getRange('D8:E8').merge().setValue('〒000-0000 ' + MARK + '東京都サンプル区1-1-1').setFontSize(9)
    .setNote('自社の住所に書き換えてください。');
  sheet.getRange('D9:E9').merge().setValue('TEL ' + MARK + '00-0000-0000').setFontSize(9)
    .setNote('自社の電話番号・メールアドレスに書き換えてください。');
  sheet.getRange('D10:E10').merge().setValue('登録番号：' + MARK + 'T0000000000000').setFontSize(9)
    .setNote('適格請求書発行事業者の登録番号（T＋13桁）に書き換えてください。\n未登録の場合はこの行を空欄にしてください。');

  // ご請求金額（大きく表示）
  sheet.getRange('A9').setValue('ご請求金額（税込）').setFontWeight('bold').setFontSize(9).setWrap(true).setVerticalAlignment('middle');
  sheet.getRange('B9:C9').merge().setNumberFormat('"¥"#,##0').setFontSize(16).setFontWeight('bold')
    .setHorizontalAlignment('right').setBorder(null, null, true, null, null, null, '#333333', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sheet.setRowHeight(9, 32);

  // 明細の見出し
  sheet.getRange('A12:E12').setValues([['日付', '品目', '数量', '単価（税抜）', '金額（税抜）']])
    .setFontWeight('bold').setBackground('#eef2f7').setHorizontalAlignment('center');

  // 明細行
  const items = sheet.getRange(start, 1, CONFIG.ITEM_ROWS, 5);
  items.setBorder(true, true, true, true, true, true, '#c0c6cf', SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange('A12:E12').setBorder(true, true, true, true, true, true, '#c0c6cf', SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(start, 1, CONFIG.ITEM_ROWS, 1).setNumberFormat('m/d').setHorizontalAlignment('center');
  sheet.getRange(start, 3, CONFIG.ITEM_ROWS, 3).setNumberFormat('#,##0');
  sheet.setRowHeights(start, CONFIG.ITEM_ROWS, 22);

  // 小計・消費税・合計（金額はスクリプトが計算して書き込みます）
  const sum = end + 1; // 28
  sheet.getRange(sum, 4, 3, 1).setValues([['小計（税抜）'], ['消費税（' + Math.round(CONFIG.TAX_RATE * 100) + '%）'], ['合計（税込）']])
    .setBackground('#eef2f7').setHorizontalAlignment('center');
  sheet.getRange(sum, 5, 3, 1).setNumberFormat('#,##0');
  sheet.getRange(sum, 4, 3, 2).setBorder(true, true, true, true, true, true, '#c0c6cf', SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(sum + 2, 4, 1, 2).setFontWeight('bold');
  sheet.getRange(sum + 3, 4, 1, 2).merge().setValue('※' + Math.round(CONFIG.TAX_RATE * 100) + '%対象 合計額に対して消費税を計算しています')
    .setFontSize(8).setFontColor('#777777').setHorizontalAlignment('right');

  // 振込先・備考
  const bank = sum + 4; // 32
  sheet.getRange(bank, 1).setValue('お振込先').setFontWeight('bold');
  sheet.getRange(bank, 2, 1, 4).merge().setValue(MARK + 'サンプル銀行 見本支店 普通 0000000 サンプルセイサクシツ')
    .setNote('自社の振込先口座に書き換えてください。');
  sheet.getRange(bank + 1, 1).setValue('備考').setFontWeight('bold');
  sheet.getRange(bank + 1, 2, 1, 4).merge().setValue('恐れ入りますが、振込手数料は貴社にてご負担くださいますようお願いいたします。').setFontSize(9);
  sheet.getRange(bank, 1, 2, 5).setBorder(true, null, true, null, true, null, '#c0c6cf', SpreadsheetApp.BorderStyle.SOLID);

  // サンプルであることの表示（印刷範囲の外＝余白に影響しない注意書きとしてメモに記載）
  sheet.getRange('A1').setNote('このテンプレートはkentaniのサンプルです。【要変更】の部分を自社の情報に書き換えてお使いください。');
}

// ------------------------------------------------------------
//  補助
// ------------------------------------------------------------

/** シートがあれば中身と書式を消して使い直し、無ければ新しく作ります */
function recreateSheet_(ss, name) {
  const old = ss.getSheetByName(name);
  if (!old) return ss.insertSheet(name);
  // 結合・メモ・書式まで確実に消すため、いったん削除して作り直す
  const index = old.getIndex();
  const tmp = ss.insertSheet(); // シートが1枚だけだと削除できないため、一時シートを挟む
  ss.deleteSheet(old);
  const sheet = ss.insertSheet(name, index - 1);
  ss.deleteSheet(tmp);
  return sheet;
}

/** 新規スプレッドシートに最初からある空の「シート1」を片付けます */
function removeEmptyDefaultSheet_(ss) {
  ['シート1', 'Sheet1'].forEach(function (n) {
    const s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
}

function styleHeader_(sheet, cols) {
  sheet.getRange(1, 1, 1, cols).setFontWeight('bold').setBackground('#eef2f7');
  sheet.setFrozenRows(1);
}
