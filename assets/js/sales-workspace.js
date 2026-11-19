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
let countingExport = false;
let exportDateCache;
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
  if (tab !== 'meetings' && element('meetingExportDialog').open) element('meetingExportDialog').close();
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
  meetingLoad = 'loading';
  exportDateCache = undefined;
  if (element('meetingExportDialog').open) element('meetingExportDialog').close();
  element('meetingSearch').value = '';
  element('meetingExportCount').textContent = '';
  updateAgendaMetrics();
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
  element('dailyExportLabel').textContent = day === today ? 'تصدير كل اجتماعات اليوم'
    : day === tomorrow ? 'تصدير كل اجتماعات الغد' : 'تصدير كل اجتماعات اليوم المحدد';
  element('meetingsRefreshBtn').disabled = true;

  if (!background) {
    meetingLoad = 'loading';
    dailyMeetings = [];
    updateDailyExportButton();
    updateAgendaMetrics();
    const table = element('meetingsTableContainer');
    table.setAttribute('aria-busy', 'true');
    element('meetingsProgressLabel').textContent = 'جارٍ جلب الاجتماعات…';
    const placeholder = textElement('div', '', 'agenda-loading');
    placeholder.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 3; index++) placeholder.append(textElement('span', ''));
    table.replaceChildren(placeholder);
  }

  try {
    const meetings = await getCalendarMeetings({ date: day });
    if (request !== meetingRequest) return;
    dailyMeetings = availableMeetings(meetings, day);
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
    renderMeetingMessage(error.message, retry, 'circle-alert');
  } finally {
    if (request === meetingRequest) {
      element('meetingsTableContainer').setAttribute('aria-busy', 'false');
      element('meetingsRefreshBtn').disabled = false;
    }
  }
}

