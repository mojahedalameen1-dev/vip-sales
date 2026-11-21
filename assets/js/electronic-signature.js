/*
 * Electronic signature images, PDF preview and local export.
 * Built for CRM - RTL Arabic, Light/Dark theme compatible.
 */

// SECTION 1: Module State & Constants
const ES_PATHS = {
  settings: 'electronicSignature/settings/company',
  logs: 'electronicSignature/logs'
};

function createEsDocument() {
  return {
    file: null,
    loadingTask: null,
    pdfDocument: null,
    pageCount: 0,
    viewports: [],
    renderedPages: [],
    signatureOverlay: { leftRatio: 0, topRatio: 0, widthRatio: 0, heightRatio: 0 },
    stampOverlay: { leftRatio: 0, topRatio: 0, widthRatio: 0, heightRatio: 0 },
    pageSignatureOverlays: [],
    pageStampOverlays: [],
    processingStatus: 'empty',
    errorMessage: ''
  };
}

function createEsState() {
  return {
    signatureData: null,
    stampData: null,
    currentTab: 'sign',
    currentStep: 1,
    zoomLevel: 1,
    isProcessing: false,
    isInitialized: false,
    activePreviewSubTab: 'technical',
    reviewedFiles: { technicalOffer: false, contract: false },
    wizardStep: 1,
    technicalOffer: createEsDocument(),
    contract: createEsDocument(),
    outputs: new Map(),
    quick: null,
    settingsStatus: 'idle'
  };
}

let esState = createEsState();
let esIntersectionObserver = null;
const ES_DOCUMENT_TYPES = ['contract', 'technicalOffer'];

function releaseEsDocument(state) {
  if (state.loadingTask) void state.loadingTask.destroy().catch(error => console.warn(error));
}

function clearEsOutputs() {
  for (const output of esState.outputs.values()) URL.revokeObjectURL(output.url);
  esState.outputs.clear();
}

function clearElectronicSignatureSession() {
  esIntersectionObserver?.disconnect();
  esIntersectionObserver = null;
  for (const type of ES_DOCUMENT_TYPES) releaseEsDocument(esState[type]);
  clearEsOutputs();
  esState = createEsState();
  esLogsCache = [];
  document.getElementById('esignView')?.replaceChildren();
}

// SECTION 2: Init & DOM Building
function initElectronicSignature() {
  if (esState.isInitialized) return;

  const esignView = document.getElementById('esignView');
  if (!esignView) return;

  esignView.innerHTML = `
    <div class="esign-section">
      <div class="esign-header-container">
        <div class="esign-title-area">
          <h1>التوقيع الإلكتروني للمستندات</h1>
          <p>أضف توقيع المدير وختم الشركة على عروض الأسعار والعقود مباشرة وبشكل آمن</p>
        </div>
        <div class="esign-status-badges">
          <div id="sig-status-badge" class="esign-badge inactive">
            <i data-lucide="pen-tool"></i>
            <span>توقيع المدير: غير متوفر</span>
          </div>
          <div id="stamp-status-badge" class="esign-badge inactive">
            <i data-lucide="award"></i>
            <span>ختم الشركة: غير متوفر</span>
          </div>
        </div>
      </div>
      
      <div class="esign-tabs">
        <button class="esign-tab-btn active" id="tab-btn-sign" onclick="switchEsTab('sign')">
          <i data-lucide="file-signature"></i>
          <span>توقيع مستند</span>
        </button>
        <button class="esign-tab-btn" id="tab-btn-settings" onclick="switchEsTab('settings')">
          <i data-lucide="settings"></i>
          <span>إعدادات التوقيع والختم</span>
        </button>
        <button class="esign-tab-btn" id="tab-btn-logs" onclick="switchEsTab('logs')">
          <i data-lucide="history"></i>
          <span>سجل العمليات</span>
        </button>
      </div>

      <!-- Tab: Sign Document -->
      <div id="panel-sign" class="esign-tab-panel active">
        <div class="step-wizard">
          <div class="step-wizard-header">
            <div class="step-indicator-list">
              <div class="step-item active" id="step-i-1">
                <div class="step-num">1</div>
                <div class="step-label">رفع الملفات</div>
              </div>
              <div class="step-item" id="step-i-2">
                <div class="step-num">2</div>
                <div class="step-label">المعاينة والمواضع</div>
              </div>
              <div class="step-item" id="step-i-3">
                <div class="step-num">3</div>
                <div class="step-label">توقيع وتحميل</div>
              </div>
            </div>
          </div>

          <div class="step-content-container" id="step-content">
            <!-- Dynamic steps -->
          </div>

          <div class="step-actions-container">
            <button class="btn-es btn-es-secondary" id="btn-prev-step" onclick="prevStep()" style="visibility: hidden;">
              <i data-lucide="arrow-right"></i>
              <span>السابق</span>
            </button>
            <div style="display: flex; gap: 0.5rem;">
              <button class="btn-es btn-es-danger" id="btn-reset-esign" onclick="resetEsignFlow()" style="display: none;">
                <i data-lucide="trash-2"></i>
                <span>إزالة الملفات والبدء من جديد</span>
              </button>
              <button class="btn-es btn-es-primary" id="btn-next-step" onclick="nextStep()" disabled>
                <span>التالي</span>
                <i data-lucide="arrow-left"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab: Settings -->
      <div id="panel-settings" class="esign-tab-panel">
        <div class="settings-grid">
          <!-- Signature Upload Card -->
          <div class="asset-card">
            <h3>
              <i data-lucide="pen-tool" style="color: var(--accent-blue);"></i>
              <span>توقيع المدير</span>
            </h3>
            <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0;">يجب رفع التوقيع كصورة شفافة بصيغة PNG مفرغة لتظهر بشكل صحيح فوق نصوص الـ PDF.</p>
            
            <div class="upload-zone" id="upload-zone-signature" onclick="document.getElementById('file-input-signature').click()">
              <i data-lucide="upload-cloud" style="width: 32px; height: 32px;"></i>
              <p>اسحب صورة التوقيع هنا أو انقر للاختيار</p>
              <span>الصيغة المدعومة: PNG فقط (الحد الأقصى 5MB)</span>
              <input type="file" id="file-input-signature" accept="image/png" style="display:none" onchange="handleAssetUpload(this, 'signature')">
            </div>
            
            <div class="asset-preview-container" id="preview-container-signature" style="display:none;">
              <img id="preview-img-signature" class="asset-preview-img" src="" alt="توقيع المدير">
            </div>
            
            <div class="asset-meta-info" id="meta-signature" style="display:none;">
              <div class="asset-meta-row">
                <span>اسم الملف:</span>
                <span id="meta-name-signature" style="direction: ltr; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">-</span>
              </div>
              <div class="asset-meta-row">
                <span>الأبعاد الأصلية:</span>
                <span id="meta-dim-signature">-</span>
              </div>
              <div class="asset-meta-row">
                <span>تاريخ التحديث:</span>
                <span id="meta-date-signature">-</span>
              </div>
              <div class="asset-meta-row">
                <span>بواسطة:</span>
                <span id="meta-user-signature">-</span>
              </div>
            </div>
            
            <div class="asset-actions" id="actions-signature" style="display:none;">
              <button class="btn-es btn-es-danger" onclick="deleteSignatureAsset('signature')">
                <i data-lucide="trash-2"></i>
                <span>حذف التوقيع</span>
              </button>
            </div>
          </div>

          <!-- Stamp Upload Card -->
          <div class="asset-card">
            <h3>
              <i data-lucide="award" style="color: var(--accent-teal);"></i>
              <span>ختم الشركة</span>
            </h3>
            <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0;">يجب رفع الختم الرسمي للشركة كصورة شفافة بصيغة PNG مفرغة.</p>
            
            <div class="upload-zone" id="upload-zone-stamp" onclick="document.getElementById('file-input-stamp').click()">
              <i data-lucide="upload-cloud" style="width: 32px; height: 32px;"></i>
              <p>اسحب صورة الختم هنا أو انقر للاختيار</p>
              <span>الصيغة المدعومة: PNG فقط (الحد الأقصى 5MB)</span>
              <input type="file" id="file-input-stamp" accept="image/png" style="display:none" onchange="handleAssetUpload(this, 'stamp')">
            </div>
            
            <div class="asset-preview-container" id="preview-container-stamp" style="display:none;">
              <img id="preview-img-stamp" class="asset-preview-img" src="" alt="ختم الشركة">
            </div>
            
            <div class="asset-meta-info" id="meta-stamp" style="display:none;">
              <div class="asset-meta-row">
                <span>اسم الملف:</span>
                <span id="meta-name-stamp" style="direction: ltr; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">-</span>
              </div>
              <div class="asset-meta-row">
                <span>الأبعاد الأصلية:</span>
                <span id="meta-dim-stamp">-</span>
              </div>
              <div class="asset-meta-row">
                <span>تاريخ التحديث:</span>
                <span id="meta-date-stamp">-</span>
              </div>
              <div class="asset-meta-row">
                <span>بواسطة:</span>
                <span id="meta-user-stamp">-</span>
              </div>
            </div>
            
            <div class="asset-actions" id="actions-stamp" style="display:none;">
              <button class="btn-es btn-es-danger" onclick="deleteSignatureAsset('stamp')">
                <i data-lucide="trash-2"></i>
                <span>حذف الختم</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab: Logs -->
      <div id="panel-logs" class="esign-tab-panel">
        <div class="esign-logs-toolbar">
          <div class="esign-filter-tabs">
            <button class="esign-filter-btn active" onclick="filterEsLogs('all', this)">الكل</button>
            <button class="esign-filter-btn" onclick="filterEsLogs('technical_offer', this)">عروض فنية</button>
            <button class="esign-filter-btn" onclick="filterEsLogs('contract', this)">عقود</button>
          </div>
          <button class="btn-es btn-es-secondary" onclick="loadSignatureLogs()">
            <i data-lucide="refresh-cw"></i>
            <span>تحديث السجل</span>
          </button>
        </div>
        <div class="table-responsive" tabindex="0" role="region" aria-label="جدول سجل عمليات التوقيع">
          <table class="esign-logs-table">
            <thead>
              <tr>
                <th>التاريخ والوقت</th>
                <th>المستخدم</th>
                <th>نوع المستند</th>
                <th>اسم الملف الأصلي</th>
                <th>صفحات الأصل</th>
                <th>الختم؟</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody id="esign-logs-tbody">
              <!-- Logs injected here -->
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  setupDragAndDropZones();
  loadSignatureSettings();

  esState.isInitialized = true;
  goToStep(1);
}

function switchEsTab(tabName) {
  esState.currentTab = tabName;
  document.querySelectorAll('.esign-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.esign-tab-panel').forEach(panel => panel.classList.remove('active'));

  const activeBtn = document.getElementById(`tab-btn-${tabName}`);
  const activePanel = document.getElementById(`panel-${tabName}`);

  if (activeBtn) activeBtn.classList.add('active');
  if (activePanel) activePanel.classList.add('active');

  if (tabName === 'logs') {
    loadSignatureLogs();
  } else if (tabName === 'settings' && esState.settingsStatus === 'error') {
    loadSignatureSettings();
  } else if (tabName === 'sign' && esState.currentStep === 2) {
    layoutEsPreview();
  }
}

// SECTION 3: Settings Tab
function loadSignatureSettings() {
  if (typeof db === 'undefined' || esState.settingsStatus === 'loading') return;
  const session = esState;
  session.settingsStatus = 'loading';
  checkStepValidity();

  db.ref(ES_PATHS.settings).once('value')
    .then(snapshot => {
      if (esState !== session) return;
      const data = snapshot.val() || {};
      session.settingsStatus = 'ready';
      applyEsAsset('signature', data.signature || null);
      applyEsAsset('stamp', data.stamp || null);
    })
    .catch(error => {
      if (esState !== session) return;
      session.settingsStatus = 'error';
      checkStepValidity();
      console.warn('Could not load signature settings:', error);
      showToast('تعذر تحميل صور التوقيع والختم. تحقق من الاتصال أو صلاحيتك في القسم.', 'error');
    });
}

function applyEsAsset(type, data) {
  const key = type === 'signature' ? 'signatureData' : 'stampData';
  const changed = esState[key]?.dataUrl !== data?.dataUrl;
  if (changed && esState.quick && !esState.isProcessing) cancelEsQuick();
  esState[key] = data;
  if (data) updateAssetUI(type, data);
  else clearAssetUI(type);

  for (const docType of getEsReviewDocuments()) {
    if (type === 'stamp' && docType !== 'contract') continue;
    initializeDefaultOverlayRatios(docType);
    redrawAllPageOverlays(docType, type);
    if (changed) esState.reviewedFiles[docType] = false;
  }
  if (changed && esState.currentStep === 3 && !esState.isProcessing) {
    esState.wizardStep = 1;
    goToStep(2);
  }
  updateGlobalStatusBadges();
}

function setupEsUploadZone(zoneId, handleFiles) {
  const zone = document.getElementById(zoneId);
  if (!zone) return;
  zone.addEventListener('dragover', event => {
    event.preventDefault();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', event => {
    event.preventDefault();
    zone.classList.remove('dragover');
    if (event.dataTransfer.files.length) handleFiles(event.dataTransfer.files);
  });
}

function setupDragAndDropZones() {
  for (const type of ['signature', 'stamp']) {
    setupEsUploadZone('upload-zone-' + type, files => handleAssetUpload({ files }, type));
  }
}

function handleAssetUpload(input, type) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  const session = esState;

  if (file.type !== 'image/png') {
    showToast('يجب اختيار ملف صورة بصيغة PNG فقط!', 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('اختر صورة بحجم 5 ميغابايت أو أقل.', 'error');
    return;
  }

  showToast('جاري حفظ الصورة وصيغة الأبعاد المفرغة...', 'info');

  compressPngImage(file)
    .then((res) => {
      if (esState !== session) return;
      const user = getCurrentUserInfo();
      const assetData = {
        dataUrl: res.dataUrl,
        originalFileName: file.name,
        width: res.width,
        height: res.height,
        updatedAt: Date.now(),
        updatedBy: user.userName,
        updatedByEmail: user.userEmail
      };

      return db.ref(`${ES_PATHS.settings}/${type}`).set(assetData).then(() => {
        if (esState !== session) return;
        applyEsAsset(type, assetData);
        showToast('تم حفظ الصورة وتحديثها محلياً بنجاح.', 'success');
      });
    })
    .catch((err) => {
      if (esState !== session) return;
      console.error(err);
      showToast('خطأ أثناء معالجة وحفظ الصورة', 'error');
    });
}

function compressPngImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function (e) {
      const img = new Image();
      img.onload = function () {
        try {
          const scale = Math.min(1, 800 / Math.max(img.width, img.height));
          const width = Math.max(1, Math.round(img.width * scale));
          const height = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve({ dataUrl: canvas.toDataURL('image/png'), width, height });
        } catch (error) {
          reject(error);
        }
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function deleteSignatureAsset(type) {
  const session = esState;
  if (!confirm(`هل أنت متأكد من حذف ${type === 'signature' ? 'توقيع المدير' : 'ختم الشركة'}؟`)) return;

  db.ref(`${ES_PATHS.settings}/${type}`).set(null)
    .then(() => {
      if (esState !== session) return;
      applyEsAsset(type, null);
      showToast('تم حذف الملف بنجاح.', 'success');
    })
    .catch((err) => {
      if (esState !== session) return;
      console.error(err);
      showToast('فشل حذف الملف', 'error');
    });
}

function updateAssetUI(type, data) {
  const uploadZone = document.getElementById(`upload-zone-${type}`);
  const previewContainer = document.getElementById(`preview-container-${type}`);
  const previewImg = document.getElementById(`preview-img-${type}`);
  const metaContainer = document.getElementById(`meta-${type}`);
  const actionsContainer = document.getElementById(`actions-${type}`);

  if (uploadZone) uploadZone.style.display = 'none';
  if (previewContainer) previewContainer.style.display = 'flex';
  if (previewImg) previewImg.src = data.dataUrl;

  if (metaContainer) {
    metaContainer.style.display = 'flex';
    metaContainer.querySelector(`#meta-name-${type}`).textContent = data.originalFileName || '';
    metaContainer.querySelector(`#meta-dim-${type}`).textContent = `${data.width} × ${data.height} بكسل`;
    metaContainer.querySelector(`#meta-date-${type}`).textContent = formatArabicDate(data.updatedAt);
    metaContainer.querySelector(`#meta-user-${type}`).textContent = data.updatedBy || '';
  }

  if (actionsContainer) actionsContainer.style.display = 'flex';
}

