// Google Apps Script backend for MFTNB
// HOW TO USE:
// 1) In Google Drive: New -> Google Sheet (name it MFTNB Leads). Keep Sheet1.
// 2) Extensions -> Apps Script. Paste this code. File -> Save.
// 3) Deploy -> New deployment -> Type: Web app. Execute as: Me. Access: Anyone (or Anyone with the link).
// 4) Copy the Web app URL and paste it into index.html BACKEND.appsScriptUrl.

const SHEET_NAME = 'Sheet1';
const SEND_TO = 'info@mftnb.ca';
const SUBJECT = 'New MFTNB Estimate Request';

function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    if (body.honeypot === true) return respond({ ok: true, skipped: true, reason: 'honeypot' });

    const ss = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!ss) throw new Error('Sheet not found');

    const fields = [
      'submittedAt','name','email','phone','pickup','dropoff','moveDate','timeWindow',
      'homeSize','access','inventory','extras','notes','source'
    ];
    const row = fields.map(k => {
      const v = body[k];
      if (k === 'inventory' || k === 'extras') return JSON.stringify(v || {});
      return v || '';
    });
    ss.appendRow(row);

    try {
      MailApp.sendEmail({ to: SEND_TO, subject: SUBJECT, htmlBody: '<pre>' + JSON.stringify(body, null, 2) + '</pre>' });
    } catch (err) { /* ignore mail failures on locked accounts */ }

    return respond({ ok: true });
  } catch (err) {
    return respond({ ok: false, error: String(err) }, 500);
  }
}

function doGet(e) {
  return respond({ ok: true, service: 'mftnb-apps-script' });
}

function respond(obj, code) {
  const out = ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  out.setHeaders({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  return out;
}
