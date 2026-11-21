/* The detector works in PDF.js viewport coordinates, independent of page rotation and crop. */
const ES_DOTS = /[.·•∙⋅…‥․。۔]{3,}|[_.ـ]{4,}/gu;
const ES_SIGN_LABEL = /^(?:التوقيع|توقيع)(?:(?:الطرف(?:الاول|الثاني)|المدير(?:العام)?))?$/u;
const ES_FIRST_PARTY = /الطرف(?:الاول|1)|اوامرالشبكه/u;
const ES_OTHER_PARTY = /الطرف(?:الثاني|2)|العميل/u;

function esPlacementText(value) {
  return value.normalize('NFKC').replace(/[\u0610-\u061A\u064B-\u065F\u0670\u0640\u200E\u200F\u202A-\u202E]/gu, '')
    .replace(/[أإآٱ]/gu, 'ا').replace(/ة/gu, 'ه').replace(/ى/gu, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function esTextMatches(pattern, value) {
  // PDF producers can emit a separate text item for every Arabic glyph,
  // including a single compatibility ligature for two adjacent letters.
  const compact = esPlacementText(value).replaceAll(' ', '');
  return pattern.test(compact) || pattern.test(Array.from(compact).reverse().join(''));
}

function esPlacementPage(items, viewport) {
  const rows = [];
  const marks = [];
  for (const item of items) {
    if (!item.str?.trim() || !item.transform || !item.width) continue;
    const [a, b, c, d, e, f] = item.transform;
    const length = Math.hypot(a, b);
    if (!length) continue;
    const origin = viewport.convertToViewportPoint(e, f);
    const end = viewport.convertToViewportPoint(e + a / length * item.width, f + b / length * item.width);
    const font = viewport.convertToViewportPoint(e + c, f + d);
    const height = Math.max(2, Math.hypot(font[0] - origin[0], font[1] - origin[1]));
    if (Math.abs(end[1] - origin[1]) > Math.max(2, height * 0.35)) {
      marks.push({
        x: Math.min(origin[0], end[0]) - height, right: Math.max(origin[0], end[0]) + height,
        top: Math.min(origin[1], end[1]), bottom: Math.max(origin[1], end[1])
      });
      continue;
    }
    const left = Math.min(origin[0], end[0]);
    const right = Math.max(origin[0], end[0]);
    const baseline = (origin[1] + end[1]) / 2;
    if (right <= 0 || left >= viewport.width || baseline < 0 || baseline > viewport.height) continue;
    const box = { x: left, right, y: baseline, height, top: baseline - 0.95 * height, bottom: baseline + 0.28 * height };
    let row = rows.find(candidate => Math.abs(candidate.y - baseline) < Math.max(2, height * 0.45));
    if (!row) rows.push(row = { y: baseline, spans: [] });
    if (/^[\s.·•∙⋅…‥․。۔_ـ]+$/u.test(item.str)) {
      row.spans.push({ ...box, dots: item.str.replace(/\s/gu, '').length });
      continue;
    }

    const runs = [...item.str.matchAll(ES_DOTS)];
    if (!runs.length) {
      row.spans.push({ ...box, text: item.str });
      continue;
    }
    // Text extraction can merge the label and dots. Keep only the conservative
    // interior of a dotted prefix/suffix on the label's visually left side.
    const words = item.str.replace(ES_DOTS, ' ');
    if (runs.length === 1 && esTextMatches(ES_SIGN_LABEL, words) &&
        (runs[0].index === 0 || runs[0].index + runs[0][0].length === item.str.length)) {
      const split = left + (right - left) * Math.min(0.58, runs[0][0].length / item.str.length);
      row.spans.push({ ...box, right: split, dots: runs[0][0].length, inset: height * 0.35 });
      row.spans.push({ ...box, x: split, text: words, merged: true });
    } else {
      row.spans.push({ ...box, text: item.str });
    }
  }

  const labels = [];
  const context = [];
  const dotted = [];
  for (const row of rows) {
    row.spans.sort((a, b) => a.x - b.x);
    let group;
    for (const span of row.spans) {
      if (span.dots) {
        if (group?.dots && span.x - group.right <= Math.max(3, span.height * 0.85)) {
          group.right = span.right;
          group.dots += span.dots;
        } else {
          group = { ...span };
          dotted.push(group);
        }
        continue;
      }
      marks.push(span);
      // Adjacent text spans can split Arabic words or a party label.
      if (group?.text && span.x - group.right <= span.height * 1.05) {
        group.right = span.right;
        group.text = span.text + ' ' + group.text;
      } else {
        group = { ...span };
        context.push(group);
      }
    }
  }

  for (const item of context) {
    if (esTextMatches(ES_SIGN_LABEL, item.text)) labels.push(item);
    const first = esTextMatches(ES_FIRST_PARTY, item.text);
    const other = esTextMatches(ES_OTHER_PARTY, item.text);
    item.party = first && other ? 3 : first ? 1 : other ? 2 : 0;
  }
  return { width: viewport.width, height: viewport.height, marks, labels, context, dotted };
}

function esPartyForLabel(page, label) {
  const nearby = page.context.filter(item => item.party && item.y <= label.y + label.height * 1.5 &&
    label.y - item.y <= Math.min(page.height * 0.44, label.height * 26) &&
    Math.max(0, item.x - label.right, label.x - item.right) <= label.height * 6)
    .map(item => ({
      party: item.party,
      distance: Math.abs(label.y - item.y) +
        2 * Math.max(0, item.x - label.right, label.x - item.right)
    })).sort((a, b) => a.distance - b.distance);
  return nearby[0]?.party === 1 && !nearby.some(item => item.party !== 1 &&
    item.distance <= nearby[0].distance + label.height * 2);
}

function esFindSigningLine(page, graphicLines = []) {
  const candidates = [];
  for (const label of page.labels) {
    if (!esPartyForLabel(page, label)) continue;
    const ranges = page.dotted.filter(line => line.dots >= 3);
    for (const line of ranges) {
      const gap = label.x - line.right;
      if (Math.abs(line.y - label.y) > label.height * 0.43 ||
          gap < -label.height * 0.5 || gap > label.height * 4 ||
          line.right - line.x < label.height * 1.8 || line.right - line.x > page.width * 0.55) continue;
      const padding = line.inset || 0;
      candidates.push({ x: line.x + padding, right: Math.min(line.right - padding, label.x), y: line.y, height: label.height });
    }
  }
  return candidates.length ? candidates : graphicLines;
}

function esGroupIsVisuallyClear(page, group, line, raster) {
  const sx = raster.width / page.width;
  const sy = raster.height / page.height;
  const hasInk = (x, y) => {
    const i = (y * raster.width + x) * 4;
    return raster.pixels[i + 3] > 120 &&
      raster.pixels[i] + raster.pixels[i + 1] + raster.pixels[i + 2] < 645;
  };
  const xStart = Math.max(0, Math.floor(line.x * sx));
  const xEnd = Math.min(raster.width, Math.ceil(line.right * sx));
  const yStart = Math.max(0, Math.floor((line.y - line.height * 0.25) * sy));
  const yEnd = Math.min(raster.height, Math.ceil((line.y + line.height * 0.42) * sy));
  let columnsWithInk = 0;
  for (let x = xStart; x < xEnd; x++) {
    for (let y = yStart; y < yEnd; y++) {
      if (hasInk(x, y)) {
        columnsWithInk++;
        break;
      }
    }
  }
  if (columnsWithInk < (xEnd - xStart) * 0.16) return false;

  return Object.values(group).every(rect => {
    const left = Math.max(0, Math.floor(rect.leftRatio * raster.width));
    const top = Math.max(0, Math.floor(rect.topRatio * raster.height));
    const right = Math.min(raster.width, Math.ceil((rect.leftRatio + rect.widthRatio) * raster.width));
    const bottom = Math.min(raster.height, Math.ceil((rect.topRatio + rect.heightRatio) * raster.height));
    let ink = 0;
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        if (x / sx >= line.x - 2 && x / sx <= line.right + 2 &&
          y / sy >= line.y - line.height * 0.25 && y / sy <= line.y + line.height * 0.42) continue;
        if (hasInk(x, y)) ink++;
      }
    }
    return ink <= Math.max(3, (right - left) * (bottom - top) * 0.002);
  });
}

