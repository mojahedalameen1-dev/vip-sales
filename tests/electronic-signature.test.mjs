import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const source = await readFile(new URL('../assets/js/electronic-signature.js', import.meta.url), 'utf8');
const placementSource = await readFile(new URL('../assets/js/esign-placement.js', import.meta.url), 'utf8');
const libSource = await readFile(new URL('../assets/js/vendor/pdf-lib.min.js', import.meta.url), 'utf8');
const lib = { exports: {} };
new Function('module', 'exports', libSource)(lib, lib.exports);
const PDFLib = lib.exports;
const standardFontDataUrl = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replaceAll('\\', '/');

function createElement() {
  return {
    children: [], style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, removeAttribute() {}, focus() {}, addEventListener() {},
    append(...children) { this.children.push(...children); },
    prepend(...children) { this.children.unshift(...children); },
    appendChild(child) { this.append(child); },
    replaceChildren(...children) { this.children = children; },
    querySelector() { return this.label ??= {}; }
  };
}

function harness(ids = []) {
  const elements = new Map(ids.map(id => [id, createElement()]));
  const downloads = [];
  const notices = [];
  const context = vm.createContext({
    PDFLib, pdfjsLib: pdfjs, URL, Blob, File, Uint8Array, ArrayBuffer, confirm: () => true,
    ES_PDF_ASSETS: new URL('../node_modules/pdfjs-dist/', import.meta.url),
    window: { atob, innerWidth: 1200 },
    document: {
      addEventListener() {}, querySelectorAll: () => [],
      getElementById: id => elements.get(id) || null,
      createElement(tag) {
        const node = createElement();
        if (tag === 'a') node.click = () => downloads.push(node.download);
        return node;
      }
    },
    console: { warn() {}, error() {} },
    showToast: (message, type) => notices.push({ message, type })
  });
  const run = code => vm.runInContext(code, context);
  run(placementSource);
  run(source);
  return { run, context, state: () => run('esState'), downloads, elements, notices };
}

function artwork(colorA, colorB) {
  const canvas = createCanvas(80, 40);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = colorA;
  ctx.fillRect(0, 0, 40, 40);
  ctx.fillStyle = colorB;
  ctx.fillRect(40, 0, 40, 40);
  return { width: 80, height: 40, dataUrl: canvas.toDataURL('image/png') };
}

const signature = artwork('#ff0000', '#0000ff');
const stamp = artwork('#00aa00', '#ff8800');

async function fixture({ rotations = [0], crop = false, name = 'fixture.pdf' } = {}) {
  const pdf = await PDFLib.PDFDocument.create();
  for (const rotation of rotations) {
    const page = pdf.addPage([600, 800]);
    page.setRotation(PDFLib.degrees(rotation));
    if (crop) {
      page.setMediaBox(-20, -30, 600, 800);
      page.setCropBox(40, 60, 400, 500);
      page.node.set(PDFLib.PDFName.of('UserUnit'), PDFLib.PDFNumber.of(1.25));
    }
  }
  return new File([await pdf.save()], name, { type: 'application/pdf' });
}

async function upload(h, type, file) {
  h.context.input = { files: [file] };
  h.context.documentType = type;
  await h.run('handleDocumentUpload(input, documentType)');
}

const sigPosition = { leftRatio: 0.15, topRatio: 0.2, widthRatio: 0.25, heightRatio: 0.16 };
const stampPosition = { leftRatio: 0.5, topRatio: 0.5, widthRatio: 0.2, heightRatio: 0.17 };

