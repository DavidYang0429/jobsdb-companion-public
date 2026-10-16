/* JobsDB companion protocol v1. Configure Script Properties:
   SPREADSHEET_ID, SHEET_NAME (default JobsDB), TARGET_ID, SHARED_SECRET (>=24 chars).
   Deploy as Web App: execute as owner; allow access for this extension's requests.
   Deploy a new version after edits. Never put the secret in sheet cells or URL.
*/
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(function(k) { return JSON.stringify(k) + ':' + canonical(value[k]); }).join(',') + '}';
  return JSON.stringify(value);
}
function digest(value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical(value), Utilities.Charset.UTF_8).map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join(''); }
function json(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function text(v, max) { return typeof v === 'string' && v.length <= max; }
function exactKeys(o, keys) { return o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join('|') === keys.slice().sort().join('|'); }
function validPayload(p) {
  if (!p || typeof p !== 'object') return false;
  var optionalTimes = ['appliedAt','interviewAt'].filter(function(k) { return Object.prototype.hasOwnProperty.call(p,k); });
  if (!optionalTimes.every(function(k) { return p[k] === null || (text(p[k],40) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(p[k]) && !isNaN(Date.parse(p[k]))); })) return false;
  if (!exactKeys(p, ['categoryId','categoryName','job','status','hasTailoredResume','notes','createdAt','updatedAt'].concat(optionalTimes))) return false;
  var j = p.job;
  return text(p.categoryId,120) && p.categoryId.length > 0 && text(p.categoryName,100) &&
    ['saved','applied','waiting_interview','no_response','interviewing','offer','rejected'].indexOf(p.status) >= 0 && typeof p.hasTailoredResume === 'boolean' &&
    text(p.notes,50000) && text(p.createdAt,40) && !isNaN(Date.parse(p.createdAt)) && text(p.updatedAt,40) && !isNaN(Date.parse(p.updatedAt)) &&
    exactKeys(j,['source','sourceJobId','jobKey','title','company','location','salary','workType','jobUrl','jdRawText','jdParagraphs','capturedAt']) &&
    j.source === 'jobsdb' && text(j.sourceJobId,100) && /^\d+$/.test(j.sourceJobId) && j.jobKey === 'jobsdb:' + j.sourceJobId &&
    j.jobUrl === 'https://hk.jobsdb.com/job/' + j.sourceJobId && text(j.title,1000) && j.title.length > 0 && text(j.company,1000) && j.company.length > 0 &&
    [j.location,j.salary,j.workType].every(function(v) { return v === null || text(v,50000); }) && text(j.jdRawText,50000) && j.jdRawText.length > 0 &&
    Array.isArray(j.jdParagraphs) && j.jdParagraphs.length <= 1000 && j.jdParagraphs.every(function(v) { return text(v,50000); }) && text(j.capturedAt,40) && !isNaN(Date.parse(j.capturedAt));
}
function safeCell(value) { var s = value == null ? '' : String(value); return /^\s*[=+@-]/.test(s) ? "'" + s : s; }
function doPost(e) {
  var lock;
  try {
    if (!e || !e.postData || e.postData.contents.length > 350000) return json({ok:false,code:'INVALID_SIZE',retryable:false});
    var b; try { b = JSON.parse(e.postData.contents); } catch (_) { return json({ok:false,code:'INVALID_JSON',retryable:false}); }
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty('SHARED_SECRET');
    if (!secret || secret.length < 24 || b.sharedSecret !== secret) return json({ok:false,code:'AUTH',retryable:false});
    if (!exactKeys(b,['protocolVersion','targetId','sharedSecret','requestId','recordId','revision','payload']) || b.protocolVersion !== 1 ||
      !text(b.targetId,120) || b.targetId !== props.getProperty('TARGET_ID') || !text(b.requestId,120) || !b.requestId || !text(b.recordId,120) || !b.recordId ||
      !Number.isSafeInteger(b.revision) || b.revision < 1 || !validPayload(b.payload)) return json({ok:false,code:'INVALID_REQUEST',retryable:false});
    lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return json({ok:false,code:'BUSY',retryable:true});
    var book = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
    var name = props.getProperty('SHEET_NAME') || 'JobsDB';
    var sheet = book.getSheetByName(name) || book.insertSheet(name);
    var headers = ['recordId','revision','payloadHash','categoryId','categoryName','title','company','location','salary','workType','jobUrl','jdRawText','status','hasTailoredResume','notes','createdAt','updatedAt','appliedAt','interviewAt'];
    if (sheet.getLastRow() === 0) sheet.appendRow(headers);
    var currentHeaders = sheet.getRange(1,1,1,headers.length).getValues()[0];
    // Append only to an exact legacy header with two empty destination cells.
    if (currentHeaders.slice(0,17).join('|') === headers.slice(0,17).join('|') && currentHeaders[17] === '' && currentHeaders[18] === '') {
      if (sheet.getLastRow() > 1 && sheet.getRange(2,18,sheet.getLastRow()-1,2).getValues().some(function(row) { return row.some(function(v) { return v !== ''; }); })) return json({ok:false,code:'HEADER_MISMATCH',retryable:false});
      sheet.getRange(1,18,1,2).setValues([headers.slice(17)]);
      currentHeaders = sheet.getRange(1,1,1,headers.length).getValues()[0];
    }
    if (currentHeaders.join('|') !== headers.join('|')) return json({ok:false,code:'HEADER_MISMATCH',retryable:false});
    var row = sheet.getLastRow() + 1, oldRevision = 0, oldHash = '';
    if (sheet.getLastRow() > 1) {
      var matches = sheet.getRange(2,1,sheet.getLastRow()-1,1).createTextFinder(b.recordId).matchEntireCell(true).useRegularExpression(false).findAll();
      if (matches.length > 1) return json({ok:false,code:'DUPLICATE_REMOTE_ID',retryable:false});
      if (matches.length) { row = matches[0].getRow(); var old = sheet.getRange(row,2,1,2).getValues()[0]; oldRevision=Number(old[0]);oldHash=String(old[1]); }
    }
    var h = digest(b.payload);
    if (oldRevision > b.revision || (oldRevision === b.revision && oldHash !== h)) return json({ok:false,code:'VERSION_CONFLICT',retryable:false});
    if (oldRevision < b.revision) {
      var p=b.payload,j=p.job;
      var values=[b.recordId,b.revision,h,p.categoryId,p.categoryName,j.title,j.company,j.location,j.salary,j.workType,j.jobUrl,j.jdRawText,p.status,p.hasTailoredResume,p.notes,p.createdAt,p.updatedAt,p.appliedAt,p.interviewAt].map(safeCell);
      var range=sheet.getRange(row,1,1,values.length);range.setNumberFormat('@');range.setValues([values]);SpreadsheetApp.flush();
    }
    return json({ok:true,targetId:b.targetId,requestId:b.requestId,recordId:b.recordId,appliedRevision:b.revision,payloadHash:h});
  } catch (_) { return json({ok:false,code:'SERVER_ERROR',retryable:true}); }
  finally { if (lock && lock.hasLock()) lock.releaseLock(); }
}