function clearAssetUI(type) {
  const uploadZone = document.getElementById(`upload-zone-${type}`);
  const previewContainer = document.getElementById(`preview-container-${type}`);
  const previewImg = document.getElementById(`preview-img-${type}`);
  const metaContainer = document.getElementById(`meta-${type}`);
  const actionsContainer = document.getElementById(`actions-${type}`);

  if (uploadZone) uploadZone.style.display = 'flex';
  if (previewContainer) previewContainer.style.display = 'none';
  if (previewImg) previewImg.src = '';
  if (metaContainer) metaContainer.style.display = 'none';
  if (actionsContainer) actionsContainer.style.display = 'none';
}

function updateGlobalStatusBadges() {
  const sigBadge = document.getElementById('sig-status-badge');
  const stampBadge = document.getElementById('stamp-status-badge');

  if (sigBadge) {
    if (esState.signatureData) {
      sigBadge.className = 'esign-badge active';
      sigBadge.querySelector('span').textContent = 'توقيع المدير: جاهز';
    } else {
      sigBadge.className = 'esign-badge inactive';
      sigBadge.querySelector('span').textContent = 'توقيع المدير: غير متوفر';
    }
  }

  if (stampBadge) {
    if (esState.stampData) {
      stampBadge.className = 'esign-badge active';
      stampBadge.querySelector('span').textContent = 'ختم الشركة: جاهز';
    } else {
      stampBadge.className = 'esign-badge inactive';
      stampBadge.querySelector('span').textContent = 'ختم الشركة: غير متوفر';
    }
  }

  checkStepValidity();
}

// SECTION 4: Sign Document Tab — Step Machine
function goToStep(step, { preserveOutputs = false } = {}) {
  if (step !== esState.currentStep && !preserveOutputs) clearEsOutputs();
  if (step !== 2) {
    esIntersectionObserver?.disconnect();
    esIntersectionObserver = null;
  }
  esState.currentStep = step;

  for (let i = 1; i <= 3; i++) {
    const item = document.getElementById('step-i-' + i);
    if (!item) continue;
    item.classList.toggle('active', i === step);
    item.classList.toggle('completed', i < step);
    if (i === step) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  }

  const prev = document.getElementById('btn-prev-step');
  if (prev) prev.style.visibility = step > 1 ? 'visible' : 'hidden';
  const reset = document.getElementById('btn-reset-esign');
  if (reset) reset.style.display = step > 1 ? 'flex' : 'none';
  const next = document.getElementById('btn-next-step');
  if (next) {
    next.hidden = step === 3;
    next.querySelector('span').textContent = 'التالي';
  }

  const content = document.getElementById('step-content');
  if (!content) return;
  if (step === 1) renderStep1(content);
  else if (step === 2) renderStep2(content);
  else renderStep3(content);

  checkStepValidity();
  content.querySelector('h3')?.focus({ preventScroll: true });
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function nextStep() {
  if (esState.quick) return;
  if (!canAdvanceEsStep()) return;
  if (esState.currentStep === 1) {
    esState.wizardStep = 1;
    esState.reviewedFiles = { technicalOffer: false, contract: false };
    goToStep(2);
  } else if (esState.currentStep === 2) {
    const docs = getEsReviewDocuments();
    esState.reviewedFiles[docs[esState.wizardStep - 1]] = true;
    if (esState.wizardStep < docs.length) {
      goToWizardSubStep(esState.wizardStep + 1);
    } else {
      goToStep(3);
    }
  }
}

function prevStep() {
  if (esState.isProcessing) return;
  if (esState.quick?.editing) {
    const { type, index, group } = esState.quick.editing;
    applyEsQuickGroup(esState[type], index, group);
    esState.quick.editing = null;
    esState.quick.pending = [];
    esState.quick.current = null;
    esState.quick.phase = 'results';
    goToStep(3, { preserveOutputs: true });
    return;
  }
  if (esState.quick) {
    cancelEsQuick();
    return;
  }
  if (esState.currentStep === 3) {
    esState.wizardStep = getEsReviewDocuments().length;
    goToStep(2);
  } else if (esState.currentStep === 2) {
    if (esState.wizardStep > 1) goToWizardSubStep(esState.wizardStep - 1);
    else goToStep(1);
  }
}

function resetEsignFlow() {
  if (esState.isProcessing || !confirm('هل تريد إلغاء الملفات الحالية والبدء من جديد؟')) return;
  esState.quick = null;
  for (const type of ES_DOCUMENT_TYPES) {
    releaseEsDocument(esState[type]);
    esState[type] = createEsDocument();
    esState.reviewedFiles[type] = false;
  }
  esState.wizardStep = 1;
  esState.zoomLevel = 1;
  goToStep(1);
}

function getEsReviewDocuments() {
  return ES_DOCUMENT_TYPES.filter(type => {
    const state = esState[type];
    return state.processingStatus === 'ready' && state.pageCount >= (type === 'contract' ? 1 : 2);
  });
}

function canAdvanceEsStep() {
  const docs = getEsReviewDocuments();
  if (!docs.length || ES_DOCUMENT_TYPES.some(type => esState[type].file && esState[type].processingStatus !== 'ready')) return false;
  if (esState.currentStep === 1) return true;
  if (!esState.signatureData || (docs.includes('contract') && !esState.stampData)) return false;
  if (esState.currentStep === 2) {
    const active = esState[docs[esState.wizardStep - 1]];
    return Boolean(active?.renderedPages.some(page => page.isRendered));
  }
  return true;
}

function checkStepValidity() {
  const nextBtn = document.getElementById('btn-next-step');
  if (nextBtn) {
    nextBtn.hidden = esState.currentStep === 3 || esState.quick?.phase === 'positioning';
    nextBtn.disabled = Boolean(esState.quick) || !canAdvanceEsStep();
  }
  const quickButton = document.getElementById('btn-es-quick');
  if (quickButton) quickButton.disabled = Boolean(esState.quick) || !esQuickDocuments().length;
  const processBtn = document.getElementById('btn-process-pdf');
  if (processBtn) processBtn.disabled = esState.isProcessing || !canExportEsDocuments();
  const finalReview = document.getElementById('wizard-step-final');
  if (finalReview) finalReview.disabled = !canExportEsDocuments();
  const assetNotice = document.getElementById('esign-asset-notice');
  if (assetNotice) {
    assetNotice.hidden = Boolean(esState.signatureData && (!getEsReviewDocuments().includes('contract') || esState.stampData));
    assetNotice.querySelector('p').textContent = esState.settingsStatus === 'loading'
      ? 'جارٍ تحميل إعدادات التوقيع والختم…'
      : 'يلزم توفر صورة التوقيع، وختم الشركة عند معالجة عقد.';
  }
}

function canExportEsDocuments() {
  if (esState.quick?.phase === 'results') {
    return esState.quick.docs.every(type => esState.reviewedFiles[type] && esState[type].processingStatus === 'ready') &&
      Boolean(esState.signatureData && (!esState.quick.docs.includes('contract') || esState.stampData));
  }
  return canAdvanceEsStep() && getEsReviewDocuments().every(type => esState.reviewedFiles[type]);
}

// STEP 1: Dual Upload zone
function renderStep1(container) {
  container.innerHTML = `
    <div style="text-align: center; margin-bottom: 1.5rem;">
      <h3 tabindex="-1" style="margin: 0; font-size: 1.25rem;">ارفع المستندات المطلوب توقيعها</h3>
      <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); font-size: 0.9rem;">يمكنك رفع العرض الفني فقط، أو العقد فقط، أو الملفين معاً.</p>
    </div>
    <div class="esign-quick-bar">
      <button id="btn-es-quick" type="button" class="btn-es btn-es-primary" onclick="startEsQuick()" disabled>
        <i data-lucide="zap"></i><span>توقيع ومشاركة سريعة</span>
      </button>
      <span id="esign-quick-progress" role="status">استخدم «التالي» للمراجعة اليدوية.</span>
    </div>
    
    <div class="upload-grid-container">
      <div class="document-file-card" id="card-upload-contract">
        <h4 style="margin: 0; display: flex; align-items: center; gap: 0.5rem;">
          <i data-lucide="file-check-2" style="color: var(--accent-teal);"></i>
          <span>العقد الرسمي (Contract)</span>
        </h4>
        <p style="margin: 0; font-size: 0.8rem; color: var(--text-muted);">* يتم توقيع كافة الصفحات، مع وضع الختم الرسمي على الصفحة الأخيرة فقط.</p>
        
        <button type="button" class="upload-zone" id="zone-contract" aria-label="اختر ملف العقد" onclick="document.getElementById('input-contract').click()">
          <i data-lucide="file-up" style="width: 32px; height: 32px;"></i>
          <span class="upload-instruction">
            <span class="desktop-only-inline">اسحب ملف العقد هنا أو انقر للاختيار</span>
            <span class="mobile-only-inline">اضغط هنا لاختيار ملف العقد</span>
          </span>
          <span>PDF أو صور PNG وJPG</span>
        </button>
        <input type="file" id="input-contract" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" hidden onchange="handleDocumentUpload(this, 'contract')">
        
        <div id="details-contract" hidden class="esign-upload-details">
          <div class="esign-upload-file">
            <bdi id="name-contract"></bdi>
            <div>
              <button type="button" class="btn-es btn-es-secondary" onclick="document.getElementById('input-contract').click()">استبدال</button>
              <button type="button" class="btn-es btn-es-danger" onclick="clearUploadedDocument('contract')">حذف</button>
            </div>
          </div>
          <div id="status-contract" class="esign-upload-status" role="status"></div>
        </div>
      </div>

      <div class="document-file-card" id="card-upload-technical">
        <h4 style="margin: 0; display: flex; align-items: center; gap: 0.5rem;">
          <i data-lucide="file-text" style="color: var(--accent-blue);"></i>
          <span>العرض الفني (Technical Offer)</span>
        </h4>
        <p style="margin: 0; font-size: 0.8rem; color: var(--text-muted);">* سيتم تجاهل الصفحة الأولى تلقائياً، والتوقيع يبدأ من الصفحة الثانية لنهاية الملف.</p>
        
        <button type="button" class="upload-zone" id="zone-technical" aria-label="اختر ملف العرض الفني" onclick="document.getElementById('input-technical').click()">
          <i data-lucide="file-up" style="width: 32px; height: 32px;"></i>
          <span class="upload-instruction">
            <span class="desktop-only-inline">اسحب ملف العرض الفني هنا أو انقر للاختيار</span>
            <span class="mobile-only-inline">اضغط هنا لاختيار العرض الفني</span>
          </span>
          <span>PDF متعدد الصفحات</span>
        </button>
        <input type="file" id="input-technical" accept=".pdf,application/pdf" hidden onchange="handleDocumentUpload(this, 'technicalOffer')">
        
        <div id="details-technical" hidden class="esign-upload-details">
          <div class="esign-upload-file">
            <bdi id="name-technical"></bdi>
            <div>
              <button type="button" class="btn-es btn-es-secondary" onclick="document.getElementById('input-technical').click()">استبدال</button>
              <button type="button" class="btn-es btn-es-danger" onclick="clearUploadedDocument('technicalOffer')">حذف</button>
            </div>
          </div>
          <div id="status-technical" class="esign-upload-status" role="status"></div>
        </div>
      </div>
    </div>

    <!-- Mobile Only Reset Button -->
    <div class="mobile-only-reset-container" style="text-align: center; margin-top: 1.5rem; display: none;">
      <button class="btn-es btn-es-danger" style="background: none; border: none; padding: 0; box-shadow: none; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 4px;" onclick="resetEsignFlow()">
        <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
        <span>إزالة الملفات والبدء من جديد</span>
      </button>
    </div>
  `;

  for (const type of ES_DOCUMENT_TYPES) showUploadedDetails(type);
  setupEsUploadZone('zone-contract', files => handleDocumentUpload({ files }, 'contract'));
  setupEsUploadZone('zone-technical', files => handleDocumentUpload({ files }, 'technicalOffer'));
}

async function handleDocumentUpload(input, type) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  if (esState.quick?.phase === 'analyzing') return;

  const imageType = /\.png$/i.test(file.name) || file.type === 'image/png' ? 'png'
    : /\.jpe?g$/i.test(file.name) || file.type === 'image/jpeg' ? 'jpeg' : null;
  if (imageType && type === 'technicalOffer') {
    showToast('العرض الفني يحتاج PDF متعدد الصفحات لأن الغلاف مستثنى من التوقيع.', 'warning');
    return;
  }
  if (!imageType && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    showToast(/\.docx$/i.test(file.name) ? 'صدّر المستند من Word إلى PDF لحفظ تنسيقه، ثم ارفعه.' : 'اختر ملف PDF أو صورة PNG أو JPG.', 'error');
    return;
  }
  if (imageType && file.size > 25 * 1024 * 1024) {
    showToast('اختر صورة لا يتجاوز حجمها 25 ميغابايت أو صدّرها إلى PDF.', 'error');
    return;
  }

  const fileName = file.name.toLowerCase();
  const otherTypeWords = type === 'technicalOffer'
    ? ['عقد', 'اتفاقية', 'اتفاقيه', 'عقود', 'contract', 'agreement']
    : ['عرض', 'فني', 'سعر', 'اسعار', 'أسعار', 'technical', 'offer', 'proposal', 'quotation'];
  if (otherTypeWords.some(word => fileName.includes(word))) {
    showToast('تحقق من اختيار نوع المستند المناسب قبل المتابعة.', 'warning');
  }

  releaseEsDocument(esState[type]);
  const state = createEsDocument();
  state.file = file;
  state.processingStatus = 'loading';
  esState[type] = state;
  esState.reviewedFiles[type] = false;
  showUploadedDetails(type);
  checkStepValidity();

  try {
    const data = imageType ? await esImageToPdf(file, imageType) : new Uint8Array(await file.arrayBuffer());
    if (esState[type] !== state) return;
    if (imageType) state.convertedPdf = data;
    state.loadingTask = openEsPdf(imageType ? data.slice() : data);
    const pdf = await state.loadingTask.promise;
    if (esState[type] !== state) return;
    state.pdfDocument = pdf;
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      if (esState[type] !== state) return;
      state.viewports.push(page.getViewport({ scale: 1 }));
    }
    state.pageCount = pdf.numPages;
    state.processingStatus = 'ready';
  } catch (error) {
    if (esState[type] !== state) return;
    releaseEsDocument(state);
    state.loadingTask = null;
    state.pdfDocument = null;
    state.viewports = [];
    state.processingStatus = 'error';
    state.errorMessage = error.name === 'PasswordException'
      ? 'الملف محمي بكلمة مرور. اختر نسخة غير محمية.'
      : 'تعذرت قراءة الملف. استبدله بملف PDF أو صورة سليمة.';
    console.warn('Could not open signature document:', error);
  }
  showUploadedDetails(type);
  checkStepValidity();
}

