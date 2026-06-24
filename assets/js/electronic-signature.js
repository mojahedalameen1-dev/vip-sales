/*
 * Electronic Signature Module
 * Built for CRM - RTL Arabic, Light/Dark theme compatible.
 */

// SECTION 1: Module State & Constants
const ES_PATHS = {
  settings: 'electronicSignature/settings/company',
  logs: 'electronicSignature/logs'
};

let esState = {
  // Assets
  signatureData: null,    // { dataUrl, width, height, originalFileName, updatedAt, updatedBy }
  stampData: null,        // { dataUrl, width, height, originalFileName, updatedAt, updatedBy }
  
  // Current document
  currentPdfFile: null,   // File object
  pdfDocument: null,      // PDF.js document
  pdfPageCount: 0,
  documentType: null,     // 'technical_offer' | 'contract'
  
  // Overlay positions (stored as ratio 0..1 relative to page size)
  signatureOverlay: { leftRatio: 0, topRatio: 0, widthRatio: 0, heightRatio: 0 },
  stampOverlay: { leftRatio: 0, topRatio: 0, widthRatio: 0, heightRatio: 0 },
  
  // UI State
  currentStep: 1,         // 1, 2, 3, 4
  currentTab: 'sign',     // 'sign' | 'settings' | 'logs'
  activeOverlay: null,    // 'signature' | 'stamp' | null
  zoomLevel: 1.0,
  isProcessing: false,
  
  // Rendered pages
  renderedPages: [],       // [{canvas, renderedWidth, renderedHeight, pdfPageWidth, pdfPageHeight}]
  isInitialized: false
};

// SECTION 2: Init & DOM Building
function initElectronicSignature() {
  if (esState.isInitialized) return;
  
  const esignView = document.getElementById('esignView');
  if (!esignView) return;
  
  // Build Main Layout
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
                <div class="step-label">نوع المستند</div>
              </div>
              <div class="step-item" id="step-i-2">
                <div class="step-num">2</div>
                <div class="step-label">رفع PDF</div>
              </div>
              <div class="step-item" id="step-i-3">
                <div class="step-num">3</div>
                <div class="step-label">المعاينة والموضع</div>
              </div>
              <div class="step-item" id="step-i-4">
                <div class="step-num">4</div>
                <div class="step-label">التنزيل والسجل</div>
              </div>
            </div>
          </div>

          <div class="step-content-container" id="step-content">
            <!-- Step contents injected here dynamically -->
          </div>

          <div class="step-actions-container">
            <button class="btn-es btn-es-secondary" id="btn-prev-step" onclick="prevStep()" style="visibility: hidden;">
              <i data-lucide="arrow-right"></i>
              <span>السابق</span>
            </button>
            <div style="display: flex; gap: 0.5rem;">
              <button class="btn-es btn-es-danger" id="btn-reset-esign" onclick="resetEsignFlow()" style="display: none;">
                <i data-lucide="trash-2"></i>
                <span>إزالة الملف والبدء من جديد</span>
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
                <span id="meta-name-signature" style="direction: ltr; text-align: right;">-</span>
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
                <span id="meta-name-stamp" style="direction: ltr; text-align: right;">-</span>
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
  
  // Re-run lucide icons rendering
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
  
  // Setup drag & drop for settings zone
  setupDragAndDropZones();
  
  // Load initial settings from Firebase
  loadSignatureSettings();
  
  // Go to step 1
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

// SECTION 3: Settings Tab — Upload & Save Assets
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
      console.error("Error loading signature settings:", err);
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
  
  // Show spinner or processing state
  showToast('جاري ضغط وحفظ الصورة...', 'info');
  
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
        showToast('تم حفظ الصورة بنجاح وتحديثها في قاعدة البيانات.', 'success');
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
        
        // Define maximum dimension to scale down PNG if too large
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
        ctx.clearRect(0, 0, width, height); // maintain transparency
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
    document.getElementById(`meta-name-${type}`).textContent = data.originalFileName || 'توقيع_مدير.png';
    document.getElementById(`meta-dim-${type}`).textContent = `${data.width} × ${data.height} بكسل`;
    document.getElementById(`meta-date-${type}`).textContent = formatArabicDate(data.updatedAt);
    document.getElementById(`meta-user-${type}`).textContent = data.updatedBy || 'غير معروف';
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
  
  // Re-evaluate next buttons in sign tab if we are there
  checkStepValidity();
}