async function assertVisualPositions(bytes, expectations) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false });
  try {
    const pdf = await task.promise;
    assert.equal(pdf.numPages, expectations.length);
    for (let index = 0; index < expectations.length; index++) {
      const page = await pdf.getPage(index + 1);
      const viewport = page.getViewport({ scale: 0.5 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      const pixel = (x, y) => Array.from(ctx.getImageData(
        Math.floor(x * viewport.width), Math.floor(y * viewport.height), 1, 1
      ).data).slice(0, 3);
      for (const [position, colors] of [[sigPosition, [[255, 0, 0], [0, 0, 255]]],
        [stampPosition, [[0, 170, 0], [255, 136, 0]]]]) {
        const y = position.topRatio + position.heightRatio / 2;
        const expected = expectations[index].includes(position) ? colors : [[255, 255, 255], [255, 255, 255]];
        for (const [i, fraction] of [0.25, 0.75].entries()) {
          assert.deepEqual(pixel(position.leftRatio + position.widthRatio * fraction, y), expected[i],
            'Visible position and orientation on page ' + (index + 1));
        }
        assert.deepEqual(pixel(position.leftRatio - 0.02, y), [255, 255, 255], 'The image begins at the preview boundary');
        assert.deepEqual(pixel(position.leftRatio + position.widthRatio + 0.02, y), [255, 255, 255], 'The image ends at the preview boundary');
      }
    }
  } finally {
    await task.destroy();
  }
}

test('PDF.js is patched and document loading explicitly disables evaluation', async () => {
  const h = harness();
  h.context.pdfjsLib = { getDocument: options => options };
  const options = h.run('openEsPdf(new Uint8Array())');
  assert.equal(pdfjs.version, '6.5.438');
  assert.equal(options.isEvalSupported, false);
  assert.match(options.wasmUrl, /\/wasm\/$/);
});

test('rendered contract matches the preview rectangle and image orientation at all rotations and crop origins', async t => {
  const h = harness();
  t.after(() => h.run('clearElectronicSignatureSession()'));
  const rotations = [0, 90, 180, 270];
  await upload(h, 'contract', await fixture({ rotations, crop: true }));
  const state = h.state();
  assert.equal(state.contract.processingStatus, 'ready');
  state.signatureData = signature;
  state.stampData = stamp;
  state.contract.signatureOverlay = sigPosition;
  state.contract.stampOverlay = stampPosition;
  state.contract.stampPageIndex = 1;
  const bytes = await h.run("generateFinalPdfBytes('contract', esState.contract, esState.signatureData, esState.stampData)");
  await assertVisualPositions(bytes, [[sigPosition], [sigPosition, stampPosition], [sigPosition], [sigPosition]]);
});

test('technical offer keeps the cover untouched and never adds a company stamp', async t => {
  const h = harness();
  t.after(() => h.run('clearElectronicSignatureSession()'));
  await upload(h, 'technicalOffer', await fixture({ rotations: [0, 90] }));
  h.state().signatureData = signature;
  h.state().technicalOffer.signatureOverlay = sigPosition;
  const bytes = await h.run("generateFinalPdfBytes('technicalOffer', esState.technicalOffer, esState.signatureData, null)");
  await assertVisualPositions(bytes, [[], [sigPosition]]);
});

test('zoom leaves page-specific positions intact and reset clears the same positions used at export', async t => {
  const h = harness(['zoom-value']);
  t.after(() => h.run('clearElectronicSignatureSession()'));
  await upload(h, 'contract', await fixture({ rotations: [90] }));
  const state = h.state();
  state.signatureData = signature;
  state.stampData = stamp;
  state.activePreviewSubTab = 'contract';
  state.contract.pageSignatureOverlays[0] = sigPosition;
  state.contract.pageStampOverlays[0] = stampPosition;
  h.run('adjustEsZoom(0.1)');
  assert.equal(h.elements.get('zoom-value').textContent, '110%');
  assert.equal(h.run("getOverlayState('contract', 'signature', 0)"), sigPosition);
  h.run('resetOverlaysToDefaults()');
  assert.equal(state.contract.pageSignatureOverlays[0], null);
  assert.equal(state.contract.pageStampOverlays[0], null);
  assert.equal(h.run("getOverlayState('contract', 'signature', 0)"), state.contract.signatureOverlay);
});

test('one-page offer is explained and can only continue with an eligible contract', async t => {
  const h = harness(['status-technical', 'btn-next-step']);
  t.after(() => h.run('clearElectronicSignatureSession()'));
  await upload(h, 'technicalOffer', await fixture());
  assert.equal(h.elements.get('btn-next-step').disabled, true);
  assert.match(h.elements.get('status-technical').textContent, /صفحة واحدة/);
  h.run('nextStep()');
  assert.equal(h.state().currentStep, 1);
  await upload(h, 'contract', await fixture());
  assert.equal(h.elements.get('btn-next-step').disabled, false);
  assert.deepEqual(Array.from(h.run('getEsReviewDocuments()')), ['contract']);
});

test('replacement discards a late file read, invalid files are explicit, and a corrected file can continue', async t => {
  const h = harness(['status-technical', 'name-technical', 'btn-next-step']);
  t.after(() => h.run('clearElectronicSignatureSession()'));
  let finishOldRead;
  const old = { name: 'old.pdf', type: 'application/pdf', arrayBuffer: () => new Promise(resolve => { finishOldRead = resolve; }) };
  const oldUpload = upload(h, 'technicalOffer', old);
  assert.equal(h.elements.get('btn-next-step').disabled, true);
  const replacement = await fixture({ rotations: [0, 90, 0], name: 'replacement.pdf' });
  await upload(h, 'technicalOffer', replacement);
  finishOldRead(await (await fixture()).arrayBuffer());
  await oldUpload;
  assert.equal(h.state().technicalOffer.file, replacement);
  assert.equal(h.state().technicalOffer.pageCount, 3);
  assert.equal(h.elements.get('name-technical').textContent, 'replacement.pdf');
  assert.equal(h.elements.get('btn-next-step').disabled, false);
  await upload(h, 'technicalOffer', new File(['text'], 'unreadable.pdf', { type: 'application/pdf' }));
  assert.equal(h.state().technicalOffer.processingStatus, 'error');
  assert.match(h.elements.get('status-technical').textContent, /تعذرت قراءة/);
  assert.equal(h.elements.get('btn-next-step').disabled, true);
  await upload(h, 'technicalOffer', replacement);
  assert.equal(h.elements.get('btn-next-step').disabled, false);
});

test('review buttons do not mark skipped documents and Previous reopens the last reviewed document', () => {
  const h = harness();
  const state = h.state();
  state.signatureData = signature;
  state.stampData = stamp;
  for (const type of ['contract', 'technicalOffer']) Object.assign(state[type], { file: {}, processingStatus: 'ready', pageCount: 2 });
  h.run('goToStep(2)');
  assert.equal(state.currentStep, 2);
  h.run('goToWizardSubStep(2); goToWizardSubStep(3)');
  assert.equal(state.wizardStep, 1);
  assert.equal(state.reviewedFiles.contract, false);
  h.run('nextStep()');
  assert.equal(state.wizardStep, 1, 'Wait for a page of the active preview');
  state.contract.renderedPages = [{ isRendered: true }];
  state.technicalOffer.renderedPages = [{ isRendered: true }];
  h.run('nextStep(); prevStep()');
  assert.equal(state.reviewedFiles.technicalOffer, false);
  h.run('nextStep(); nextStep()');
  assert.equal(state.currentStep, 3);
  h.run('prevStep()');
  assert.equal(state.currentStep, 2);
  assert.equal(state.wizardStep, 2);
});

function prepareExport(h) {
  const state = h.state();
  state.currentStep = 3;
  state.signatureData = signature;
  state.stampData = stamp;
  for (const type of ['contract', 'technicalOffer']) {
    Object.assign(state[type], { file: { name: type + '.pdf' }, processingStatus: 'ready', pageCount: 2 });
    state.reviewedFiles[type] = true;
  }
  h.context.currentUser = { uid: 'operator', getIdTokenResult: async () => ({ claims: { name: 'Operator' } }) };
  h.context.firebase = { database: { ServerValue: { TIMESTAMP: { '.sv': 'timestamp' } } } };
}

test('ready document remains downloadable with a pending log and a failed second export; retry only regenerates that file', async t => {
  const h = harness(['esign-output-technicalOffer', 'esign-output-contract', 'btn-process-pdf']);
  t.after(() => h.run('clearElectronicSignatureSession()'));
  prepareExport(h);
  const calls = [];
  const records = [];
  let contractFails = true;
  h.context.generateFinalPdfBytes = async type => {
    calls.push(type);
    if (type === 'contract' && contractFails) throw new Error('fixture failure');
    return Uint8Array.of(1);
  };
  h.context.db = { ref: () => ({ push: () => ({ set(record) {
    records.push(record);
    return new Promise(() => {});
  } }) }) };
  await h.run('processAllDocumentsDownload()');
  assert.equal(h.downloads.length, 1);
  assert.equal(h.elements.get('esign-output-technicalOffer').children.length, 1);
  assert.match(h.elements.get('esign-output-contract').textContent, /تعذر/);
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'generated');
  assert.equal(records[0].signedAt['.sv'], 'timestamp');
  assert.equal(h.state().isProcessing, false);
  contractFails = false;
  await h.run('processAllDocumentsDownload()');
  await setImmediate();
  assert.deepEqual(calls, ['technicalOffer', 'contract', 'contract']);
  assert.equal(h.downloads.length, 2);
  assert.equal(records.length, 2);
});

