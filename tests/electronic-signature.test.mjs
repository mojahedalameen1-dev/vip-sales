import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const source = await readFile(new URL('../assets/js/electronic-signature.js', import.meta.url), 'utf8');
const libSource = await readFile(new URL('../assets/js/vendor/pdf-lib.min.js', import.meta.url), 'utf8');
const lib = { exports: {} };
new Function('module', 'exports', libSource)(lib, lib.exports);
const PDFLib = lib.exports;

function createElement() {
  return {
    children: [], style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, removeAttribute() {}, focus() {}, addEventListener() {},
    append(...children) { this.children.push(...children); },
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
    PDFLib, pdfjsLib: pdfjs, URL, Blob, Uint8Array, ArrayBuffer, confirm: () => true,
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
  const bytes = await h.run("generateFinalPdfBytes('contract', esState.contract, esState.signatureData, esState.stampData)");
  await assertVisualPositions(bytes, [[sigPosition], [sigPosition], [sigPosition], [sigPosition, stampPosition]]);
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
  h.run('nextStep()');
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