// SECTION 4: Sign Document Tab — Step Machine
function goToStep(step) {
  esState.currentStep = step;
  
  // Update indicator list
  for (let i = 1; i <= 4; i++) {
    const item = document.getElementById(`step-i-${i}`);
    if (!item) continue;
    
    item.classList.remove('active', 'completed');
    if (i < step) {
      item.classList.add('completed');
    } else if (i === step) {
      item.classList.add('active');
    }
  }
  
  // Show prev button only on step 2 & 3
  const prevBtn = document.getElementById('btn-prev-step');
  if (prevBtn) {
    if (step > 1 && step < 4) {
      prevBtn.style.visibility = 'visible';
    } else {
      prevBtn.style.visibility = 'hidden';
    }
  }
  
  // Show reset button on step 2, 3, 4
  const resetBtn = document.getElementById('btn-reset-esign');
  if (resetBtn) {
    if (step > 1) {
      resetBtn.style.display = 'flex';
    } else {
      resetBtn.style.display = 'none';
    }
  }
  
  // Render step content
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
    case 4:
      renderStep4(content);
      break;
  }
  
  // Check validity to disable/enable next button
  checkStepValidity();
  
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

function nextStep() {
  if (esState.currentStep === 1) {
    goToStep(2);
  } else if (esState.currentStep === 2) {
    goToStep(3);
  } else if (esState.currentStep === 3) {
    goToStep(4);
  }
}

function prevStep() {
  if (esState.currentStep === 2) {
    goToStep(1);
  } else if (esState.currentStep === 3) {
    goToStep(2);
  }
}

function resetEsignFlow() {
  if (confirm('هل تريد فعلاً إلغاء الملف الحالي والبدء من جديد؟ سيتم مسح أي خيارات مؤقتة.')) {
    esState.currentPdfFile = null;
    esState.pdfDocument = null;
    esState.pdfPageCount = 0;
    esState.renderedPages = [];
    esState.documentType = null;
    esState.currentStep = 1;
    goToStep(1);
  }
}

function checkStepValidity() {
  const nextBtn = document.getElementById('btn-next-step');
  if (!nextBtn) return;
  
  let valid = false;
  
  if (esState.currentStep === 1) {
    valid = (esState.documentType !== null);
  } else if (esState.currentStep === 2) {
    valid = (esState.currentPdfFile !== null);
  } else if (esState.currentStep === 3) {
    // Check if signature asset is uploaded
    if (!esState.signatureData) {
      valid = false;
    } else if (esState.documentType === 'contract' && !esState.stampData) {
      valid = false; // contract requires stamp
    } else {
      valid = true;
    }
  } else if (esState.currentStep === 4) {
    valid = false; // final step is for download/logs
  }
  
  nextBtn.disabled = !valid;
  
  // Update step 3 error/warning text if any required assets are missing
  const warningDiv = document.getElementById('step3-assets-warning');
  if (warningDiv) {
    if (!esState.signatureData) {
      warningDiv.style.display = 'block';
      warningDiv.textContent = 'تنبيه: يجب رفع توقيع المدير أولاً من تبويب الإعدادات لإنهاء التوقيع.';
    } else if (esState.documentType === 'contract' && !esState.stampData) {
      warningDiv.style.display = 'block';
      warningDiv.textContent = 'تنبيه: يتطلب توقيع العقود رفع ختم الشركة أولاً من تبويب الإعدادات.';
    } else {
      warningDiv.style.display = 'none';
    }
  }
}

// Step 1: Document Type Select
function renderStep1(container) {
  container.innerHTML = `
    <div style="text-align: center; margin-bottom: 1.5rem;">
      <h3 style="margin: 0; font-size: 1.25rem;">اختر نوع المستند المراد توقيعه</h3>
      <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); font-size: 0.9rem;">يتم تطبيق ختم الشركة في الصفحة الأخيرة للعقود فقط.</p>
    </div>
    
    <div class="doc-type-grid">
      <div class="doc-type-card ${esState.documentType === 'technical_offer' ? 'selected' : ''}" onclick="selectDocType('technical_offer')">
        <i data-lucide="file-text" style="width: 48px; height: 48px;"></i>
        <h4>عرض فني / عرض أسعار</h4>
        <p>يضاف توقيع المدير فقط على جميع الصفحات.</p>
      </div>
      
      <div class="doc-type-card ${esState.documentType === 'contract' ? 'selected' : ''}" onclick="selectDocType('contract')">
        <i data-lucide="file-check-2" style="width: 48px; height: 48px;"></i>
        <h4>عقد رسمي</h4>
        <p>يضاف توقيع المدير على جميع الصفحات، وختم الشركة في الصفحة الأخيرة فقط.</p>
      </div>
    </div>
  `;
}

function selectDocType(type) {
  esState.documentType = type;
  document.querySelectorAll('.doc-type-card').forEach(c => c.classList.remove('selected'));
  
  // Re-render Step 1 UI elements classes without full redraw to avoid losing other focus
  goToStep(1);
}

