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
      const hourlyRate = (w.daily_wage / (w.standard_hours || 8.0)).toFixed(2);
      const isActive = w.status === 'ACTIVE';

      return `
        <div class="emp-card ${isActive ? '' : 'inactive'}" style="${!isActive ? 'opacity: 0.6; background: #f8fafc;' : ''}">
          <div>
            <div class="emp-header">
              <div>
                <span class="emp-name">${this.escapeHtml(w.name)}</span>
                <span class="worker-badge">${this.escapeHtml(w.employee_code || '')}</span>
              </div>
              <span class="badge ${isActive ? 'text-success' : 'text-muted'}" style="font-weight: 700; font-size: 0.75rem;">
                ${isActive ? '🟢 Active' : '⚪ Inactive'}
              </span>
            </div>

            <div class="text-sm text-muted mb-2">
              <strong>${this.escapeHtml(w.role || 'Daily Worker')}</strong>
              ${w.phone ? ` • 📞 ${this.escapeHtml(w.phone)}` : ''}
            </div>

            <div class="emp-rate-banner">
              <span>Daily Base Wage:</span>
              <span class="emp-rate-val">${API.formatMoney(w.daily_wage)}</span>
            </div>

            <div class="text-xs text-muted">
              Standard: <strong>${w.standard_hours || 8} hrs/day</strong> (${API.currency}${hourlyRate}/hr)<br>
              Overtime Multiplier: <strong>${w.default_ot_multiplier || 1.5}x</strong>
              (${API.currency}${(hourlyRate * (w.default_ot_multiplier || 1.5)).toFixed(2)}/hr OT)
            </div>

            ${w.notes ? `<div class="text-xs text-muted mt-2" style="font-style: italic;">"${this.escapeHtml(w.notes)}"</div>` : ''}
          </div>

          <div class="emp-footer">
            <button class="btn btn-secondary btn-sm" onclick="EmployeesModule.openWorkerModal(${w.id})">
              ✏️ Edit
            </button>
            <button class="btn btn-secondary btn-sm ${isActive ? 'text-rose' : 'text-success'}" onclick="EmployeesModule.toggleStatus(${w.id}, '${isActive ? 'INACTIVE' : 'ACTIVE'}')">
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

    if (workerId) {
      const worker = this.workers.find(w => w.id === workerId);
      if (!worker) return;
      titleEl.textContent = 'Edit Worker';
      idInput.value = worker.id;
      document.getElementById('workerName').value = worker.name;
      document.getElementById('workerCode').value = worker.employee_code || '';
      document.getElementById('workerDailyWage').value = worker.daily_wage;
      document.getElementById('workerStandardHours').value = worker.standard_hours || 8;
      document.getElementById('workerRole').value = worker.role || '';
      document.getElementById('workerDefaultOt').value = worker.default_ot_multiplier || 1.5;
      document.getElementById('workerPhone').value = worker.phone || '';
      document.getElementById('workerStatus').value = worker.status || 'ACTIVE';
      document.getElementById('workerNotes').value = worker.notes || '';
    } else {
      titleEl.textContent = 'Add New Daily Wage Worker';
      idInput.value = '';
      document.getElementById('workerStandardHours').value = API.standardHours || 8;
      document.getElementById('workerDefaultOt').value = API.defaultOtMult || 1.5;
      document.getElementById('workerStatus').value = 'ACTIVE';
    }

    App.openModal('workerModal');
  },

  async handleSaveWorker() {
    const id = document.getElementById('workerId').value;
    const name = document.getElementById('workerName').value.trim();
    const code = document.getElementById('workerCode').value.trim();
    const dailyWage = parseFloat(document.getElementById('workerDailyWage').value);
    const standardHours = parseFloat(document.getElementById('workerStandardHours').value) || 8;
    const role = document.getElementById('workerRole').value.trim();
    const defaultOt = parseFloat(document.getElementById('workerDefaultOt').value) || 1.5;
    const phone = document.getElementById('workerPhone').value.trim();
    const status = document.getElementById('workerStatus').value;
    const notes = document.getElementById('workerNotes').value.trim();

    if (!name || isNaN(dailyWage)) {
      App.showToast('Please enter worker name and valid daily wage', 'error');
      return;
    }

    const payload = {
      name,
      employee_code: code,
      daily_wage: dailyWage,
      standard_hours: standardHours,
      role,
      default_ot_multiplier: defaultOt,
      phone,
      status,
      notes
    };

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
