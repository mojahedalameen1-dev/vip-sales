/*
 * Electronic Signature Module - High Performance Lazy Rendering & Intelligent Detection
 * Built for CRM - RTL Arabic, Light/Dark theme compatible.
 */

// SECTION 1: Module State & Constants
const ES_PATHS = {
  settings: 'electronicSignature/settings/company',
  logs: 'electronicSignature/logs'
};

let esState = {
  // Global assets
  signatureData: null,
  stampData: null,
  
  // UI general states
  currentTab: 'sign',
  currentStep: 1,         // 1: Upload, 2: Preview & Align, 3: Success & Download
  activeOverlay: null,    // 'signature' | 'stamp' | null
  zoomLevel: 1.0,
  isProcessing: false,
  isInitialized: false,
  activePreviewSubTab: 'technical',
  reviewedFiles: { technicalOffer: false, contract: false },
  wizardStep: 1,
  
  // Independent File States
  technicalOffer: {
    file: null,
    pdfDocument: null,
    pageCount: 0,
    renderedPages: [], // [{renderedWidth, renderedHeight, pdfPageWidth, pdfPageHeight, pageNum, isRendered, canvas}]
    signatureOverlay: { leftRatio: 0, topRatio: 0, widthRatio: 0, heightRatio: 0 },
    pageSignatureOverlays: [], // [{leftRatio, topRatio, widthRatio, heightRatio} | null]
    processingStatus: 'empty',
    autoPlacementMethod: 'manual-fallback',
    autoPlacementSucceeded: false,
    errorMessage: ''
  },
  contract: {
    file: null,
    pdfDocument: null,
    pageCount: 0,
    renderedPages: [], // [{renderedWidth, renderedHeight, pdfPageWidth, pdfPageHeight, pageNum, isRendered, canvas}]
    signatureOverlay: { leftRatio: 0, topRatio: 0, widthRatio: 0, heightRatio: 0 },
    stampOverlay: { leftRatio: 0, topRatio: 0, widthRatio: 0, heightRatio: 0 },
    pageSignatureOverlays: [],
    pageStampOverlays: [],
    processingStatus: 'empty',
    autoPlacementMethod: 'manual-fallback',
    autoPlacementSucceeded: false,
    errorMessage: ''
  }
};

// Global observer reference
let esIntersectionObserver = null;

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
        <div class="table-responsive">
          <table class="esign-logs-table">
            <thead>
              <tr>
                <th>التاريخ والوقت</th>
                <th>المستخدم</th>
                <th>نوع المستند</th>
                <th>اسم الملف الأصلي</th>
                <th>الصفحات</th>
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
  }
}

// Lazy Load Tesseract Library
function loadTesseractLibrary() {
  return new Promise((resolve, reject) => {
    if (typeof Tesseract !== 'undefined') {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'assets/js/vendor/tesseract/tesseract.min.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('فشل تحميل مكتبة OCR المحلية Tesseract.js'));
    document.head.appendChild(script);
  });
}

// SECTION 3: Settings Tab
function loadSignatureSettings() {
  if (typeof db === 'undefined') return;
  
  db.ref(ES_PATHS.settings).once('value')
    .then((snapshot) => {
      const data = snapshot.val() || {};
      
      if (data.signature) {
        esState.signatureData = data.signature;
        updateAssetUI('signature', data.signature);
      } else {
        esState.signatureData = null;
        clearAssetUI('signature');
      }
      
      if (data.stamp) {
        esState.stampData = data.stamp;
        updateAssetUI('stamp', data.stamp);
      } else {
        esState.stampData = null;
        clearAssetUI('stamp');
      }
      
      updateGlobalStatusBadges();
    })
    .catch((err) => {
      console.error(err);
      showToast('خطأ في تحميل إعدادات التوقيع والختم من Firebase', 'error');
    });
}

function setupDragAndDropZones() {
  const setupZone = (zoneId, inputId, type) => {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    });
    
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('dragover');
    });
    
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const input = document.getElementById(inputId);
        if (input) {
          input.files = files;
          handleAssetUpload(input, type);
        }
      }
    });
  };
  
  setupZone('upload-zone-signature', 'file-input-signature', 'signature');
  setupZone('upload-zone-stamp', 'file-input-stamp', 'stamp');
}

function handleAssetUpload(input, type) {
  const file = input.files[0];
  if (!file) return;
  
  if (file.type !== 'image/png') {
    showToast('يجب اختيار ملف صورة بصيغة PNG فقط!', 'error');
    input.value = '';
    return;
  }
  
  showToast('جاري حفظ الصورة وصيغة الأبعاد المفرغة...', 'info');
  
  compressPngImage(file)
    .then((res) => {
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
        if (type === 'signature') {
          esState.signatureData = assetData;
        } else {
          esState.stampData = assetData;
        }
        updateAssetUI(type, assetData);
        updateGlobalStatusBadges();
        showToast('تم حفظ الصورة وتحديثها محلياً بنجاح.', 'success');
      });
    })
    .catch((err) => {
      console.error(err);
      showToast('خطأ أثناء معالجة وحفظ الصورة', 'error');
    })
    .finally(() => {
      input.value = '';
    });
}

function compressPngImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        let width = img.width;
        let height = img.height;
        
        const MAX_DIM = 800;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, width, height); // transparency
        ctx.drawImage(img, 0, 0, width, height);
        
        const compressedDataUrl = canvas.toDataURL('image/png');
        resolve({
          dataUrl: compressedDataUrl,
          width: width,
          height: height
        });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function deleteSignatureAsset(type) {
  if (!confirm(`هل أنت متأكد من حذف ${type === 'signature' ? 'توقيع المدير' : 'ختم الشركة'}؟`)) return;
  
  db.ref(`${ES_PATHS.settings}/${type}`).set(null)
    .then(() => {
      if (type === 'signature') {
        esState.signatureData = null;
      } else {
        esState.stampData = null;
      }
      clearAssetUI(type);
      updateGlobalStatusBadges();
      showToast('تم حذف الملف بنجاح.', 'success');
    })
    .catch((err) => {
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
function goToStep(step) {
  esState.currentStep = step;
  
  for (let i = 1; i <= 3; i++) {
    const item = document.getElementById(`step-i-${i}`);
    if (!item) continue;
    item.classList.remove('active', 'completed');
    if (i < step) {
      item.classList.add('completed');
    } else if (i === step) {
      item.classList.add('active');
    }
  }
  
  const prevBtn = document.getElementById('btn-prev-step');
  if (prevBtn) {
    prevBtn.style.visibility = (step > 1 && step < 3) ? 'visible' : 'hidden';
  }
  
  const resetBtn = document.getElementById('btn-reset-esign');
  if (resetBtn) {
    resetBtn.style.display = (step > 1) ? 'flex' : 'none';
  }
  
  const content = document.getElementById('step-content');
  if (!content) return;
  
  content.innerHTML = '';
  
  switch(step) {
    case 1:
      renderStep1(content);
      break;
    case 2:
      renderStep2(content);
      break;
    case 3:
      renderStep3(content);
      break;
  }
  
  checkStepValidity();
  
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

function nextStep() {
  const hasTech = esState.technicalOffer.file !== null;
  const hasContract = esState.contract.file !== null;
  
  if (esState.currentStep === 1) {
    if (hasTech && hasContract) {
      esState.wizardStep = 1;
      esState.reviewedFiles = { technicalOffer: false, contract: false };
    }
    goToStep(2);
  } else if (esState.currentStep === 2) {
    if (hasTech && hasContract) {
      if (esState.wizardStep === 1) {
        esState.reviewedFiles.technicalOffer = true;
        goToWizardSubStep(2);
      } else if (esState.wizardStep === 2) {
        esState.reviewedFiles.contract = true;
        goToStep(3);
      }
    } else {
      goToStep(3);
    }
  }
}

function prevStep() {
  const hasTech = esState.technicalOffer.file !== null;
  const hasContract = esState.contract.file !== null;
  
  if (esState.currentStep === 2) {
    if (hasTech && hasContract && esState.wizardStep === 2) {
      goToWizardSubStep(1);
    } else {
      if (esIntersectionObserver) {
        esIntersectionObserver.disconnect();
        esIntersectionObserver = null;
      }
      goToStep(1);
    }
  } else if (esState.currentStep === 3) {
    if (hasTech && hasContract) {
      goToStep(2);
      goToWizardSubStep(2);
    } else {
      goToStep(2);
    }
  }
}

function resetEsignFlow() {
  if (confirm('هل تريد إلغاء الملفات الحالية والبدء من جديد؟')) {
    if (esIntersectionObserver) {
      esIntersectionObserver.disconnect();
      esIntersectionObserver = null;
    }
    esState.technicalOffer = {
      file: null, pdfDocument: null, pageCount: 0, renderedPages: [],
      signatureOverlay: { leftRatio: 0, topRatio: 0, widthRatio: 0, heightRatio: 0 },
      pageSignatureOverlays: [],
      processingStatus: 'empty', autoPlacementMethod: 'manual-fallback', autoPlacementSucceeded: false, errorMessage: ''
    };
    esState.contract = {
      file: null, pdfDocument: null, pageCount: 0, renderedPages: [],
      signatureOverlay: { leftRatio: 0, topRatio: 0, widthRatio: 0, heightRatio: 0 },
      stampOverlay: { leftRatio: 0, topRatio: 0, widthRatio: 0, heightRatio: 0 },
      pageSignatureOverlays: [],
      pageStampOverlays: [],
      processingStatus: 'empty', autoPlacementMethod: 'manual-fallback', autoPlacementSucceeded: false, errorMessage: ''
    };
    esState.reviewedFiles = { technicalOffer: false, contract: false };
    esState.wizardStep = 1;
    esState.currentStep = 1;
    goToStep(1);
  }
}

function checkStepValidity() {
  const nextBtn = document.getElementById('btn-next-step');
  if (!nextBtn) return;
  
  let valid = false;
  
  if (esState.currentStep === 1) {
    valid = (esState.technicalOffer.file !== null || esState.contract.file !== null);
  } else if (esState.currentStep === 2) {
    if (!esState.signatureData) {
      valid = false;
    } else {
      const techOk = esState.technicalOffer.file ? (esState.technicalOffer.pageCount > 0) : true;
      const contractOk = esState.contract.file ? (esState.contract.pageCount > 0 && esState.stampData) : true;
      valid = techOk && contractOk;
    }
  }
  
  nextBtn.disabled = !valid;
}

// STEP 1: Dual Upload zone
function renderStep1(container) {
  container.innerHTML = `
    <div style="text-align: center; margin-bottom: 1.5rem;">
      <h3 style="margin: 0; font-size: 1.25rem;">ارفع المستندات المطلوب توقيعها</h3>
      <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); font-size: 0.9rem;">يمكنك رفع العرض الفني فقط، أو العقد فقط، أو الملفين معاً.</p>
    </div>
    
    <div class="upload-grid-container">
      <div class="document-file-card" id="card-upload-technical">
        <h4 style="margin: 0; display: flex; align-items: center; gap: 0.5rem;">
          <i data-lucide="file-text" style="color: var(--accent-blue);"></i>
          <span>العرض الفني (Technical Offer)</span>
        </h4>
        <p style="margin: 0; font-size: 0.8rem; color: var(--text-muted);">* سيتم تجاهل الصفحة الأولى تلقائياً، والتوقيع يبدأ من الصفحة الثانية لنهاية الملف.</p>
        
        <div class="upload-zone" id="zone-technical" onclick="document.getElementById('input-technical').click()">
          <i data-lucide="file-up" style="width: 32px; height: 32px;"></i>
          <p>اسحب ملف العرض الفني هنا أو انقر للاختيار</p>
          <span>PDF فقط</span>
          <input type="file" id="input-technical" accept="application/pdf" style="display:none" onchange="handleDocumentUpload(this, 'technicalOffer')">
        </div>
        
        <div id="details-technical" style="display: none; background-color: var(--bg-subtle); padding: 0.75rem; border-radius: 8px; font-size: 0.85rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
            <span id="name-technical" style="direction: ltr; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; font-weight: bold;">-</span>
            <button class="btn-es btn-es-danger" style="padding: 4px 8px; font-size: 0.75rem;" onclick="clearUploadedDocument('technicalOffer')">حذف</button>
          </div>
        </div>
      </div>
      
      <div class="document-file-card" id="card-upload-contract">
        <h4 style="margin: 0; display: flex; align-items: center; gap: 0.5rem;">
          <i data-lucide="file-check-2" style="color: var(--accent-teal);"></i>
          <span>عقد رسمي (Contract)</span>
        </h4>
        <p style="margin: 0; font-size: 0.8rem; color: var(--text-muted);">* يتم توقيع كافة الصفحات، مع وضع الختم الرسمي على الصفحة الأخيرة فقط.</p>
        
        <div class="upload-zone" id="zone-contract" onclick="document.getElementById('input-contract').click()">
          <i data-lucide="file-up" style="width: 32px; height: 32px;"></i>
          <p>اسحب ملف العقد هنا أو انقر للاختيار</p>
          <span>PDF فقط</span>
          <input type="file" id="input-contract" accept="application/pdf" style="display:none" onchange="handleDocumentUpload(this, 'contract')">
        </div>
        
        <div id="details-contract" style="display: none; background-color: var(--bg-subtle); padding: 0.75rem; border-radius: 8px; font-size: 0.85rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
            <span id="name-contract" style="direction: ltr; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; font-weight: bold;">-</span>
            <button class="btn-es btn-es-danger" style="padding: 4px 8px; font-size: 0.75rem;" onclick="clearUploadedDocument('contract')">حذف</button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  if (esState.technicalOffer.file) {
    showUploadedDetails('technicalOffer', esState.technicalOffer.file.name);
  }
  if (esState.contract.file) {
    showUploadedDetails('contract', esState.contract.file.name);
  }
}

function handleDocumentUpload(input, type) {
  const file = input.files[0];
  if (!file) return;
  
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    showToast('يجب اختيار ملف PDF فقط!', 'error');
    input.value = '';
    return;
  }
  
  // Document type name mismatch check
  const fileNameLower = file.name.toLowerCase();
  const contractKeywords = ['عقد', 'اتفاقية', 'اتفاقيه', 'عقود', 'contract', 'agreement'];
  const techKeywords = ['عرض', 'فني', 'سعر', 'اسعار', 'أسعار', 'technical', 'offer', 'proposal', 'quotation'];
  
  if (type === 'technicalOffer') {
    const hasContractKeyword = contractKeywords.some(k => fileNameLower.includes(k));
    if (hasContractKeyword) {
      showToast('تنبيه: يبدو أن هذا الملف هو (عقد) ولكنك تقوم برفعه في خانة (العرض الفني). يرجى التأكد من صحة الملف.', 'warning');
    }
  } else if (type === 'contract') {
    const hasTechKeyword = techKeywords.some(k => fileNameLower.includes(k));
    if (hasTechKeyword) {
      showToast('تنبيه: يبدو أن هذا الملف هو (عرض فني/سعر) ولكنك تقوم برفعه في خانة (العقد). يرجى التأكد من صحة الملف.', 'warning');
    }
  }
  
  esState[type].file = file;
  esState[type].processingStatus = 'loading';
  showUploadedDetails(type, file.name);
  checkStepValidity();
}

function showUploadedDetails(type, filename) {
  const isTech = type === 'technicalOffer';
  const prefix = isTech ? 'technical' : 'contract';
  const card = document.getElementById(`card-upload-${prefix}`);
  const zone = document.getElementById(`zone-${prefix}`);
  const details = document.getElementById(`details-${prefix}`);
  const nameSpan = document.getElementById(`name-${prefix}`);
  
  if (card) card.classList.add('has-file');
  if (zone) zone.style.display = 'none';
  if (details) details.style.display = 'block';
  if (nameSpan) nameSpan.textContent = filename;
}

function clearUploadedDocument(type) {
  const isTech = type === 'technicalOffer';
  const prefix = isTech ? 'technical' : 'contract';
  
  esState[type] = {
    file: null, pdfDocument: null, pageCount: 0, renderedPages: [],
    signatureOverlay: { leftRatio: 0, topRatio: 0, widthRatio: 0, heightRatio: 0 },
    stampOverlay: isTech ? undefined : { leftRatio: 0, topRatio: 0, widthRatio: 0, heightRatio: 0 },
    processingStatus: 'empty', autoPlacementMethod: 'manual-fallback', autoPlacementSucceeded: false, errorMessage: ''
  };
  
  const card = document.getElementById(`card-upload-${prefix}`);
  const zone = document.getElementById(`zone-${prefix}`);
  const details = document.getElementById(`details-${prefix}`);
  
  if (card) card.classList.remove('has-file');
  if (zone) zone.style.display = 'flex';
  if (details) details.style.display = 'none';
  
  const fileInput = document.getElementById(`input-${prefix}`);
  if (fileInput) fileInput.value = '';
  
  checkStepValidity();
}

// STEP 2: Preview & Alignment (High Performance Lazy Rendering)
function renderStep2(container) {
  const hasTech = esState.technicalOffer.file !== null;
  const hasContract = esState.contract.file !== null;
  
  if (hasTech) {
    esState.activePreviewSubTab = 'technical';
  } else {
    esState.activePreviewSubTab = 'contract';
  }
  
  let tabsHtml = '';
  if (hasTech && hasContract) {
    tabsHtml = `
      <div class="es-wizard-stepper">
        <div class="es-wizard-step active" id="wizard-step-technical" onclick="goToWizardSubStep(1)">
          <div class="es-wizard-icon">1</div>
          <div class="es-wizard-text">
            <span class="es-wizard-title">العرض الفني</span>
            <span class="es-wizard-status" id="wizard-status-technical">بانتظار المراجعة</span>
          </div>
        </div>
        <div class="es-wizard-line"></div>
        <div class="es-wizard-step" id="wizard-step-contract" onclick="goToWizardSubStep(2)">
          <div class="es-wizard-icon">2</div>
          <div class="es-wizard-text">
            <span class="es-wizard-title">العقد الرسمي</span>
            <span class="es-wizard-status" id="wizard-status-contract">بانتظار المراجعة</span>
          </div>
        </div>
        <div class="es-wizard-line"></div>
        <div class="es-wizard-step" id="wizard-step-final" onclick="goToWizardSubStep(3)">
          <div class="es-wizard-icon">3</div>
          <div class="es-wizard-text">
            <span class="es-wizard-title">المراجعة والتحميل</span>
            <span class="es-wizard-status">جاهز للتوقيع</span>
          </div>
        </div>
      </div>
    `;
  }
  
  let ocrBtnHtml = '';
  if (hasContract) {
    ocrBtnHtml = `
      <button class="btn-es btn-es-secondary" id="btn-run-ocr-visual" onclick="triggerOcrAutoPlacement()">
        <i data-lucide="scan-eye" style="width: 16px; height: 16px;"></i>
        <span>البحث البصري الذكي (OCR)</span>
      </button>
    `;
  }
  
  container.innerHTML = `
    <div style="text-align: center; margin-bottom: 1rem;">
      <h3 style="margin: 0; font-size: 1.25rem;">حدد الموضع والتوزيع على صفحات المستند</h3>
      <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); font-size: 0.9rem;">اسحب التوقيع أو الختم وضعهما في المكان المطلوب. التغييرات تطبق تلقائياً على كل الصفحات المقترنة.</p>
    </div>

    ${tabsHtml}
    
    <div class="pdf-preview-layout">
      <div class="pdf-toolbar">
        <div class="toolbar-group">
          <button class="btn-es btn-es-secondary" onclick="adjustEsZoom(-0.1)">
            <i data-lucide="zoom-out" style="width: 16px; height: 16px;"></i>
          </button>
          <span id="zoom-value" style="font-size: 0.9rem; min-width: 45px; text-align: center;">100%</span>
          <button class="btn-es btn-es-secondary" onclick="adjustEsZoom(0.1)">
            <i data-lucide="zoom-in" style="width: 16px; height: 16px;"></i>
          </button>
        </div>
        
        <div class="toolbar-group" style="gap: 0.5rem;">
          ${ocrBtnHtml}
          <button class="btn-es btn-es-secondary" onclick="resetActiveOverlays()">
            <i data-lucide="refresh-cw" style="width: 16px; height: 16px;"></i>
            <span>إعادة تعيين المواضع</span>
          </button>
        </div>
      </div>
      
      <!-- Preview Workspace Areas -->
      <div class="pdf-workspace" id="pdf-workspace-area">
        <div id="pdf-loading-spinner" style="display: flex; flex-direction: column; align-items: center; gap: 1rem; margin: 3rem 0;">
          <div class="pulse-loader"></div>
          <span id="pdf-loading-text" style="font-size: 0.9rem; color: var(--text-secondary);">جاري تهيئة وتحليل المستندات...</span>
        </div>
        
        <div id="workspace-technical" style="display: none; width: 100%;"></div>
        <div id="workspace-contract" style="display: none; width: 100%;"></div>
      </div>
    </div>
  `;
  
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
  
  processStep2Files();
}

function switchPreviewSubTab(subTab) {
  esState.activePreviewSubTab = subTab;
  
  const techWorkspace = document.getElementById('workspace-technical');
  const contractWorkspace = document.getElementById('workspace-contract');
  const ocrBtn = document.getElementById('btn-run-ocr-visual');
  
  if (subTab === 'technical') {
    if (techWorkspace) techWorkspace.style.display = 'block';
    if (contractWorkspace) contractWorkspace.style.display = 'none';
    if (ocrBtn) ocrBtn.style.display = 'none';
    _reObserveUnrenderedPages('technicalOffer');
  } else {
    if (techWorkspace) techWorkspace.style.display = 'none';
    if (contractWorkspace) contractWorkspace.style.display = 'block';
    if (ocrBtn) ocrBtn.style.display = 'inline-flex';
    _reObserveUnrenderedPages('contract');
  }
}

function goToWizardSubStep(stepNum) {
  const hasTech = esState.technicalOffer.file !== null;
  const hasContract = esState.contract.file !== null;
  if (!hasTech || !hasContract) return;
  
  // Warn if leaving unreviewed files
  if (esState.wizardStep === 1 && stepNum > 1 && !esState.reviewedFiles.technicalOffer) {
    if (!confirm('تنبيه: لم تقم بإنهاء مراجعة العرض الفني وتحديد مواضع التوقيع. هل تريد الانتقال على أي حال؟')) {
      return;
    }
  }
  if (esState.wizardStep === 2 && stepNum === 3 && !esState.reviewedFiles.contract) {
    if (!confirm('تنبيه: لم تقم بإنهاء مراجعة العقد والختم. هل تريد الانتقال على أي حال؟')) {
      return;
    }
  }
  
  // Set reviewed state
  if (esState.wizardStep === 1) esState.reviewedFiles.technicalOffer = true;
  if (esState.wizardStep === 2) esState.reviewedFiles.contract = true;
  
  esState.wizardStep = stepNum;
  
  updateWizardStepperUI();
  
  if (stepNum === 1) {
    switchPreviewSubTab('technical');
  } else if (stepNum === 2) {
    switchPreviewSubTab('contract');
  } else if (stepNum === 3) {
    goToStep(3);
  }
}

function updateWizardStepperUI() {
  const stepTech = document.getElementById('wizard-step-technical');
  const stepContract = document.getElementById('wizard-step-contract');
  const stepFinal = document.getElementById('wizard-step-final');
  
  if (!stepTech || !stepContract || !stepFinal) return;
  
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
    stepTech.classList.add('active');
  } else if (esState.wizardStep === 2) {
    stepTech.classList.add('completed');
    stepContract.classList.add('active');
  } else if (esState.wizardStep === 3) {
    stepTech.classList.add('completed');
    stepContract.classList.add('completed');
    stepFinal.classList.add('active');
  }
  
  // Modify Next button label to guide user
  const nextBtn = document.getElementById('btn-next-step');
  if (nextBtn) {
    if (esState.wizardStep === 1) {
      nextBtn.innerHTML = '<span>التالي — مراجعة العقد</span><i data-lucide="arrow-left"></i>';
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
  if (!esIntersectionObserver) return;
  // Small delay lets browser complete layout before observer checks intersection
  setTimeout(() => {
    const state = esState[type];
    if (!state || !state.renderedPages) return;
    state.renderedPages.forEach((pd, idx) => {
      if (pd.isRendered) return;
      const el = document.getElementById(`page-wrapper-${type}-${idx}`);
      if (el) {
        try { esIntersectionObserver.observe(el); } catch(e) {/* already observed */}
      }
    });
  }, 60);
}

async function processStep2Files() {
  const spinner = document.getElementById('pdf-loading-spinner');
  const spinnerTxt = document.getElementById('pdf-loading-text');
  
  // Setup intersection observer for lazy rendering
  setupIntersectionObserver();
  
  try {
    if (esState.technicalOffer.file) {
      if (spinnerTxt) spinnerTxt.textContent = 'جاري قراءة ملف العرض الفني...';
      await parsePdfMetadataOnly('technicalOffer', 'workspace-technical');
    }
    
    if (esState.contract.file) {
      if (spinnerTxt) spinnerTxt.textContent = 'جاري البحث التلقائي عن خانة التوقيع في العقد...';
      await parsePdfMetadataOnly('contract', 'workspace-contract');
    }
    
    switchPreviewSubTab(esState.activePreviewSubTab);
    checkStepValidity();
  } catch (err) {
    console.error(err);
    showToast(err.message || 'حدث خطأ في قراءة ملفات الـ PDF', 'error');
  } finally {
    if (spinner) spinner.style.display = 'none';
  }
}

// Quick metadata parse without rendering all pages
async function parsePdfMetadataOnly(type, workspaceId) {
  const state = esState[type];
  const container = document.getElementById(workspaceId);
  if (!container) return;
  
  container.innerHTML = '';
  
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/js/vendor/pdf.worker.min.js';
  
  const arrayBuffer = await state.file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
  
  state.pdfDocument = pdf;
  state.pageCount = pdf.numPages;
  state.renderedPages = [];
  state.pageSignatureOverlays = new Array(pdf.numPages).fill(null);
  state.pageStampOverlays = new Array(pdf.numPages).fill(null);
  
  if (type === 'technicalOffer' && pdf.numPages === 1) {
    const errorDiv = document.createElement('div');
    errorDiv.style.color = '#ef4444';
    errorDiv.style.backgroundColor = 'rgba(239, 68, 68, 0.05)';
    errorDiv.style.border = '1px solid #ef4444';
    errorDiv.style.borderRadius = '8px';
    errorDiv.style.padding = '1rem';
    errorDiv.style.marginBottom = '1rem';
    errorDiv.style.textAlign = 'center';
    errorDiv.style.fontWeight = 'bold';
    errorDiv.textContent = 'تنبيه: العرض الفني يحتوي على صفحة واحدة فقط، وبحسب إعداد النظام يتم تجاهل الصفحة الأولى (لن يتم تطبيق التوقيع على المستند)';
    container.appendChild(errorDiv);
  }
  
  // Quick fetch sizes for placeholders with precise A4 sizing and centering
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const pageViewport = page.getPageViewport ? page.getPageViewport({ scale: 1.0 }) : page.getViewport({ scale: 1.0 });
    const aspect = pageViewport.width / pageViewport.height;
    
    // Natural A4 width on screen (800px at 100% zoom)
    const baseDisplayWidth = 800;
    const renderedWidth = baseDisplayWidth * esState.zoomLevel;
    const renderedHeight = renderedWidth / aspect;
    
    state.renderedPages.push({
      renderedWidth: renderedWidth,
      renderedHeight: renderedHeight,
      pdfPageWidth: pageViewport.width,
      pdfPageHeight: pageViewport.height,
      pageNum: pageNum,
      isRendered: false,
      canvas: null
    });
  }
  
  // Fast signature detection in last page of contract using Text Layer only (NO heavy OCR on load)
  if (type === 'contract') {
    await runTextLayerPlacementOnly();
  } else {
    initializeDefaultOverlayRatios(type);
  }
  
  // Build DOM placeholders for Lazy Rendering
  buildPlaceholderViews(type, container);
}

function buildPlaceholderViews(type, container) {
  const state  = esState[type];
  
  state.renderedPages.forEach((pageData, index) => {
    const wrapper = document.createElement('div');
    wrapper.className          = 'page-wrapper';
    wrapper.id                 = `page-wrapper-${type}-${index}`;
    // Store data attributes for reliable retrieval in the observer callback
    wrapper.dataset.esType     = type;
    wrapper.dataset.esIndex    = String(index);
    wrapper.style.position     = 'relative';
    wrapper.style.marginBottom = '20px';
    wrapper.style.width        = `${pageData.renderedWidth}px`;
    wrapper.style.height       = `${pageData.renderedHeight}px`;
    wrapper.style.backgroundColor = 'white';
    
    const skeleton = document.createElement('div');
    skeleton.style.width   = '100%';
    skeleton.style.height  = '100%';
    skeleton.className     = 'pulse-loader';
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
  
  esIntersectionObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const el = entry.target;
        // Read type and index from data attributes (more reliable than ID parsing)
        const type  = el.dataset.esType;
        const index = parseInt(el.dataset.esIndex);
        if (!type || isNaN(index)) return;
        esIntersectionObserver.unobserve(el);
        lazyRenderPageCanvas(type, index);
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
  if (!pageData || pageData.isRendered) return;
  
  const wrapper = document.getElementById(`page-wrapper-${type}-${index}`);
  if (!wrapper) return;
  
  try {
    const page = await state.pdfDocument.getPage(pageData.pageNum);
    
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
    
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    
    pageData.canvas = canvas;
    pageData.isRendered = true;
    
    // Remove skeleton loader
    wrapper.innerHTML = '';
    wrapper.appendChild(canvas);
    
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
    if (esState.signatureData) {
      const sigOverlay = createEsOverlayElement('signature', index, pageData.renderedWidth, pageData.renderedHeight, type);
      wrapper.appendChild(sigOverlay);
    }
    
    if (!isTech && esState.stampData && index === lastIndex) {
      const stampOverlay = createEsOverlayElement('stamp', index, pageData.renderedWidth, pageData.renderedHeight, type);
      wrapper.appendChild(stampOverlay);
    }
    
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  } catch(err) {
    console.error(err);
  }
}

// Pure text layer positioning on load
async function runTextLayerPlacementOnly() {
  const contractState = esState.contract;
  const lastPageNum = contractState.pageCount;
  const page = await contractState.pdfDocument.getPage(lastPageNum);
  
  const textContent = await page.getTextContent();
  const keywords = ['توقيع', 'التوقيع', 'signature', 'authorized signature'];
  let foundItem = null;
  
  for (const item of textContent.items) {
    const text = item.str.toLowerCase();
    const matched = keywords.some(k => text.includes(k));
    if (matched) {
      foundItem = item;
      break;
    }
  }
  
  const pageViewport = page.getViewport({ scale: 1.0 });
  const pdfW = pageViewport.width;
  const pdfH = pageViewport.height;
  
  const sigW = Math.min(esState.signatureData ? esState.signatureData.width * 0.4 : 100, pdfW * 0.25);
  const sigH = sigW * (esState.signatureData ? (esState.signatureData.height / esState.signatureData.width) : 0.5);
  
  if (foundItem) {
    const pdfX = foundItem.transform[4];
    const pdfY = foundItem.transform[5];
    
    let targetLeft = pdfX - sigW - 10;
    if (targetLeft < 0) targetLeft = pdfX + foundItem.width + 10;
    let targetTop = pdfH - pdfY - sigH; // Y-flip
    
    targetLeft = Math.max(0, Math.min(targetLeft, pdfW - sigW));
    targetTop = Math.max(0, Math.min(targetTop, pdfH - sigH));
    
    contractState.signatureOverlay = {
      leftRatio: targetLeft / pdfW,
      topRatio: targetTop / pdfH,
      widthRatio: sigW / pdfW,
      heightRatio: sigH / pdfH
    };
    
    const stampW = Math.min(esState.stampData ? esState.stampData.width * 0.45 : 120, pdfW * 0.28);
    const stampH = stampW * (esState.stampData ? (esState.stampData.height / esState.stampData.width) : 0.5);
    let stampLeft = targetLeft - stampW - 10;
    if (stampLeft < 0) stampLeft = targetLeft + sigW + 10;
    let stampTop = targetTop - 15;
    
    stampLeft = Math.max(0, Math.min(stampLeft, pdfW - stampW));
    stampTop = Math.max(0, Math.min(stampTop, pdfH - stampH));
    
    contractState.stampOverlay = {
      leftRatio: stampLeft / pdfW,
      topRatio: stampTop / pdfH,
      widthRatio: stampW / pdfW,
      heightRatio: stampH / pdfH
    };
    
    contractState.autoPlacementMethod = 'text-layer';
    contractState.autoPlacementSucceeded = true;
    showToast('تم كشف خانة التوقيع تلقائياً عبر طبقة نصوص العقد.', 'success');
  } else {
    // If not found in Text Layer, immediately fall back to bottom-right position (DO NOT run OCR on load)
    initializeDefaultOverlayRatios('contract');
    contractState.autoPlacementMethod = 'manual-fallback';
    contractState.autoPlacementSucceeded = false;
  }
}

// User-triggered local OCR placement
async function triggerOcrAutoPlacement() {
  const contractState = esState.contract;
  if (!contractState.file) return;
  
  const ocrBtn = document.getElementById('btn-run-ocr-visual');
  const originalHtml = ocrBtn ? ocrBtn.innerHTML : '';
  if (ocrBtn) {
    ocrBtn.disabled = true;
    ocrBtn.innerHTML = '<i class="pulse-loader" style="width:10px; height:10px; margin:0;"></i> <span>جاري البحث البصري (OCR)...</span>';
  }
  
  try {
    await loadTesseractLibrary();
    
    const lastPageNum = contractState.pageCount;
    // We render the last page to a high-res temporary canvas for Tesseract OCR
    const page = await contractState.pdfDocument.getPage(lastPageNum);
    const viewport = page.getViewport({ scale: 2.0 }); // High scale for better OCR accuracy
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = viewport.width;
    tempCanvas.height = viewport.height;
    const ctx = tempCanvas.getContext('2d');
    
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    
    const ocrPromise = runTesseractOcr(tempCanvas);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('timeout')), 15000)
    );
    
    const ocrRes = await Promise.race([ocrPromise, timeoutPromise]);
    
    const pageViewport = page.getViewport({ scale: 1.0 });
    const pdfW = pageViewport.width;
    const pdfH = pageViewport.height;
    const sigW = Math.min(esState.signatureData ? esState.signatureData.width * 0.4 : 100, pdfW * 0.25);
    const sigH = sigW * (esState.signatureData ? (esState.signatureData.height / esState.signatureData.width) : 0.5);
    
    if (ocrRes && ocrRes.found) {
      const canvasW = tempCanvas.width;
      const canvasH = tempCanvas.height;
      
      let ocrLeft = (ocrRes.bbox.x0 / canvasW) * pdfW - sigW - 10;
      if (ocrLeft < 0) ocrLeft = (ocrRes.bbox.x1 / canvasW) * pdfW + 10;
      let ocrTop = (ocrRes.bbox.y0 / canvasH) * pdfH - sigH;
      
      ocrLeft = Math.max(0, Math.min(ocrLeft, pdfW - sigW));
      ocrTop = Math.max(0, Math.min(ocrTop, pdfH - sigH));
      
      contractState.signatureOverlay = {
        leftRatio: ocrLeft / pdfW,
        topRatio: ocrTop / pdfH,
        widthRatio: sigW / pdfW,
        heightRatio: sigH / pdfH
      };
      
      const stampW = Math.min(esState.stampData ? esState.stampData.width * 0.45 : 120, pdfW * 0.28);
      const stampH = stampW * (esState.stampData ? (esState.stampData.height / esState.stampData.width) : 0.5);
      let stampLeft = ocrLeft - stampW - 10;
      if (stampLeft < 0) stampLeft = ocrLeft + sigW + 10;
      let stampTop = ocrTop - 15;
      
      stampLeft = Math.max(0, Math.min(stampLeft, pdfW - stampW));
      stampTop = Math.max(0, Math.min(stampTop, pdfH - stampH));
      
      contractState.stampOverlay = {
        leftRatio: stampLeft / pdfW,
        topRatio: stampTop / pdfH,
        widthRatio: stampW / pdfW,
        heightRatio: stampH / pdfH
      };
      
      contractState.autoPlacementMethod = 'ocr';
      contractState.autoPlacementSucceeded = true;
      
      // Update UI
      resetOverlaysToDefaults(); // forces redraw based on new state ratios
      showToast('تم كشف وتعديل موضع التوقيع والختم تلقائياً بصرياً (OCR).', 'success');
    } else {
      showToast('تعذر كشف أي خانة توقيع بصرياً. يرجى تحديد الموضع يدوياً.', 'warning');
    }
  } catch(err) {
    console.error(err);
    showToast('فشل البحث البصري أو انتهت المهلة المحددة.', 'warning');
  } finally {
    if (ocrBtn) {
      ocrBtn.disabled = false;
      ocrBtn.innerHTML = originalHtml;
    }
  }
}

function runTesseractOcr(canvas) {
  return new Promise(async (resolve, reject) => {
    try {
      const worker = await Tesseract.createWorker('ara+eng', 1, {
        workerPath: 'assets/js/vendor/tesseract/worker.min.js',
        corePath: 'assets/js/vendor/tesseract/tesseract-core-simd.wasm.js',
        langPath: 'assets/js/vendor/tesseract'
      });
      
      const result = await worker.recognize(canvas);
      const words = result.data.words;
      await worker.terminate();
      
      const keywords = ['توقيع', 'التوقيع', 'signature', 'authorized signature'];
      for (const word of words) {
        const matched = keywords.some(k => word.text.toLowerCase().includes(k));
        if (matched) {
          resolve({ found: true, bbox: word.bbox });
          return;
        }
      }
      resolve({ found: false });
    } catch(err) {
      reject(err);
    }
  });
}

function initializeDefaultOverlayRatios(type) {
  const state = esState[type];
  const firstPage = state.renderedPages[0];
  if (!firstPage) return;
  
  const isTech = type === 'technicalOffer';
  
  if (esState.signatureData && state.signatureOverlay.widthRatio === 0) {
    const originalWidth = esState.signatureData.width;
    const originalHeight = esState.signatureData.height;
    
    const targetWidth = Math.min(originalWidth * 0.4, firstPage.renderedWidth * 0.25);
    const targetHeight = targetWidth * (originalHeight / originalWidth);
    
    const marginX = firstPage.renderedWidth * 0.05;
    const marginY = firstPage.renderedHeight * 0.05;
    
    const left = firstPage.renderedWidth - targetWidth - marginX;
    const top = firstPage.renderedHeight - targetHeight - marginY;
    
    state.signatureOverlay = {
      leftRatio: left / firstPage.renderedWidth,
      topRatio: top / firstPage.renderedHeight,
      widthRatio: targetWidth / firstPage.renderedWidth,
      heightRatio: targetHeight / firstPage.renderedHeight
    };
  }
  
  if (!isTech && esState.stampData && state.stampOverlay.widthRatio === 0) {
    const originalWidth = esState.stampData.width;
    const originalHeight = esState.stampData.height;
    
    const targetWidth = Math.min(originalWidth * 0.45, firstPage.renderedWidth * 0.28);
    const targetHeight = targetWidth * (originalHeight / originalWidth);
    
    const marginX = firstPage.renderedWidth * 0.05;
    const sigHeight = state.signatureOverlay.heightRatio * firstPage.renderedHeight;
    const marginY = firstPage.renderedHeight * 0.05 + sigHeight + 10;
    
    const left = firstPage.renderedWidth - targetWidth - marginX;
    const top = firstPage.renderedHeight - targetHeight - marginY;
    
    state.stampOverlay = {
      leftRatio: left / firstPage.renderedWidth,
      topRatio: top / firstPage.renderedHeight,
      widthRatio: targetWidth / firstPage.renderedWidth,
      heightRatio: targetHeight / firstPage.renderedHeight
    };
  }
}

function getOverlayState(docType, overlayType, pageIndex) {
  const state = esState[docType];
  const overlaysArray = overlayType === 'signature' ? state.pageSignatureOverlays : state.pageStampOverlays;
  if (overlaysArray && overlaysArray[pageIndex]) {
    return overlaysArray[pageIndex];
  }
  return overlayType === 'signature' ? state.signatureOverlay : state.stampOverlay;
}

function createEsOverlayElement(overlayType, pageIndex, renderedWidth, renderedHeight, docType) {
  const state = esState[docType];
  const overlayState = getOverlayState(docType, overlayType, pageIndex);
  const assetData = overlayType === 'signature' ? esState.signatureData : esState.stampData;
  
  const el = document.createElement('div');
  el.className = `overlay-element ${overlayType}-element`;
  el.id = `overlay-${docType}-${overlayType}-page-${pageIndex}`;
  el.dataset.type = overlayType;
  el.dataset.docType = docType;
  el.dataset.pageIndex = pageIndex;
  
  const badge = document.createElement('div');
  badge.className = 'overlay-badge';
  
  const isCustom = (overlayType === 'signature' ? state.pageSignatureOverlays?.[pageIndex] : state.pageStampOverlays?.[pageIndex]) !== null;
  badge.textContent = `${overlayType === 'signature' ? 'توقيع المدير' : 'ختم الشركة'} - ${isCustom ? 'تعديل خاص' : 'افتراضي'}`;
  el.appendChild(badge);
  
  const img = document.createElement('img');
  img.src = assetData.dataUrl;
  img.className = 'overlay-img';
  el.appendChild(img);
  
  const corners = ['nw', 'ne', 'se', 'sw'];
  corners.forEach(c => {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-handle-${c}`;
    el.appendChild(handle);
    initPointerResize(handle, el, c, overlayType, docType);
  });
  
  updateOverlayUI(el, overlayState, renderedWidth, renderedHeight);
  initPointerDrag(el, overlayType, docType);
  
  return el;
}

function updateOverlayUI(element, state, w, h) {
  element.style.left = `${state.leftRatio * w}px`;
  element.style.top = `${state.topRatio * h}px`;
  element.style.width = `${state.widthRatio * w}px`;
  element.style.height = `${state.heightRatio * h}px`;
}

function initPointerDrag(element, overlayType, docType) {
  element.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('resize-handle')) return;
    
    e.preventDefault();
    
    document.querySelectorAll('.overlay-element').forEach(o => o.classList.remove('selected'));
    element.classList.add('selected');
    
    removeFloatingMenus();
    
    esState.activeOverlay = overlayType;
    
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
    
    element.setPointerCapture(e.pointerId);
    
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
      
      updateOverlayUI(element, targetOverlaysArray[pageIndex], renderedWidth, renderedHeight);
    };
    
    const onPointerUp = (upEvent) => {
      element.releasePointerCapture(upEvent.pointerId);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      
      showFloatingMenu(element, overlayType, docType, pageIndex);
    };
    
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
  });
}