test('log rejection does not remove an already prepared result', async t => {
  const h = harness(['esign-output-contract']);
  t.after(() => h.run('clearElectronicSignatureSession()'));
  prepareExport(h);
  h.state().technicalOffer.file = null;
  h.state().technicalOffer.processingStatus = 'empty';
  h.context.generateFinalPdfBytes = async () => Uint8Array.of(1);
  h.context.db = { ref: () => ({ push: () => ({ set: async () => { throw new Error('fixture rejection'); } }) }) };
  await h.run('processAllDocumentsDownload()');
  await setImmediate();
  assert.equal(h.downloads.length, 1);
  assert.equal(h.elements.get('esign-output-contract').children.length, 1);
  assert.equal(h.notices.at(-1)?.type, 'warning');
});

test('closing an authenticated session drops drafts and prevents a pending export from leaking to the next session', async () => {
  const h = harness(['esign-output-contract', 'esignView']);
  prepareExport(h);
  h.state().technicalOffer.processingStatus = 'empty';
  h.state().technicalOffer.file = null;
  let complete;
  h.context.generateFinalPdfBytes = () => new Promise(resolve => { complete = resolve; });
  const exportPromise = h.run('processAllDocumentsDownload()');
  h.run('clearElectronicSignatureSession()');
  complete(Uint8Array.of(1));
  await exportPromise;
  assert.equal(h.downloads.length, 0);
  assert.equal(h.state().contract.file, null);
  assert.equal(h.state().signatureData, null);
});

test('classic script loader shares the pending request and retries a failed script tag', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('    const scriptLoads');
  const end = html.indexOf('    // ═', start);
  const tags = [];
  const context = vm.createContext({ document: {
    createElement: () => ({ remove() { this.removed = true; } }),
    head: { appendChild: tag => tags.push(tag) }
  } });
  vm.runInContext(html.slice(start, end), context);
  const load = () => vm.runInContext("loadScript('fixture.js')", context);
  const initial = load();
  assert.equal(load(), initial);
  tags[0].onerror();
  await assert.rejects(initial);
  assert.equal(tags[0].removed, true);
  const retried = load();
  assert.equal(tags.length, 2);
  tags[1].onload();
  await retried;
});

test('failed preview page offers retry and renders on its second attempt', async () => {
  const id = 'page-wrapper-contract-0';
  const h = harness([id]);
  const wrapper = h.elements.get(id);
  wrapper.id = id;
  let attempts = 0;
  h.state().contract.pdfDocument = {
    getPage: async () => ({
      getViewport: () => ({ width: 120, height: 180 }),
      render: () => ({ promise: ++attempts === 1 ? Promise.reject(new Error('fixture')) : Promise.resolve() })
    })
  };
  h.state().contract.renderedPages = [{ pageNum: 1, pdfPageWidth: 80, renderedWidth: 80 }];
  const create = h.context.document.createElement;
  h.context.document.createElement = tag => tag === 'canvas' ? { style: {}, getContext: () => ({}) } : create(tag);
  await h.run("lazyRenderPageCanvas('contract', 0)");
  const retry = wrapper.children[0].children[1];
  assert.match(retry.textContent, /إعادة عرض الصفحة/);
  retry.onclick();
  await setImmediate();
  assert.equal(attempts, 2);
  assert.equal(h.state().contract.renderedPages[0].isRendered, true);
  assert.equal(wrapper.children.at(-1).className, 'page-canvas');
});