async function esImageToPdf(file, type) {
  const pdf = await PDFLib.PDFDocument.create();
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, 3600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const jpeg = type === 'jpeg';
    const data = canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.95);
    const image = await (jpeg ? pdf.embedJpg(data) : pdf.embedPng(data));
    const factor = Math.min(1, 1200 / Math.max(image.width, image.height));
    const width = image.width * factor;
    const height = image.height * factor;
    const page = pdf.addPage();
    page.setSize(width, height);
    page.drawImage(image, { x: 0, y: 0, width, height });
    return await pdf.save();
  } finally {
    bitmap.close();
  }
}

function openEsPdf(data) {
  return pdfjsLib.getDocument({
    data,
    // Kept explicit for compatibility with PDF.js versions that expose the option.
    isEvalSupported: false,
    cMapUrl: new URL('cmaps/', ES_PDF_ASSETS).href,
    standardFontDataUrl: new URL('standard_fonts/', ES_PDF_ASSETS).href,
    wasmUrl: new URL('wasm/', ES_PDF_ASSETS).href,
    iccUrl: new URL('iccs/', ES_PDF_ASSETS).href
  });
}

function showUploadedDetails(type) {
  const state = esState[type];
  const prefix = type === 'technicalOffer' ? 'technical' : 'contract';
  const card = document.getElementById('card-upload-' + prefix);
  const zone = document.getElementById('zone-' + prefix);
  const details = document.getElementById('details-' + prefix);
  const name = document.getElementById('name-' + prefix);
  const message = document.getElementById('status-' + prefix);
  if (card) card.classList.toggle('has-file', Boolean(state.file));
  if (zone) zone.hidden = Boolean(state.file);
  if (details) details.hidden = !state.file;
  if (name) name.textContent = state.file?.name || '';
  if (!message) return;
  const offerSkipped = type === 'technicalOffer' && state.pageCount === 1;
  message.classList.toggle('esign-document-warning', offerSkipped || state.processingStatus === 'error');
  if (state.processingStatus === 'loading') message.textContent = 'جارٍ قراءة المستند…';
  else if (state.processingStatus === 'error') message.textContent = state.errorMessage;
  else if (offerSkipped) message.textContent = 'يُستثنى الغلاف؛ هذا العرض من صفحة واحدة ولن يُصدّر. يمكنك متابعة العقد أو اختيار عرض آخر.';
  else message.textContent = state.file ? String(state.pageCount) + ' صفحة' : '';
}

function clearUploadedDocument(type) {
  if (esState.quick?.phase === 'analyzing') return;
  releaseEsDocument(esState[type]);
  esState[type] = createEsDocument();
  esState.reviewedFiles[type] = false;
  showUploadedDetails(type);
  checkStepValidity();
  document.getElementById(type === 'contract' ? 'zone-contract' : 'zone-technical')?.focus();
}

function esQuickDocuments() {
  if (!esState.signatureData || ES_DOCUMENT_TYPES.some(type => esState[type].processingStatus === 'loading')) return [];
  return getEsReviewDocuments().filter(type => type !== 'contract' || esState.stampData);
}

async function startEsQuick() {
  const docs = esQuickDocuments();
  if (esState.currentStep !== 1 || esState.quick || !docs.length) return;
  const session = esState;
  const quick = {
    docs, phase: 'analyzing', pending: [], original: new Map(), approved: [],
    skipped: new Set(), previewPages: new Map(), current: null
  };
  session.quick = quick;
  const progress = document.getElementById('esign-quick-progress');
  const next = document.getElementById('btn-next-step');
  if (next) next.disabled = true;
  checkStepValidity();
  const total = docs.reduce((sum, type) => sum + session[type].pageCount - (type === 'technicalOffer' ? 1 : 0), 0);
  const templates = esLoadTemplates();
  const hasTemplates = Object.keys(templates).length > 0;
  let completed = 0;

  for (const type of docs) {
    const state = session[type];
    quick.original.set(type, { signature: [...state.pageSignatureOverlays], stamp: [...state.pageStampOverlays] });
    const includeStamp = type === 'contract';
    for (let index = includeStamp ? 0 : 1; index < state.pageCount; index++) {
      if (session.quick !== quick || esState !== session) return;
      if (progress) progress.textContent = 'جارٍ فحص الصفحة ' + (++completed) + ' من ' + total + '…';
      const viewport = state.viewports[index];
      const target = { type, index, stamp: includeStamp && index === state.pageCount - 1 };
      try {
        const page = await state.pdfDocument.getPage(index + 1);
        const { items } = await page.getTextContent();
        target.page = esPlacementPage(items, viewport);
        const labels = target.page.labels.filter(label => esPartyForLabel(target.page, label));
        let lines = esFindSigningLine(target.page);
        if (labels.length && lines.length < 2) {
          const raster = await esRenderPlacementRaster(page, viewport);
          if (!lines.length) lines = esFindGraphicSigningLines(target.page, raster.pixels, raster.width, raster.height);
          if (lines.length === 1) {
            const line = lines[0];
            const group = esComposeSigningGroup(target.page, line, session.signatureData, target.stamp ? session.stampData : null);
            if (group && esGroupIsVisuallyClear(target.page, group, line, raster)) target.group = group;
          }
        }
      } catch (error) {
        console.warn('Could not detect a signing location:', error);
      }
      if (session.quick !== quick || esState !== session) return;
      target.page ??= { width: viewport.width, height: viewport.height, marks: [] };
      if (!target.group || hasTemplates) {
        target.key = await esTemplateKey(type, state, index);
        if (session.quick !== quick || esState !== session) return;
        target.group = esReadTemplate(target, templates) || target.group;
      }
      if (target.group) applyEsQuickGroup(state, index, target.group);
      else quick.pending.push(target);
    }
  }
  if (session.quick === quick && esState === session) await advanceEsQuick();
}