// Step 2: Upload PDF
function renderStep2(container) {
  container.innerHTML = `
    <div style="text-align: center; margin-bottom: 1.5rem;">
      <h3 style="margin: 0; font-size: 1.25rem;">قم برفع ملف الـ PDF</h3>
      <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); font-size: 0.9rem;">يجب أن يكون الملف بامتداد PDF وغير محمي بكلمة مرور.</p>
    </div>
    
    <div class="upload-zone" id="upload-zone-pdf" onclick="document.getElementById('file-input-pdf').click()">
      <i data-lucide="file-up" style="width: 48px; height: 48px;"></i>
      <p>اسحب ملف PDF هنا أو انقر لاختياره من جهازك</p>
      <span>الحجم الأقصى المفضل: 20 ميجابايت</span>
      <input type="file" id="file-input-pdf" accept="application/pdf" style="display:none" onchange="handlePdfFileInput(this)">
    </div>
    
    <div id="pdf-file-details" style="display: none; margin-top: 1.5rem; background-color: var(--bg-subtle); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1rem;">
      <div style="display: flex; align-items: center; gap: 1rem;">
        <i data-lucide="file" style="color: var(--accent-blue); width: 36px; height: 36px; flex-shrink: 0;"></i>
        <div style="flex-grow: 1;">
          <h4 id="pdf-detail-name" style="margin: 0; font-size: 1rem; word-break: break-all;">-</h4>
          <p id="pdf-detail-size-pages" style="margin: 0.25rem 0 0 0; color: var(--text-secondary); font-size: 0.85rem;">-</p>
        </div>
        <button class="btn-es btn-es-danger" onclick="clearPdfFile()">
          <i data-lucide="trash-2"></i>
          <span>حذف</span>
        </button>
      </div>
    </div>
  `;
  
  if (esState.currentPdfFile) {
    showPdfDetails(esState.currentPdfFile.name, esState.currentPdfFile.size);
  }
}

function handlePdfFileInput(input) {
  const file = input.files[0];
  if (!file) return;
  
  if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
    showToast('يجب اختيار ملف بصيغة PDF فقط!', 'error');
    input.value = '';
    return;
  }
  
  esState.currentPdfFile = file;
  showPdfDetails(file.name, file.size);
  checkStepValidity();
}

function showPdfDetails(name, size) {
  const zone = document.getElementById('upload-zone-pdf');
  const details = document.getElementById('pdf-file-details');
  if (zone) zone.style.display = 'none';
  if (details) {
    details.style.display = 'block';
    const nameSpan = document.getElementById('pdf-detail-name');
    const sizeSpan = document.getElementById('pdf-detail-size-pages');
    
    if (nameSpan) nameSpan.textContent = name;
    if (sizeSpan) sizeSpan.textContent = `الحجم: ${formatFileSize(size)}`;
  }
}

function clearPdfFile() {
  esState.currentPdfFile = null;
  esState.pdfDocument = null;
  esState.pdfPageCount = 0;
  esState.renderedPages = [];
  
  const zone = document.getElementById('upload-zone-pdf');
  const details = document.getElementById('pdf-file-details');
  if (zone) zone.style.display = 'flex';
  if (details) details.style.display = 'none';
  
  checkStepValidity();
}

// SECTION 5: PDF Upload & Rendering (PDF.js)
function renderStep3(container) {
  container.innerHTML = `
    <div style="text-align: center; margin-bottom: 1rem;">
      <h3 style="margin: 0; font-size: 1.25rem;">حدد الموضع والتوزيع على صفحات المستند</h3>
      <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); font-size: 0.9rem;">اسحب التوقيع أو الختم وضعهما في المكان المطلوب. يمكنك استخدام زوايا التحديد للتحجيم.</p>
      <div id="step3-assets-warning" style="display: none; color: #ef4444; font-size: 0.85rem; font-weight: 600; margin-top: 0.5rem;"></div>
    </div>
    
    <div class="pdf-preview-layout">
      <div class="pdf-toolbar">
        <div class="toolbar-group">
          <button class="btn-es btn-es-secondary" onclick="adjustZoom(-0.1)">
            <i data-lucide="zoom-out" style="width: 16px; height: 16px;"></i>
          </button>
          <span id="zoom-value" style="font-size: 0.9rem; min-width: 45px; text-align: center;">100%</span>
          <button class="btn-es btn-es-secondary" onclick="adjustZoom(0.1)">
            <i data-lucide="zoom-in" style="width: 16px; height: 16px;"></i>
          </button>
        </div>
        <div class="toolbar-group">
          <button class="btn-es btn-es-secondary" onclick="resetOverlaysToDefaults()">
            <i data-lucide="refresh-cw" style="width: 16px; height: 16px;"></i>
            <span>إعادة تعيين المواضع</span>
          </button>
        </div>
      </div>
      
      <div class="pdf-workspace" id="pdf-workspace-area">
        <div id="pdf-render-spinner" style="display: flex; flex-direction: column; align-items: center; gap: 1rem; margin: 3rem 0;">
          <div class="pulse-loader"></div>
          <span style="font-size: 0.9rem; color: var(--text-secondary);">جاري رندرة صفحات PDF للمعاينة...</span>
        </div>
        
        <div id="pdf-pages-container" style="display: none; width: 100%; text-align: center;">
          <!-- Rendered pages are injected here -->
        </div>
      </div>
    </div>
  `;
  
  if (esState.currentPdfFile) {
    loadAndRenderPdf();
  }
}

