// Main Application Orchestrator
const App = {
  isUnlocked: false,
  activeTab: 'tabAttendance',

  async init() {
    this.bindGlobalEvents();
    this.bindKeypad();
    this.bindSettingsForms();

    // Check if previously unlocked in this session
    const savedUnlocked = sessionStorage.getItem('admin_unlocked');
    if (savedUnlocked === 'true') {
      this.setUnlockedState(true);
    } else {
      this.promptPin();
    }

    // Load server settings & mobile server info
    try {
      await API.getSettings();
      this.populateSettingsForm();
    } catch (e) {
      console.warn('Initial settings load error:', e);
    }

    // Initialize modules
    AttendanceModule.init();
    EmployeesModule.init();
    PayrollModule.init();
    PaymentsModule.init();
  },

  bindGlobalEvents() {
    // Navigation Tabs
    const tabButtons = document.querySelectorAll('.main-tabs .tab-btn');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        this.switchTab(targetTab);
      });
    });

    // Mobile Connect Button in top bar
    document.getElementById('btnConnectMobile').addEventListener('click', () => {
      this.openMobileConnectModal();
    });

    // Admin Lock/Unlock Button in top bar
    document.getElementById('btnAdminLock').addEventListener('click', () => {
      if (this.isUnlocked) {
        this.lockApp();
      } else {
        this.promptPin();
      }
    });

    // Modal Close Buttons
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.dataset.close;
        this.closeModal(modalId);
      });
    });

    // Copy URL Button in Mobile Connect Modal
    document.getElementById('btnCopyUrl').addEventListener('click', () => {
      const urlText = document.getElementById('mobileUrlDisplay').textContent;
      navigator.clipboard.writeText(urlText).then(() => {
        this.showToast('Server URL copied to clipboard!', 'success');
      }).catch(() => {
        this.showToast('Could not copy automatically', 'error');
      });
    });

    // PIN Form submission
    const pinForm = document.getElementById('pinForm');
    pinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitPin();
    });

    // Manage Paid Holidays Button in top bar
    const btnManageHolidays = document.getElementById('btnManageHolidays');
    if (btnManageHolidays) {
      btnManageHolidays.addEventListener('click', () => {
        this.openHolidayModal();
      });
    }

    // Holiday Form submission
    const holidayForm = document.getElementById('addHolidayForm');
    if (holidayForm) {
      holidayForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.submitAddHoliday();
      });
    }
  },

  // Switch Active Tab
  switchTab(tabId) {
    this.activeTab = tabId;

    // Update tab buttons
    document.querySelectorAll('.main-tabs .tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tabId);
    });

    // Update tab panes
    document.querySelectorAll('.tab-pane').forEach(p => {
      p.classList.toggle('active', p.id === tabId);
    });

    // Trigger refresh for specific tabs
    if (tabId === 'tabAttendance') {
      AttendanceModule.loadAttendance();
    } else if (tabId === 'tabWorkers') {
      EmployeesModule.loadWorkers();
    } else if (tabId === 'tabPayroll') {
      PayrollModule.loadReport();
    } else if (tabId === 'tabPayments') {
      PaymentsModule.loadPayments();
    }
  },

  // Admin PIN Authentication
  promptPin() {
    const modalPinInput = document.getElementById('modalPinInput');
    modalPinInput.value = '';
    document.getElementById('pinErrorMsg').style.display = 'none';
    this.openModal('pinModal');
    setTimeout(() => modalPinInput.focus(), 200);
  },

  async submitPin() {
    const pinInput = document.getElementById('modalPinInput');
    const pin = pinInput.value.trim();
    const errorEl = document.getElementById('pinErrorMsg');

    if (!pin) {
      errorEl.textContent = 'Please enter Admin PIN';
      errorEl.style.display = 'block';
      return;
    }

    try {
      const res = await API.verifyPin(pin);
      if (res.success) {
        this.setUnlockedState(true);
        this.closeModal('pinModal');
        this.showToast('Welcome, Employer! Admin unlocked.', 'success');
      }
    } catch (err) {
      errorEl.textContent = err.message || 'Incorrect PIN';
      errorEl.style.display = 'block';
      pinInput.value = '';
    }
  },

  setUnlockedState(unlocked) {
    this.isUnlocked = unlocked;
    const lockIcon = document.getElementById('lockIcon');
    const lockLabel = document.getElementById('lockLabel');

    if (unlocked) {
      sessionStorage.setItem('admin_unlocked', 'true');
      lockIcon.textContent = '🔓';
      lockLabel.textContent = 'Unlocked';
    } else {
      sessionStorage.removeItem('admin_unlocked');
      lockIcon.textContent = '🔒';
      lockLabel.textContent = 'Locked';
    }
  },

  lockApp() {
    this.setUnlockedState(false);
    this.showToast('Admin session locked', 'success');
    this.promptPin();
  },

  // Onscreen Numeric Keypad for Mobile PIN Entry
  bindKeypad() {
    const pinInput = document.getElementById('modalPinInput');
    const keys = document.querySelectorAll('.keypad-grid .key-btn');

    keys.forEach(key => {
      key.addEventListener('click', (e) => {
        e.preventDefault();
        const action = key.dataset.key;
        if (action === 'CLEAR') {
          pinInput.value = '';
        } else if (action === 'BACK') {
          pinInput.value = pinInput.value.slice(0, -1);
        } else {
          if (pinInput.value.length < 8) {
            pinInput.value += action;
          }
        }
      });
    });
  },

  // Mobile Connect QR Modal
  async openMobileConnectModal() {
    this.openModal('mobileConnectModal');
    const qrImg = document.getElementById('qrCodeImg');
    const urlDisplay = document.getElementById('mobileUrlDisplay');

    urlDisplay.textContent = 'Generating connection details...';

    try {
      const res = await API.getServerInfo();
      if (res.success) {
        qrImg.src = res.qrCodeDataUrl;
        urlDisplay.textContent = res.networkUrl;
      }
    } catch (err) {
      urlDisplay.textContent = 'Error loading connection info';
    }
  },

  // Settings Forms & Storage Management
  bindSettingsForms() {
    const generalForm = document.getElementById('settingsGeneralForm');
    const otForm = document.getElementById('settingsOtForm');
    const pinForm = document.getElementById('changePinForm');

    generalForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const bName = document.getElementById('settingBusinessName').value.trim();
      const sLoc = document.getElementById('settingSiteLocation').value.trim();
      const curr = document.getElementById('settingCurrency').value;

      try {
        const res = await API.updateSettings({
          business_name: bName,
          site_location: sLoc,
          currency_symbol: curr
        });
        if (res.success) {
          document.getElementById('appBusinessName').textContent = bName;
          document.querySelectorAll('.currency-tag').forEach(el => el.textContent = curr);
          this.showToast('Settings saved successfully', 'success');
          // Refresh views to use new currency
          AttendanceModule.loadAttendance();
        }
      } catch (err) {
        this.showToast(`Error: ${err.message}`, 'error');
      }
    });

    otForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const otM = document.getElementById('settingDefaultOtMult').value;

      try {
        const res = await API.updateSettings({
          default_ot_multiplier: otM
        });
        if (res.success) {
          this.showToast('Overtime multiplier defaults updated', 'success');
        }
      } catch (err) {
        this.showToast(`Error: ${err.message}`, 'error');
      }
    });

    pinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPin = document.getElementById('currentPinInput').value;
      const newPin = document.getElementById('newPinInput').value;

      try {
        const res = await API.changePin(currentPin, newPin);
        if (res.success) {
          this.showToast('Admin PIN changed successfully!', 'success');
          pinForm.reset();
        }
      } catch (err) {
        this.showToast(`Error: ${err.message}`, 'error');
      }
    });
  },

  async populateSettingsForm() {
    try {
      const res = await API.getSettings();
      if (res.success && res.settings) {
        const s = res.settings;
        if (s.business_name) {
          document.getElementById('settingBusinessName').value = s.business_name;
          document.getElementById('appBusinessName').textContent = s.business_name;
        }
        if (s.site_location) document.getElementById('settingSiteLocation').value = s.site_location;
        if (s.currency_symbol) {
          document.getElementById('settingCurrency').value = s.currency_symbol;
          document.querySelectorAll('.currency-tag').forEach(el => el.textContent = s.currency_symbol);
        }
        if (s.default_ot_multiplier) document.getElementById('settingDefaultOtMult').value = s.default_ot_multiplier;
      }
    } catch (e) {
      console.warn('Failed to populate settings form:', e);
    }
  },

  // Modal Helpers
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('open');
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('open');
  },

  // Toast Notification Helper
  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️');
    toast.innerHTML = `<span>${icon}</span> <span>${this.escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  // Holiday Management
  async openHolidayModal() {
    this.openModal('holidayModal');
    await this.loadHolidays();
  },

  async loadHolidays() {
    const container = document.getElementById('holidaysListContainer');
    if (!container) return;
    container.innerHTML = '<div class="spinner"></div>';

    try {
      const res = await API.getHolidays();
      if (!res.success || !res.holidays || res.holidays.length === 0) {
        container.innerHTML = '<p class="text-muted" style="font-size: 0.85rem; padding: 12px 0;">No custom paid holidays added yet. Tuesdays are automatically paid off.</p>';
        return;
      }

      container.innerHTML = res.holidays.map(h => `
        <div class="holiday-item" data-id="${h.id}">
          <div class="holiday-item-info">
            <span class="holiday-badge">Paid Holiday</span>
            <strong class="holiday-title">${this.escapeHtml(h.title)}</strong>
            <span class="holiday-date">${this.formatDisplayDate(h.date)}</span>
          </div>
          <button class="btn-icon text-rose btn-delete-holiday" data-id="${h.id}" title="Remove Holiday">🗑️</button>
        </div>
      `).join('');

      container.querySelectorAll('.btn-delete-holiday').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          if (confirm('Are you sure you want to remove this paid holiday?')) {
            try {
              const delRes = await API.deleteHoliday(id);
              if (delRes.success) {
                this.showToast('Holiday removed', 'success');
                await this.loadHolidays();
                // Refresh attendance if on attendance tab
                if (this.activeTab === 'tabAttendance') {
                  AttendanceModule.loadAttendance();
                }
              }
            } catch (err) {
              this.showToast(`Error: ${err.message}`, 'error');
            }
          }
        });
      });
    } catch (err) {
      container.innerHTML = `<p class="text-rose" style="font-size: 0.85rem;">Failed to load holidays: ${this.escapeHtml(err.message)}</p>`;
    }
  },

  async submitAddHoliday() {
    const dateInput = document.getElementById('holidayDateInput');
    const titleInput = document.getElementById('holidayTitleInput');
    const date = dateInput.value;
    const title = titleInput.value.trim();

    if (!date || !title) {
      this.showToast('Please provide both date and holiday title', 'error');
      return;
    }

    try {
      const res = await API.saveHoliday({ date, title });
      if (res.success) {
        this.showToast(`Holiday "${title}" added!`, 'success');
        dateInput.value = '';
        titleInput.value = '';
        await this.loadHolidays();
        if (this.activeTab === 'tabAttendance') {
          AttendanceModule.loadAttendance();
        }
      }
    } catch (err) {
      this.showToast(`Error: ${err.message}`, 'error');
    }
  },

  formatDisplayDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};

// Start application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
