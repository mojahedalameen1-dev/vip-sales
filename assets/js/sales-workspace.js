const workspaceTimeZone = 'Asia/Riyadh';
const calendarDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: workspaceTimeZone });
const calendarLabelFormat = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
  timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});
const meetingTimeFormat = new Intl.DateTimeFormat('ar-SA-u-nu-latn', {
  timeZone: workspaceTimeZone, hour: 'numeric', minute: '2-digit',
});
const workspaceNumber = new Intl.NumberFormat('en-US');
const customerStages = {
  new: 'جديد', technical: 'عرض فني', closing: 'تقفيل', signed: 'توقيع', closed: 'مغلق',
};
const meetingStatusLabels = {
  pending: 'مجدول', done: 'تم', postponed: 'ملغي', canceled: 'ملغي',
};

let activeWorkspace = '';
let meetingDay = calendarDayFormat.format(new Date());
let meetingScope = 'mine';
let dailyMeetings = [];
let meetingLoad = 'loading';
let meetingRequest = 0;
let meetingStatuses = {};
let meetingStatusesRef;
let meetingStatusUpdates = new Map();
let exportingDay = false;
let exportingRange = false;
let customerExport;
let customerLoad;
let customerRows;
const exportScripts = new Map();

function element(id) {
  return document.getElementById(id);
}

function shiftDate(date, days) {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function eventDay(meeting) {
  return meeting.allDay ? meeting.startTime : calendarDayFormat.format(new Date(meeting.startTime));
}

function meetingTime(meeting) {
  return meeting.allDay ? 'طوال اليوم' : meetingTimeFormat.format(new Date(meeting.startTime));
}

function meetUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'meet.google.com' ? parsed.href : '';
  } catch {
    return '';
  }
}

function renderedIcon(name) {
  const icon = document.createElement('i');
  icon.dataset.lucide = name;
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

function textElement(tag, text, className) {
  const item = document.createElement(tag);
  item.textContent = englishDigits(text);
  if (className) item.className = className;
  return item;
}

function englishDigits(value) {
  return String(value).replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) & 15));
}

function activeButtons(selector, key, value) {
  document.querySelectorAll(selector).forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset[key] === value));
  });
}

function matchesCurrentUser(meeting) {
  const email = currentUser?.email?.toLowerCase();
  return Boolean(email && (meeting.organizer?.toLowerCase() === email ||
    meeting.attendees?.some(person => person.email?.toLowerCase() === email)));
}

async function getCalendarMeetings(query) {
  const response = await fetchSalesApi('/api/meetings?' + new URLSearchParams(query));
  if (!response.ok) throw new Error('تعذّر جلب المواعيد من تقويم Google.');
  const meetings = await response.json();
  if (!Array.isArray(meetings)) throw new Error('تعذّر قراءة بيانات المواعيد.');
  return meetings.filter(meeting => meeting.id && Number.isFinite(Date.parse(meeting.startTime)));
}

