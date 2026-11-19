const meetingSheetDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' });
const meetingSheetMonth = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
  month: 'long', year: 'numeric', timeZone: 'UTC',
});
const meetingSheetClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Riyadh', hour: 'numeric', minute: '2-digit', hour12: true,
});
const meetingHeaders = [
  'a', 'مختصر فكرة المشروع', 'الفريق المسؤول', 'الساعة',
  'من خلال', 'حالة الاجتماع', 'رابط التذكرة', 'رابط الاجتماع',
];
const meetingColumnWidths = [8, 86, 15, 14, 15, 15, 67, 38];
const meetingChoices = {
  C: { 'حسام': ['B50909', 'FFFFFF'], 'أشرف': ['542D80', 'FFFFFF'],
    'شادي': ['FFB800', '1B1B1B'], 'مجاهد': ['0B5395', 'FFFFFF'] },
  E: { 'عن بعد': ['E8EAED', '191919'], 'حضوري': ['151515', 'FFFFFF'] },
  F: { 'تم': ['126D52', 'FFFFFF'], 'لم يتم': ['B50909', 'FFFFFF'],
    'ملغي': ['151515', 'FFFFFF'] },
};
const reportStatusLabel = { done: 'تم', pending: 'لم يتم', postponed: 'ملغي', canceled: 'ملغي' };
const meetingCellBorder = Object.fromEntries(['top', 'bottom', 'left', 'right'].map(side => [
  side, { style: 'thin', color: { argb: 'FF252525' } },
]));

function meetingSheetDate(meeting) {
  return meeting.allDay ? meeting.startTime : meetingSheetDay.format(new Date(meeting.startTime));
}

function meetingSheetTime(meeting) {
  if (meeting.allDay) return 'طوال اليوم';
  const parts = meetingSheetClock.formatToParts(new Date(meeting.startTime));
  return parts.filter(part => ['hour', 'literal', 'minute'].includes(part.type)).map(part => part.value).join('').trim();
}

function paintMeetingCell(cell, background, foreground = '121212', bold = true) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + background } };
  cell.font = { name: 'Arial', size: 11, bold, color: { argb: 'FF' + foreground } };
}

function styleMeetingRow(row, background, foreground) {
  for (let col = 1; col <= meetingHeaders.length; col++) {
    const cell = row.getCell(col);
    paintMeetingCell(cell, background, foreground);
    cell.border = meetingCellBorder;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: col === 2 };
  }
}

function addMeetingChoices(sheet, first, last) {
  for (const [column, options] of Object.entries(meetingChoices)) {
    const range = column + first + ':' + column + last;
    const choices = Object.keys(options);
    sheet.dataValidations.add(range, {
      type: 'list',
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: 'قيمة غير صالحة',
      error: 'اختر قيمة من القائمة.',
      formulae: ['"' + choices.join(',') + '"'],
    });
    sheet.addConditionalFormatting({
      ref: range,
      rules: choices.map(value => {
        const [background, foreground] = options[value];
        return {
          type: 'expression',
          formulae: [column + first + '="' + value + '"'],
          style: {
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + background } },
            font: { bold: true, color: { argb: 'FF' + foreground } },
          },
        };
      }),
    });
  }
}

function safeMeetingSheetLink(value, hostname) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === hostname && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function meetingSheetTitle(meeting) {
  return String(meeting.reportTitle || meeting.summary || 'اجتماع')
    .replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) & 15));
}

function addDayToMeetingSheet(sheet, date, meetings, statuses) {
  const header = sheet.addRow([new Date(date + 'T00:00:00Z')]);
  header.height = 25;
  styleMeetingRow(header, 'FFFF00');
  sheet.mergeCells(header.number, 1, header.number, meetingHeaders.length);
  header.getCell(1).numFmt = '[$-409]yyyy/mm/dd';

  const first = header.number + 1;
  meetings.forEach((meeting, index) => {
    const team = (meeting.salesRep || '').replace(/^م\.\s*/, '');
    const channel = ['حضوري', 'خارجي'].includes(meeting.meetingType) ? 'حضوري' : 'عن بعد';
    const status = reportStatusLabel[statuses[meeting.id]] || '';
    const row = sheet.addRow([
      index + 1, meetingSheetTitle(meeting), team, meetingSheetTime(meeting), channel, status,
      safeMeetingSheetLink(meeting.ticketUrl, 'e.aait.sa'),
      safeMeetingSheetLink(meeting.meetLink, 'meet.google.com'),
    ]);
    row.height = row.getCell(2).value.length > 85 ? 33 : 24;
    styleMeetingRow(row, index % 2 ? 'FFFFFF' : 'E9F0F4');
    for (const [column, options] of Object.entries(meetingChoices)) {
      const cell = row.getCell(column);
      const colors = options[cell.value];
      if (colors) paintMeetingCell(cell, ...colors);
      else if (!cell.value) paintMeetingCell(cell, 'E8EAED');
    }
    for (const column of ['G', 'H']) {
      const cell = row.getCell(column);
      if (!cell.value) continue;
      const link = cell.value;
      cell.value = { text: link, hyperlink: link };
      cell.font = { name: 'Arial', size: 11, bold: true, underline: true, color: { argb: 'FF1155CC' } };
    }
  });
  addMeetingChoices(sheet, first, first + meetings.length - 1);
}

function createMeetingsWorkbook(rows, statuses) {
  const workbook = new ExcelJS.Workbook();
  const days = Map.groupBy(rows.toSorted((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime)), meetingSheetDate);
  const months = new Map();
  for (const [date, meetings] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    const month = date.slice(0, 7);
    let sheet = months.get(month);
    if (!sheet) {
      sheet = workbook.addWorksheet(meetingSheetMonth.format(new Date(month + '-01T00:00:00Z')), {
        views: [{ state: 'frozen', ySplit: 1, rightToLeft: true, showGridLines: false }],
      });
      sheet.columns = meetingColumnWidths.map(width => ({ width }));
      const header = sheet.addRow(meetingHeaders);
      header.height = 29;
      styleMeetingRow(header, '5C6676', 'FFFFFF');
      months.set(month, sheet);
    }
    addDayToMeetingSheet(sheet, date, meetings, statuses);
  }
  return workbook;
}

window.saveMeetingsWorkbook = async function(rows, statuses, filename) {
  const workbook = createMeetingsWorkbook(rows, statuses);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename + '.xlsx';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
