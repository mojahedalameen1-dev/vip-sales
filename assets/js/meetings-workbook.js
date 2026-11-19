const meetingSheetDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' });
const meetingSheetMonth = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
  month: 'long', year: 'numeric', timeZone: 'UTC',
});
const meetingHeaders = [
  'a', 'مختصر فكرة المشروع', 'الفريق المسؤول', 'الساعة',
  'من خلال', 'حالة الاجتماع', 'رابط التذكرة', 'رابط الاجتماع',
];
const meetingColumnWidths = [8, 86, 15, 14, 15, 15, 67, 38];
const workbookMeetingChoices = {
  C: meetingSheetTeamChoices,
  E: meetingSheetChannelChoices,
  F: meetingSheetStatusChoices,
};
const meetingCellBorder = Object.fromEntries(['top', 'bottom', 'left', 'right'].map(side => [
  side, { style: 'thin', color: { argb: 'FF252525' } },
]));

function meetingSheetDate(meeting) {
  return meeting.allDay ? meeting.startTime : meetingSheetDay.format(new Date(meeting.startTime));
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
  for (const [column, choices] of Object.entries(workbookMeetingChoices)) {
    const range = column + first + ':' + column + last;
    sheet.dataValidations.add(range, {
      type: 'list',
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: 'قيمة غير صالحة',
      error: 'اختر قيمة من القائمة.',
      formulae: ['"' + choices.join(',') + '"'],
    });
  }
}

function addDayToMeetingSheet(sheet, date, meetings, statuses) {
  const header = sheet.addRow([new Date(date + 'T00:00:00Z')]);
  header.height = 25;
  styleMeetingRow(header, 'FFFF00');
  sheet.mergeCells(header.number, 1, header.number, meetingHeaders.length);
  header.getCell(1).numFmt = '[$-409]yyyy/mm/dd';

  const first = header.number + 1;
  meetings.forEach((meeting, index) => {
    const row = sheet.addRow(meetingSheetRow(meeting, index + 1, statuses[meeting.id]));
    row.height = row.getCell(2).value.length > 85 ? 33 : 24;
    styleMeetingRow(row, index % 2 ? 'FFFFFF' : 'E9F0F4');
    for (const column of Object.keys(workbookMeetingChoices)) {
      row.getCell(column).fill = undefined;
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