function showWorkspaceFromLocation() {
  const route = location.hash.slice(1);
  const tab = route === 'esign' || route === 'export' ? route : 'meetings';
  if (!currentUser || activeWorkspace === tab) return;
  activeWorkspace = tab;

  element('meetingsView').hidden = tab !== 'meetings';
  const signature = element('esignView');
  signature.style.display = tab === 'esign' ? 'flex' : 'none';
  if (tab === 'esign') signature.style.flexDirection = 'column';
  element('exportView').hidden = tab !== 'export';
  document.querySelectorAll('[data-workspace]').forEach(link => {
    const selected = link.dataset.workspace === tab;
    link.classList.toggle('active', selected);
    if (selected) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (tab === 'meetings') fetchMeetingsForDay();
  if (tab === 'esign') openElectronicSignature();
  if (tab === 'export') loadCustomerRows();
}

function startWorkspace() {
  meetingStatusesRef?.off();
  meetingStatusesRef = db.ref('meetingStatuses');
  meetingStatusesRef.on('value', snapshot => {
    meetingStatuses = snapshot.val() || {};
    if (activeWorkspace === 'meetings' && meetingLoad === 'ready') renderMeetings();
  });
  showWorkspaceFromLocation();
}

function stopWorkspace() {
  meetingStatusesRef?.off();
  meetingStatusesRef = undefined;
  meetingStatuses = {};
  meetingStatusUpdates = new Map();
  activeWorkspace = '';
  dailyMeetings = [];
  customerRows = undefined;
  customerLoad = undefined;
  customerExport = undefined;
  meetingRequest++;
  element('meetingExportCount').textContent = '';
  updateDailyExportButton();
  element('customerExportPreview').replaceChildren();
  element('customerExportCount').textContent = '';
  element('exportExcelBtn').disabled = true;
}

function selectMeetingDay(offset) {
  meetingDay = shiftDate(calendarDayFormat.format(new Date()), offset);
  fetchMeetingsForDay();
}

function navigateMeetingsDay(days) {
  meetingDay = shiftDate(meetingDay, days);
  fetchMeetingsForDay();
}

async function fetchMeetingsForDay({ background = false } = {}) {
  if (!currentUser || activeWorkspace !== 'meetings') return;
  const request = ++meetingRequest;
  const day = meetingDay;
  const date = new Date(day + 'T00:00:00Z');
  element('meetingsDatePicker').value = day;
  const today = calendarDayFormat.format(new Date());
  const tomorrow = shiftDate(today, 1);
  element('meetingsTodayBtn').setAttribute('aria-pressed', String(day === today));
  element('meetingsTomorrowBtn').setAttribute('aria-pressed', String(day === tomorrow));
  element('meetingsDayTitle').textContent = day === today ? 'اجتماعات اليوم'
    : day === tomorrow ? 'اجتماعات الغد' : 'جدول الاجتماعات';
  element('meetingsDaySub').textContent = calendarLabelFormat.format(date);
  element('meetingsRefreshBtn').disabled = true;

  if (!background) {
    meetingLoad = 'loading';
    updateDailyExportButton();
    element('meetingsAgenda').setAttribute('aria-busy', 'true');
    element('meetingsProgressLabel').textContent = 'جارٍ جلب الاجتماعات…';
    element('meetingsTableContainer').replaceChildren();
  }

  try {
    const meetings = await getCalendarMeetings({ date: day });
    if (request !== meetingRequest) return;
    dailyMeetings = meetings;
    meetingLoad = 'ready';
    renderMeetings();
  } catch (error) {
    if (request !== meetingRequest || background) return;
    meetingLoad = 'error';
    updateDailyExportButton();
    element('meetingsProgressLabel').textContent = 'تعذّر جلب الاجتماعات';
    const retry = textElement('button', 'إعادة المحاولة', 'workspace-button');
    retry.type = 'button';
    retry.addEventListener('click', () => fetchMeetingsForDay());
    renderMeetingMessage(error.message, retry);
  } finally {
    if (request === meetingRequest) {
      element('meetingsAgenda').setAttribute('aria-busy', 'false');
      element('meetingsRefreshBtn').disabled = false;
    }
  }
}

function renderMeetingMessage(message, button) {
  const empty = textElement('div', '', 'workspace-empty');
  empty.append(textElement('p', message));
  if (button) empty.append(button);
  element('meetingsTableContainer').replaceChildren(empty);
}

function selectMeetingScope(scope) {
  meetingScope = scope;
  activeButtons('[data-meetings-scope]', 'meetingsScope', scope);
  if (meetingLoad === 'ready') renderMeetings();
}

function getMeetingStatus(id) {
  const status = meetingStatusUpdates.get(id) || meetingStatuses[id]?.status;
  if (status === 'canceled') return 'postponed';
  return Object.hasOwn(meetingStatusLabels, status) ? status : 'pending';
}

async function saveMeetingStatus(id, status) {
  const user = currentUser;
  const updates = meetingStatusUpdates;
  updates.set(id, status);
  renderMeetings();
  try {
    await db.ref('meetingStatuses/' + id).set({
      status, updatedBy: user.email,
      updatedAt: firebase.database.ServerValue.TIMESTAMP,
    });
  } catch {
    if (currentUser === user) showToast('تعذّر حفظ حالة الاجتماع. حاول مرة أخرى.', 'error');
  } finally {
    updates.delete(id);
    if (currentUser === user && activeWorkspace === 'meetings' && meetingLoad === 'ready') renderMeetings();
  }
}

function visibleMeetings() {
  return dailyMeetings.filter(meeting => meetingScope === 'all' || matchesCurrentUser(meeting))
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
}

function updateDailyExportButton(meetings = visibleMeetings()) {
  element('downloadDailyMeetingsBtn').disabled = exportingDay || meetingLoad !== 'ready' || meetings.length === 0;
}

function renderMeetings() {
  const meetings = visibleMeetings();
  updateDailyExportButton(meetings);
  const completed = meetings.filter(meeting => getMeetingStatus(meeting.id) === 'done').length;
  element('meetingsProgressLabel').textContent = meetings.length
    ? workspaceNumber.format(meetings.length) + ' مواعيد · ' + workspaceNumber.format(completed) + ' مكتملة'
    : 'المواعيد';

  if (!meetings.length) {
    let showTeam;
    if (meetingScope === 'mine' && dailyMeetings.length) {
      showTeam = textElement('button', 'عرض كل الاجتماعات', 'workspace-button');
      showTeam.type = 'button';
      showTeam.addEventListener('click', () => selectMeetingScope('all'));
    }
    renderMeetingMessage(showTeam ? 'لا توجد اجتماعات باسمك في هذا اليوم.' : 'لا توجد اجتماعات في هذا اليوم.', showTeam);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'workspace-agenda';
  for (const meeting of meetings) {
    const row = document.createElement('li');
    row.className = 'workspace-agenda-row';

    const title = document.createElement('div');
    title.append(
      textElement('strong', meeting.summary),
      textElement('small', [meeting.salesRep, meeting.meetingType].filter(Boolean).join(' · ')),
    );
    const time = textElement('time', meetingTime(meeting));
    time.dateTime = meeting.startTime;
    if (!meeting.allDay && Number.isFinite(Date.parse(meeting.endTime))) {
      time.append(textElement('small', 'إلى ' + meetingTimeFormat.format(new Date(meeting.endTime))));
    }

    const actions = document.createElement('div');
    actions.className = 'workspace-meeting-actions';
    const link = meetUrl(meeting.meetLink);
    if (link && !['حضوري', 'خارجي'].includes(meeting.meetingType)) {
      const join = textElement('a', 'انضمام', 'workspace-button workspace-join');
      join.prepend(renderedIcon('video'));
      join.href = link;
      join.target = '_blank';
      join.rel = 'noopener noreferrer';
      join.setAttribute('aria-label', 'انضمام إلى ' + meeting.summary);
      actions.append(join);
    }

    const select = document.createElement('select');
    select.className = 'input-field workspace-status';
    select.setAttribute('aria-label', 'حالة ' + meeting.summary);
    for (const status of ['pending', 'done', 'postponed']) {
      select.add(new Option(meetingStatusLabels[status], status));
    }
    select.value = getMeetingStatus(meeting.id);
    select.dataset.status = select.value;
    select.disabled = meetingStatusUpdates.has(meeting.id);
    select.addEventListener('change', () => saveMeetingStatus(meeting.id, select.value));
    actions.append(select);
    row.append(time, title, actions);
    list.append(row);
  }
  element('meetingsTableContainer').replaceChildren(list);
  window.lucide?.createIcons();
}

function setMeetingsExportShortcut(type) {
  const today = calendarDayFormat.format(new Date());
  let first = today, last = today;
  if (type === 'tomorrow') {
    first = last = shiftDate(today, 1);
  } else if (type === 'week') {
    first = shiftDate(today, -new Date(today + 'T00:00:00Z').getUTCDay());
    last = shiftDate(first, 6);
  } else if (type === 'month') {
    first = today.slice(0, 7) + '-01';
    const next = new Date(first + 'T00:00:00Z');
    next.setUTCMonth(next.getUTCMonth() + 1);
    last = shiftDate(next.toISOString().slice(0, 10), -1);
  }
  element('meetingsExportDateFrom').value = first;
  element('meetingsExportDateTo').value = last;
}

function loadExportScript(url) {
  if (!exportScripts.has(url)) {
    const loaded = loadScript(url).catch(error => {
      document.querySelector('script[src="' + url + '"]')?.remove();
      exportScripts.delete(url);
      throw error;
    });
    exportScripts.set(url, loaded);
  }
  return exportScripts.get(url);
}

async function saveMeetingReport(rows, filename, uid) {
  await Promise.all([
    loadExportScript('assets/js/vendor/exceljs.min.js'),
    loadExportScript('assets/js/meetings-workbook.js'),
  ]);
  if (currentUser?.uid !== uid) return;
  const statuses = Object.fromEntries(rows.map(meeting => [
    meeting.id, meetingStatusUpdates.get(meeting.id) || meetingStatuses[meeting.id]?.status,
  ]));
  await window.saveMeetingsWorkbook(rows, statuses, filename);
}

async function downloadDailyMeetings() {
  const uid = currentUser?.uid;
  const rows = visibleMeetings();
  if (!uid || !rows.length || meetingLoad !== 'ready' || exportingDay) return;
  const date = meetingDay;
  exportingDay = true;
  updateDailyExportButton();
  try {
    await saveMeetingReport(rows, 'الاجتماعات ' + date, uid);
  } catch {
    if (currentUser?.uid === uid) showToast('تعذّر تنزيل ملف الاجتماعات. حاول مرة أخرى.', 'error');
  } finally {
    exportingDay = false;
    updateDailyExportButton();
  }
}

async function downloadMeetingsRange(event) {
  event.preventDefault();
  const uid = currentUser?.uid;
  if (!uid || exportingRange) return;
  const from = element('meetingsExportDateFrom').value;
  const to = element('meetingsExportDateTo').value;
  const scope = document.querySelector('[name="meetingsExportScope"]:checked').value;
  const count = element('meetingExportCount');
  const btn = element('meetingsExportExcelSubmitBtn');
  if (!from || !to || from > to) {
    count.textContent = 'حدد تاريخ بداية وتاريخ نهاية صالحين.';
    return;
  }

  exportingRange = true;
  btn.disabled = true;
  count.textContent = 'جارٍ جلب الاجتماعات للفترة المحددة…';
  try {
    const cursor = new Date(from.slice(0, 7) + '-01T00:00:00Z');
    const lastMonth = to.slice(0, 7);
    const events = new Map();
    while (cursor.toISOString().slice(0, 7) <= lastMonth) {
      const batch = [];
      for (let i = 0; i < 4 && cursor.toISOString().slice(0, 7) <= lastMonth; i++) {
        batch.push(getCalendarMeetings({ month: cursor.toISOString().slice(0, 7) }));
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
      const lists = await Promise.all(batch);
      if (currentUser?.uid !== uid) return;
      for (const list of lists) {
        for (const meeting of list) {
          const date = eventDay(meeting);
          if (date >= from && date <= to && (scope === 'all' || matchesCurrentUser(meeting))) {
            events.set(meeting.id, meeting);
          }
        }
      }
    }
    if (!events.size) {
      count.textContent = 'لا توجد اجتماعات تطابق الفترة والنطاق.';
      return;
    }
    count.textContent = 'جارٍ تجهيز ' + workspaceNumber.format(events.size) + ' اجتماع…';
    await saveMeetingReport([...events.values()], 'الاجتماعات ' + from + ' إلى ' + to, uid);
    if (currentUser?.uid === uid) count.textContent = 'عدد الاجتماعات: ' + workspaceNumber.format(events.size);
  } catch {
    if (currentUser?.uid === uid) count.textContent = 'تعذّر تنزيل ملف الاجتماعات. حاول مرة أخرى.';
  } finally {
    exportingRange = false;
    btn.disabled = false;
  }
}

function renderExportPreview(id, columns, rows) {
  const target = element(id);
  target.replaceChildren();
  if (!rows.length || !columns.length) return;

  const table = document.createElement('table');
  const header = table.createTHead().insertRow();
  for (const column of columns) {
    const cell = textElement('th', column.label);
    cell.scope = 'col';
    header.append(cell);
  }
  const body = table.createTBody();
  for (const row of rows.slice(0, 5)) {
    const tr = body.insertRow();
    for (const column of columns) {
      const value = column.value(row);
      tr.append(textElement('td', value === '' ? '—' : String(value)));
    }
  }
  target.append(table);
}

function setCustomerExportDays(days) {
  const today = calendarDayFormat.format(new Date());
  element('exportDateFrom').value = days ? shiftDate(today, 1 - days) : '';
  element('exportDateTo').value = days ? today : '';
  renderCustomerExport();
}

function formatSavedMeetingDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? calendarDayFormat.format(date) : '';
}

async function loadCustomerRows() {
  if (customerRows) {
    renderCustomerExport();
    return;
  }
  if (customerLoad) return;
  const uid = currentUser?.uid;
  if (!uid) return;
  const count = element('customerExportCount');
  count.textContent = 'جارٍ قراءة سجلات العملاء المحفوظة…';
  const request = db.ref('users/' + uid + '/leads').once('value');
  customerLoad = request;
  try {
    const snapshot = await request;
    if (customerLoad !== request) return;
    customerRows = Object.values(snapshot.val() || {}).filter(row => row && typeof row === 'object');
    renderCustomerExport();
  } catch {
    if (customerLoad !== request) return;
    count.textContent = 'تعذّر تحميل سجلات العملاء.';
    const retry = textElement('button', 'إعادة المحاولة', 'workspace-button');
    retry.type = 'button';
    retry.addEventListener('click', () => loadCustomerRows());
    element('customerExportPreview').replaceChildren(retry);
  } finally {
    if (customerLoad === request) customerLoad = undefined;
  }
}

function renderCustomerExport() {
  if (!customerRows) return;
  const count = element('customerExportCount');
  const download = element('exportExcelBtn');
  const from = element('exportDateFrom').value;
  const to = element('exportDateTo').value;
  const stages = new Set([...document.querySelectorAll('[data-stage]:checked')].map(input => input.dataset.stage));
  const fromTime = from ? Date.parse(from + 'T00:00:00+03:00') : -Infinity;
  const toTime = to ? Date.parse(shiftDate(to, 1) + 'T00:00:00+03:00') : Infinity;
  const rows = customerRows.filter(row => {
    const stage = Object.hasOwn(customerStages, row.column) ? row.column : 'other';
    const created = Number(row.createdAt) || 0;
    return stages.has(stage) && created >= fromTime && created < toTime;
  });
  const columns = [];

  if (element('fieldFullName').checked) columns.push({ label: 'الاسم الكامل', width: 32, value: row => row.clientName || row.fullName || '' });
  if (element('fieldPhone').checked) columns.push({ label: 'رقم الجوال', width: 20, value: row => row.phone || '' });
  if (element('fieldFinancials').checked) {
    columns.push({ label: 'الدفعة الأولى', width: 18, value: row => Number(row.firstPayment) || 0 });
    columns.push({ label: 'إجمالي الصفقة', width: 18, value: row => Number(row.totalDeal) || 0 });
  }
  if (element('fieldMeeting').checked) {
    columns.push({
      label: 'موعد الاجتماع', width: 18,
      value: row => formatSavedMeetingDate(row.meetingDate),
    });
  }
  if (element('fieldColumn').checked) {
    columns.push({ label: 'المرحلة', width: 18, value: row => customerStages[row.column] || row.column || '' });
  }
  // Keep the original optional details of saved customer records.
  if (columns.length && rows.some(row => row.meetingTitle)) {
    columns.push({
      label: 'عنوان الاجتماع', width: 42,
      value: row => String(row.meetingTitle || '').replace(/\b(?:AA|SLK-?|CS)\d+\b/gi, '').trim(),
    });
  }
  if (columns.length && rows.some(row => row.projectName || row.closingNote || row.closingReason)) {
    columns.push({
      label: 'المشروع والملاحظات', width: 42,
      value: row => [row.projectName, row.closingReason, row.closingNote].filter(Boolean).join(' | '),
    });
  }

  const invalid = from && to && from > to;
  count.textContent = invalid ? 'يجب أن يكون تاريخ البداية قبل تاريخ النهاية أو في اليوم نفسه.'
    : !columns.length ? 'اختر حقلاً واحدًا على الأقل.'
    : rows.length ? 'عدد السجلات: ' + workspaceNumber.format(rows.length) : 'لا توجد سجلات تطابق الفلاتر.';
  download.disabled = Boolean(invalid || !columns.length || !rows.length);
  customerExport = download.disabled ? undefined : { rows, columns };
  renderExportPreview('customerExportPreview', columns, invalid ? [] : rows);
}

function appendExportSheet(book, name, columns, rows) {
  const data = [columns.map(column => column.label), ...rows.map(row => columns.map(column => {
    const value = column.value(row);
    return typeof value === 'string' ? englishDigits(value) : value;
  }))];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet['!cols'] = columns.map(column => ({ wch: column.width }));
  sheet['!rows'] = [{ hpt: 28 }];
  sheet['!autofilter'] = { ref: sheet['!ref'] };
  columns.forEach((column, index) => {
    const heading = sheet[XLSX.utils.encode_cell({ r: 0, c: index })];
    heading.s = { fill: { fgColor: { rgb: '14314D' } }, font: { color: { rgb: 'FFFFFF' }, bold: true } };
    rows.forEach((row, rowIndex) => {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex + 1, c: index })];
      if (column.link && cell?.v) cell.l = { Target: cell.v };
      if (cell && rowIndex % 2 === 1) cell.s = { fill: { fgColor: { rgb: 'F0F5FA' } } };
    });
  });
  XLSX.utils.book_append_sheet(book, sheet, name);
}