const arabicFixture = await readFile(new URL('./fixtures/esign-arabic.pdf', import.meta.url));

async function arabicTestFile(indexes, name) {
  const sourcePdf = await PDFLib.PDFDocument.load(arabicFixture);
  const result = await PDFLib.PDFDocument.create();
  for (const page of await result.copyPages(sourcePdf, indexes)) result.addPage(page);
  return new File([await result.save()], name, { type: 'application/pdf' });
}

function quickHarness(ids = []) {
  const h = harness(ids);
  h.context.pdfjsLib = { getDocument: options => pdfjs.getDocument({ ...options, standardFontDataUrl }) };
  const create = h.context.document.createElement;
  h.context.document.createElement = tag => tag === 'canvas' ? createCanvas(1, 1) : create(tag);
  h.state().signatureData = signature;
  h.state().stampData = stamp;
  h.context.currentUser = { uid: 'fixture' };
  h.context.localStorage = {
    items: new Map(),
    getItem(key) { return this.items.get(key); },
    setItem(key, value) { this.items.set(key, value); }
  };
  return h;
}

test('detects real Arabic dotted sections high, middle and low, uses graphics only in qualifying context, and rejects ambiguity', async t => {
  const cases = [
    { index: 0, y: 175, x: 321 }, { index: 1, y: 400, x: 321 }, { index: 2, y: 663, x: 321 },
    { index: 3, y: 400, x: 302 }, { index: 4, manual: true }, { index: 5, manual: true }, { index: 6, manual: true }
  ];
  for (const scenario of cases) {
    await t.test('Arabic fixture page ' + (scenario.index + 1), async sub => {
      const h = quickHarness();
      sub.after(() => h.run('clearElectronicSignatureSession()'));
      const file = await arabicTestFile([scenario.index], 'arabic-contract.pdf');
      await upload(h, 'contract', file);
      await h.run('startEsQuick()');
      assert.equal(h.state().contract.file, file);
      if (scenario.manual) {
        assert.equal(h.state().quick.phase, 'positioning');
        assert.equal(h.state().outputs.size, 0);
        assert.equal(h.state().quick.pending.length, 1);
        return;
      }
      assert.equal(h.state().quick.phase, 'results');
      const doc = h.state().contract;
      const sig = doc.pageSignatureOverlays[0];
      const stampRect = doc.pageStampOverlays[0];
      assert.ok(sig.leftRatio * 600 >= scenario.x);
      assert.ok((sig.leftRatio + sig.widthRatio) * 600 < 474, 'Stays clear of the signature label and other party');
      assert.ok(sig.topRatio * 800 < scenario.y && (sig.topRatio + sig.heightRatio) * 800 > scenario.y);
      assert.ok(stampRect.topRatio > sig.topRatio && stampRect.topRatio < sig.topRatio + sig.heightRatio);
      assert.notEqual(stampRect.leftRatio + stampRect.widthRatio / 2, sig.leftRatio + sig.widthRatio / 2);
      assert.ok(Math.abs(sig.widthRatio * 600 / (sig.heightRatio * 800) - signature.width / signature.height) < 0.001);
      const exported = h.state().outputs.get('contract');
      assert.equal(exported.file.type, 'application/pdf');
      assert.deepEqual(h.downloads, [exported.file.name]);
      const output = pdfjs.getDocument({ data: new Uint8Array(await exported.file.arrayBuffer()), standardFontDataUrl });
      try {
        const page = await (await output.promise).getPage(1);
        const canvas = createCanvas(600, 800);
        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport: page.getViewport({ scale: 1 }) }).promise;
        const samples = (rect, side) => Array.from(context.getImageData(
          Math.floor((rect.leftRatio + rect.widthRatio * side) * 600),
          Math.floor((rect.topRatio + rect.heightRatio * 0.45) * 800), 1, 1
        ).data).slice(0, 3);
        assert.deepEqual(samples(sig, 0.75), [0, 0, 255]);
        assert.deepEqual(samples(stampRect, 0.25), [0, 170, 0]);
      } finally { await output.destroy(); }
    });
  }
});

test('quick export supports an offer alone, both files together, and a separate result when one file cannot be read', async t => {
  const offer = await arabicTestFile([4, 2], 'offer.pdf');
  const contract = await arabicTestFile([3, 4], 'contract.pdf');
  for (const scenario of ['offer-only', 'both', 'bad-contract']) {
    await t.test(scenario, async sub => {
      const h = quickHarness();
      sub.after(() => h.run('clearElectronicSignatureSession()'));
      await upload(h, 'technicalOffer', offer);
      if (scenario === 'both') await upload(h, 'contract', contract);
      if (scenario === 'bad-contract') await upload(h, 'contract', new File(['unreadable'], 'bad.pdf', { type: 'application/pdf' }));
      await h.run('startEsQuick()');
      assert.equal(h.state().quick.phase, 'results');
      assert.deepEqual([...h.state().outputs.keys()], scenario === 'both' ? ['technicalOffer', 'contract'] : ['technicalOffer']);
      assert.deepEqual(h.downloads, [...h.state().outputs.values()].map(result => result.file.name));
      assert.equal(h.state().technicalOffer.pageSignatureOverlays[0], undefined, 'Cover excluded');
      assert.equal(h.state().technicalOffer.pageStampOverlays[1], undefined);
      if (scenario === 'both') {
        assert.ok(h.state().contract.pageSignatureOverlays[0]);
        assert.ok(h.state().contract.pageSignatureOverlays[1]);
        assert.ok(h.state().contract.pageStampOverlays[0]);
        assert.equal(h.state().contract.pageStampOverlays[1], undefined);
      }
    });
  }
});

