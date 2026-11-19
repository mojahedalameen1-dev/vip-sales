// These choices use the exact text of the original Google Sheet's validation rules.
// The trailing spaces in three choices are part of the allowed values.
const meetingSheetTeamChoices = ['اشرف\u0020', 'مجاهد', 'شادي', 'حسام'];
const meetingSheetChannelChoices = ['عن بعد', 'حضوري', 'خارجي\u0020'];
const meetingSheetStatusChoices = ['تم', 'لم يتم\u0020', 'ملغي'];

const meetingSheetClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Riyadh', hour: 'numeric', minute: '2-digit', hour12: true,
});

function meetingSheetTime(meeting) {
  if (meeting.allDay) return 'طوال اليوم';
  const parts = meetingSheetClock.formatToParts(new Date(meeting.startTime));
  const hour = parts.find(part => part.type === 'hour').value;
  const minute = parts.find(part => part.type === 'minute').value;
  return hour + ':' + minute;
}

function safeMeetingSheetLink(value, hostname) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === hostname && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function meetingSheetRow(meeting, number, rawStatus) {
  const title = String(meeting.reportTitle || meeting.summary || 'اجتماع')
    .replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) & 15));
  const owner = (meeting.salesRep || '').trim().replace(/^م(?:\.\s*|\s+)/, '').replace(/^[أإآ]/, 'ا');
  const team = meetingSheetTeamChoices.find(choice => choice.trimEnd() === owner) || '';
  const channel = meeting.meetingType === 'خارجي' ? meetingSheetChannelChoices[2]
    : meeting.meetingType === 'حضوري' ? meetingSheetChannelChoices[1] : meetingSheetChannelChoices[0];
  const status = rawStatus === 'done' ? meetingSheetStatusChoices[0]
    : rawStatus === 'pending' ? meetingSheetStatusChoices[1]
    : ['postponed', 'canceled', 'cancelled'].includes(rawStatus) ? meetingSheetStatusChoices[2] : '';
  return [
    number, title, team, meetingSheetTime(meeting), channel, status,
    safeMeetingSheetLink(meeting.ticketUrl, 'e.aait.sa'),
    safeMeetingSheetLink(meeting.meetLink, 'meet.google.com'),
  ];
}

function meetingSheetClipboard(rows, statuses) {
  const safeCell = value => {
    const text = String(value).replace(/[\t\r\n\u2028\u2029]+/g, ' ');
    // Guard spreadsheet formula prefixes while keeping the actual dropdown text exact.
    return typeof value === 'string' && /^\s*[=+\-@]/.test(text) ? "'" + text : text;
  };
  return rows.map((meeting, index) => meetingSheetRow(meeting, index + 1, statuses[meeting.id]).map(safeCell).join('\t')).join('\n');
}