function esFindGraphicSigningLines(page, pixels, rasterWidth, rasterHeight) {
  const found = [];
  const scaleX = rasterWidth / page.width;
  const scaleY = rasterHeight / page.height;
  const dark = (x, y) => {
    const i = (y * rasterWidth + x) * 4;
    return pixels[i + 3] > 160 && (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3 < 135;
  };
  for (const label of page.labels) {
    if (label.merged || !esPartyForLabel(page, label)) continue;
    const maxX = Math.min(rasterWidth - 1, Math.floor((label.x - label.height * 0.2) * scaleX));
    const minX = Math.max(0, Math.floor((label.x - Math.min(page.width * 0.45, label.height * 25)) * scaleX));
    const minY = Math.max(1, Math.floor((label.y - label.height * 0.4) * scaleY));
    const maxY = Math.min(rasterHeight - 2, Math.ceil((label.y + label.height * 0.34) * scaleY));
    const maxGap = Math.max(2, Math.ceil(label.height * scaleX * 0.5));
    for (let y = minY; y <= maxY; y++) {
      let start = -1;
      let last = -1;
      let filled = 0;
      for (let x = minX; x <= maxX + maxGap + 1; x++) {
        if (x <= maxX && dark(x, y)) {
          if (start < 0) start = x;
          last = x;
          filled++;
        } else if (start >= 0 && x - last > maxGap) {
          const length = last - start + 1;
          if (length >= label.height * scaleX * 2.4 && filled >= length * 0.32 &&
              maxX - last < label.height * scaleX * 2.6) {
            const row = { x: start / scaleX, right: last / scaleX, y: y / scaleY, height: label.height };
            const crossesText = page.marks.some(box => row.y > box.top && row.y < box.bottom &&
              row.x < box.right && row.right > box.x);
            if (!crossesText && !found.some(line => Math.abs(line.y - row.y) <= label.height * 0.24 &&
                Math.abs(line.x - row.x) <= label.height * 0.5 && Math.abs(line.right - row.right) <= label.height * 0.5)) {
              found.push(row);
            }
          }
          start = -1;
          filled = 0;
        }
      }
    }
  }
  return found;
}

function esGroupIsClear(page, group, avoidText = true) {
  return Boolean(group?.signature) && Object.values(group).every(rect => {
    const { leftRatio, topRatio, widthRatio, heightRatio } = rect;
    if (![leftRatio, topRatio, widthRatio, heightRatio].every(Number.isFinite) ||
        widthRatio <= 0 || heightRatio <= 0 || leftRatio < 0 || topRatio < 0 ||
        leftRatio + widthRatio > 1.000001 || topRatio + heightRatio > 1.000001) return false;
    if (!avoidText) return true;
    const left = leftRatio * page.width;
    const top = topRatio * page.height;
    const right = left + widthRatio * page.width;
    const bottom = top + heightRatio * page.height;
    return !page.marks.some(box => left < box.right + 1 && right > box.x - 1 &&
      top < box.bottom + 1 && bottom > box.top - 1);
  });
}

function esComposeSigningGroup(page, line, signature, stamp, manual = false) {
  const span = line.right - line.x;
  const center = (line.x + line.right) / 2;
  const asRatio = (x, y, width, height) => ({
    leftRatio: x / page.width, topRatio: y / page.height,
    widthRatio: width / page.width, heightRatio: height / page.height
  });
  for (const scale of [1, 0.86, 0.73, 0.6]) {
    const sigWidth = Math.min(span * 0.77, page.width * 0.26, page.height * 0.17 * signature.width / signature.height) * scale;
    const sigHeight = sigWidth * signature.height / signature.width;
    if (sigWidth < line.height * 1.25) continue;
    const stampWidth = stamp ? Math.min(sigWidth * 0.98, span * 0.7, page.height * 0.13 * stamp.width / stamp.height) : 0;
    const stampHeight = stamp ? stampWidth * stamp.height / stamp.width : 0;
    const gapFromSignatureTop = sigHeight * 0.68;
    for (const offset of stamp ? [-0.25, 0.25] : [0]) {
      let x = center - sigWidth / 2;
      let y = line.y - sigHeight * 0.72;
      const stampX = (sigWidth - stampWidth) / 2 + sigWidth * offset;
      const stampBottom = Math.max(sigHeight, gapFromSignatureTop + stampHeight);
      if (manual) {
        x = Math.max(1 - Math.min(0, stampX), Math.min(x, page.width - 1 - Math.max(sigWidth, stampX + stampWidth)));
        y = Math.max(1, Math.min(y, page.height - 1 - stampBottom));
      }
      const group = { signature: asRatio(x, y, sigWidth, sigHeight) };
      if (stamp) group.stamp = asRatio(x + stampX, y + gapFromSignatureTop, stampWidth, stampHeight);
      if (esGroupIsClear(page, group, !manual)) return group;
    }
  }
  return null;
}

function esCanSharePdfFiles(sharing, files) {
  if (!files.length || typeof sharing.share !== 'function' || typeof sharing.canShare !== 'function') return false;
  try { return sharing.canShare({ files }); } catch { return false; }
}

async function esSharePdfFiles(sharing, files) {
  if (!esCanSharePdfFiles(sharing, files)) return 'unsupported';
  try {
    await sharing.share({ files });
    return 'opened';
  } catch (error) {
    return error.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}