test('quick detection and export agree on a rotated and cropped Arabic PDF', async t => {
  const h = quickHarness();
  t.after(() => h.run('clearElectronicSignatureSession()'));
  const sourceDoc = await PDFLib.PDFDocument.load(arabicFixture);
  const doc = await PDFLib.PDFDocument.create();
  const embedded = await doc.embedPage(sourceDoc.getPage(0));
  const page = doc.addPage([820, 650]);
  page.drawPage(embedded, { x: 810, y: 20, rotate: PDFLib.degrees(90) });
  page.setRotation(PDFLib.degrees(90));
  page.setCropBox(10, 20, 800, 600);
  await upload(h, 'contract', new File([await doc.save()], 'rotated-arabic.pdf', { type: 'application/pdf' }));
  await h.run('startEsQuick()');
  assert.equal(h.state().quick.phase, 'results');
  const overlay = h.state().contract.pageSignatureOverlays[0];
  assert.ok(overlay.leftRatio * 600 > 300 && overlay.leftRatio * 600 < 375);
  assert.ok(overlay.topRatio * 800 < 175);
  const task = pdfjs.getDocument({
    data: new Uint8Array(await h.state().outputs.get('contract').file.arrayBuffer()), standardFontDataUrl
  });
  try {
    const finalPage = await (await task.promise).getPage(1);
    const viewport = finalPage.getViewport({ scale: 1 });
    assert.deepEqual([viewport.width, viewport.height], [600, 800]);
    const canvas = createCanvas(600, 800);
    const ctx = canvas.getContext('2d');
    await finalPage.render({ canvasContext: ctx, viewport }).promise;
    const pixel = ctx.getImageData(
      Math.floor((overlay.leftRatio + overlay.widthRatio * 0.75) * viewport.width),
      Math.floor((overlay.topRatio + overlay.heightRatio * 0.45) * viewport.height), 1, 1
    );
    assert.deepEqual(Array.from(pixel.data).slice(0, 3), [0, 0, 255]);
  } finally { await task.destroy(); }
});

test('ordinary pages use a right-aligned slot above the real footer, including on rotated pages', async t => {
  const h = quickHarness();
  t.after(() => h.run('clearElectronicSignatureSession()'));
  const doc = await PDFLib.PDFDocument.create();
  doc.addPage([600, 800]);
  const portrait = doc.addPage([600, 800]);
  portrait.drawRectangle({ x: 0, y: 0, width: 600, height: 68, color: PDFLib.rgb(0.15, 0.25, 0.5) });
  const rotated = doc.addPage([800, 600]);
  rotated.setRotation(PDFLib.degrees(90));
  rotated.drawRectangle({ x: 732, y: 0, width: 68, height: 600, color: PDFLib.rgb(0.15, 0.25, 0.5) });
  await upload(h, 'technicalOffer', new File([await doc.save()], 'footer.pdf', { type: 'application/pdf' }));
  await h.run('startEsQuick()');
  const result = h.state().outputs.get('technicalOffer');
  const task = pdfjs.getDocument({ data: new Uint8Array(await result.file.arrayBuffer()) });
  try {
    const pdf = await task.promise;
    assert.equal(result.signatures[0], undefined);
    for (const index of [1, 2]) {
      const page = await pdf.getPage(index + 1);
      const view = page.getViewport({ scale: 1 });
      const canvas = createCanvas(view.width, view.height);
      const context = canvas.getContext('2d');
      await page.render({ canvas, canvasContext: context, viewport: view }).promise;
      const rect = result.signatures[index];
      assert.equal(rect.leftRatio + rect.widthRatio, 0.94);
      assert.ok(rect.topRatio + rect.heightRatio < 0.915);
      assert.ok(rect.topRatio + rect.heightRatio > 0.89);
      const pixel = (x, y) => [...context.getImageData(Math.floor(x * view.width), Math.floor(y * view.height), 1, 1).data].slice(0, 3);
      assert.deepEqual(pixel(rect.leftRatio + rect.widthRatio * 0.25, rect.topRatio + rect.heightRatio / 2), [255, 0, 0]);
      assert.deepEqual(pixel(0.9, 0.96), [38, 64, 128]);
      assert.equal(result.stamps[index], undefined);
    }
  } finally { await task.destroy(); }
});

test('a solid graphic at the fixed position asks for review of just the obstructed page', async t => {
  const h = quickHarness();
  t.after(() => h.run('clearElectronicSignatureSession()'));
  const doc = await PDFLib.PDFDocument.create();
  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([600, 800]);
    if (i === 1) page.drawRectangle({ x: 430, y: 0, width: 170, height: 175 });
  }
  await upload(h, 'technicalOffer', new File([await doc.save()], 'graphic.pdf', { type: 'application/pdf' }));
  await h.run('startEsQuick()');
  assert.equal(h.state().quick.phase, 'positioning');
  assert.deepEqual(Array.from(h.state().quick.pending, target => target.index), [1]);
  assert.ok(h.state().technicalOffer.pageSignatureOverlays[2]);
  assert.equal(h.downloads.length, 0);
});