function loadAndRenderPdf() {
  if (typeof pdfjsLib === 'undefined') {
    showToast('خطأ: مكتبة PDF.js غير متوفرة محلياً.', 'error');
    return;
  }
  
  // Set worker src locally
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/js/vendor/pdf.worker.min.js';
  
  const fileReader = new FileReader();
  fileReader.onload = function() {
    const typedarray = new Uint8Array(this.result);
    
    pdfjsLib.getDocument(typedarray).promise.then((pdf) => {
      esState.pdfDocument = pdf;
      esState.pdfPageCount = pdf.numPages;
      esState.renderedPages = [];
      
      // Determine rendering scale
      const scale = pdf.numPages > 10 ? 1.0 : 1.3;
      
      // Loop render page by page
      renderPagesSequence(1, pdf, scale);
    }).catch(err => {
      console.error(err);
      showToast('فشل تحليل ملف PDF. تأكد من أن الملف ليس مشفراً.', 'error');
      const spinner = document.getElementById('pdf-render-spinner');
      if (spinner) spinner.innerHTML = `<span style="color: #ef4444;">خطأ في تحميل ملف PDF</span>`;
    });
  };
  fileReader.readAsArrayBuffer(esState.currentPdfFile);
}

function renderPagesSequence(pageNum, pdf, scale) {
  if (pageNum > pdf.numPages) {
    // Done rendering all pages
    const spinner = document.getElementById('pdf-render-spinner');
    if (spinner) spinner.style.display = 'none';
    
    const container = document.getElementById('pdf-pages-container');
    if (container) {
      container.style.display = 'block';
      buildPagesUI();
    }
    return;
  }
  
  pdf.getPage(pageNum).then(page => {
    const viewport = page.getViewport({ scale: scale * esState.zoomLevel });
    const canvas = document.createElement('canvas');
    canvas.className = 'page-canvas';
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    const renderContext = {
      canvasContext: ctx,
      viewport: viewport
    };
    
    page.render(renderContext).promise.then(() => {
      // Store sizes
      const pdfSize = page.getViewport({ scale: 1.0 });
      esState.renderedPages.push({
        canvas: canvas,
        renderedWidth: viewport.width,
        renderedHeight: viewport.height,
        pdfPageWidth: pdfSize.width,
        pdfPageHeight: pdfSize.height
      });
      
      // Next page
      renderPagesSequence(pageNum + 1, pdf, scale);
    });
  });
}

function adjustZoom(diff) {
  const newZoom = Math.min(2.0, Math.max(0.5, esState.zoomLevel + diff));
  if (newZoom === esState.zoomLevel) return;
  
  esState.zoomLevel = newZoom;
  const zoomVal = document.getElementById('zoom-value');
  if (zoomVal) zoomVal.textContent = `${Math.round(newZoom * 100)}%`;
  
  // Re-render
  const container = document.getElementById('pdf-pages-container');
  if (container) container.innerHTML = '';
  
  const spinner = document.getElementById('pdf-render-spinner');
  if (spinner) spinner.style.display = 'flex';
  
  esState.renderedPages = [];
  const scale = esState.pdfPageCount > 10 ? 1.0 : 1.3;
  renderPagesSequence(1, esState.pdfDocument, scale);
}