async function esRenderPlacementRaster(page, viewport) {
  const scaled = page.getViewport({ scale: Math.min(2, 900 / viewport.width, 1400 / viewport.height) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(scaled.width);
  canvas.height = Math.ceil(scaled.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  await page.render({ canvas, canvasContext: ctx, viewport: scaled }).promise;
  const { width, height, data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = canvas.height = 0;
  return { width, height, pixels: data };
}

async function esTemplateKey(type, state, index) {
  if (!globalThis.crypto?.subtle) return null;
  try {
    state.templateDigest ??= state.file.arrayBuffer().then(bytes => crypto.subtle.digest('SHA-256', bytes))
      .then(bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join(''));
    return type + ':' + await state.templateDigest + ':' + index;
  } catch {
    return null;
  }
}

function esLoadTemplates() {
  if (!currentUser?.uid) return {};
  try {
    const key = 'vip-esign-templates-v1:' + currentUser.uid;
    return JSON.parse(localStorage.getItem(key) || '{}') || {};
  } catch {
    return {};
  }
}

function esReadTemplate(target, templates) {
  if (!target.key) return null;
  const { group, signatureAspect, stampAspect } = templates[target.key] || {};
  if (Object.keys(group || {}).length !== (target.stamp ? 2 : 1) || Boolean(group?.stamp) !== target.stamp) return null;
  const signature = esState.signatureData;
  const stamp = esState.stampData;
  if (signatureAspect !== signature.width / signature.height ||
      (target.stamp && stampAspect !== stamp.width / stamp.height)) return null;
  return esGroupIsClear(target.page, group, false) ? group : null;
}

function esSaveTemplates(approved) {
  if (!approved.length || !currentUser?.uid) return;
  try {
    const key = 'vip-esign-templates-v1:' + currentUser.uid;
    const entries = new Map(Object.entries(esLoadTemplates()));
    for (const { key, group } of approved) {
      const signature = esState.signatureData;
      const stamp = esState.stampData;
      entries.delete(key);
      entries.set(key, {
        group, signatureAspect: signature.width / signature.height,
        stampAspect: group.stamp ? stamp.width / stamp.height : null
      });
    }
    localStorage.setItem(key, JSON.stringify(Object.fromEntries([...entries].slice(-60))));
  } catch {
    showToast('تعذر حفظ المواضع على هذا الجهاز.', 'warning');
  }
}

function applyEsQuickGroup(state, index, group) {
  state.pageSignatureOverlays[index] = group.signature;
  if (group.stamp) state.pageStampOverlays[index] = group.stamp;
}

function advanceEsQuick() {
  const quick = esState.quick;
  quick.current = null;
  if (quick.pending.length) {
    quick.phase = 'positioning';
    goToStep(2, { preserveOutputs: Boolean(quick.editing) });
    return;
  }
  quick.phase = 'results';
  const edit = quick.editing;
  quick.editing = null;
  for (const type of quick.docs) esState.reviewedFiles[type] = true;
  goToStep(3, { preserveOutputs: Boolean(edit) });
  return processAllDocumentsDownload(edit);
}

function cancelEsQuick() {
  const quick = esState.quick;
  if (!quick) return;
  for (const [type, placements] of quick.original) {
    esState[type].pageSignatureOverlays = placements.signature;
    esState[type].pageStampOverlays = placements.stamp;
  }
  esState.quick = null;
  goToStep(1);
}

function renderEsQuickPosition(container) {
  const target = esState.quick.pending[0];
  esState.activePreviewSubTab = target.type === 'contract' ? 'contract' : 'technical';
  container.innerHTML = `
    <h3 tabindex="-1">حدد موضع التوقيع</h3>
    <p id="esign-quick-page"></p>
    <p>اضغط على موضع التوقيع قرب السطر. راجع التكوين وعدّله قبل اعتماده.</p>
    <div class="esign-quick-controls">
      <label>حجم المجموعة <input id="esign-quick-size" type="range" min="60" max="130" value="100" disabled oninput="updateEsQuickGroup()"></label>
      <label id="esign-quick-offset-label" hidden>إزاحة الختم <input id="esign-quick-offset" type="range" min="-40" max="40" value="-25" disabled oninput="updateEsQuickGroup()"></label>
      <label id="esign-quick-template-label" hidden><input type="checkbox" id="esign-quick-template"> تذكّر هذا الموضع للملف المطابق على هذا الجهاز</label>
      <button id="esign-quick-confirm" class="btn-es btn-es-primary" type="button" disabled onclick="confirmEsQuickPosition()">اعتماد الموضع والمتابعة</button>
      <button id="esign-quick-skip" class="btn-es btn-es-secondary" type="button" onclick="skipEsQuickDocument()">متابعة الملف الآخر</button>
    </div>
    <p id="esign-quick-position-status" role="status"></p>
    <div class="pdf-workspace esign-quick-workspace" id="pdf-workspace-area" tabindex="0" role="region" aria-label="صفحة تحديد موضع التوقيع">
      <div id="workspace-technical" style="display:none;width:100%"></div>
      <div id="workspace-contract" style="display:none;width:100%"></div>
    </div>
  `;
  document.getElementById('esign-quick-page').textContent =
    (target.type === 'contract' ? 'العقد' : 'العرض الفني') + ' · الصفحة ' + (target.index + 1) +
    ' · صفحات تحتاج تحديدًا: ' + esState.quick.pending.length;
  document.getElementById('esign-quick-offset-label').hidden = !target.stamp;
  document.getElementById('esign-quick-template-label').hidden = !target.key;
  document.getElementById('esign-quick-skip').hidden = Boolean(esState.quick.editing) || esState.quick.docs.length < 2;
  layoutEsPreview();
  if (esState.quick.editing) configureEsQuickGroup(esState.quick.editing.group, target);
}

function placeEsQuickGroup(x, y) {
  const quick = esState.quick;
  const target = quick?.pending[0];
  if (quick?.phase !== 'positioning' || !target) return;
  if (quick.current?.group) {
    const { base, group } = quick.current;
    const rectangles = Object.values(group);
    const left = Math.min(...rectangles.map(rect => rect.leftRatio));
    const right = Math.max(...rectangles.map(rect => rect.leftRatio + rect.widthRatio));
    const top = Math.min(...rectangles.map(rect => rect.topRatio));
    const bottom = Math.max(...rectangles.map(rect => rect.topRatio + rect.heightRatio));
    const { signature } = group;
    const dx = Math.max(-left, Math.min(1 - right, x - signature.leftRatio - signature.widthRatio / 2));
    const dy = Math.max(-top, Math.min(1 - bottom, y - signature.topRatio - signature.heightRatio * 0.72));
    for (const rect of Object.values(base)) {
      rect.leftRatio += dx;
      rect.topRatio += dy;
    }
    updateEsQuickGroup();
    return;
  }
  const width = target.page.width * 0.32;
  const line = {
    x: x * target.page.width - width / 2, right: x * target.page.width + width / 2,
    y: y * target.page.height, height: 5
  };
  const group = esComposeSigningGroup(target.page, line, esState.signatureData, target.stamp ? esState.stampData : null, true);
  if (!group) return;
  configureEsQuickGroup(group, target);
}

function configureEsQuickGroup(group, target) {
  const base = { signature: { ...group.signature } };
  if (group.stamp) base.stamp = { ...group.stamp };
  esState.quick.current = { base, group };
  document.getElementById('esign-quick-size').disabled = false;
  document.getElementById('esign-quick-size').value = 100;
  document.getElementById('esign-quick-offset').disabled = !target.stamp;
  document.getElementById('esign-quick-offset').value = group.stamp ? Math.round(100 *
    (group.stamp.leftRatio + group.stamp.widthRatio / 2 - group.signature.leftRatio - group.signature.widthRatio / 2) /
    group.signature.widthRatio) : 0;
  updateEsQuickGroup();
}

function updateEsQuickGroup() {
  const quick = esState.quick;
  const target = quick.pending[0];
  const current = quick.current;
  if (!current) return;
  const { base } = current;
  const center = base.signature.leftRatio + base.signature.widthRatio / 2;
  const scale = Number(document.getElementById('esign-quick-size').value) / 100;
  const offset = Number(document.getElementById('esign-quick-offset').value) / 100;
  const rect = (shape, x) => ({
    leftRatio: center + (x - center) * scale,
    topRatio: base.signature.topRatio + (shape.topRatio - base.signature.topRatio) * scale,
    widthRatio: shape.widthRatio * scale, heightRatio: shape.heightRatio * scale
  });
  const group = { signature: rect(base.signature, base.signature.leftRatio) };
  if (base.stamp) group.stamp = rect(base.stamp, center + base.signature.widthRatio * offset - base.stamp.widthRatio / 2);
  const status = document.getElementById('esign-quick-position-status');
  if (!esGroupIsClear(target.page, group, false)) {
    status.textContent = 'الحجم أو الإزاحة يتجاوز حدود الصفحة. قلّل الحجم أو اختر موضعًا آخر.';
    document.getElementById('esign-quick-confirm').disabled = true;
    current.group = null;
    return;
  }
  current.group = group;
  applyEsQuickGroup(esState[target.type], target.index, group);
  redrawAllPageOverlays(target.type, 'signature');
  if (target.stamp) redrawAllPageOverlays(target.type, 'stamp');
  const clear = esGroupIsClear(target.page, group);
  status.textContent = clear ? '' : 'الموضع يتداخل مع نص. اختر مساحة أخرى أو صغّر المجموعة.';
  document.getElementById('esign-quick-confirm').disabled = !clear;
}

function confirmEsQuickPosition() {
  const quick = esState.quick;
  const target = quick?.pending[0];
  if (!target || !esGroupIsClear(target.page, quick.current?.group)) return;
  if (target.key && document.getElementById('esign-quick-template').checked) {
    quick.approved.push({ type: target.type, key: target.key, group: quick.current.group });
  }
  quick.pending.shift();
  return advanceEsQuick();
}

function skipEsQuickDocument() {
  const quick = esState.quick;
  if (quick?.phase !== 'positioning' || quick.editing || quick.docs.length < 2) return;
  const { type } = quick.pending[0];
  quick.docs = quick.docs.filter(doc => doc !== type);
  quick.pending = quick.pending.filter(target => target.type !== type);
  quick.approved = quick.approved.filter(placement => placement.type !== type);
  quick.skipped.add(type);
  advanceEsQuick();
}

async function editEsQuickResult(type) {
  const session = esState;
  const quick = session.quick;
  if (quick?.phase !== 'results' || quick.openingEditor || session.isProcessing || !session.outputs.has(type)) return;
  quick.openingEditor = true;
  const state = session[type];
  const index = esResultPage(session, type);
  const stamp = type === 'contract' && index === state.pageCount - 1;
  const group = { signature: state.pageSignatureOverlays[index] };
  if (stamp) group.stamp = state.pageStampOverlays[index];
  const viewport = state.viewports[index];
  let page;
  try {
    const pdfPage = await state.pdfDocument.getPage(index + 1);
    page = esPlacementPage((await pdfPage.getTextContent()).items, viewport);
  } catch {
    page = { width: viewport.width, height: viewport.height, marks: [] };
  }
  const key = await esTemplateKey(type, state, index);
  quick.openingEditor = false;
  if (session !== esState || quick !== session.quick || quick.phase !== 'results') return;
  quick.editing = { type, index, group };
  quick.pending = [{ type, index, stamp, page, key }];
  advanceEsQuick();
}

// STEP 2: Preview & Alignment (High Performance Lazy Rendering)
function renderStep2(container) {
  if (esState.quick?.phase === 'positioning') {
    renderEsQuickPosition(container);
    return;
  }
  const docs = getEsReviewDocuments();
  esState.activePreviewSubTab = docs[esState.wizardStep - 1] === 'contract' ? 'contract' : 'technical';

  let tabsHtml = '';
  if (docs.length === 2) {
    tabsHtml = `
      <div class="es-wizard-stepper">
        <button type="button" class="es-wizard-step" id="wizard-step-contract" onclick="goToWizardSubStep(1)">
          <span class="es-wizard-icon">1</span>
          <span class="es-wizard-text">
            <span class="es-wizard-title">العقد الرسمي</span>
            <span class="es-wizard-status" id="wizard-status-contract">بانتظار المراجعة</span>
          </span>
        </button>
        <div class="es-wizard-line"></div>
        <button type="button" class="es-wizard-step" id="wizard-step-technical" onclick="goToWizardSubStep(2)">
          <span class="es-wizard-icon">2</span>
          <span class="es-wizard-text">
            <span class="es-wizard-title">العرض الفني</span>
            <span class="es-wizard-status" id="wizard-status-technical">بانتظار المراجعة</span>
          </span>
        </button>
        <div class="es-wizard-line"></div>
        <button type="button" class="es-wizard-step" id="wizard-step-final" onclick="goToWizardSubStep(3)">
          <span class="es-wizard-icon">3</span>
          <span class="es-wizard-text">
            <span class="es-wizard-title">المراجعة والتحميل</span>
          </span>
        </button>
      </div>
    `;
  }

  container.innerHTML = `
    <div style="text-align: center; margin-bottom: 1rem;">
      <h3 tabindex="-1" style="margin: 0; font-size: 1.25rem;">حدد الموضع على صفحات المستند</h3>
      <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); font-size: 0.9rem;">حرّك التوقيع أو الختم. يمكنك تطبيق موضع التوقيع على صفحات أخرى من قائمة العنصر.</p>
    </div>

    <div id="esign-asset-notice" class="esign-retry" hidden>
      <p role="status"></p>
      <button type="button" class="btn-es btn-es-secondary" onclick="switchEsTab('settings')">إعدادات التوقيع والختم</button>
    </div>

    ${tabsHtml}
    
    <div class="pdf-preview-layout">
      <div class="pdf-toolbar">
        <div class="toolbar-group">
          <button type="button" class="btn-es btn-es-secondary" aria-label="تصغير المعاينة" onclick="adjustEsZoom(-0.1)">
            <i data-lucide="zoom-out" style="width: 16px; height: 16px;"></i>
          </button>
          <span id="zoom-value" style="font-size: 0.9rem; min-width: 45px; text-align: center;">100%</span>
          <button type="button" class="btn-es btn-es-secondary" aria-label="تكبير المعاينة" onclick="adjustEsZoom(0.1)">
            <i data-lucide="zoom-in" style="width: 16px; height: 16px;"></i>
          </button>
        </div>
        
        <div class="toolbar-group" style="gap: 0.5rem;">
          <button class="btn-es btn-es-secondary" onclick="resetActiveOverlays()">
            <i data-lucide="refresh-cw" style="width: 16px; height: 16px;"></i>
            <span>إعادة تعيين المواضع</span>
          </button>
        </div>
      </div>
      
      <!-- Preview Workspace Areas -->
      <div class="pdf-workspace" id="pdf-workspace-area" tabindex="0" role="region" aria-label="معاينة المستند">
        <div id="workspace-technical" style="display: none; width: 100%;"></div>
        <div id="workspace-contract" style="display: none; width: 100%;"></div>
      </div>
    </div>
  `;

  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  document.getElementById('zoom-value').textContent = String(Math.round(esState.zoomLevel * 100)) + '%';
  layoutEsPreview();
  updateWizardStepperUI();
}

function switchPreviewSubTab(subTab) {
  esState.activePreviewSubTab = subTab;

  const techWorkspace = document.getElementById('workspace-technical');
  const contractWorkspace = document.getElementById('workspace-contract');

  if (subTab === 'technical') {
    if (techWorkspace) techWorkspace.style.display = 'block';
    if (contractWorkspace) contractWorkspace.style.display = 'none';
    _reObserveUnrenderedPages('technicalOffer');
  } else {
    if (techWorkspace) techWorkspace.style.display = 'none';
    if (contractWorkspace) contractWorkspace.style.display = 'block';
    _reObserveUnrenderedPages('contract');
  }
}

function goToWizardSubStep(stepNum) {
  const docs = getEsReviewDocuments();
  if (esState.currentStep !== 2 || docs.length < 2) return;
  if (stepNum === 3) {
    if (canExportEsDocuments()) goToStep(3);
    return;
  }
  if (stepNum === 2 && !esState.reviewedFiles.contract) return;
  esState.wizardStep = stepNum;
  updateWizardStepperUI();
  switchPreviewSubTab(stepNum === 1 ? 'contract' : 'technical');
  checkStepValidity();
}

function updateWizardStepperUI() {
  const stepTech = document.getElementById('wizard-step-technical');
  const stepContract = document.getElementById('wizard-step-contract');
  const stepFinal = document.getElementById('wizard-step-final');

  if (!stepTech || !stepContract || !stepFinal) return;
  stepTech.disabled = !esState.reviewedFiles.contract;
  stepFinal.disabled = !canExportEsDocuments();

  stepTech.classList.remove('active', 'completed');
  stepContract.classList.remove('active', 'completed');
  stepFinal.classList.remove('active', 'completed');

  const statusTech = document.getElementById('wizard-status-technical');
  const statusContract = document.getElementById('wizard-status-contract');

  if (statusTech) {
    statusTech.textContent = esState.reviewedFiles.technicalOffer ? 'تمت المراجعة' : 'بانتظار المراجعة';
    statusTech.className = esState.reviewedFiles.technicalOffer ? 'es-wizard-status completed' : 'es-wizard-status pending';
  }
  if (statusContract) {
    statusContract.textContent = esState.reviewedFiles.contract ? 'تمت المراجعة' : 'بانتظار المراجعة';
    statusContract.className = esState.reviewedFiles.contract ? 'es-wizard-status completed' : 'es-wizard-status pending';
  }

  if (esState.wizardStep === 1) {
    stepContract.classList.add('active');
  } else if (esState.wizardStep === 2) {
    stepContract.classList.add('completed');
    stepTech.classList.add('active');
  } else if (esState.wizardStep === 3) {
    stepContract.classList.add('completed');
    stepTech.classList.add('completed');
    stepFinal.classList.add('active');
  }

  // Modify Next button label to guide user
  const nextBtn = document.getElementById('btn-next-step');
  if (nextBtn) {
    if (esState.wizardStep === 1) {
      nextBtn.innerHTML = '<span>التالي — مراجعة العرض الفني</span><i data-lucide="arrow-left"></i>';
    } else if (esState.wizardStep === 2) {
      nextBtn.innerHTML = '<span>التالي — المراجعة النهائية</span><i data-lucide="arrow-left"></i>';
    }
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }
}

// Force re-observation of unrendered pages after display switch
function _reObserveUnrenderedPages(type) {
  const observer = esIntersectionObserver;
  if (!observer) return;
  esState[type].renderedPages.forEach((pageData, index) => {
    const wrapper = document.getElementById('page-wrapper-' + type + '-' + index);
    if (wrapper && !pageData.isRendered) observer.observe(wrapper);
  });
}

function layoutEsPreview() {
  const workspace = document.getElementById('pdf-workspace-area');
  if (!workspace) return;
  removeFloatingMenus();
  const style = getComputedStyle(workspace);
  const available = workspace.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const baseWidth = Math.min(800, Math.max(1, available));
  setupIntersectionObserver();

  for (const type of getEsReviewDocuments()) {
    const id = type === 'contract' ? 'workspace-contract' : 'workspace-technical';
    const container = document.getElementById(id);
    if (!container) continue;
    const state = esState[type];
    state.renderedPages = state.viewports.map((viewport, index) => {
      const renderedWidth = baseWidth * esState.zoomLevel;
      return {
        renderedWidth,
        renderedHeight: renderedWidth * viewport.height / viewport.width,
        pdfPageWidth: viewport.width,
        pageNum: index + 1,
        isRendered: false
      };
    });
    initializeDefaultOverlayRatios(type);
    container.replaceChildren();
    buildPlaceholderViews(type, container);
  }
  switchPreviewSubTab(esState.activePreviewSubTab);
  checkStepValidity();
}

function buildPlaceholderViews(type, container) {
  const state = esState[type];

  state.renderedPages.forEach((pageData, index) => {
    const target = esState.quick?.phase === 'positioning' && esState.quick.pending[0];
    if (target && (target.type !== type || target.index !== index)) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'page-wrapper';
    wrapper.id = `page-wrapper-${type}-${index}`;
    // Store data attributes for reliable retrieval in the observer callback
    wrapper.dataset.esType = type;
    wrapper.dataset.esIndex = String(index);
    wrapper.style.position = 'relative';
    wrapper.style.marginBottom = '20px';
    wrapper.style.width = `${pageData.renderedWidth}px`;
    wrapper.style.height = `${pageData.renderedHeight}px`;
    wrapper.style.backgroundColor = 'white';

    const skeleton = document.createElement('div');
    skeleton.style.width = '100%';
    skeleton.style.height = '100%';
    skeleton.className = 'pulse-loader';
    skeleton.style.borderRadius = '0';
    wrapper.appendChild(skeleton);

    container.appendChild(wrapper);

    // Register for lazy rendering
    if (esIntersectionObserver) {
      esIntersectionObserver.observe(wrapper);
    }
  });
}

// Set up IntersectionObserver — uses VIEWPORT as root (null) so it works
// even when workspace containers are toggled via display:none/block
function setupIntersectionObserver() {
  if (esIntersectionObserver) {
    esIntersectionObserver.disconnect();
  }

  esIntersectionObserver = new IntersectionObserver((entries, observer) => {
    if (esIntersectionObserver !== observer) return;
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const el = entry.target;
        // Read type and index from data attributes (more reliable than ID parsing)
        const type = el.dataset.esType;
        const index = parseInt(el.dataset.esIndex);
        if (!type || isNaN(index)) return;
        observer.unobserve(el);
        if (document.getElementById(el.id) === el) void lazyRenderPageCanvas(type, index);
      }
    });
  }, {
    root: null,                           // viewport — works regardless of display state
    rootMargin: '200px 0px 200px 0px',   // pre-load 200px before entering viewport
    threshold: 0.01
  });
}

async function lazyRenderPageCanvas(type, index) {
  const state = esState[type];
  const pageData = state.renderedPages[index];
  if (!pageData || pageData.isRendered || pageData.isRendering) return;

  const wrapper = document.getElementById(`page-wrapper-${type}-${index}`);
  if (!wrapper) return;
  pageData.isRendering = true;
  const stillCurrent = () => state === esState[type] && document.getElementById(wrapper.id) === wrapper;

  try {
    const page = await state.pdfDocument.getPage(pageData.pageNum);
    if (!stillCurrent()) return;

    // Render at 1.5x display width for premium sharp rendering
    const renderScale = (pageData.renderedWidth / pageData.pdfPageWidth) * 1.5;
    const viewport = page.getViewport({ scale: renderScale });

    const canvas = document.createElement('canvas');
    canvas.className = 'page-canvas';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';

    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    if (!stillCurrent()) return;

    pageData.isRendered = true;

    // Remove skeleton loader
    wrapper.innerHTML = '';
    wrapper.appendChild(canvas);

    if (esState.quick?.phase === 'positioning') {
      canvas.addEventListener('click', event => {
        const bounds = canvas.getBoundingClientRect();
        placeEsQuickGroup((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
      });
      canvas.tabIndex = 0;
      canvas.setAttribute('aria-label', 'حدد الموضع على الصفحة. مفاتيح الأسهم تحرك المجموعة.');
      canvas.addEventListener('keydown', event => {
        const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const direction = directions[event.key];
        if (!direction) return;
        event.preventDefault();
        const group = esState.quick?.current?.group;
        const x = group ? group.signature.leftRatio + group.signature.widthRatio / 2 : 0.5;
        const y = group ? group.signature.topRatio + group.signature.heightRatio * 0.72 : 0.5;
        placeEsQuickGroup(x + direction[0] * 0.025, y + direction[1] * 0.025);
      });
    }

    const isTech = type === 'technicalOffer';
    const lastIndex = state.renderedPages.length - 1;

    if (isTech && index === 0) {
      const watermark = document.createElement('div');
      watermark.style.position = 'absolute';
      watermark.style.top = '10px';
      watermark.style.right = '10px';
      watermark.style.backgroundColor = 'rgba(239, 68, 68, 0.85)';
      watermark.style.color = 'white';
      watermark.style.padding = '4px 10px';
      watermark.style.borderRadius = '4px';
      watermark.style.fontSize = '0.75rem';
      watermark.style.fontWeight = 'bold';
      watermark.style.zIndex = '5';
      watermark.textContent = 'الصفحة الأولى (تم تجاهلها ولن توقع)';
      wrapper.appendChild(watermark);
      return;
    }

    // Add overlays to wrapper
    const showGroup = esState.quick?.phase !== 'positioning' || esState.quick.current?.group;
    if (esState.signatureData && showGroup) {
      const sigOverlay = createEsOverlayElement('signature', index, type);
      wrapper.appendChild(sigOverlay);
    }

    if (!isTech && esState.stampData && index === lastIndex && showGroup) {
      const stampOverlay = createEsOverlayElement('stamp', index, type);
      wrapper.appendChild(stampOverlay);
    }

    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  } catch (err) {
    if (!stillCurrent()) return;
    console.error(err);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn-es btn-es-secondary';
    retry.textContent = 'إعادة عرض الصفحة';
    retry.onclick = () => {
      retry.disabled = true;
      void lazyRenderPageCanvas(type, index);
    };
    const notice = document.createElement('div');
    notice.className = 'esign-retry esign-page-error';
    notice.setAttribute('role', 'status');
    notice.append('تعذر عرض الصفحة.', retry);
    wrapper.replaceChildren(notice);
  } finally {
    pageData.isRendering = false;
    if (stillCurrent()) checkStepValidity();
  }
}



function initializeDefaultOverlayRatios(type) {
  const state = esState[type];
  const isTech = type === 'technicalOffer';
  const first = state.viewports[isTech ? 1 : 0];
  if (!first) return;
  const referenceWidth = 800;

  const signature = esState.signatureData;
  if (signature && !state.signatureOverlay.widthRatio) {
    const height = referenceWidth * first.height / first.width;
    const aspect = signature.width / signature.height;
    const width = Math.min(signature.width * 0.4, referenceWidth * 0.25, height * 0.4 * aspect);
    const widthRatio = width / referenceWidth;
    const heightRatio = width / aspect / height;
    state.signatureOverlay = { leftRatio: 0.95 - widthRatio, topRatio: 0.95 - heightRatio, widthRatio, heightRatio };
  }

  const stamp = esState.stampData;
  if (!isTech && stamp && !state.stampOverlay.widthRatio) {
    const last = state.viewports.at(-1);
    const height = referenceWidth * last.height / last.width;
    const aspect = stamp.width / stamp.height;
    const width = Math.min(stamp.width * 0.45, referenceWidth * 0.28, height * 0.4 * aspect);
    const widthRatio = width / referenceWidth;
    const heightRatio = width / aspect / height;
    state.stampOverlay = {
      leftRatio: 0.95 - widthRatio,
      topRatio: Math.max(0, state.signatureOverlay.topRatio - heightRatio - 10 / height),
      widthRatio,
      heightRatio
    };
  }
}

function getOverlayState(docType, overlayType, pageIndex, state = esState[docType]) {
  const overlaysArray = overlayType === 'signature' ? state.pageSignatureOverlays : state.pageStampOverlays;
  if (overlaysArray && overlaysArray[pageIndex]) {
    return overlaysArray[pageIndex];
  }
  return overlayType === 'signature' ? state.signatureOverlay : state.stampOverlay;
}

function createEsOverlayElement(overlayType, pageIndex, docType) {
  const state = esState[docType];
  const overlayState = getOverlayState(docType, overlayType, pageIndex);
  const assetData = overlayType === 'signature' ? esState.signatureData : esState.stampData;

  const el = document.createElement('div');
  el.className = `overlay-element ${overlayType}-element`;
  el.id = `overlay-${docType}-${overlayType}-page-${pageIndex}`;
  el.dataset.type = overlayType;
  el.dataset.docType = docType;
  el.dataset.pageIndex = pageIndex;
  el.tabIndex = 0;
  el.setAttribute('aria-label', (overlayType === 'signature' ? 'التوقيع' : 'الختم') + '، الصفحة ' + (pageIndex + 1));

  const badge = document.createElement('div');
  badge.className = 'overlay-badge';

  if (overlayType === 'signature') {
    const isCustom = Boolean(state.pageSignatureOverlays[pageIndex]);
    badge.textContent = `توقيع المدير - ${isCustom ? 'تعديل خاص' : 'افتراضي'}`;
  } else {
    badge.textContent = 'ختم الشركة';
  }
  el.appendChild(badge);

  const img = document.createElement('img');
  img.src = assetData.dataUrl;
  img.alt = '';
  img.className = 'overlay-img';
  el.appendChild(img);

  if (esState.quick?.phase === 'positioning') {
    el.classList.add('esign-quick-overlay');
    el.removeAttribute('tabindex');
    updateOverlayUI(el, overlayState);
    return el;
  }

  const corners = ['nw', 'ne', 'se', 'sw'];
  corners.forEach(c => {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-handle-${c}`;
    el.appendChild(handle);
    initPointerResize(handle, el, c, overlayType, docType);
  });

  updateOverlayUI(el, overlayState);
  initPointerDrag(el, overlayType, docType);
  el.addEventListener('keydown', event => {
    const movement = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!movement) return;
    event.preventDefault();
    const current = getOverlayState(docType, overlayType, pageIndex);
    const distance = event.shiftKey ? 0.05 : 0.01;
    const position = {
      ...current,
      leftRatio: Math.max(0, Math.min(1 - current.widthRatio, current.leftRatio + movement[0] * distance)),
      topRatio: Math.max(0, Math.min(1 - current.heightRatio, current.topRatio + movement[1] * distance))
    };
    const positions = overlayType === 'signature' ? state.pageSignatureOverlays : state.pageStampOverlays;
    positions[pageIndex] = position;
    updateOverlayUI(el, position);
  });

  return el;
}

function updateOverlayUI(element, state) {
  element.style.left = `${state.leftRatio * 100}%`;
  element.style.top = `${state.topRatio * 100}%`;
  element.style.width = `${state.widthRatio * 100}%`;
  element.style.height = `${state.heightRatio * 100}%`;
}

function initPointerDrag(element, overlayType, docType) {
  element.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('resize-handle')) return;

    document.querySelectorAll('.overlay-element').forEach(o => o.classList.remove('selected'));
    element.classList.add('selected');

    removeFloatingMenus();


    const state = esState[docType];
    const pageIndex = parseInt(element.dataset.pageIndex);
    const pageWrapper = element.parentElement;
    const renderedWidth = pageWrapper.clientWidth;
    const renderedHeight = pageWrapper.clientHeight;

    if (!state.pageSignatureOverlays) state.pageSignatureOverlays = new Array(state.pageCount).fill(null);
    if (!state.pageStampOverlays) state.pageStampOverlays = new Array(state.pageCount).fill(null);

    const startRatios = getOverlayState(docType, overlayType, pageIndex);

    let startX = e.clientX;
    let startY = e.clientY;
    let startLeft = startRatios.leftRatio * renderedWidth;
    let startTop = startRatios.topRatio * renderedHeight;
    const elementWidth = startRatios.widthRatio * renderedWidth;
    const elementHeight = startRatios.heightRatio * renderedHeight;

    try {
      element.setPointerCapture(e.pointerId);
    } catch (err) {
      console.warn("Could not set pointer capture", err);
    }

    const onPointerMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      let newLeft = startLeft + dx;
      let newTop = startTop + dy;

      newLeft = Math.max(0, Math.min(newLeft, renderedWidth - elementWidth));
      newTop = Math.max(0, Math.min(newTop, renderedHeight - elementHeight));

      const targetOverlaysArray = overlayType === 'signature' ? state.pageSignatureOverlays : state.pageStampOverlays;
      targetOverlaysArray[pageIndex] = {
        leftRatio: newLeft / renderedWidth,
        topRatio: newTop / renderedHeight,
        widthRatio: startRatios.widthRatio,
        heightRatio: startRatios.heightRatio
      };

      updateOverlayUI(element, targetOverlaysArray[pageIndex]);
    };

    const onPointerUp = (upEvent) => {
      try {
        element.releasePointerCapture(upEvent.pointerId);
      } catch (err) { }
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);

      if (overlayType !== 'stamp') {
        showFloatingMenu(element, overlayType, docType, pageIndex);
      }
    };

    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerUp);
  });
}

function initPointerResize(handle, element, direction, overlayType, docType) {
  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();

    removeFloatingMenus();

    const state = esState[docType];
    const pageIndex = parseInt(element.dataset.pageIndex);
    const assetData = overlayType === 'signature' ? esState.signatureData : esState.stampData;
    const pageWrapper = element.parentElement;
    const renderedWidth = pageWrapper.clientWidth;
    const renderedHeight = pageWrapper.clientHeight;

    const aspect = assetData.width / assetData.height;

    if (!state.pageSignatureOverlays) state.pageSignatureOverlays = new Array(state.pageCount).fill(null);
    if (!state.pageStampOverlays) state.pageStampOverlays = new Array(state.pageCount).fill(null);

    const startRatios = getOverlayState(docType, overlayType, pageIndex);

    let startX = e.clientX;
    let startY = e.clientY;

    let startLeft = startRatios.leftRatio * renderedWidth;
    let startTop = startRatios.topRatio * renderedHeight;
    let startWidth = startRatios.widthRatio * renderedWidth;
    let startHeight = startRatios.heightRatio * renderedHeight;

    try {
      handle.setPointerCapture(e.pointerId);
    } catch (err) {
      console.warn("Could not set pointer capture for handle", err);
    }

    const onPointerMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      let newLeft = startLeft;
      let newTop = startTop;
      let newWidth = startWidth;
      let newHeight = startHeight;

      if (direction === 'se') {
        newWidth = Math.max(30, startWidth + dx);
        newHeight = newWidth / aspect;

        if (newLeft + newWidth > renderedWidth) {
          newWidth = renderedWidth - newLeft;
          newHeight = newWidth / aspect;
        }
        if (newTop + newHeight > renderedHeight) {
          newHeight = renderedHeight - newTop;
          newWidth = newHeight * aspect;
        }
      }
      else if (direction === 'sw') {
        newWidth = Math.max(30, startWidth - dx);
        newHeight = newWidth / aspect;
        newLeft = startLeft + (startWidth - newWidth);

        if (newLeft < 0) {
          newLeft = 0;
          newWidth = startLeft + startWidth;
          newHeight = newWidth / aspect;
        }
        if (newTop + newHeight > renderedHeight) {
          newHeight = renderedHeight - newTop;
          newWidth = newHeight * aspect;
          newLeft = startLeft + (startWidth - newWidth);
        }
      }
      else if (direction === 'ne') {
        newWidth = Math.max(30, startWidth + dx);
        newHeight = newWidth / aspect;
        newTop = startTop + (startHeight - newHeight);

        if (newLeft + newWidth > renderedWidth) {
          newWidth = renderedWidth - newLeft;
          newHeight = newWidth / aspect;
          newTop = startTop + (startHeight - newHeight);
        }
        if (newTop < 0) {
          newTop = 0;
          newHeight = startTop + startHeight;
          newWidth = newHeight * aspect;
        }
      }
      else if (direction === 'nw') {
        newWidth = Math.max(30, startWidth - dx);
        newHeight = newWidth / aspect;
        newLeft = startLeft + (startWidth - newWidth);
        newTop = startTop + (startHeight - newHeight);

        if (newLeft < 0) {
          newLeft = 0;
          newWidth = startLeft + startWidth;
          newHeight = newWidth / aspect;
          newTop = startTop + (startHeight - newHeight);
        }
        if (newTop < 0) {
          newTop = 0;
          newHeight = startTop + startHeight;
          newWidth = newHeight * aspect;
          newLeft = startLeft + (startWidth - newWidth);
        }
      }

      const targetOverlaysArray = overlayType === 'signature' ? state.pageSignatureOverlays : state.pageStampOverlays;
      targetOverlaysArray[pageIndex] = {
        leftRatio: newLeft / renderedWidth,
        topRatio: newTop / renderedHeight,
        widthRatio: newWidth / renderedWidth,
        heightRatio: newHeight / renderedHeight
      };

      updateOverlayUI(element, targetOverlaysArray[pageIndex]);
    };

    const onPointerUp = (upEvent) => {
      try {
        handle.releasePointerCapture(upEvent.pointerId);
      } catch (err) { }
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerUp);

      if (overlayType !== 'stamp') {
        showFloatingMenu(element, overlayType, docType, pageIndex);
      }
    };

    element.classList.add('selected');

    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerUp);
  });
}

function showFloatingMenu(element, overlayType, docType, pageIndex) {
  removeFloatingMenus();

  const pageWrapper = element.parentElement;
  if (!pageWrapper) return;

  const menu = document.createElement('div');
  menu.className = 'es-floating-menu';
  menu.id = `es-floating-menu-${docType}-${overlayType}-${pageIndex}`;

  const btnApplyAll = document.createElement('button');
  btnApplyAll.className = 'es-menu-item';
  btnApplyAll.innerHTML = '<i data-lucide="check-check"></i><span>تطبيق الموضع على كل الصفحات</span>';
  btnApplyAll.onclick = () => applyPositionToAll(docType, overlayType, pageIndex);

  const btnApplyThisPage = document.createElement('button');
  btnApplyThisPage.className = 'es-menu-item';
  btnApplyThisPage.innerHTML = '<i data-lucide="check"></i><span>تطبيق الموضع على هذه الصفحة فقط</span>';
  btnApplyThisPage.onclick = () => applyPositionToThisPageOnly(docType, overlayType, pageIndex);

  menu.appendChild(btnApplyAll);
  menu.appendChild(btnApplyThisPage);

  const overlayRectTop = parseFloat(element.style.top);
  const overlayRectHeight = parseFloat(element.style.height);
  const overlayRectLeft = parseFloat(element.style.left);
  const overlayRectWidth = parseFloat(element.style.width);

  menu.style.top = `${overlayRectTop + overlayRectHeight + 8}px`;
  menu.style.left = `${overlayRectLeft + (overlayRectWidth / 2) - 105}px`;

  pageWrapper.appendChild(menu);

  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  const badge = element.querySelector('.overlay-badge');
  if (badge) {
    badge.textContent = `${overlayType === 'signature' ? 'توقيع المدير' : 'ختم الشركة'} - تعديل هذه الصفحة فقط`;
  }
}

function applyPositionToThisPageOnly(docType, overlayType, pageIndex) {
  showToast('تم حفظ موضع التوقيع لهذه الصفحة فقط.', 'success');
  removeFloatingMenus();
}

function removeFloatingMenus() {
  document.querySelectorAll('.es-floating-menu').forEach(menu => menu.remove());
}

function applyPositionToAll(docType, overlayType, pageIndex) {
  const sourceState = getOverlayState(docType, overlayType, pageIndex);
  const state = esState[docType];
  if (overlayType === 'signature') {
    state.signatureOverlay = { ...sourceState };
    state.pageSignatureOverlays = new Array(state.pageCount).fill(null);
  } else {
    state.stampOverlay = { ...sourceState };
    state.pageStampOverlays = new Array(state.pageCount).fill(null);
  }

  redrawAllPageOverlays(docType, overlayType);
  showToast('تم تطبيق الموضع على جميع الصفحات.', 'success');
  removeFloatingMenus();
}

function applyPositionToSubsequent(docType, overlayType, pageIndex) {
  const sourceState = getOverlayState(docType, overlayType, pageIndex);
  const state = esState[docType];
  const targetArray = overlayType === 'signature' ? state.pageSignatureOverlays : state.pageStampOverlays;

  for (let i = pageIndex; i < state.pageCount; i++) {
    if (docType === 'technicalOffer' && i === 0) continue;
    targetArray[i] = { ...sourceState };
  }

  redrawAllPageOverlays(docType, overlayType);
  showToast('تم تطبيق الموضع على الصفحات التالية.', 'success');
  removeFloatingMenus();
}

function resetPageToDefault(docType, overlayType, pageIndex) {
  const state = esState[docType];
  const targetArray = overlayType === 'signature' ? state.pageSignatureOverlays : state.pageStampOverlays;
  targetArray[pageIndex] = null;

  const defaultState = overlayType === 'signature' ? state.signatureOverlay : state.stampOverlay;
  const el = document.getElementById(`overlay-${docType}-${overlayType}-page-${pageIndex}`);
  if (el) {
    updateOverlayUI(el, defaultState);
    const badge = el.querySelector('.overlay-badge');
    if (badge) {
      badge.textContent = `${overlayType === 'signature' ? 'توقيع المدير' : 'ختم الشركة'} - افتراضي`;
    }
  }
  showToast('تمت إعادة تعيين موضع الصفحة للوضع الافتراضي.', 'info');
  removeFloatingMenus();
}

function redrawAllPageOverlays(docType, overlayType) {
  const state = esState[docType];
  const isTech = docType === 'technicalOffer';
  const asset = overlayType === 'signature' ? esState.signatureData : esState.stampData;
  const positions = overlayType === 'signature' ? state.pageSignatureOverlays : state.pageStampOverlays;

  state.renderedPages.forEach((pageData, index) => {
    if (isTech && index === 0) return;
    if (overlayType === 'stamp' && (isTech || index !== state.pageCount - 1)) return;
    const wrapper = document.getElementById('page-wrapper-' + docType + '-' + index);
    if (!wrapper || !pageData.isRendered) return;

    const element = document.getElementById('overlay-' + docType + '-' + overlayType + '-page-' + index);
    if (!asset) {
      element?.remove();
      return;
    }
    if (!element) {
      wrapper.appendChild(createEsOverlayElement(overlayType, index, docType));
      return;
    }

    updateOverlayUI(element, getOverlayState(docType, overlayType, index));
    element.querySelector('img').src = asset.dataUrl;
    const badge = element.querySelector('.overlay-badge');
    if (badge) {
      const label = overlayType === 'signature' ? 'توقيع المدير' : 'ختم الشركة';
      badge.textContent = label + ' - ' + (positions[index] ? 'تعديل خاص' : 'افتراضي');
    }
  });
}

// Global click listener to close floating menus when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.overlay-element') && !e.target.closest('.es-floating-menu')) {
    removeFloatingMenus();
  }
});

function resetOverlaysToDefaults() {
  const type = esState.activePreviewSubTab === 'technical' ? 'technicalOffer' : 'contract';
  const state = esState[type];
  state.signatureOverlay = { leftRatio: 0, topRatio: 0, widthRatio: 0, heightRatio: 0 };
  state.stampOverlay = { leftRatio: 0, topRatio: 0, widthRatio: 0, heightRatio: 0 };
  state.pageSignatureOverlays.fill(null);
  state.pageStampOverlays.fill(null);
  initializeDefaultOverlayRatios(type);
  redrawAllPageOverlays(type, 'signature');
  if (type === 'contract') redrawAllPageOverlays(type, 'stamp');
  removeFloatingMenus();
}

function resetActiveOverlays() {
  resetOverlaysToDefaults();
}

function adjustEsZoom(diff) {
  const newZoom = Math.min(2, Math.max(0.5, Math.round((esState.zoomLevel + diff) * 10) / 10));
  if (newZoom === esState.zoomLevel) return;

  esState.zoomLevel = newZoom;
  const zoomVal = document.getElementById('zoom-value');
  if (zoomVal) zoomVal.textContent = String(Math.round(newZoom * 100)) + '%';
  layoutEsPreview();
}

// STEP 3: Confirm & Download (Dual Files Supported)
function renderStep3(container) {
  const docs = esState.quick?.docs ?? getEsReviewDocuments();
  container.innerHTML = `
    <div style="text-align: center; margin-bottom: 1.5rem;">
      <h3 tabindex="-1" style="margin: 0; font-size: 1.25rem;">مراجعة المستندات وتنزيلها</h3>
      <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary);">أضف التوقيع والختم حسب المعاينة ونزّل النسخ من هذا الجهاز.</p>
    </div>
    <div class="esign-summary-card" id="esign-export-summary"></div>
    <div class="esign-share-bar" id="esign-share-bar" hidden>
      <button type="button" class="btn-es btn-es-primary" onclick="shareEsResults('whatsapp')"><i data-lucide="message-circle"></i><span>مشاركة واتساب</span></button>
      <button type="button" class="btn-es btn-es-secondary" onclick="shareEsResults('other')"><i data-lucide="share-2"></i><span>مشاركة أخرى</span></button>
      <p id="esign-share-status" role="status"></p>
      <a id="esign-whatsapp-web" class="btn-es btn-es-secondary" href="https://web.whatsapp.com/" target="_blank" rel="noopener noreferrer" hidden>فتح واتساب وإرفاق الملفات يدويًا</a>
    </div>
    <div class="esign-retry" id="esign-asset-notice" hidden>
      <p role="status"></p>
      <button type="button" class="btn-es btn-es-secondary" onclick="switchEsTab('settings')">إعدادات التوقيع والختم</button>
    </div>
    <div class="esign-export-actions">
      <button type="button" class="btn-es btn-es-primary" id="btn-process-pdf" onclick="processAllDocumentsDownload()">
        <i data-lucide="file-signature"></i><span>إضافة التوقيع وتنزيل الملفات</span>
      </button>
      <p id="pdf-processing-spinner" role="status" hidden>جارٍ تجهيز الملفات…</p>
    </div>
  `;
  const summary = document.getElementById('esign-export-summary');
  for (const type of docs) {
    const isContract = type === 'contract';
    const row = document.createElement('div');
    row.className = 'esign-export-file';
    const title = document.createElement('strong');
    title.textContent = isContract ? 'العقد الرسمي' : 'العرض الفني';
    const filename = document.createElement('bdi');
    filename.className = 'esign-export-name';
    filename.textContent = esState[type].file.name;
    const pages = document.createElement('span');
    pages.textContent = String(esState[type].pageCount - (isContract ? 0 : 1)) + ' صفحة للتوقيع';
    const result = document.createElement('div');
    result.id = 'esign-output-' + type;
    result.className = 'esign-export-result';
    result.setAttribute('aria-live', 'polite');
    row.append(title, filename, pages, result);
    summary.append(row);
    if (esState.outputs.has(type)) showEsOutput(esState, type, result);
  }
  const processButton = document.getElementById('btn-process-pdf');
  if (processButton) processButton.hidden = docs.every(type => esState.outputs.has(type));
  if (esState.quick) {
    for (const type of ES_DOCUMENT_TYPES) {
      if (!esState[type].file || docs.includes(type) || (type === 'technicalOffer' && esState[type].pageCount === 1)) continue;
      const skipped = document.createElement('p');
      skipped.className = 'esign-document-warning';
      const title = type === 'contract' ? 'العقد' : 'العرض الفني';
      skipped.textContent = title + ' خارج النتائج: ' +
        (esState.quick.skipped.has(type) ? 'لم يُعتمد موضع التوقيع.' :
          esState[type].errorMessage || 'الختم غير متوفر. ارجع لإعدادات التوقيع لإكمال العقد.');
      summary.append(skipped);
    }
  }
  if (esState.technicalOffer.pageCount === 1) {
    const skipped = document.createElement('p');
    skipped.className = 'esign-document-warning';
    skipped.textContent = 'العرض الفني من صفحة واحدة؛ تم استثناؤه من التصدير.';
    summary.append(skipped);
  }
}

async function processAllDocumentsDownload(edit = null) {
  if (esState.currentStep !== 3 || esState.isProcessing || !canExportEsDocuments()) return;

  const session = esState;
  const { signatureData, stampData } = session;
  const docs = [...(session.quick?.docs ?? getEsReviewDocuments())].reverse();
  const pending = edit ? [edit.type] : docs.filter(type => !session.outputs.has(type));
  if (!pending.length) return;
  const button = document.getElementById('btn-process-pdf');
  const spinner = document.getElementById('pdf-processing-spinner');
  const prev = document.getElementById('btn-prev-step');
  const reset = document.getElementById('btn-reset-esign');

  session.isProcessing = true;
  document.querySelectorAll('[data-esign-edit]').forEach(edit => { edit.disabled = true; });
  if (button) button.disabled = true;
  if (spinner) spinner.hidden = false;
  if (prev) prev.disabled = true;
  if (reset) reset.disabled = true;
  let failed = false;

  try {
    for (const type of pending) {
      const state = session[type];
      const outputStatus = document.getElementById('esign-output-' + type);
      if (outputStatus && !edit) outputStatus.textContent = 'جارٍ تجهيز النسخة…';
      try {
        const bytes = await generateFinalPdfBytes(type, state, signatureData, stampData);
        if (esState !== session) return;
        const name = state.file.name.replace(/\.(?:pdf|png|jpe?g)$/i, '') + ' - معتمد.pdf';
        const file = new File([bytes], name, { type: 'application/pdf' });
        const url = URL.createObjectURL(file);
        const previous = session.outputs.get(type);
        session.outputs.set(type, {
          url, file,
          signatures: [...state.pageSignatureOverlays],
          stamps: [...state.pageStampOverlays]
        });
        if (previous) URL.revokeObjectURL(previous.url);
        const link = showEsOutput(session, type, outputStatus);
        if (!session.quick) link.click();
        if (session.quick) {
          esSaveTemplates(session.quick.approved.filter(placement => placement.type === type));
          session.quick.approved = session.quick.approved.filter(placement => placement.type !== type);
        }
        void logSignatureOperation({
          status: 'generated',
          documentType: type === 'contract' ? 'contract' : 'technical_offer',
          originalFileName: state.file.name,
          pageCount: state.pageCount,
          stampApplied: type === 'contract'
        }, session);
      } catch (error) {
        if (esState !== session) return;
        console.error('Could not generate signature document:', error);
        if (edit) {
          applyEsQuickGroup(state, edit.index, edit.group);
          session.quick.approved = session.quick.approved.filter(placement => placement.type !== type);
          showEsOutput(session, type, outputStatus);
          showToast('تعذر تحديث الموضع. النسخة السابقة جاهزة. اضبط الموضع وأعد المحاولة.', 'warning');
          continue;
        }
        failed = true;
        if (outputStatus) outputStatus.textContent = 'تعذر تجهيز هذا الملف. يمكنك إعادة محاولة الملفات المتعثرة.';
      }
    }
  } finally {
    if (esState === session) {
      session.isProcessing = false;
      document.querySelectorAll('[data-esign-edit]').forEach(edit => { edit.disabled = false; });
      if (button) {
        button.hidden = !failed;
        if (failed) button.querySelector('span').textContent = 'إعادة محاولة الملفات المتعثرة';
      }
      if (prev) prev.disabled = false;
      if (reset) reset.disabled = false;
      if (spinner) spinner.hidden = true;
      checkStepValidity();
    }
  }
}

function esResultPage(session, type) {
  return session.quick.previewPages.get(type) ?? (type === 'contract' ? session[type].pageCount - 1 : 1);
}

function showEsOutput(session, type, container) {
  const output = session.outputs.get(type);
  const { file, url } = output;
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.className = 'btn-es btn-es-primary';
  link.textContent = type === 'contract' ? 'تنزيل العقد' : 'تنزيل العرض الفني';
  container?.replaceChildren(link);
  const sharing = document.getElementById('esign-share-bar');
  if (sharing) sharing.hidden = false;
  if (!container) return link;

  if (typeof navigator !== 'undefined' && esCanSharePdfFiles(navigator, [file])) {
    const share = document.createElement('button');
    share.type = 'button';
    share.className = 'btn-es btn-es-secondary';
    share.textContent = 'مشاركة هذا الملف';
    share.onclick = () => shareEsResults('other', type);
    container.append(share);
  }
  if (session.quick) {
    const state = session[type];
    const first = type === 'contract' ? 0 : 1;
    const title = type === 'contract' ? 'العقد' : 'العرض الفني';
    const thumbnail = document.createElement('div');
    thumbnail.className = 'esign-result-thumbnail';
    const showPreview = () => {
      const frame = document.createElement('div');
      thumbnail.replaceChildren(frame);
      void renderEsResultPreview(session, output, esResultPage(session, type), frame);
    };
    container.prepend(thumbnail);
    if (state.pageCount - first > 1) {
      const label = document.createElement('label');
      label.className = 'esign-result-page';
      const picker = document.createElement('select');
      picker.dir = 'rtl';
      picker.setAttribute('aria-label', 'صفحة معاينة ' + title);
      for (let index = first; index < state.pageCount; index++) {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = 'صفحة ' + (index + 1);
        picker.append(option);
      }
      picker.value = String(esResultPage(session, type));
      picker.onchange = () => {
        if (session.isProcessing || session.quick.openingEditor) {
          picker.value = String(esResultPage(session, type));
          return;
        }
        session.quick.previewPages.set(type, Number(picker.value));
        showPreview();
      };
      label.append('معاينة الموضع', picker);
      container.prepend(label);
    }
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn-es btn-es-secondary';
    edit.dataset.esignEdit = '';
    edit.disabled = session.isProcessing;
    edit.textContent = 'ضبط موضع هذه الصفحة';
    edit.setAttribute('aria-label', 'ضبط موضع توقيع ' + title);
    edit.onclick = () => editEsQuickResult(type);
    container.append(edit);
    showPreview();
  }
  return link;
}

async function shareEsResults(destination, type) {
  const session = esState;
  const files = type ? [session.outputs.get(type)?.file].filter(Boolean)
    : Array.from(session.outputs.values(), output => output.file);
  if (!files.length) return;
  const status = document.getElementById('esign-share-status');
  const fallback = document.getElementById('esign-whatsapp-web');
  if (destination === 'whatsapp' && status) status.textContent = 'اختر واتساب من قائمة المشاركة على جهازك.';
  const result = await esSharePdfFiles(navigator, files);
  if (session !== esState || !status?.isConnected) return;
  if (fallback) fallback.hidden = destination !== 'whatsapp' || ['opened', 'cancelled'].includes(result);
  if (result === 'opened') {
    status.textContent = '';
  } else if (result === 'cancelled') {
    status.textContent = 'أُغلقت المشاركة. ملفاتك جاهزة.';
  } else if (destination === 'whatsapp') {
    status.textContent = 'نزّل الملفات ثم افتح واتساب لإرفاقها.';
  } else {
    status.textContent = files.length > 1
      ? 'تعذرت مشاركة الملفين معًا. جرّب مشاركة كل ملف أو تنزيله لإرفاقه.'
      : 'تعذرت مشاركة الملف من هذا المتصفح. نزّله لإرفاقه.';
  }
}

async function renderEsResultPreview(session, output, index, container) {
  let task;
  try {
    if (session !== esState || !container.isConnected) return;
    const bytes = new Uint8Array(await output.file.arrayBuffer());
    if (session !== esState || !container.isConnected) return;
    task = openEsPdf(bytes);
    const documentOut = await task.promise;
    const page = await documentOut.getPage(index + 1);
    if (session !== esState || !container.isConnected) return;
    const view = page.getViewport({ scale: 1 });
    const group = [output.signatures[index]];
    if (output.stamps[index]) group.push(output.stamps[index]);
    const left = Math.max(0, Math.min(...group.map(rect => rect.leftRatio)) - 0.04) * view.width;
    const top = Math.max(0, Math.min(...group.map(rect => rect.topRatio)) - 0.04) * view.height;
    const right = Math.min(1, Math.max(...group.map(rect => rect.leftRatio + rect.widthRatio)) + 0.04) * view.width;
    const bottom = Math.min(1, Math.max(...group.map(rect => rect.topRatio + rect.heightRatio)) + 0.04) * view.height;
    const scale = Math.min(2, 440 / (right - left), 200 / (bottom - top));
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((right - left) * scale);
    canvas.height = Math.ceil((bottom - top) * scale);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'معاينة موضع التوقيع في الصفحة ' + (index + 1));
    canvas.className = 'esign-result-preview';
    const context = canvas.getContext('2d');
    await page.render({
      canvas, canvasContext: context, viewport: page.getViewport({ scale }),
      transform: [1, 0, 0, 1, -left * scale, -top * scale]
    }).promise;
    if (session === esState && container.isConnected) container.prepend(canvas);
  } catch (error) {
    console.warn('Could not render generated signature preview:', error);
  } finally {
    if (task) await task.destroy().catch(error => console.warn(error));
  }
}

// SECTION 7: PDF Generation (pdf-lib)
async function generateFinalPdfBytes(type, state, signatureData, stampData) {
  const pdfDoc = await PDFLib.PDFDocument.load(state.convertedPdf ?? await state.file.arrayBuffer());
  const signature = await pdfDoc.embedPng(dataUrlToBytes(signatureData.dataUrl));
  const isContract = type === 'contract';
  const stamp = isContract ? await pdfDoc.embedPng(dataUrlToBytes(stampData.dataUrl)) : null;
  const pages = pdfDoc.getPages();
  if (pages.length !== state.viewports.length) throw new Error('PDF page count changed after preview');

  for (let index = isContract ? 0 : 1; index < pages.length; index++) {
    const viewport = state.viewports[index];
    const page = pages[index];
    const signatureRect = getOverlayState(type, 'signature', index, state);
    page.drawImage(signature, esPdfImagePlacement(viewport, signatureRect));

    if (stamp && index === pages.length - 1) {
      const stampRect = getOverlayState(type, 'stamp', index, state);
      page.drawImage(stamp, esPdfImagePlacement(viewport, stampRect));
    }
  }

  return pdfDoc.save();
}

function esPdfImagePlacement(viewport, overlay) {
  // The preview is y-down. Map the image's PDF-space origin and both basis vectors
  // through PDF.js so the crop origin, page rotation and UserUnit are preserved.
  const left = overlay.leftRatio * viewport.width;
  const top = overlay.topRatio * viewport.height;
  const right = left + overlay.widthRatio * viewport.width;
  const bottom = top + overlay.heightRatio * viewport.height;
  const [x, y] = viewport.convertToPdfPoint(left, bottom);
  const [rightX, rightY] = viewport.convertToPdfPoint(right, bottom);
  const [topX, topY] = viewport.convertToPdfPoint(left, top);

  return {
    x,
    y,
    width: Math.hypot(rightX - x, rightY - y),
    height: Math.hypot(topX - x, topY - y),
    rotate: PDFLib.radians(Math.atan2(rightY - y, rightX - x))
  };
}

// SECTION 8: Firebase Operations
function getCurrentUserInfo() {
  if (typeof currentUser !== 'undefined' && currentUser) {
    return {
      userId: currentUser.uid,
      userEmail: currentUser.email || 'غير معروف',
      userName: currentUser.displayName || currentUser.email || 'مستخدم غير معروف'
    };
  }
  return {
    userId: null,
    userEmail: 'anonymous@system.local',
    userName: 'مستخدم افتراضي'
  };
}

async function logSignatureOperation(payload, session) {
  if (typeof db === 'undefined' || !currentUser || esState !== session) return;
  const user = currentUser;

  try {
    const operation = db.ref(ES_PATHS.logs).push();
    const { claims } = await user.getIdTokenResult();
    if (esState !== session || currentUser?.uid !== user.uid) return;
    const userName = typeof claims.name === 'string' ? { userName: claims.name } : {};
    await operation.set({
      ...payload,
      ...userName,
      userId: user.uid,
      signedAt: firebase.database.ServerValue.TIMESTAMP
    });
  } catch (error) {
    if (esState !== session) return;
    console.warn('Could not save signature operation:', error);
    showToast('النسخة جاهزة للتنزيل. تعذر حفظ العملية في السجل.', 'warning');
  }
}

// SECTION 9: Logs Tab
let esLogsCache = [];

function loadSignatureLogs() {
  if (typeof db === 'undefined') return;
  const session = esState;

  const tbody = document.getElementById('esign-logs-tbody');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2rem 0;">
          <div class="pulse-loader" style="margin: 0 auto 0.5rem auto;"></div>
          <span>جاري تحميل سجل العمليات...</span>
        </td>
      </tr>
    `;
  }

  db.ref(ES_PATHS.logs).orderByChild('signedAt').limitToLast(100).once('value')
    .then((snapshot) => {
      if (esState !== session) return;
      const logs = [];
      snapshot.forEach((child) => {
        logs.push({
          id: child.key,
          ...child.val()
        });
      });

      logs.reverse();
      esLogsCache = logs;

      renderLogsTable(logs);
    })
    .catch((err) => {
      if (esState !== session) return;
      console.error(err);
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" style="text-align: center; color: #ef4444; padding: 2rem 0;">
              <span>فشل تحميل السجل. تأكد من صلاحيات Firebase.</span>
            </td>
          </tr>
        `;
      }
    });
}

function renderLogsTable(logs) {
  const tbody = document.getElementById('esign-logs-tbody');
  if (!tbody) return;

  if (logs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2rem 0;">
          لا توجد عمليات توقيع مسجلة حتى الآن.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  logs.forEach((log) => {
    const tr = document.createElement('tr');

    const tdDate = document.createElement('td');
    tdDate.textContent = formatArabicDate(log.signedAt);
    tr.appendChild(tdDate);

    const tdUser = document.createElement('td');
    tdUser.textContent = log.userName || log.userId || 'غير معروف';
    tr.appendChild(tdUser);

    const tdDocType = document.createElement('td');
    tdDocType.textContent = log.documentType === 'contract' ? 'عقد رسمي' : 'عرض فني';
    tr.appendChild(tdDocType);

    const tdFileName = document.createElement('td');
    tdFileName.style.direction = 'ltr';
    tdFileName.style.textAlign = 'right';
    tdFileName.textContent = log.originalFileName || '-';
    tr.appendChild(tdFileName);

    const tdPages = document.createElement('td');
    tdPages.textContent = log.pageCount ? `${log.pageCount} ص` : '-';
    tr.appendChild(tdPages);

    const tdStamp = document.createElement('td');
    tdStamp.textContent = log.stampApplied ? 'نعم' : 'لا';
    tr.appendChild(tdStamp);

    const tdStatus = document.createElement('td');
    const statusSpan = document.createElement('span');
    if (log.status === 'generated' || log.status === 'success') {
      statusSpan.textContent = log.status === 'generated' ? 'تم توليد نسخة' : 'ناجحة';
      statusSpan.style.color = 'var(--accent-teal)';
      statusSpan.style.fontWeight = 'bold';
    } else {
      statusSpan.textContent = 'فاشلة';
      statusSpan.style.color = '#ef4444';
      statusSpan.style.fontWeight = 'bold';
    }
    tdStatus.appendChild(statusSpan);
    tr.appendChild(tdStatus);

    tbody.appendChild(tr);
  });
}

function filterEsLogs(filterType, btn) {
  const parent = btn.parentElement;
  parent.querySelectorAll('.esign-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  if (filterType === 'all') {
    renderLogsTable(esLogsCache);
  } else {
    const filtered = esLogsCache.filter(log => log.documentType === filterType);
    renderLogsTable(filtered);
  }
}

// SECTION 10: Utility Functions
function dataUrlToBytes(dataUrl) {
  const parts = dataUrl.split(';base64,');
  const contentType = parts[0].split(':')[1];
  const raw = window.atob(parts[1]);
  const rawLength = raw.length;
  const uInt8Array = new Uint8Array(rawLength);
  for (let i = 0; i < rawLength; ++i) {
    uInt8Array[i] = raw.charCodeAt(i);
  }
  return uInt8Array;
}

function formatTimestamp(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}`;
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatArabicDate(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  return date.toLocaleString('ar-EG', {
    numberingSystem: 'latn',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}