function initPointerResize(handle, element, direction, overlayType, docType) {
  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    
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
    
    handle.setPointerCapture(e.pointerId);
    
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
      
      updateOverlayUI(element, targetOverlaysArray[pageIndex], renderedWidth, renderedHeight);
    };
    
    const onPointerUp = (upEvent) => {
      handle.releasePointerCapture(upEvent.pointerId);
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      
      showFloatingMenu(element, overlayType, docType, pageIndex);
    };
    
    element.classList.add('selected');
    esState.activeOverlay = overlayType;
    
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
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
  
  const btnApplyNext = document.createElement('button');
  btnApplyNext.className = 'es-menu-item';
  btnApplyNext.innerHTML = '<i data-lucide="chevrons-down"></i><span>تطبيق الموضع على الصفحات التالية</span>';
  btnApplyNext.onclick = () => applyPositionToSubsequent(docType, overlayType, pageIndex);
  
  const btnReset = document.createElement('button');
  btnReset.className = 'es-menu-item es-menu-item-danger';
  btnReset.innerHTML = '<i data-lucide="rotate-ccw"></i><span>إعادة هذه الصفحة للوضع الافتراضي</span>';
  btnReset.onclick = () => resetPageToDefault(docType, overlayType, pageIndex);
  
  menu.appendChild(btnApplyAll);
  menu.appendChild(btnApplyNext);
  menu.appendChild(btnReset);
  
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
    const pageData = state.renderedPages[pageIndex];
    updateOverlayUI(el, defaultState, pageData.renderedWidth, pageData.renderedHeight);
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
  
  state.renderedPages.forEach((pageData, index) => {
    if (isTech && index === 0) return;
    
    const el = document.getElementById(`overlay-${docType}-${overlayType}-page-${index}`);
    if (el) {
      const overlayState = getOverlayState(docType, overlayType, index);
      updateOverlayUI(el, overlayState, pageData.renderedWidth, pageData.renderedHeight);
      
      const badge = el.querySelector('.overlay-badge');
      if (badge) {
        const isCustom = (overlayType === 'signature' ? state.pageSignatureOverlays?.[index] : state.pageStampOverlays?.[index]) !== null;
        badge.textContent = `${overlayType === 'signature' ? 'توقيع المدير' : 'ختم الشركة'} - ${isCustom ? 'تعديل خاص' : 'افتراضي'}`;
      }
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
  const currentSubTab = esState.activePreviewSubTab;
  const stateKey = currentSubTab === 'technical' ? 'technicalOffer' : 'contract';
  const state = esState[stateKey];
  
  state.signatureOverlay = { leftRatio: 0, topRatio: 0, widthRatio: 0, heightRatio: 0 };
  if (currentSubTab === 'contract') {
    state.stampOverlay = { leftRatio: 0, topRatio: 0, widthRatio: 0, heightRatio: 0 };
  }
  
  initializeDefaultOverlayRatios(stateKey);
  
  state.renderedPages.forEach((pageData, index) => {
    if (currentSubTab === 'technical' && index === 0) return;
    
    const sigEl = document.getElementById(`overlay-${stateKey}-signature-page-${index}`);
    if (sigEl) {
      updateOverlayUI(sigEl, state.signatureOverlay, pageData.renderedWidth, pageData.renderedHeight);
    }
    
    const stampEl = document.getElementById(`overlay-${stateKey}-stamp-page-${index}`);
    if (stampEl) {
      updateOverlayUI(stampEl, state.stampOverlay, pageData.renderedWidth, pageData.renderedHeight);
    }
  });
}

function resetActiveOverlays() {
  resetOverlaysToDefaults();
}

function adjustEsZoom(diff) {
  const newZoom = Math.min(2.0, Math.max(0.5, esState.zoomLevel + diff));
  if (newZoom === esState.zoomLevel) return;
  
  esState.zoomLevel = newZoom;
  const zoomVal = document.getElementById('zoom-value');
  if (zoomVal) zoomVal.textContent = `${Math.round(newZoom * 100)}%`;
  
  processStep2Files();
}

// STEP 3: Confirm & Download (Dual Files Supported)
function renderStep3(container) {
  const hasTech = esState.technicalOffer.file !== null;
  const hasContract = esState.contract.file !== null;
  
  let techRow = '';
  if (hasTech) {
    const isSinglePage = esState.technicalOffer.pageCount === 1;
    const warning = isSinglePage ? '<span style="color: #ef4444;"> (سيتم تجاهلها لكونها صفحة واحدة)</span>' : '';
    techRow = `
      <div class="esign-summary-row">
        <span>العرض الفني:</span>
        <span style="direction: ltr; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 250px;" class="summary-file-name-tech">${esState.technicalOffer.file.name}</span>
      </div>
      <div class="esign-summary-row">
        <span>عدد الصفحات الموقعة:</span>
        <span>${isSinglePage ? 0 : esState.technicalOffer.pageCount - 1} صفحة${warning}</span>
      </div>
    `;
  }
  
  let contractRow = '';
  if (hasContract) {
    contractRow = `
      <div class="esign-summary-row">
        <span>العقد الرسمي:</span>
        <span style="direction: ltr; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 250px;" class="summary-file-name-contract">${esState.contract.file.name}</span>
      </div>
      <div class="esign-summary-row">
        <span>عدد الصفحات الموقعة:</span>
        <span>${esState.contract.pageCount} صفحة (توقيع المدير + الختم في الأخيرة)</span>
      </div>
    `;
  }
  
  let allReviewed = true;
  if (hasTech && hasContract) {
    allReviewed = esState.reviewedFiles.technicalOffer && esState.reviewedFiles.contract;
  }
  const disabledAttr = allReviewed ? '' : 'disabled';
  const warningMsg = allReviewed ? '' : `
    <div style="color: #ef4444; background-color: rgba(239, 68, 68, 0.05); border: 1px solid #ef4444; border-radius: 8px; padding: 0.75rem; max-width: 500px; margin: 1rem auto; font-size: 0.85rem; font-weight: bold; text-align: center;">
      تنبيه: يجب مراجعة وتحديد موضع التوقيع لكلا الملفين أولاً قبل إتمام عملية التوقيع والتحميل.
    </div>
  `;
  
  container.innerHTML = `
    <div style="text-align: center; margin-bottom: 1.5rem;">
      <h3 style="margin: 0; font-size: 1.25rem;">المستندات جاهزة للتنزيل النهائي</h3>
      <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); font-size: 0.9rem;">اضغط على الزر لمعالجة المستندات وتنزيلها محلياً.</p>
    </div>
    
    <div class="esign-summary-card">
      ${techRow}
      ${techRow && contractRow ? '<hr style="border: none; border-top: 1px solid var(--border-subtle); margin: 0.75rem 0;">' : ''}
      ${contractRow}
    </div>
    
    ${warningMsg}
    
    <div style="text-align: center; margin-top: 2rem;">
      <button class="btn-es btn-es-primary" id="btn-process-pdf" onclick="processAllDocumentsDownload()" ${disabledAttr} style="margin: 0 auto; padding: 0.8rem 2.5rem; font-size: 1.05rem;">
        <i data-lucide="file-signature"></i>
        <span>توقيع وتحميل الملفات</span>
      </button>
      
      <div id="individual-downloads" style="display: none; justify-content: center; gap: 1rem; margin-top: 1.5rem; flex-wrap: wrap;"></div>
      
      <div id="pdf-processing-spinner" style="display: none; flex-direction: column; align-items: center; gap: 0.5rem; margin-top: 1.5rem;">
        <div class="pulse-loader"></div>
        <span style="font-size: 0.85rem; color: var(--text-secondary);">جاري دمج التوقيع وتوليد الـ PDF النهائي...</span>
      </div>
    </div>
  `;
  
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

async function processAllDocumentsDownload() {
  if (esState.isProcessing) return;
  
  const btnProcess = document.getElementById('btn-process-pdf');
  const spinner = document.getElementById('pdf-processing-spinner');
  const indyContainer = document.getElementById('individual-downloads');
  
  if (btnProcess) btnProcess.style.display = 'none';
  if (spinner) spinner.style.display = 'flex';
  if (indyContainer) {
    indyContainer.style.display = 'none';
    indyContainer.innerHTML = '';
  }
  
  esState.isProcessing = true;
  
  const downloads = [];
  
  try {
    if (esState.technicalOffer.file && esState.technicalOffer.pageCount > 1) {
      const docBytes = await generateFinalPdfBytes('technicalOffer');
      const originalName = esState.technicalOffer.file.name.replace(/\.pdf$/i, '');
      const outputFileName = `${originalName} - معتمد.pdf`;
      downloads.push({ bytes: docBytes, name: outputFileName, label: 'العرض الفني الموقع' });
      
      await logSignatureOperation({
        status: 'success',
        documentType: 'technical_offer',
        originalFileName: esState.technicalOffer.file.name,
        outputFileName: outputFileName,
        originalFileSize: esState.technicalOffer.file.size,
        pageCount: esState.technicalOffer.pageCount,
        stampApplied: false,
        autoPlacementMethod: 'manual-fallback',
        autoPlacementSucceeded: false
      });
    }
    
    if (esState.contract.file) {
      const docBytes = await generateFinalPdfBytes('contract');
      const originalName = esState.contract.file.name.replace(/\.pdf$/i, '');
      const outputFileName = `${originalName} - معتمد.pdf`;
      downloads.push({ bytes: docBytes, name: outputFileName, label: 'العقد الموقع' });
      
      await logSignatureOperation({
        status: 'success',
        documentType: 'contract',
        originalFileName: esState.contract.file.name,
        outputFileName: outputFileName,
        originalFileSize: esState.contract.file.size,
        pageCount: esState.contract.pageCount,
        stampApplied: true,
        autoPlacementMethod: esState.contract.autoPlacementMethod,
        autoPlacementSucceeded: esState.contract.autoPlacementSucceeded
      });
    }
    
    if (downloads.length > 0) {
      if (indyContainer) {
        indyContainer.style.display = 'flex';
        downloads.forEach((dl) => {
          const blob = new Blob([dl.bytes], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          
          const a = document.createElement('a');
          a.href = url;
          a.download = dl.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          
          const dlBtn = document.createElement('a');
          dlBtn.href = url;
          dlBtn.className = 'btn-es btn-es-primary';
          dlBtn.download = dl.name;
          dlBtn.innerHTML = `<i data-lucide="download"></i><span>تحميل ${dl.label}</span>`;
          indyContainer.appendChild(dlBtn);
        });
        
        if (typeof lucide !== 'undefined') {
          lucide.createIcons();
        }
      }
      showToast('تم تطبيق التوقيع وتحميل الملفات بنجاح.', 'success');
    }
  } catch(err) {
    console.error(err);
    showToast(err.message || 'حدث خطأ أثناء معالجة وحفظ الملفات', 'error');
  } finally {
    esState.isProcessing = false;
    if (btnProcess) btnProcess.style.display = 'inline-flex';
    if (spinner) spinner.style.display = 'none';
  }
}

// SECTION 7: PDF Generation (pdf-lib)
async function generateFinalPdfBytes(type) {
  const state = esState[type];
  
  const arrayBuffer = await state.file.arrayBuffer();
  const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
  
  const sigBytes = dataUrlToBytes(esState.signatureData.dataUrl);
  const sigImage = await pdfDoc.embedPng(sigBytes);
  
  let stampImage = null;
  if (type === 'contract' && esState.stampData) {
    const stampBytes = dataUrlToBytes(esState.stampData.dataUrl);
    stampImage = await pdfDoc.embedPng(stampBytes);
  }
  
  const pages = pdfDoc.getPages();
  const lastPageIndex = pages.length - 1;
  const isTech = type === 'technicalOffer';
  
  for (let i = 0; i < pages.length; i++) {
    if (isTech && i === 0) continue; // Skip first page of technical offer
    
    const page = pages[i];
    const { width: pdfW, height: pdfH } = page.getSize();
    
    // Get page-specific signature or fallback
    const sig = getOverlayState(type, 'signature', i);
    const pdfX = sig.leftRatio * pdfW;
    const pdfWidth = sig.widthRatio * pdfW;
    const pdfHeight = sig.heightRatio * pdfH;
    const pdfY = pdfH - (sig.topRatio + sig.heightRatio) * pdfH; // flip Y
    
    page.drawImage(sigImage, {
      x: pdfX,
      y: pdfY,
      width: pdfWidth,
      height: pdfHeight
    });
    
    if (i === lastPageIndex && stampImage) {
      // Get page-specific stamp or fallback
      const st = getOverlayState(type, 'stamp', i);
      const stPdfX = st.leftRatio * pdfW;
      const stPdfWidth = st.widthRatio * pdfW;
      const stPdfHeight = st.heightRatio * pdfH;
      const stPdfY = pdfH - (st.topRatio + st.heightRatio) * pdfH;
      
      page.drawImage(stampImage, {
        x: stPdfX,
        y: stPdfY,
        width: stPdfWidth,
        height: stPdfHeight
      });
    }
  }
  
  return await pdfDoc.save();
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

async function logSignatureOperation(payload) {
  if (typeof db === 'undefined') return;
  
  const user = getCurrentUserInfo();
  const fullLog = {
    ...payload,
    ...user,
    signedAt: Date.now()
  };
  
  try {
    await db.ref(ES_PATHS.logs).push().set(fullLog);
  } catch(err) {
    console.error(err);
    showToast('تعذر كتابة سجل الميتاداتا في Firebase', 'warning');
  }
}

// SECTION 9: Logs Tab
let esLogsCache = [];

function loadSignatureLogs() {
  if (typeof db === 'undefined') return;
  
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
    tdUser.textContent = log.userName || 'غير معروف';
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
    if (log.status === 'success') {
      statusSpan.textContent = 'ناجحة';
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
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}