// SECTION 6: Overlay System — Drag, Resize, Sync & Clamping
function buildPagesUI() {
  const container = document.getElementById('pdf-pages-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  // Initialize default ratios if not set
  initializeDefaultOverlayRatios();
  
  // Render pages & overlays
  const lastIndex = esState.renderedPages.length - 1;
  esState.renderedPages.forEach((pageData, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'page-wrapper';
    wrapper.style.position = 'relative';
    wrapper.style.marginBottom = '20px';
    wrapper.style.width = `${pageData.renderedWidth}px`;
    wrapper.style.height = `${pageData.renderedHeight}px`;
    
    // Append the page canvas
    wrapper.appendChild(pageData.canvas);
    
    // Add Signature Overlay
    if (esState.signatureData) {
      const sigOverlay = createOverlayElement('signature', index, pageData.renderedWidth, pageData.renderedHeight);
      wrapper.appendChild(sigOverlay);
    }
    
    // Add Stamp Overlay if 'contract' and last page
    if (esState.documentType === 'contract' && esState.stampData && index === lastIndex) {
      const stampOverlay = createOverlayElement('stamp', index, pageData.renderedWidth, pageData.renderedHeight);
      wrapper.appendChild(stampOverlay);
    }
    
    container.appendChild(wrapper);
  });
  
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

function initializeDefaultOverlayRatios() {
  const firstPage = esState.renderedPages[0];
  if (!firstPage) return;
  
  // Signature defaults: Bottom right with 5% margin
  if (esState.signatureData && esState.signatureOverlay.widthRatio === 0) {
    const originalWidth = esState.signatureData.width;
    const originalHeight = esState.signatureData.height;
    
    // Target width: 25% of page width, or original width scale
    const targetWidth = Math.min(originalWidth * 0.4, firstPage.renderedWidth * 0.25);
    const targetHeight = targetWidth * (originalHeight / originalWidth);
    
    const marginX = firstPage.renderedWidth * 0.05;
    const marginY = firstPage.renderedHeight * 0.05;
    
    // Calculate Bottom-Right position:
    const left = firstPage.renderedWidth - targetWidth - marginX;
    const top = firstPage.renderedHeight - targetHeight - marginY;
    
    esState.signatureOverlay = {
      leftRatio: left / firstPage.renderedWidth,
      topRatio: top / firstPage.renderedHeight,
      widthRatio: targetWidth / firstPage.renderedWidth,
      heightRatio: targetHeight / firstPage.renderedHeight
    };
  }
  
  // Stamp defaults: Just above signature in bottom right
  if (esState.stampData && esState.stampOverlay.widthRatio === 0) {
    const originalWidth = esState.stampData.width;
    const originalHeight = esState.stampData.height;
    
    const targetWidth = Math.min(originalWidth * 0.45, firstPage.renderedWidth * 0.28);
    const targetHeight = targetWidth * (originalHeight / originalWidth);
    
    const marginX = firstPage.renderedWidth * 0.05;
    // Position it slightly above the signature
    const sigHeight = esState.signatureOverlay.heightRatio * firstPage.renderedHeight;
    const marginY = firstPage.renderedHeight * 0.05 + sigHeight + 10; 
    
    const left = firstPage.renderedWidth - targetWidth - marginX;
    const top = firstPage.renderedHeight - targetHeight - marginY;
    
    esState.stampOverlay = {
      leftRatio: left / firstPage.renderedWidth,
      topRatio: top / firstPage.renderedHeight,
      widthRatio: targetWidth / firstPage.renderedWidth,
      heightRatio: targetHeight / firstPage.renderedHeight
    };
  }
}

function createOverlayElement(type, pageIndex, renderedWidth, renderedHeight) {
  const overlayState = type === 'signature' ? esState.signatureOverlay : esState.stampOverlay;
  const assetData = type === 'signature' ? esState.signatureData : esState.stampData;
  
  const el = document.createElement('div');
  el.className = `overlay-element ${type}-element`;
  el.id = `overlay-${type}-page-${pageIndex}`;
  el.dataset.type = type;
  el.dataset.pageIndex = pageIndex;
  
  // Add badge
  const badge = document.createElement('div');
  badge.className = 'overlay-badge';
  badge.textContent = type === 'signature' ? 'توقيع المدير' : 'ختم الشركة';
  el.appendChild(badge);
  
  // Add image element
  const img = document.createElement('img');
  img.src = assetData.dataUrl;
  img.className = 'overlay-img';
  el.appendChild(img);
  
  // Add resize handles (4 corners)
  const corners = ['nw', 'ne', 'se', 'sw'];
  corners.forEach(c => {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-handle-${c}`;
    el.appendChild(handle);
    // Bind Pointer Events for resizing
    initPointerResize(handle, el, c, type);
  });
  
  // Set current position
  updateOverlayUI(el, overlayState, renderedWidth, renderedHeight);
  
  // Drag handler via Pointer Events
  initPointerDrag(el, type);
  
  return el;
}

function updateOverlayUI(element, state, w, h) {
  element.style.left = `${state.leftRatio * w}px`;
  element.style.top = `${state.topRatio * h}px`;
  element.style.width = `${state.widthRatio * w}px`;
  element.style.height = `${state.heightRatio * h}px`;
}

function initPointerDrag(element, type) {
  element.addEventListener('pointerdown', (e) => {
    // If clicked on resize handle, ignore dragging
    if (e.target.classList.contains('resize-handle')) return;
    
    e.preventDefault();
    
    // Remove selection from all others, select this one
    document.querySelectorAll('.overlay-element').forEach(o => o.classList.remove('selected'));
    element.classList.add('selected');
    
    esState.activeOverlay = type;
    
    const overlayState = type === 'signature' ? esState.signatureOverlay : esState.stampOverlay;
    const pageWrapper = element.parentElement;
    const renderedWidth = pageWrapper.clientWidth;
    const renderedHeight = pageWrapper.clientHeight;
    
    let startX = e.clientX;
    let startY = e.clientY;
    let startLeft = overlayState.leftRatio * renderedWidth;
    let startTop = overlayState.topRatio * renderedHeight;
    const elementWidth = overlayState.widthRatio * renderedWidth;
    const elementHeight = overlayState.heightRatio * renderedHeight;
    
    element.setPointerCapture(e.pointerId);
    
    const onPointerMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      
      let newLeft = startLeft + dx;
      let newTop = startTop + dy;
      
      // CLAMPING: Keep overlays inside the bounds of the page
      newLeft = Math.max(0, Math.min(newLeft, renderedWidth - elementWidth));
      newTop = Math.max(0, Math.min(newTop, renderedHeight - elementHeight));
      
      overlayState.leftRatio = newLeft / renderedWidth;
      overlayState.topRatio = newTop / renderedHeight;
      
      if (type === 'signature') {
        syncSignatureOverlayToAllPages();
      } else {
        updateOverlayUI(element, overlayState, renderedWidth, renderedHeight);
      }
    };
    
    const onPointerUp = (upEvent) => {
      element.releasePointerCapture(upEvent.pointerId);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
    };
    
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
  });
}

function initPointerResize(handle, element, direction, type) {
  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    
    const overlayState = type === 'signature' ? esState.signatureOverlay : esState.stampOverlay;
    const assetData = type === 'signature' ? esState.signatureData : esState.stampData;
    const pageWrapper = element.parentElement;
    const renderedWidth = pageWrapper.clientWidth;
    const renderedHeight = pageWrapper.clientHeight;
    
    // Target ratio (original width / height) to maintain aspect ratio
    const aspect = assetData.width / assetData.height;
    
    let startX = e.clientX;
    let startY = e.clientY;
    
    let startLeft = overlayState.leftRatio * renderedWidth;
    let startTop = overlayState.topRatio * renderedHeight;
    let startWidth = overlayState.widthRatio * renderedWidth;
    let startHeight = overlayState.heightRatio * renderedHeight;
    
    handle.setPointerCapture(e.pointerId);
    
    const onPointerMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      
      let newLeft = startLeft;
      let newTop = startTop;
      let newWidth = startWidth;
      let newHeight = startHeight;
      
      // Preserve aspect ratio locked and apply clamping
      if (direction === 'se') {
        newWidth = Math.max(30, startWidth + dx);
        newHeight = newWidth / aspect;
        
        // Clamping right & bottom
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
        
        // Clamping left & bottom
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
        
        // Clamping right & top
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
        
        // Clamping left & top
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
      
      overlayState.leftRatio = newLeft / renderedWidth;
      overlayState.topRatio = newTop / renderedHeight;
      overlayState.widthRatio = newWidth / renderedWidth;
      overlayState.heightRatio = newHeight / renderedHeight;
      
      if (type === 'signature') {
        syncSignatureOverlayToAllPages();
      } else {
        updateOverlayUI(element, overlayState, renderedWidth, renderedHeight);
      }
    };
    
    const onPointerUp = (upEvent) => {
      handle.releasePointerCapture(upEvent.pointerId);
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
    };
    
    element.classList.add('selected');
    esState.activeOverlay = type;
    
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
  });
}

function syncSignatureOverlayToAllPages() {
  esState.renderedPages.forEach((pageData, index) => {
    const el = document.getElementById(`overlay-signature-page-${index}`);
    if (el) {
      updateOverlayUI(el, esState.signatureOverlay, pageData.renderedWidth, pageData.renderedHeight);
    }
  });
}

function resetOverlaysToDefaults() {
  esState.signatureOverlay = { leftRatio: 0, topRatio: 0, widthRatio: 0, heightRatio: 0 };
  esState.stampOverlay = { leftRatio: 0, topRatio: 0, widthRatio: 0, heightRatio: 0 };
  
  initializeDefaultOverlayRatios();
  
  esState.renderedPages.forEach((pageData, index) => {
    const sigEl = document.getElementById(`overlay-signature-page-${index}`);
    if (sigEl) {
      updateOverlayUI(sigEl, esState.signatureOverlay, pageData.renderedWidth, pageData.renderedHeight);
    }
    
    const stampEl = document.getElementById(`overlay-stamp-page-${index}`);
    if (stampEl) {
      updateOverlayUI(stampEl, esState.stampOverlay, pageData.renderedWidth, pageData.renderedHeight);
    }
  });
}

// Step 4: Confirm & Download
function renderStep4(container) {
  const lastIndex = esState.pdfPageCount;
  const isContract = esState.documentType === 'contract';
  
  container.innerHTML = `
    <div style="text-align: center; margin-bottom: 1.5rem;">
      <h3 style="margin: 0; font-size: 1.25rem;">تمت محاذاة العناصر بنجاح</h3>
      <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); font-size: 0.9rem;">راجع الملخص بالأسفل قبل المتابعة للتنزيل.</p>
    </div>
    
    <div class="esign-summary-card">
      <div class="esign-summary-row">
        <span>نوع المستند:</span>
        <span>${isContract ? 'عقد رسمي' : 'عرض فني / عرض أسعار'}</span>
      </div>
      <div class="esign-summary-row">
        <span>الملف الأصلي:</span>
        <span id="summary-file-name" style="direction: ltr; text-align: right; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">-</span>
      </div>
      <div class="esign-summary-row">
        <span>عدد الصفحات:</span>
        <span>${lastIndex} صفحة</span>
      </div>
      <div class="esign-summary-row">
        <span>توقيع المدير:</span>
        <span style="color: var(--accent-teal);">سيتم تطبيقه على جميع الصفحات (${lastIndex})</span>
      </div>
      <div class="esign-summary-row">
        <span>ختم الشركة:</span>
        <span>${isContract ? `سيتم تطبيقه على الصفحة الأخيرة فقط (${lastIndex})` : 'لن يتم تطبيقه'}</span>
      </div>
    </div>
    
    <div style="text-align: center; margin-top: 2rem;">
      <button class="btn-es btn-es-primary" id="btn-process-pdf" onclick="generateSignedPdf()" style="margin: 0 auto; padding: 0.8rem 2rem; font-size: 1.05rem;">
        <i data-lucide="file-down"></i>
        <span>تنزيل المستند موقعاً</span>
      </button>
      <div id="pdf-processing-spinner" style="display: none; flex-direction: column; align-items: center; gap: 0.5rem; margin-top: 1rem;">
        <div class="pulse-loader"></div>
        <span style="font-size: 0.85rem; color: var(--text-secondary);">جاري إنتاج ملف الـ PDF وتطبيق التوقيع...</span>
      </div>
    </div>
  `;
  
  const nameSpan = document.getElementById('summary-file-name');
  if (nameSpan && esState.currentPdfFile) {
    nameSpan.textContent = esState.currentPdfFile.name;
  }
  
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

// SECTION 7: PDF Generation (pdf-lib)
async function generateSignedPdf() {
  if (esState.isProcessing) return;
  
  // Validation
  if (!esState.signatureData) {
    showToast('الرجاء رفع توقيع المدير أولاً.', 'error');
    return;
  }
  if (esState.documentType === 'contract' && !esState.stampData) {
    showToast('الرجاء رفع ختم الشركة أولاً لتوقيع العقود.', 'error');
    return;
  }
  if (!esState.currentPdfFile) {
    showToast('لم يتم اختيار ملف PDF.', 'error');
    return;
  }
  
  const btnProcess = document.getElementById('btn-process-pdf');
  const spinner = document.getElementById('pdf-processing-spinner');
  
  if (btnProcess) btnProcess.style.display = 'none';
  if (spinner) spinner.style.display = 'flex';
  
  esState.isProcessing = true;
  const startTime = Date.now();
  
  try {
    const arrayBuffer = await esState.currentPdfFile.arrayBuffer();
    
    let pdfDoc;
    try {
      pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
    } catch(err) {
      if (err.message && err.message.includes('password')) {
        throw new Error('ملف PDF محمي بكلمة مرور. يرجى إلغاء الحماية أولاً.');
      } else {
        throw new Error('فشل تحميل الـ PDF. قد يكون الملف تالفاً أو غير مدعوم.');
      }
    }
    
    // Embed signature image (PNG bytes)
    const sigBytes = dataUrlToBytes(esState.signatureData.dataUrl);
    const sigImage = await pdfDoc.embedPng(sigBytes);
    
    // Embed stamp image if needed
    let stampImage = null;
    if (esState.documentType === 'contract' && esState.stampData) {
      const stampBytes = dataUrlToBytes(esState.stampData.dataUrl);
      stampImage = await pdfDoc.embedPng(stampBytes);
    }
    
    const pages = pdfDoc.getPages();
    const lastPageIndex = pages.length - 1;
    
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const { width: pdfW, height: pdfH } = page.getSize();
      
      // Target coordinate calculations converting ratio back to absolute PDF coordinates
      const sig = esState.signatureOverlay;
      const pdfX = sig.leftRatio * pdfW;
      const pdfWidth = sig.widthRatio * pdfW;
      const pdfHeight = sig.heightRatio * pdfH;
      // Y-axis flip: PDF coordinate system starts bottom-left, DOM starts top-left
      const pdfY = pdfH - (sig.topRatio + sig.heightRatio) * pdfH;
      
      page.drawImage(sigImage, {
        x: pdfX,
        y: pdfY,
        width: pdfWidth,
        height: pdfHeight
      });
      
      // Apply stamp to the last page only for contracts
      if (i === lastPageIndex && stampImage) {
        const st = esState.stampOverlay;
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
    
    // Save to bytes and download
    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    
    const originalName = esState.currentPdfFile.name.replace('.pdf', '');
    const cleanDate = formatTimestamp(new Date());
    const outputFileName = `signed-${originalName}-${cleanDate}.pdf`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = outputFileName;
    a.click();
    
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 100);
    
    showToast('تم تطبيق التوقيع وتحميل الملف بنجاح!', 'success');
    
    // Log operation to database
    const timeTaken = Date.now() - startTime;
    await logSignatureOperation({
      status: 'success',
      documentType: esState.documentType,
      originalFileName: esState.currentPdfFile.name,
      outputFileName: outputFileName,
      originalFileSize: esState.currentPdfFile.size,
      pageCount: pages.length,
      stampApplied: (esState.documentType === 'contract'),
      processingTimeMs: timeTaken
    });
    
  } catch(err) {
    console.error(err);
    showToast(err.message || 'حدث خطأ غير متوقع أثناء معالجة المستند', 'error');
    
    // Log failure
    const timeTaken = Date.now() - startTime;
    await logSignatureOperation({
      status: 'failed',
      errorMessage: err.message || 'Unknown error',
      documentType: esState.documentType,
      originalFileName: esState.currentPdfFile ? esState.currentPdfFile.name : 'unknown',
      outputFileName: '',
      originalFileSize: esState.currentPdfFile ? esState.currentPdfFile.size : 0,
      pageCount: esState.pdfPageCount || 0,
      stampApplied: (esState.documentType === 'contract'),
      processingTimeMs: timeTaken
    });
  } finally {
    esState.isProcessing = false;
    if (btnProcess) btnProcess.style.display = 'inline-flex';
    if (spinner) spinner.style.display = 'none';
  }
}

// SECTION 8: Firebase Operations
function getCurrentUserInfo() {
  // Access global variables directly
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
    console.error("Error writing logs:", err);
    showToast('تم تحميل الملف، لكن تعذر حفظ السجل في Firebase.', 'warning');
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
      
      // Sort newest first
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
    
    // SAFE HTML CONSTRUCTION: Use textContent for any variable data to prevent XSS
    
    // Date/Time
    const tdDate = document.createElement('td');
    tdDate.textContent = formatArabicDate(log.signedAt);
    tr.appendChild(tdDate);
    
    // User
    const tdUser = document.createElement('td');
    tdUser.textContent = log.userName || 'غير معروف';
    tr.appendChild(tdUser);
    
    // Document Type Label
    const tdDocType = document.createElement('td');
    tdDocType.textContent = log.documentType === 'contract' ? 'عقد رسمي' : 'عرض فني';
    tr.appendChild(tdDocType);
    
    // Original File Name
    const tdFileName = document.createElement('td');
    tdFileName.style.direction = 'ltr';
    tdFileName.style.textAlign = 'right';
    tdFileName.textContent = log.originalFileName || '-';
    tr.appendChild(tdFileName);
    
    // Page Count
    const tdPages = document.createElement('td');
    tdPages.textContent = log.pageCount ? `${log.pageCount} ص` : '-';
    tr.appendChild(tdPages);
    
    // Stamp Applied?
    const tdStamp = document.createElement('td');
    tdStamp.textContent = log.stampApplied ? 'نعم' : 'لا';
    tr.appendChild(tdStamp);
    
    // Status Badge
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
  // Update filter buttons UI
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
