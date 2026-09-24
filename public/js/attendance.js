// Daily Attendance & Overtime Module
const AttendanceModule = {
  currentDate: new Date().toISOString().split('T')[0],
  records: [],
  activeFilter: 'ALL',
  searchQuery: '',

  init() {
    this.bindEvents();
    this.setDate(this.currentDate);
  },

  bindEvents() {
    const datePicker = document.getElementById('attendanceDatePicker');
    const btnPrev = document.getElementById('btnPrevDate');
    const btnNext = document.getElementById('btnNextDate');
    const btnToday = document.getElementById('btnToday');
    const btnMarkAll = document.getElementById('btnMarkAllPresent');
    const searchInput = document.getElementById('attendanceSearch');

    datePicker.addEventListener('change', (e) => {
      this.setDate(e.target.value);
    });

    btnPrev.addEventListener('click', () => {
      const d = new Date(this.currentDate);
      d.setDate(d.getDate() - 1);
      this.setDate(d.toISOString().split('T')[0]);
    });

    btnNext.addEventListener('click', () => {
      const d = new Date(this.currentDate);
      d.setDate(d.getDate() + 1);
      this.setDate(d.toISOString().split('T')[0]);
    });

    btnToday.addEventListener('click', () => {
      this.setDate(new Date().toISOString().split('T')[0]);
    });

    btnMarkAll.addEventListener('click', () => {
      this.markAllPresent();
    });

    searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.render();
    });

    // Filter pills
    document.querySelectorAll('.filter-pills .pill-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-pills .pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeFilter = btn.dataset.filter;
        this.render();
      });
    });
  },

  setDate(dateStr) {
    this.currentDate = dateStr;
    const datePicker = document.getElementById('attendanceDatePicker');
    const dateLabel = document.getElementById('dateDisplayLabel');
    datePicker.value = dateStr;

    const todayStr = new Date().toISOString().split('T')[0];
    const targetDate = new Date(dateStr + 'T00:00:00');
    const options = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
    const formatted = targetDate.toLocaleDateString('en-US', options);

    if (dateStr === todayStr) {
      dateLabel.textContent = `Today (${formatted})`;
    } else {
      dateLabel.textContent = formatted;
    }

    this.loadAttendance();
  },

  async loadAttendance() {
    const listEl = document.getElementById('attendanceList');
    listEl.innerHTML = '<div class="loader-wrap"><div class="spinner"></div><p>Loading attendance...</p></div>';

    try {
      const res = await API.getAttendance(this.currentDate);
      if (res.success) {
        this.records = res.records || [];
        this.updateStats(res.summary);
        this.render();
      }
    } catch (err) {
      listEl.innerHTML = `<div class="error-msg">Failed to load attendance: ${err.message}</div>`;
    }
  },

  updateStats(summary) {
    if (!summary) return;
    document.getElementById('statPresentCount').textContent = summary.totalPresent;
    document.getElementById('statHalfDayCount').textContent = summary.totalHalfDay;
    document.getElementById('statAbsentCount').textContent = summary.totalAbsent;
    document.getElementById('statOtHours').textContent = `${summary.totalOtHours}h`;
    document.getElementById('statTotalWages').textContent = API.formatMoney(summary.totalWagesToday);

    // Update filter counts
    document.getElementById('countAll').textContent = this.records.length;
    document.getElementById('countUnmarked').textContent = summary.totalUnmarked;
  },

  render() {
    const listEl = document.getElementById('attendanceList');
    let filtered = this.records;

    // Apply text search
    if (this.searchQuery) {
      filtered = filtered.filter(r => 
        (r.name && r.name.toLowerCase().includes(this.searchQuery)) ||
        (r.role && r.role.toLowerCase().includes(this.searchQuery)) ||
        (r.employee_code && r.employee_code.toLowerCase().includes(this.searchQuery))
      );
    }

    // Apply status pills
    if (this.activeFilter === 'UNMARKED') {
      filtered = filtered.filter(r => r.status === 'NOT_MARKED');
    } else if (this.activeFilter === 'PRESENT') {
      filtered = filtered.filter(r => r.status === 'PRESENT' || r.status === 'HALF_DAY');
    } else if (this.activeFilter === 'OT') {
      filtered = filtered.filter(r => r.overtime_hours > 0);
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div class="loader-wrap">
          <p>No workers match the current filter.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = filtered.map(r => this.createWorkerCardHtml(r)).join('');
    this.attachCardEventListeners();
  },

  createWorkerCardHtml(r) {
    const isPresent = r.status === 'PRESENT';
    const isHalfDay = r.status === 'HALF_DAY';
    const isAbsent = r.status === 'ABSENT';
    const isUnmarked = r.status === 'NOT_MARKED';

    const hourlyRate = (r.daily_wage / (r.standard_hours || 8.0)).toFixed(2);
    const otMult = r.overtime_multiplier || 1.5;
    const otHours = r.overtime_hours || 0;
    
    // Live calculation breakdown preview
    let basePayDisplay = 0;
    if (isPresent) basePayDisplay = r.daily_wage;
    else if (isHalfDay) basePayDisplay = r.daily_wage * 0.5;

    const otPayDisplay = otHours * (r.daily_wage / (r.standard_hours || 8.0)) * otMult;
    const totalDayEst = basePayDisplay + otPayDisplay;

    return `
      <div class="worker-card status-${r.status}" data-emp-id="${r.employee_id}" id="worker-card-${r.employee_id}">
        <div class="worker-header">
          <div class="worker-info">
            <div class="worker-name">
              <span>${this.escapeHtml(r.name)}</span>
              <span class="worker-badge">${this.escapeHtml(r.role || 'Worker')}</span>
            </div>
            <div class="worker-wage-tag">
              Rate: <span class="worker-wage-rate">${API.formatMoney(r.daily_wage)}/day</span>
              (${r.standard_hours || 8}h @ ${API.currency}${hourlyRate}/h)
            </div>
          </div>
          <div class="today-earnings-badge">
            <div class="text-xs text-muted">Day Earning</div>
            <span class="earning-val" id="earning-${r.employee_id}">${API.formatMoney(totalDayEst)}</span>
          </div>
        </div>

        <!-- 3-Button Status Segment (Thumb-friendly touch) -->
        <div class="status-segment">
          <button type="button" class="status-btn btn-present ${isPresent ? 'selected' : ''}" data-status="PRESENT" data-emp-id="${r.employee_id}">
            <span>✅</span> Present
          </button>
          <button type="button" class="status-btn btn-half ${isHalfDay ? 'selected' : ''}" data-status="HALF_DAY" data-emp-id="${r.employee_id}">
            <span>🌓</span> Half Day
          </button>
          <button type="button" class="status-btn btn-absent ${isAbsent ? 'selected' : ''}" data-status="ABSENT" data-emp-id="${r.employee_id}">
            <span>❌</span> Absent
          </button>
        </div>

        <!-- Overtime Panel -->
        <div class="overtime-panel">
          <div class="ot-controls-row">
            <div class="ot-label-group">
              <span>⏱️ Overtime</span>
            </div>
            
            <!-- Multiplier Selector 1.5x / 2.0x -->
            <div class="ot-multiplier-group">
              <button type="button" class="ot-mult-btn ${otMult === 1.5 ? 'selected' : ''}" data-mult="1.5" data-emp-id="${r.employee_id}">1.5x</button>
              <button type="button" class="ot-mult-btn ${otMult === 2.0 ? 'selected' : ''}" data-mult="2.0" data-emp-id="${r.employee_id}">2.0x</button>
            </div>

            <!-- Stepper: - 0.5h + -->
            <div class="ot-stepper-wrap">
              <button type="button" class="ot-step-btn btn-step-minus" data-emp-id="${r.employee_id}">-</button>
              <input type="number" step="0.5" min="0" max="16" class="ot-input" id="ot-input-${r.employee_id}" value="${otHours}" data-emp-id="${r.employee_id}">
              <span class="text-xs text-muted">hrs</span>
              <button type="button" class="ot-step-btn btn-step-plus" data-emp-id="${r.employee_id}">+</button>
            </div>
          </div>

          <!-- Formula preview -->
          <div class="ot-calc-preview" id="ot-preview-${r.employee_id}">
            <span>OT Rate: ${API.currency}${(hourlyRate * otMult).toFixed(2)}/h (${otMult}x)</span>
            <span>OT Pay: <strong>${API.formatMoney(otPayDisplay)}</strong></span>
          </div>

          <!-- Quick Notes -->
          <input type="text" class="notes-input-mini" placeholder="Notes (e.g. Site B, Late 30m)..." value="${this.escapeHtml(r.notes || '')}" data-emp-id="${r.employee_id}" id="notes-${r.employee_id}">
        </div>

        <!-- Visual Save Feedback -->
        <div class="card-save-status" id="save-status-${r.employee_id}">
          <span>✓ Saved</span>
        </div>
      </div>
    `;
  },

  attachCardEventListeners() {
    // Status button clicks
    document.querySelectorAll('.status-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const empId = parseInt(btn.dataset.empId);
        const status = btn.dataset.status;
        this.updateWorkerAttendance(empId, { status });
      });
    });

    // Overtime multiplier buttons
    document.querySelectorAll('.ot-mult-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const empId = parseInt(btn.dataset.empId);
        const mult = parseFloat(btn.dataset.mult);
        this.updateWorkerAttendance(empId, { overtime_multiplier: mult });
      });
    });

    // Overtime step plus/minus
    document.querySelectorAll('.btn-step-plus').forEach(btn => {
      btn.addEventListener('click', () => {
        const empId = parseInt(btn.dataset.empId);
        const input = document.getElementById(`ot-input-${empId}`);
        let val = (parseFloat(input.value) || 0) + 0.5;
        if (val > 16) val = 16;
        input.value = val;
        this.updateWorkerAttendance(empId, { overtime_hours: val });
      });
    });

    document.querySelectorAll('.btn-step-minus').forEach(btn => {
      btn.addEventListener('click', () => {
        const empId = parseInt(btn.dataset.empId);
        const input = document.getElementById(`ot-input-${empId}`);
        let val = (parseFloat(input.value) || 0) - 0.5;
        if (val < 0) val = 0;
        input.value = val;
        this.updateWorkerAttendance(empId, { overtime_hours: val });
      });
    });

    // Overtime input manual change
    document.querySelectorAll('.ot-input').forEach(input => {
      input.addEventListener('change', () => {
        const empId = parseInt(input.dataset.empId);
        let val = parseFloat(input.value) || 0;
        if (val < 0) val = 0;
        input.value = val;
        this.updateWorkerAttendance(empId, { overtime_hours: val });
      });
    });

    // Notes change
    document.querySelectorAll('.notes-input-mini').forEach(input => {
      input.addEventListener('change', () => {
        const empId = parseInt(input.dataset.empId);
        this.updateWorkerAttendance(empId, { notes: input.value });
      });
    });
  },

  async updateWorkerAttendance(empId, updates) {
    const record = this.records.find(r => r.employee_id === empId);
    if (!record) return;

    // Merge updates locally
    Object.assign(record, updates);

    // If status wasn't chosen yet and OT was touched, default status to PRESENT
    if (record.status === 'NOT_MARKED') {
      record.status = 'PRESENT';
    }

    // Refresh card UI visually
    this.updateCardUi(record);

    try {
      const payload = {
        employee_id: record.employee_id,
        date: this.currentDate,
        status: record.status,
        overtime_hours: record.overtime_hours,
        overtime_multiplier: record.overtime_multiplier,
        bonus_allowance: record.bonus_allowance || 0,
        deduction: record.deduction || 0,
        notes: record.notes || ''
      };

      const res = await API.markAttendance(payload);
      if (res.success) {
        // Flash save feedback
        const saveIndicator = document.getElementById(`save-status-${empId}`);
        if (saveIndicator) {
          saveIndicator.classList.add('show');
          setTimeout(() => saveIndicator.classList.remove('show'), 1500);
        }
        // Recalculate summary metrics
        this.recalculateDailyTotals();
      }
    } catch (err) {
      App.showToast(`Error saving attendance: ${err.message}`, 'error');
    }
  },

  updateCardUi(record) {
    const card = document.getElementById(`worker-card-${record.employee_id}`);
    if (!card) return;

    // Update card classes
    card.className = `worker-card status-${record.status}`;

    // Update status buttons
    const btns = card.querySelectorAll('.status-btn');
    btns.forEach(b => {
      if (b.dataset.status === record.status) {
        b.classList.add('selected');
      } else {
        b.classList.remove('selected');
      }
    });

    // Update multiplier buttons
    const multBtns = card.querySelectorAll('.ot-mult-btn');
    multBtns.forEach(b => {
      if (parseFloat(b.dataset.mult) === (record.overtime_multiplier || 1.5)) {
        b.classList.add('selected');
      } else {
        b.classList.remove('selected');
      }
    });

    // Update OT input
    const otInput = document.getElementById(`ot-input-${record.employee_id}`);
    if (otInput) otInput.value = record.overtime_hours || 0;

    // Recalculate local display earnings
    const hourlyRate = record.daily_wage / (record.standard_hours || 8.0);
    const otMult = record.overtime_multiplier || 1.5;
    const otHours = record.overtime_hours || 0;

    let basePay = 0;
    if (record.status === 'PRESENT') basePay = record.daily_wage;
    else if (record.status === 'HALF_DAY') basePay = record.daily_wage * 0.5;

    const otPay = otHours * hourlyRate * otMult;
    const totalDay = basePay + otPay;

    const earningEl = document.getElementById(`earning-${record.employee_id}`);
    if (earningEl) earningEl.textContent = API.formatMoney(totalDay);

    const otPreviewEl = document.getElementById(`ot-preview-${record.employee_id}`);
    if (otPreviewEl) {
      otPreviewEl.innerHTML = `
        <span>OT Rate: ${API.currency}${(hourlyRate * otMult).toFixed(2)}/h (${otMult}x)</span>
        <span>OT Pay: <strong>${API.formatMoney(otPay)}</strong></span>
      `;
    }
  },

  recalculateDailyTotals() {
    let totalPresent = 0;
    let totalHalfDay = 0;
    let totalAbsent = 0;
    let totalUnmarked = 0;
    let totalOtHours = 0;
    let totalWagesToday = 0;

    for (const item of this.records) {
      if (item.status === 'PRESENT') totalPresent++;
      else if (item.status === 'HALF_DAY') totalHalfDay++;
      else if (item.status === 'ABSENT') totalAbsent++;
      else totalUnmarked++;

      const hourlyRate = item.daily_wage / (item.standard_hours || 8.0);
      let base = 0;
      if (item.status === 'PRESENT') base = item.daily_wage;
      else if (item.status === 'HALF_DAY') base = item.daily_wage * 0.5;

      const ot = (item.overtime_hours || 0) * hourlyRate * (item.overtime_multiplier || 1.5);
      totalOtHours += (item.overtime_hours || 0);
      totalWagesToday += (base + ot);
    }

    this.updateStats({
      totalPresent,
      totalHalfDay,
      totalAbsent,
      totalUnmarked,
      totalOtHours: Math.round(totalOtHours * 10) / 10,
      totalWagesToday: Math.round(totalWagesToday * 100) / 100
    });
  },

  async markAllPresent() {
    if (this.records.length === 0) return;

    const confirmed = confirm(`Mark all ${this.records.length} workers as PRESENT for ${this.currentDate}?`);
    if (!confirmed) return;

    const batchRecords = this.records.map(r => ({
      employee_id: r.employee_id,
      status: 'PRESENT',
      overtime_hours: r.overtime_hours || 0,
      overtime_multiplier: r.overtime_multiplier || 1.5,
      notes: r.notes || ''
    }));

    try {
      const res = await API.batchMarkAttendance(this.currentDate, batchRecords);
      if (res.success) {
        App.showToast(`Marked all workers Present!`, 'success');
        await this.loadAttendance();
      }
    } catch (err) {
      App.showToast(`Batch mark failed: ${err.message}`, 'error');
    }
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