async function downloadCustomerExport() {
  const selection = customerExport;
  const uid = currentUser?.uid;
  if (!uid || !selection?.rows.length) return;
  const btn = element('exportExcelBtn');
  btn.disabled = true;
  try {
    await loadExportScript('assets/js/vendor/xlsx-js-style.js');
    if (currentUser?.uid !== uid || selection !== customerExport) return;
    const book = XLSX.utils.book_new();
    book.Workbook = { Views: [{ RTL: true }] };
    appendExportSheet(book, 'العملاء', selection.columns, selection.rows);
    XLSX.writeFile(book, 'العملاء ' + calendarDayFormat.format(new Date()) + '.xlsx');
  } catch {
    showToast('تعذّر تنزيل ملف إكسل. حاول مرة أخرى.', 'error');
  } finally {
    btn.disabled = !customerExport?.rows.length;
  }
}

window.addEventListener('hashchange', showWorkspaceFromLocation);
document.querySelectorAll('[data-meetings-scope]').forEach(button => {
  button.addEventListener('click', () => selectMeetingScope(button.dataset.meetingsScope));
});
element('meetingsDatePicker').addEventListener('change', event => {
  if (!event.target.value) return;
  meetingDay = event.target.value;
  fetchMeetingsForDay();
});
element('meetingsExportForm').addEventListener('submit', downloadMeetingsRange);
element('customersExportForm').addEventListener('submit', event => event.preventDefault());
element('customersExportForm').addEventListener('change', renderCustomerExport);
element('downloadDailyMeetingsBtn').addEventListener('click', downloadDailyMeetings);
element('exportExcelBtn').addEventListener('click', downloadCustomerExport);
setMeetingsExportShortcut('today');
setInterval(() => {
  if (activeWorkspace === 'meetings' && meetingLoad === 'ready' && !document.hidden) {
    fetchMeetingsForDay({ background: true });
  }
}, 5 * 60 * 1000);