function renderMeetingMessage(message, button, icon = 'calendar-days') {
  const empty = textElement('div', '', 'workspace-empty agenda-empty');
  const badge = textElement('span', '', 'agenda-empty-icon');
  badge.append(renderedIcon(icon));
  empty.append(badge, textElement('p', message));
  if (button) empty.append(button);
  element('meetingsTableContainer').replaceChildren(empty);
  window.lucide?.createIcons();
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

function meetingChannel(meeting) {
  return ['حضوري', 'خارجي'].includes(meeting.meetingType) ? 'in-person' : 'remote';
}

function availableMeetings(rows, from, to = from) {
  const events = new Map();
  for (const meeting of rows) {
    const date = eventDay(meeting);
    if (date >= from && date <= to) events.set(meeting.id, meeting);
  }
  return [...events.values()].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
}

function searchableMeetingText(text) {
  return englishDigits(text).normalize('NFD').replace(/\p{Mark}/gu, '').toLowerCase().trim();
}

function meetingDisplayTitle(summary) {
  return summary.replace(/(?:\s*[-–—·]+\s*)+(?:[اأإ]ون\s*لا?[يى]ن|حضوري|حضورى|خارجي|عن\s+بعد)\s*$/iu, '')
    .replace(/(?:\s*[-–—]\s*){2,}/g, ' - ').trim() || summary;
}

function visibleMeetings() {
  const query = searchableMeetingText(element('meetingSearch').value);
  return dailyMeetings.filter(meeting => {
    if (meetingScope === 'mine' && !matchesCurrentUser(meeting)) return false;
    return !query || searchableMeetingText([meeting.summary, meeting.salesRep].filter(Boolean).join(' ')).includes(query);
  });
}

function updateDailyExportButton() {
  const count = element('dailyExportCount');
  const button = element('downloadDailyMeetingsBtn');
  const ready = meetingLoad === 'ready';
  const total = ready ? dailyMeetings.length : 0;
  count.hidden = !ready;
  count.textContent = ready ? workspaceNumber.format(total) : '';
  button.disabled = exportingDay || !ready || total === 0;
  const copy = element('copyDailyMeetingsBtn');
  copy.disabled = !ready || total === 0;
  copy.setAttribute('aria-label', ready ? 'نسخ كل اجتماعات اليوم المحدد للشيت، عدد الاجتماعات ' + total : 'نسخ للشيت');
  button.setAttribute('aria-busy', String(exportingDay));
  const label = element('dailyExportLabel').textContent;
  button.setAttribute('aria-label', ready ? label + '، عدد الاجتماعات ' + total : label);
}

function updateAgendaMetrics() {
  const ready = meetingLoad === 'ready';
  const total = dailyMeetings.length;
  const remote = dailyMeetings.filter(meeting => meetingChannel(meeting) === 'remote').length;
  const completed = dailyMeetings.filter(meeting => getMeetingStatus(meeting.id) === 'done').length;
  element('agendaTotalCount').textContent = ready ? workspaceNumber.format(total) : '—';
  element('agendaRemoteCount').textContent = ready ? workspaceNumber.format(remote) : '—';
  element('agendaInPersonCount').textContent = ready ? workspaceNumber.format(total - remote) : '—';
  element('agendaCompletedCount').textContent = ready ? workspaceNumber.format(completed) : '—';
}

function renderMeetings() {
  const meetings = visibleMeetings();
  updateDailyExportButton();
  updateAgendaMetrics();
  if (element('meetingExportDialog').open) updateMeetingExportPreview();
  element('meetingsProgressLabel').textContent = 'المعروض ' + workspaceNumber.format(meetings.length) +
    ' من ' + workspaceNumber.format(dailyMeetings.length);

  if (!meetings.length) {
    if (element('meetingSearch').value.trim()) {
      const clear = textElement('button', 'مسح البحث', 'workspace-button');
      clear.type = 'button';
      clear.addEventListener('click', () => {
        element('meetingSearch').value = '';
        renderMeetings();
        element('meetingSearch').focus();
      });
      renderMeetingMessage('لا توجد اجتماعات تطابق البحث.', clear, 'search');
      return;
    }
    let showTeam;
    if (meetingScope === 'mine' && dailyMeetings.length) {
      showTeam = textElement('button', 'عرض كل الاجتماعات', 'workspace-button');
      showTeam.type = 'button';
      showTeam.addEventListener('click', () => selectMeetingScope('all'));
    }
    renderMeetingMessage(showTeam ? 'لا توجد اجتماعات باسمك في هذا اليوم.' : 'لا توجد اجتماعات في هذا اليوم.', showTeam);
    return;
  }

  const container = element('meetingsTableContainer');
  const focusedStatus = container.contains(document.activeElement) ? document.activeElement.dataset.meetingId : null;
  const list = document.createElement('ol');
  list.className = 'workspace-agenda';
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', 'الاجتماعات مرتبة بالوقت');
  meetings.forEach((meeting, index) => {
    const row = document.createElement('li');
    row.className = 'workspace-agenda-row';
    const number = textElement('span', String(index + 1).padStart(2, '0'), 'agenda-row-number');
    number.setAttribute('aria-hidden', 'true');

    const title = textElement('div', '', 'agenda-row-title');
    const label = meetingDisplayTitle(meeting.summary);
    const meta = textElement('div', '', 'agenda-row-meta');
    const remote = meetingChannel(meeting) === 'remote';
    const typeLabel = remote ? 'عن بعد' : meeting.meetingType === 'خارجي' ? 'خارجي' : 'حضوري';
    const type = textElement('span', typeLabel, 'agenda-type');
    type.dataset.channel = remote ? 'remote' : 'in-person';
    type.prepend(renderedIcon(remote ? 'video' : 'map-pin'));
    meta.append(type, textElement('span', meeting.salesRep || 'بدون مسؤول', 'agenda-owner'));
    title.append(textElement('strong', label), meta);

    const timeGroup = textElement('div', '', 'agenda-row-clock');
    const time = textElement('time', meetingTime(meeting));
    time.dateTime = meeting.startTime;
    timeGroup.append(time);
    if (!meeting.allDay && Number.isFinite(Date.parse(meeting.endTime))) {
      const end = textElement('time', 'إلى ' + meetingTimeFormat.format(new Date(meeting.endTime)), 'agenda-end-time');
      end.dateTime = meeting.endTime;
      timeGroup.append(end);
    }

    const actions = textElement('div', '', 'workspace-meeting-actions');
    const select = document.createElement('select');
    select.className = 'input-field workspace-status';
    select.dataset.meetingId = meeting.id;
    select.setAttribute('aria-label', 'حالة ' + label);
    for (const status of ['pending', 'done', 'postponed']) {
      select.add(new Option(meetingStatusLabels[status], status));
    }
    select.value = getMeetingStatus(meeting.id);
    select.dataset.status = select.value;
    select.disabled = meetingStatusUpdates.has(meeting.id);
    select.addEventListener('change', () => saveMeetingStatus(meeting.id, select.value));
    actions.append(select);

    const link = meetUrl(meeting.meetLink);
    if (link && remote) {
      const join = textElement('a', 'انضمام', 'workspace-button workspace-join');
      join.prepend(renderedIcon('video'));
      join.href = link;
      join.target = '_blank';
      join.rel = 'noopener noreferrer';
      join.setAttribute('aria-label', 'انضمام إلى ' + label);
      actions.append(join);
    }
    row.append(number, timeGroup, title, actions);
    list.append(row);
  });
  container.replaceChildren(list);
  if (focusedStatus) {
    [...list.querySelectorAll('select:not(:disabled)')].find(select => select.dataset.meetingId === focusedStatus)
      ?.focus({ preventScroll: true });
  }
  window.lucide?.createIcons();
}

function readMeetingExportFilters() {
  const from = element('meetingsExportDateFrom').value;
  const range = element('meetingExportPeriod').value === 'range';
  const to = range ? element('meetingsExportDateTo').value : from;
  const isoDay = /^\d{4}-\d{2}-\d{2}$/;
  return {
    from, to, range,
    valid: isoDay.test(from) && isoDay.test(to) && from <= to,
    scope: element('meetingExportScope').value,
    type: element('meetingExportType').value,
    status: element('meetingExportStatus').value,
  };
}

function filterMeetingExport(rows, filters, mine = matchesCurrentUser, statusFor = getMeetingStatus) {
  return rows.filter(meeting => {
    if (filters.scope === 'mine' && !mine(meeting)) return false;
    if (filters.scope === 'unassigned' && meeting.salesRep) return false;
    if (!['all', 'mine', 'unassigned'].includes(filters.scope) && meeting.salesRep !== filters.scope) return false;
    if (filters.type !== 'all' && meetingChannel(meeting) !== filters.type) return false;
    return filters.status === 'all' || statusFor(meeting.id) === filters.status;
  });
}

function cachedMeetingExportRows(filters) {
  if (filters.from === meetingDay && filters.to === meetingDay && meetingLoad === 'ready') return dailyMeetings;
  if (exportDateCache?.from === filters.from && exportDateCache.to === filters.to) return exportDateCache.rows;
  return undefined;
}

function updateMeetingExportPreview() {
  const filters = readMeetingExportFilters();
  const endField = element('meetingExportEndField');
  endField.hidden = !filters.range;
  element('meetingsExportDateTo').disabled = !filters.range;
  element('meetingExportDateLabel').textContent = filters.range ? 'من تاريخ' : 'التاريخ';

  const rows = filters.valid ? cachedMeetingExportRows(filters) : undefined;
  const count = rows ? filterMeetingExport(rows, filters).length : null;
  const preview = element('previewMeetingExportBtn');
  const download = element('meetingsExportExcelSubmitBtn');
  const copy = element('copyFilteredMeetingsBtn');
  preview.hidden = !filters.valid || count !== null;
  preview.disabled = exportingRange || countingExport;
  download.disabled = !filters.valid || count === 0 || exportingRange || countingExport;
  copy.hidden = filters.from !== filters.to;
  copy.disabled = !filters.valid || !count || exportingRange || countingExport;
  download.setAttribute('aria-busy', String(exportingRange));
  const feedback = element('meetingExportCount');
  if (exportingRange || countingExport) feedback.textContent = exportingRange ? 'جارٍ تجهيز ملف إكسل…' : 'جارٍ حساب الاجتماعات…';
  else if (!filters.valid) feedback.textContent = 'حدد تاريخًا صالحًا للتصدير.';
  else if (count === null) feedback.textContent = 'احسب العدد أو نزّل الملف مباشرة.';
  else if (count === 0) feedback.textContent = 'لا توجد اجتماعات تطابق الفلاتر.';
  else feedback.textContent = 'عدد الاجتماعات في الملف: ' + workspaceNumber.format(count);
}

function openMeetingExport() {
  const dialog = element('meetingExportDialog');
  if (dialog.open) return;
  element('meetingsExportForm').reset();
  element('meetingsExportDateFrom').value = meetingDay;
  element('meetingsExportDateTo').value = meetingDay;
  exportDateCache = undefined;
  updateMeetingExportPreview();
  dialog.showModal();
}

async function getMeetingExportRows(filters, uid) {
  const cached = cachedMeetingExportRows(filters);
  if (cached) return cached;
  const meetings = [];
  if (filters.from === filters.to) {
    meetings.push(...await getCalendarMeetings({ date: filters.from }));
  } else {
    const cursor = new Date(filters.from.slice(0, 7) + '-01T00:00:00Z');
    const lastMonth = filters.to.slice(0, 7);
    while (cursor.toISOString().slice(0, 7) <= lastMonth) {
      const batch = [];
      for (let i = 0; i < 4 && cursor.toISOString().slice(0, 7) <= lastMonth; i++) {
        batch.push(getCalendarMeetings({ month: cursor.toISOString().slice(0, 7) }));
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
      for (const list of await Promise.all(batch)) {
        for (const meeting of list) meetings.push(meeting);
      }
      if (currentUser?.uid !== uid) return [];
    }
  }
  if (currentUser?.uid !== uid) return [];
  const rows = availableMeetings(meetings, filters.from, filters.to);
  exportDateCache = { from: filters.from, to: filters.to, rows };
  return rows;
}

async function previewMeetingExport() {
  const filters = readMeetingExportFilters();
  const uid = currentUser?.uid;
  if (!filters.valid || !uid || countingExport || exportingRange) return;
  countingExport = true;
  updateMeetingExportPreview();
  let failed = false;
  try {
    await getMeetingExportRows(filters, uid);
  } catch {
    failed = currentUser?.uid === uid;
  } finally {
    countingExport = false;
    updateMeetingExportPreview();
    if (failed) element('meetingExportCount').textContent = 'تعذّر حساب الاجتماعات. حاول مرة أخرى.';
  }
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
  if (currentUser?.uid !== uid) return false;
  await window.saveMeetingsWorkbook(rows, reportMeetingStatuses(rows), filename);
  return true;
}

function reportMeetingStatuses(rows) {
  return Object.fromEntries(rows.map(meeting => [
    meeting.id, meetingStatusUpdates.get(meeting.id) || meetingStatuses[meeting.id]?.status,
  ]));
}

async function copyMeetingRowsToSheet(rows, dialog) {
  if (!currentUser || !rows.length) return;
  try {
    // Send text/plain only so the destination keeps its own formats and validation.
    await navigator.clipboard.writeText(meetingSheetClipboard(rows, reportMeetingStatuses(rows)));
    if (dialog?.open) dialog.close();
    showToast('نُسخت الاجتماعات (' + workspaceNumber.format(rows.length) +
      '). الصقها في أول خلية من العمود A تحت التاريخ في الشيت.', 'success', 7000);
  } catch {
    const message = 'تعذّر النسخ إلى الحافظة. أعد المحاولة من المتصفح.';
    if (dialog?.open) element('meetingExportCount').textContent = message;
    else showToast(message, 'error');
  }
}

function copyDailyMeetings() {
  if (meetingLoad !== 'ready') return;
  return copyMeetingRowsToSheet(dailyMeetings);
}

function copyFilteredMeetings() {
  const filters = readMeetingExportFilters();
  if (!filters.valid || filters.from !== filters.to) return;
  const rows = cachedMeetingExportRows(filters);
  if (!rows) return;
  return copyMeetingRowsToSheet(filterMeetingExport(rows, filters), element('meetingExportDialog'));
}

async function downloadDailyMeetings() {
  const uid = currentUser?.uid;
  const rows = [...dailyMeetings];
  if (!uid || !rows.length || meetingLoad !== 'ready' || exportingDay) return;
  const date = meetingDay;
  exportingDay = true;
  updateDailyExportButton();
  try {
    if (await saveMeetingReport(rows, 'الاجتماعات ' + date, uid)) {
      showToast('تم تجهيز ملف اليوم. عدد الاجتماعات: ' + workspaceNumber.format(rows.length), 'success');
    }
  } catch {
    if (currentUser?.uid === uid) showToast('تعذّر تنزيل ملف الاجتماعات. حاول مرة أخرى.', 'error');
  } finally {
    exportingDay = false;
    updateDailyExportButton();
  }
}

async function downloadCustomMeetingExport(event) {
  event.preventDefault();
  const filters = readMeetingExportFilters();
  const uid = currentUser?.uid;
  if (!filters.valid || !uid || exportingRange || countingExport) return;
  exportingRange = true;
  updateMeetingExportPreview();
  let failed = false;
  try {
    const allRows = await getMeetingExportRows(filters, uid);
    if (currentUser?.uid !== uid) return;
    const rows = filterMeetingExport(allRows, filters);
    if (!rows.length) return;
    const dateLabel = filters.from === filters.to ? filters.from : filters.from + ' إلى ' + filters.to;
    if (await saveMeetingReport(rows, 'الاجتماعات ' + dateLabel, uid)) {
      element('meetingExportDialog').close();
      showToast('تم تجهيز ملف إكسل. عدد الاجتماعات: ' + workspaceNumber.format(rows.length), 'success');
    }
  } catch {
    failed = currentUser?.uid === uid;
  } finally {
    exportingRange = false;
    updateMeetingExportPreview();
    if (failed) element('meetingExportCount').textContent = 'تعذّر تنزيل ملف الاجتماعات. حاول مرة أخرى.';
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
element('meetingsExportForm').addEventListener('submit', downloadCustomMeetingExport);
element('meetingsExportForm').addEventListener('change', updateMeetingExportPreview);
element('customMeetingExportBtn').addEventListener('click', openMeetingExport);
element('closeMeetingExportBtn').addEventListener('click', () => element('meetingExportDialog').close());
element('previewMeetingExportBtn').addEventListener('click', previewMeetingExport);
element('copyFilteredMeetingsBtn').addEventListener('click', copyFilteredMeetings);
element('meetingSearch').addEventListener('input', () => {
  if (meetingLoad === 'ready') renderMeetings();
});
element('customersExportForm').addEventListener('submit', event => event.preventDefault());
element('customersExportForm').addEventListener('change', renderCustomerExport);
element('downloadDailyMeetingsBtn').addEventListener('click', downloadDailyMeetings);
element('copyDailyMeetingsBtn').addEventListener('click', copyDailyMeetings);
element('exportExcelBtn').addEventListener('click', downloadCustomerExport);
setInterval(() => {
  if (activeWorkspace === 'meetings' && meetingLoad === 'ready' && !document.hidden) {
    fetchMeetingsForDay({ background: true });
  }
}, 5 * 60 * 1000);