test('an ambiguous contract asks which page to stamp and uses the fixed placement on the other page', async t => {
  const keys = ['esign-quick-size', 'esign-quick-offset', 'esign-quick-position-status', 'esign-quick-confirm'];
  const h = quickHarness(keys);
  t.after(() => h.run('clearElectronicSignatureSession()'));
  await upload(h, 'contract', await arabicTestFile([0, 3], 'ambiguous-contract.pdf'));
  await h.run('startEsQuick()');
  assert.equal(h.state().outputs.size, 0);
  assert.equal(h.state().quick.pending[0].chooseStampPage, true);
  h.run('selectEsStampPage({ value: "1" })');
  assert.equal(h.state().contract.stampPageIndex, 1);
  assert.equal(h.state().quick.pending[0].index, 1);
  assert.equal(h.state().contract.pageStampOverlays[0], undefined);
  assert.ok(h.state().contract.pageSignatureOverlays[0].topRatio > 0.8);
  h.run('placeEsQuickGroup(0.68, 0.7)');
  await h.run('confirmEsQuickPosition()');
  assert.deepEqual(Object.keys(h.state().outputs.get('contract').stamps).filter(i => h.state().outputs.get('contract').stamps[i]), ['1']);
});

test('manual review begins with the same placement plan and leaves the manager field in place when restoring defaults', async t => {
  const h = quickHarness();
  t.after(() => h.run('clearElectronicSignatureSession()'));
  await upload(h, 'contract', await arabicTestFile([0, 4], 'contract.pdf'));
  await h.run('nextStep()');
  assert.equal(h.state().quick, null);
  assert.equal(h.state().currentStep, 2);
  assert.equal(h.state().contract.stampPageIndex, 0);
  const expected = h.run("getOverlayState('contract', 'signature', 0)");
  assert.ok(expected.topRatio < 0.3);
  h.run("esState.activePreviewSubTab = 'contract'; resetOverlaysToDefaults(); applyPositionToAll('contract', 'signature', 1)");
  assert.equal(h.run("getOverlayState('contract', 'signature', 0)"), expected);
  assert.equal(h.downloads.length, 0);
});

test('quick mobile export offers the actual PDF files together and preserves them if activation expired', async t => {
  for (const isActive of [true, false]) {
    await t.test(isActive ? 'share available' : 'activation expired', async sub => {
      const h = quickHarness(['esign-share-status', 'esign-share-native']);
      sub.after(() => h.run('clearElectronicSignatureSession()'));
      const shared = [];
      h.elements.get('esign-share-status').isConnected = true;
      h.context.window.matchMedia = () => ({ matches: true });
      h.context.navigator = {
        userActivation: { isActive },
        canShare: ({ files }) => files.length > 0 && files.every(file => file.type === 'application/pdf'),
        share: async ({ files }) => { shared.push(...files); }
      };
      await upload(h, 'contract', await arabicTestFile([3, 4], 'contract.pdf'));
      await upload(h, 'technicalOffer', await arabicTestFile([4, 2], 'offer.pdf'));
      await h.run('startEsQuick()');
      const files = [...h.state().outputs.values()].map(result => result.file);
      assert.equal(files.length, 2);
      assert.deepEqual(shared, isActive ? files : []);
      assert.deepEqual(h.downloads, []);
      if (!isActive) assert.match(h.elements.get('esign-share-status').textContent, /فتح المشاركة/);
    });
  }
});

test('an unresolved scanned page can be positioned without re-upload, retains a group, and reuses an exact approved file only', async t => {
  const keys = ['esign-quick-size', 'esign-quick-offset', 'esign-quick-position-status', 'esign-quick-confirm', 'esign-quick-template'];
  const h = quickHarness(keys);
  t.after(() => h.run('clearElectronicSignatureSession()'));
  h.context.crypto = globalThis.crypto;
  const scan = await PDFLib.PDFDocument.create();
  const raster = createCanvas(180, 240);
  raster.getContext('2d').fillRect(12, 10, 120, 30);
  const image = await scan.embedPng(raster.toDataURL('image/png'));
  scan.addPage([300, 400]).drawImage(image, { x: 0, y: 0, width: 300, height: 400 });
  const file = new File([await scan.save()], 'scan.pdf', { type: 'application/pdf' });
  await upload(h, 'contract', file);
  await h.run('startEsQuick()');
  assert.equal(h.state().quick.phase, 'positioning');
  assert.ok(h.state().quick.pending[0].key);
  assert.equal(h.state().outputs.size, 0);
  h.run('placeEsQuickGroup(0.46, 0.58)');
  assert.equal(h.elements.get('esign-quick-confirm').disabled, false);
  h.elements.get('esign-quick-template').checked = true;
  await h.run('confirmEsQuickPosition()');
  assert.equal(h.state().contract.file, file);
  assert.equal(h.state().outputs.size, 1);
  const saved = h.state().contract.pageSignatureOverlays[0];
  h.run('clearElectronicSignatureSession()');
  h.state().signatureData = signature;
  h.state().stampData = stamp;
  await upload(h, 'contract', file);
  await h.run('startEsQuick()');
  const reused = h.state().contract.pageSignatureOverlays[0];
  assert.equal(h.state().outputs.size, 1);
  assert.equal(JSON.stringify(saved), JSON.stringify(reused));
  h.run('cancelEsQuick()');
  await upload(h, 'contract', await fixture({ name: 'scan.pdf' }));
  await h.run('startEsQuick()');
  assert.equal(h.state().quick.phase, 'positioning');
  assert.equal(h.state().outputs.size, 0);
});

