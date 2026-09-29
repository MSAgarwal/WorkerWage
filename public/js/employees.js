// Workers Management Module
const EmployeesModule = {
  workers: [],
  searchQuery: '',

  init() {
    this.bindEvents();
    this.loadWorkers();
  },

  bindEvents() {
    const btnAdd = document.getElementById('btnOpenAddWorker');
    const workerForm = document.getElementById('workerForm');
    const searchInput = document.getElementById('workerSearch');

    btnAdd.addEventListener('click', () => {
      this.openWorkerModal();
    });

    workerForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSaveWorker();
    });

    searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.render();
    });

    // Toggle Worker Type in modal
    document.querySelectorAll('input[name="workerType"]').forEach(r => {
      r.addEventListener('change', () => {
        const isManager = document.getElementById('workerTypeManager').checked;
        const boxRateWrap = document.getElementById('wrapWorkerBoxRate');
        const notice = document.getElementById('managerExemptNotice');
        if (boxRateWrap) boxRateWrap.style.display = isManager ? 'none' : 'block';
        if (notice) notice.style.display = isManager ? 'flex' : 'none';
      });
    });

    // Event delegation on workersList container
    const workersList = document.getElementById('workersList');
    if (workersList) {
      workersList.addEventListener('click', (e) => {
        const editBtn = e.target.closest('[data-action="edit-worker"]');
        if (editBtn) {
          const id = parseInt(editBtn.dataset.id, 10);
          if (!isNaN(id)) this.openWorkerModal(id);
          return;
        }
        const toggleBtn = e.target.closest('[data-action="toggle-status"]');
        if (toggleBtn) {
          const id = parseInt(toggleBtn.dataset.id, 10);
          const status = toggleBtn.dataset.status;
          if (!isNaN(id)) this.toggleStatus(id, status);
          return;
        }
      });
    }
  },

  async loadWorkers() {
    const container = document.getElementById('workersList');
    container.innerHTML = '<div class="loader-wrap"><div class="spinner"></div><p>Loading workers...</p></div>';

    try {
      const res = await API.getEmployees('ALL');
      if (res.success) {
        this.workers = res.employees || [];
        this.render();
        this.updatePaymentWorkerDropdown();
      }
    } catch (err) {
      container.innerHTML = `<div class="error-msg">Error loading workers: ${err.message}</div>`;
    }
  },

  render() {
    const container = document.getElementById('workersList');
    let filtered = this.workers;

    if (this.searchQuery) {
      filtered = filtered.filter(w =>
        (w.name && w.name.toLowerCase().includes(this.searchQuery)) ||
        (w.role && w.role.toLowerCase().includes(this.searchQuery)) ||
        (w.employee_code && w.employee_code.toLowerCase().includes(this.searchQuery)) ||
        (w.phone && w.phone.includes(this.searchQuery))
      );
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="loader-wrap" style="grid-column: 1 / -1;">
          <p>No workers found. Click "+ Add Worker" to add your workforce.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(w => {
      const isActive = w.status === 'ACTIVE';
      const isManager = w.worker_type === 'MANAGER';
      const boxRate = w.default_box_rate !== undefined && w.default_box_rate !== null ? w.default_box_rate : 30;

      return `
        <div class="emp-card ${isActive ? '' : 'inactive'}" style="${!isActive ? 'opacity: 0.6; background: #f8fafc;' : ''}">
          <div>
            <div class="emp-header">
              <div>
                <span class="emp-name">${this.escapeHtml(w.name)}</span>
                <span class="worker-badge ${isManager ? 'manager-badge' : ''}">${isManager ? '👔 Manager' : '📦 Packaging Worker'}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="btn-key-badge" title="Passbook protected by 5+ digit secret key (changeable in Edit)">🔑 Key Protected</span>
                <span class="badge ${isActive ? 'text-success' : 'text-muted'}" style="font-weight: 700; font-size: 0.75rem;">
                  ${isActive ? '🟢 Active' : '⚪ Inactive'}
                </span>
              </div>
            </div>

            <div class="text-sm text-muted mb-2">
              <strong>${this.escapeHtml(w.role || (isManager ? 'Manager' : 'Packaging Worker'))}</strong>
              <span class="text-xs text-muted">(${this.escapeHtml(w.employee_code || '')})</span>
              ${w.phone ? ` • 📞 ${this.escapeHtml(w.phone)}` : ''}
            </div>

            <div class="emp-rate-banner">
              <span>Daily Base Wage:</span>
              <span class="emp-rate-val">${API.formatMoney(w.daily_wage)}/day</span>
            </div>

            ${isManager ? `
              <div class="text-xs text-purple" style="font-weight: 600;">
                👔 Manager: Fixed daily wage (Exempt from packaging work categories & box overtime)
              </div>
            ` : `
              <div class="text-xs text-muted">
                Overtime Rate: <strong>${API.formatMoney(boxRate)}/box</strong> (Based on extra boxes packed)
              </div>
            `}

            ${w.notes ? `<div class="text-xs text-muted mt-2" style="font-style: italic;">"${this.escapeHtml(w.notes)}"</div>` : ''}
          </div>

          <div class="emp-footer">
            <button class="btn btn-secondary btn-sm" onclick="App.viewWorkerPassbookAsAdmin(${w.id})" title="View Worker Passbook">
              📖 Passbook
            </button>
            <button class="btn btn-secondary btn-sm" data-action="edit-worker" data-id="${w.id}" onclick="EmployeesModule.openWorkerModal(${w.id})">
              ✏️ Edit
            </button>
            <button class="btn btn-secondary btn-sm ${isActive ? 'text-rose' : 'text-success'}" data-action="toggle-status" data-id="${w.id}" data-status="${isActive ? 'INACTIVE' : 'ACTIVE'}" onclick="EmployeesModule.toggleStatus(${w.id}, '${isActive ? 'INACTIVE' : 'ACTIVE'}')">
              ${isActive ? 'Deactivate' : 'Reactivate'}
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  openWorkerModal(workerId = null) {
    const modal = document.getElementById('workerModal');
    const form = document.getElementById('workerForm');
    form.reset();

    const titleEl = document.getElementById('workerModalTitle');
    const idInput = document.getElementById('workerId');
    const boxRateWrap = document.getElementById('wrapWorkerBoxRate');
    const notice = document.getElementById('managerExemptNotice');

    if (workerId) {
      const worker = this.workers.find(w => w.id === workerId);
      if (!worker) return;
      const isManager = worker.worker_type === 'MANAGER';
      titleEl.textContent = isManager ? 'Edit Manager' : 'Edit Worker';
      idInput.value = worker.id;
      document.getElementById('workerName').value = worker.name;
      document.getElementById('workerCode').value = worker.employee_code || '';
      document.getElementById('workerDailyWage').value = worker.daily_wage;
      document.getElementById('workerRole').value = worker.role || '';
      document.getElementById('workerDefaultBoxRate').value = worker.default_box_rate !== undefined ? worker.default_box_rate : 30;
      document.getElementById('workerPhone').value = worker.phone || '';
      document.getElementById('workerStatus').value = worker.status || 'ACTIVE';
      document.getElementById('workerNotes').value = worker.notes || '';

      const pinInput = document.getElementById('workerPin');
      if (pinInput) {
        pinInput.value = '';
        pinInput.placeholder = 'Leave blank to keep existing password';
      }

      if (isManager) {
        document.getElementById('workerTypeManager').checked = true;
        if (boxRateWrap) boxRateWrap.style.display = 'none';
        if (notice) notice.style.display = 'flex';
      } else {
        document.getElementById('workerTypeWorker').checked = true;
        if (boxRateWrap) boxRateWrap.style.display = 'block';
        if (notice) notice.style.display = 'none';
      }
    } else {
      titleEl.textContent = 'Add New Worker / Manager';
      idInput.value = '';
      document.getElementById('workerTypeWorker').checked = true;
      document.getElementById('workerDefaultBoxRate').value = API.defaultBoxRate || 30;
      document.getElementById('workerStatus').value = 'ACTIVE';

      const pinInput = document.getElementById('workerPin');
      if (pinInput) {
        pinInput.value = '12345';
        pinInput.placeholder = 'e.g. 12345 (Default: 12345)';
      }

      if (boxRateWrap) boxRateWrap.style.display = 'block';
      if (notice) notice.style.display = 'none';
    }

    App.openModal('workerModal');
  },

  async handleSaveWorker() {
    const id = document.getElementById('workerId').value;
    const name = document.getElementById('workerName').value.trim();
    const code = document.getElementById('workerCode').value.trim();
    const workerType = document.querySelector('input[name="workerType"]:checked')?.value || 'WORKER';
    const dailyWage = parseFloat(document.getElementById('workerDailyWage').value);
    const role = document.getElementById('workerRole').value.trim();
    let defaultBoxRate = parseFloat(document.getElementById('workerDefaultBoxRate').value);
    if (isNaN(defaultBoxRate) || defaultBoxRate < 0) defaultBoxRate = 30.0;
    const phone = document.getElementById('workerPhone').value.trim();
    const status = document.getElementById('workerStatus').value;
    const pin = document.getElementById('workerPin') ? document.getElementById('workerPin').value.trim() : '';
    const notes = document.getElementById('workerNotes').value.trim();

    if (!name || isNaN(dailyWage)) {
      App.showToast('Please enter worker name and valid daily wage', 'error');
      return;
    }

    if (pin && pin.length < 5) {
      App.showToast('Worker passbook secret key must be at least 5 digits', 'error');
      return;
    }

    const payload = {
      name,
      employee_code: code,
      worker_type: workerType,
      daily_wage: dailyWage,
      role: role || (workerType === 'MANAGER' ? 'Manager' : 'Packaging Worker'),
      default_box_rate: defaultBoxRate,
      default_ot_multiplier: 0.0,
      phone,
      status,
      notes
    };

    if (pin) payload.pin = pin;
    if (id) payload.id = id;

    try {
      const res = await API.saveEmployee(payload);
      if (res.success) {
        App.showToast(id ? 'Worker updated successfully!' : 'Worker added successfully!', 'success');
        App.closeModal('workerModal');
        await this.loadWorkers();
        // Also refresh daily attendance sheet if active
        if (AttendanceModule) AttendanceModule.loadAttendance();
      }
    } catch (err) {
      App.showToast(`Error: ${err.message}`, 'error');
    }
  },

  async toggleStatus(id, newStatus) {
    const worker = this.workers.find(w => w.id === id);
    if (!worker) return;

    try {
      const res = await API.saveEmployee({ ...worker, status: newStatus });
      if (res.success) {
        App.showToast(`Worker status updated to ${newStatus}`, 'success');
        await this.loadWorkers();
        if (AttendanceModule) AttendanceModule.loadAttendance();
      }
    } catch (err) {
      App.showToast(`Error: ${err.message}`, 'error');
    }
  },

  updatePaymentWorkerDropdown() {
    const select = document.getElementById('paymentWorkerSelect');
    const filterSelect = document.getElementById('paymentWorkerFilter');
    if (!select) return;

    const activeWorkers = this.workers.filter(w => w.status === 'ACTIVE');

    let opts = '<option value="">Select Worker...</option>';
    let filterOpts = '<option value="">All Workers</option>';

    activeWorkers.forEach(w => {
      opts += `<option value="${w.id}">${this.escapeHtml(w.name)} (${this.escapeHtml(w.role || 'Worker')})</option>`;
      filterOpts += `<option value="${w.id}">${this.escapeHtml(w.name)}</option>`;
    });

    select.innerHTML = opts;
    if (filterSelect) filterSelect.innerHTML = filterOpts;
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

window.EmployeesModule = EmployeesModule;