test('adjusting the quick result keeps the other generated result and leaves both intact on Back', async t => {
  const keys = ['esign-quick-size', 'esign-quick-offset', 'esign-quick-position-status', 'esign-quick-confirm', 'esign-quick-template'];
  const h = quickHarness(keys);
  h.context.crypto = globalThis.crypto;
  t.after(() => h.run('clearElectronicSignatureSession()'));
  const contractFile = await arabicTestFile([0], 'contract.pdf');
  await upload(h, 'contract', contractFile);
  await upload(h, 'technicalOffer', await arabicTestFile([4, 2], 'offer.pdf'));
  await h.run('startEsQuick()');
  const offer = h.state().outputs.get('technicalOffer');
  const contract = h.state().outputs.get('contract');
  await h.run("editEsQuickResult('contract')");
  assert.equal(h.state().quick.phase, 'positioning');
  h.run('prevStep()');
  assert.equal(h.state().outputs.get('contract'), contract);
  assert.equal(h.state().outputs.get('technicalOffer'), offer);
  await h.run("editEsQuickResult('contract')");
  h.run('placeEsQuickGroup(0.42, 0.53)');
  assert.equal(h.elements.get('esign-quick-confirm').disabled, false);
  h.elements.get('esign-quick-template').checked = true;
  await h.run('confirmEsQuickPosition()');
  assert.notEqual(h.state().outputs.get('contract'), contract);
  assert.equal(h.state().outputs.get('technicalOffer'), offer);
  const adjusted = h.state().contract.pageSignatureOverlays[0];
  h.run('cancelEsQuick()');
  await upload(h, 'contract', contractFile);
  await h.run('startEsQuick()');
  assert.notEqual(JSON.stringify(h.state().contract.pageSignatureOverlays[0]), JSON.stringify(adjusted),
    'A confidently identified director field takes precedence over a saved adjustment');
});

test('quick review selects any signed page without offering the cover or adding a stamp to other pages', async t => {
  const keys = ['esign-output-contract', 'esign-output-technicalOffer', 'esign-quick-size',
    'esign-quick-offset', 'esign-quick-position-status', 'esign-quick-confirm', 'esign-quick-template'];
  const h = quickHarness(keys);
  t.after(() => h.run('clearElectronicSignatureSession()'));
  await upload(h, 'contract', await arabicTestFile([4, 3], 'contract.pdf'));
  await upload(h, 'technicalOffer', await arabicTestFile([4, 0, 2], 'offer.pdf'));
  await h.run('startEsQuick()');

  const contract = h.state().contract;
  const lastSignature = contract.pageSignatureOverlays[1];
  const lastStamp = contract.pageStampOverlays[1];
  const result = h.elements.get('esign-output-contract');
  const picker = result.children[0].children[1];
  const offerPicker = h.elements.get('esign-output-technicalOffer').children[0].children[1];
  assert.deepEqual(picker.children.map(option => option.value), ['0', '1']);
  assert.deepEqual(offerPicker.children.map(option => option.value), ['1', '2']);
  assert.equal(picker.value, '1');
  picker.value = '0';
  picker.onchange();
  await h.run("editEsQuickResult('contract')");
  assert.equal(h.state().quick.pending[0].index, 0);
  assert.equal(h.state().quick.pending[0].stamp, false);
  h.run('placeEsQuickGroup(0.65, 0.90)');
  assert.equal(h.elements.get('esign-quick-confirm').disabled, false);
  await h.run('confirmEsQuickPosition()');
  assert.equal(h.state().quick.phase, 'results');
  assert.equal(contract.pageStampOverlays[0], undefined);
  assert.equal(contract.pageSignatureOverlays[1], lastSignature);
  assert.equal(contract.pageStampOverlays[1], lastStamp);
  assert.equal(h.state().outputs.get('contract').signatures[0], contract.pageSignatureOverlays[0]);
});

test('moving a quick signing group preserves its adjusted size, stamp offset and page bounds', async t => {
  const keys = ['esign-quick-size', 'esign-quick-offset', 'esign-quick-position-status', 'esign-quick-confirm'];
  const h = quickHarness(keys);
  t.after(() => h.run('clearElectronicSignatureSession()'));
  await upload(h, 'contract', await fixture());
  await h.run('startEsQuick()');
  h.run('placeEsQuickGroup(0.5, 0.5)');
  h.elements.get('esign-quick-size').value = '80';
  h.elements.get('esign-quick-offset').value = '32';
  h.run('updateEsQuickGroup()');
  const before = h.state().quick.current.group;
  h.run('placeEsQuickGroup(0.99, 0.99)');
  const after = h.state().quick.current.group;
  assert.notEqual(after.signature.leftRatio, before.signature.leftRatio);
  assert.equal(after.signature.widthRatio, before.signature.widthRatio);
  assert.equal(after.stamp.widthRatio, before.stamp.widthRatio);
  const offset = group => group.stamp.leftRatio - group.signature.leftRatio;
  assert.ok(Math.abs(offset(after) - offset(before)) < 0.000001);
  assert.equal(h.run('esGroupIsClear(esState.quick.pending[0].page, esState.quick.current.group)'), true);
});

test('failed quick adjustment leaves both downloads and the previous template intact until a replacement succeeds', async t => {
  const keys = ['esign-quick-size', 'esign-quick-offset', 'esign-quick-position-status', 'esign-quick-confirm', 'esign-quick-template'];
  const h = quickHarness(keys);
  h.context.crypto = globalThis.crypto;
  t.after(() => h.run('clearElectronicSignatureSession()'));
  await upload(h, 'contract', await arabicTestFile([0], 'contract.pdf'));
  await upload(h, 'technicalOffer', await arabicTestFile([4, 2], 'offer.pdf'));
  await h.run('startEsQuick()');
  const contract = h.state().outputs.get('contract');
  const offer = h.state().outputs.get('technicalOffer');
  h.run('const generateFixture = generateFinalPdfBytes; generateFinalPdfBytes = async () => { throw new Error("fixture failure"); }');

  const adjust = async () => {
    await h.run("editEsQuickResult('contract')");
    h.run('placeEsQuickGroup(0.42, 0.53)');
    assert.equal(h.elements.get('esign-quick-confirm').disabled, false);
    h.elements.get('esign-quick-template').checked = true;
    await h.run('confirmEsQuickPosition()');
  };
  await adjust();
  assert.equal(h.state().outputs.get('contract'), contract);
  assert.equal(h.state().outputs.get('technicalOffer'), offer);
  assert.ok(await fetch(contract.url).then(response => response.ok));
  assert.equal(h.state().contract.pageSignatureOverlays[0], contract.signatures[0]);
  assert.equal(h.context.localStorage.items.size, 0);
  assert.match(h.notices.at(-1).message, /النسخة السابقة جاهزة/);

  h.run('generateFinalPdfBytes = generateFixture');
  await adjust();
  assert.notEqual(h.state().outputs.get('contract'), contract);
  assert.equal(h.state().outputs.get('technicalOffer'), offer);
  assert.equal(h.context.localStorage.items.size, 1);
  await assert.rejects(fetch(contract.url));
});

test('PNG and JPEG are decoded locally and turn into a one-page PDF with visible content; DOCX explains the PDF path', async t => {
  const h = quickHarness();
  t.after(() => h.run('clearElectronicSignatureSession()'));
  h.context.createImageBitmap = async (file, options) => {
    assert.equal(options.imageOrientation, 'from-image');
    const bitmap = await loadImage(Buffer.from(await file.arrayBuffer()));
    bitmap.close = () => {};
    return bitmap;
  };
  for (const format of ['png', 'jpeg']) {
    const image = createCanvas(20, 30);
    const ctx = image.getContext('2d');
    ctx.fillStyle = '#008800';
    ctx.fillRect(0, 0, 20, 30);
    const file = new File([image.toBuffer('image/' + format)], 'fixture.' + format, { type: 'image/' + format });
    await upload(h, 'contract', file);
    assert.equal(h.state().contract.processingStatus, 'ready');
    const parsed = await PDFLib.PDFDocument.load(h.state().contract.convertedPdf);
    assert.equal(parsed.getPageCount(), 1);
    assert.deepEqual(parsed.getPage(0).getSize(), { width: 20, height: 30 });
    const pdf = h.state().contract.pdfDocument;
    const page = await pdf.getPage(1);
    const rendered = createCanvas(20, 30);
    const renderer = rendered.getContext('2d');
    await page.render({ canvasContext: renderer, viewport: page.getViewport({ scale: 1 }) }).promise;
    const [red, green, blue] = renderer.getImageData(10, 15, 1, 1).data;
    assert.ok(red < 10 && green >= 130 && green <= 141 && blue < 10);
    await upload(h, 'technicalOffer', file);
    assert.match(h.notices.at(-1).message, /PDF متعدد الصفحات/);
  }
  await upload(h, 'technicalOffer', new File(['fixture'], 'fixture.docx'));
  assert.match(h.notices.at(-1).message, /Word إلى PDF/);
});

test('sharing hands off one or two actual PDFs and leaves them available after cancellation, failure and unsupported sharing', async () => {
  const h = quickHarness();
  const files = [new File(['%PDF-test'], 'contract.pdf', { type: 'application/pdf' }),
    new File(['%PDF-test'], 'offer.pdf', { type: 'application/pdf' })];
  const calls = [];
  h.context.files = files;
  h.context.sharing = {
    canShare: data => data.files.every(file => file.type === 'application/pdf'),
    share: async data => calls.push(data.files)
  };
  assert.equal(await h.run('esSharePdfFiles(sharing, files.slice(0, 1))'), 'opened');
  assert.equal(await h.run('esSharePdfFiles(sharing, files)'), 'opened');
  assert.deepEqual(calls.map(batch => [...batch]), [[files[0]], files]);
  h.context.sharing.share = async () => { throw new DOMException('cancelled', 'AbortError'); };
  assert.equal(await h.run('esSharePdfFiles(sharing, files)'), 'cancelled');
  h.context.sharing.share = async () => { throw new Error('fixture share error'); };
  assert.equal(await h.run('esSharePdfFiles(sharing, files)'), 'failed');
  h.context.sharing.canShare = () => false;
  assert.equal(await h.run('esSharePdfFiles(sharing, files)'), 'unsupported');
  assert.equal(files.length, 2);
  assert.equal(await files[1].text(), '%PDF-test');
});
