// Daily Attendance & Overtime Module (Day-Wise with Tuesday & Paid Holiday rules)
const AttendanceModule = {
  currentDate: new Date().toISOString().split('T')[0],
  dateMeta: null,
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
      this.markAllDefault();
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
        this.dateMeta = res.meta || {};
        this.updateHolidayBanner(this.dateMeta);
        this.updateStats(res.summary);
        this.render();
      }
    } catch (err) {
      listEl.innerHTML = `<div class="error-msg">Failed to load attendance: ${err.message}</div>`;
    }
  },

  updateHolidayBanner(meta) {
    const banner = document.getElementById('holidayBanner');
    const btnMarkAll = document.getElementById('btnMarkAllPresent');
    if (!banner) return;

    if (meta && meta.isPaidDayOff) {
      banner.style.display = 'flex';
      banner.className = `holiday-banner ${meta.isTuesday ? 'tuesday-off' : 'custom-holiday'}`;
      banner.innerHTML = `
        <div class="holiday-banner-icon">${meta.isTuesday ? '🌴' : '🎉'}</div>
        <div class="holiday-banner-text">
          <div class="holiday-banner-title">${meta.dayOffReason}</div>
          <div class="holiday-banner-desc">
            Every worker receives their full day's paid wage today. If any worker came to work on this day, click <strong>"Worked on Holiday"</strong> on their card to calculate extra Overtime Pay!
          </div>
        </div>
      `;
      if (btnMarkAll) {
        btnMarkAll.innerHTML = `<span>🌴</span> Mark All Paid Leave`;
      }
    } else {
      banner.style.display = 'none';
      if (btnMarkAll) {
        btnMarkAll.innerHTML = `<span>⚡</span> Mark All Present`;
      }
    }
  },

  updateStats(summary) {
    if (!summary) return;
    document.getElementById('statPresentCount').textContent = summary.totalPresent || 0;
    document.getElementById('statHalfDayCount').textContent = summary.totalHalfDay || 0;
    const paidLeaveEl = document.getElementById('statPaidLeaveCount');
    if (paidLeaveEl) paidLeaveEl.textContent = summary.totalPaidLeave || 0;
    document.getElementById('statAbsentCount').textContent = summary.totalAbsent || 0;
    document.getElementById('statOtHours').textContent = `${(summary.totalOtDays !== undefined ? summary.totalOtDays : (summary.totalOtHours || 0))}d`;
    document.getElementById('statTotalWages').textContent = API.formatMoney(summary.totalWagesToday);

    // Update filter counts
    document.getElementById('countAll').textContent = this.records.length;
    document.getElementById('countUnmarked').textContent = summary.totalUnmarked || 0;
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
    } else if (this.activeFilter === 'PAID_OFF') {
      filtered = filtered.filter(r => r.status === 'PAID_LEAVE' || r.status === 'PAID_HOLIDAY');
    } else if (this.activeFilter === 'OT') {
      filtered = filtered.filter(r => (r.overtime_days || r.overtime_hours || 0) > 0 || r.is_holiday_work);
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
    const isPaidDayOff = !!(this.dateMeta && this.dateMeta.isPaidDayOff);
    const isHolidayWork = !!r.is_holiday_work;
    const isPresent = r.status === 'PRESENT';
    const isHalfDay = r.status === 'HALF_DAY';
    const isPaidLeave = r.status === 'PAID_LEAVE' || r.status === 'PAID_HOLIDAY';
    const isAbsent = r.status === 'ABSENT';

    const otMult = Number(r.overtime_multiplier !== undefined ? r.overtime_multiplier : 1.5);
    const otDays = Number(r.overtime_days !== undefined ? r.overtime_days : (r.overtime_hours || 0));

    // Live calculation breakdown preview (Day-Wise)
    let basePayDisplay = 0;
    if (isPresent || isPaidLeave) {
      basePayDisplay = r.daily_wage;
    } else if (isHalfDay) {
      basePayDisplay = r.daily_wage * 0.5;
    }

    const otPayDisplay = otDays * r.daily_wage * otMult;
    const totalDayEst = basePayDisplay + otPayDisplay;

    // Special Layout for Tuesdays / Paid Holidays
    if (isPaidDayOff) {
      return `
        <div class="worker-card holiday-mode status-${r.status}" data-emp-id="${r.employee_id}" id="worker-card-${r.employee_id}">
          <div class="worker-header">
            <div class="worker-info">
              <div class="worker-name">
                <span>${this.escapeHtml(r.name)}</span>
                <span class="worker-badge">${this.escapeHtml(r.role || 'Worker')}</span>
                <span class="badge-holiday-tag">🌴 ${this.dateMeta.isTuesday ? 'Tue Off' : 'Holiday'}</span>
              </div>
              <div class="worker-wage-tag">
                Daily Rate: <span class="worker-wage-rate">${API.formatMoney(r.daily_wage)}/day</span>
              </div>
            </div>
            <div class="today-earnings-badge highlight-pay">
              <div class="text-xs text-muted">Day Total</div>
              <span class="earning-val" id="earning-${r.employee_id}">${API.formatMoney(totalDayEst)}</span>
            </div>
          </div>

          <!-- Holiday Status Action Segment -->
          <div class="holiday-status-segment">
            <button type="button" class="status-btn btn-paid-leave ${(!isHolidayWork && isPaidLeave) ? 'selected' : ''}" data-status="PAID_LEAVE" data-holiday-work="0" data-emp-id="${r.employee_id}">
              <span>🌴</span> Off (Paid Full Day)
            </button>
            <button type="button" class="status-btn btn-worked-holiday ${isHolidayWork ? 'selected' : ''}" data-status="PAID_LEAVE" data-holiday-work="1" data-emp-id="${r.employee_id}">
              <span>👷</span> Worked Today (+Overtime)
            </button>
            <button type="button" class="status-btn btn-absent ${isAbsent ? 'selected' : ''}" data-status="ABSENT" data-holiday-work="0" data-emp-id="${r.employee_id}" title="Unexcused Unpaid Absence">
              <span>❌</span> Absent
            </button>
          </div>

          <!-- Overtime Section (active when worked holiday or custom OT days) -->
          <div class="overtime-panel ${isHolidayWork ? 'holiday-active' : ''}">
            <div class="ot-controls-row">
              <div class="ot-label-group">
                <span>⏱️ Overtime Work (in Days)</span>
              </div>

              <!-- Stepper: - 0.5d + -->
              <div class="ot-stepper-wrap">
                <button type="button" class="ot-step-btn btn-step-minus" data-emp-id="${r.employee_id}">-</button>
                <input type="number" step="0.25" min="0" max="5" class="ot-input" id="ot-input-${r.employee_id}" value="${otDays}" data-emp-id="${r.employee_id}">
                <span class="text-xs text-muted">days</span>
                <button type="button" class="ot-step-btn btn-step-plus" data-emp-id="${r.employee_id}">+</button>
              </div>
            </div>

            <!-- Multiplier Control: 0 to 3 in float up to 2 decimals -->
            <div class="ot-mult-row">
              <div class="ot-mult-label">
                <span>Overtime Multiplier:</span>
              </div>
              <div class="ot-chips-wrap">
                <button type="button" class="ot-chip-btn ${Math.abs(otMult - 1.0) < 0.001 ? 'selected' : ''}" data-mult="1.00" data-emp-id="${r.employee_id}">1.0x</button>
                <button type="button" class="ot-chip-btn ${Math.abs(otMult - 1.5) < 0.001 ? 'selected' : ''}" data-mult="1.50" data-emp-id="${r.employee_id}">1.5x</button>
                <button type="button" class="ot-chip-btn ${Math.abs(otMult - 2.0) < 0.001 ? 'selected' : ''}" data-mult="2.00" data-emp-id="${r.employee_id}">2.0x</button>
              </div>
              <div class="ot-custom-mult-wrap">
                <input type="number" min="0" max="3" step="0.01" class="ot-mult-input" id="ot-mult-${r.employee_id}" value="${otMult.toFixed(2)}" data-emp-id="${r.employee_id}" title="Multiplier 0.00 to 3.00">
                <span class="ot-mult-suffix">x</span>
              </div>
            </div>

            <!-- Formula preview -->
            <div class="ot-calc-preview" id="ot-preview-${r.employee_id}">
              <span>Paid Day: ${API.formatMoney(basePayDisplay)}</span>
              <span>OT: ${otDays > 0 ? `${otDays}d @ ${otMult.toFixed(2)}x = <strong>${API.formatMoney(otPayDisplay)}</strong>` : '0d'}</span>
            </div>

            <!-- Quick Notes -->
            <input type="text" class="notes-input-mini" placeholder="Notes (e.g. Came for urgent site work)..." value="${this.escapeHtml(r.notes || '')}" data-emp-id="${r.employee_id}" id="notes-${r.employee_id}">
          </div>

          <!-- Visual Save Feedback -->
          <div class="card-save-status" id="save-status-${r.employee_id}">
            <span>✓ Saved</span>
          </div>
        </div>
      `;
    }

    // Regular Working Day Layout (Day-Wise)
    return `
      <div class="worker-card status-${r.status}" data-emp-id="${r.employee_id}" id="worker-card-${r.employee_id}">
        <div class="worker-header">
          <div class="worker-info">
            <div class="worker-name">
              <span>${this.escapeHtml(r.name)}</span>
              <span class="worker-badge">${this.escapeHtml(r.role || 'Worker')}</span>
            </div>
            <div class="worker-wage-tag">
              Daily Rate: <span class="worker-wage-rate">${API.formatMoney(r.daily_wage)}/day</span>
            </div>
          </div>
          <div class="today-earnings-badge">
            <div class="text-xs text-muted">Day Total</div>
            <span class="earning-val" id="earning-${r.employee_id}">${API.formatMoney(totalDayEst)}</span>
          </div>
        </div>

        <!-- 4-Button Day Status Segment -->
        <div class="status-segment four-cols">
          <button type="button" class="status-btn btn-present ${isPresent ? 'selected' : ''}" data-status="PRESENT" data-holiday-work="0" data-emp-id="${r.employee_id}">
            <span>✅</span> Full (1d)
          </button>
          <button type="button" class="status-btn btn-half ${isHalfDay ? 'selected' : ''}" data-status="HALF_DAY" data-holiday-work="0" data-emp-id="${r.employee_id}">
            <span>🌓</span> Half (0.5d)
          </button>
          <button type="button" class="status-btn btn-absent ${isAbsent ? 'selected' : ''}" data-status="ABSENT" data-holiday-work="0" data-emp-id="${r.employee_id}">
            <span>❌</span> Absent
          </button>
          <button type="button" class="status-btn btn-paid-leave ${isPaidLeave ? 'selected' : ''}" data-status="PAID_LEAVE" data-holiday-work="0" data-emp-id="${r.employee_id}">
            <span>🌴</span> Paid Leave
          </button>
        </div>

        <!-- Overtime Panel (Day-Wise) -->
        <div class="overtime-panel">
          <div class="ot-controls-row">
            <div class="ot-label-group">
              <span>⏱️ Overtime (in Days)</span>
            </div>

            <!-- Stepper: - 0.25d / 0.5d + -->
            <div class="ot-stepper-wrap">
              <button type="button" class="ot-step-btn btn-step-minus" data-emp-id="${r.employee_id}">-</button>
              <input type="number" step="0.25" min="0" max="5" class="ot-input" id="ot-input-${r.employee_id}" value="${otDays}" data-emp-id="${r.employee_id}">
              <span class="text-xs text-muted">days</span>
              <button type="button" class="ot-step-btn btn-step-plus" data-emp-id="${r.employee_id}">+</button>
            </div>
          </div>

          <!-- Multiplier Control: 0 to 3 in float up to 2 decimals -->
          <div class="ot-mult-row">
            <div class="ot-mult-label">
              <span>OT Multiplier:</span>
            </div>
            <div class="ot-chips-wrap">
              <button type="button" class="ot-chip-btn ${Math.abs(otMult - 1.0) < 0.001 ? 'selected' : ''}" data-mult="1.00" data-emp-id="${r.employee_id}">1.0x</button>
              <button type="button" class="ot-chip-btn ${Math.abs(otMult - 1.5) < 0.001 ? 'selected' : ''}" data-mult="1.50" data-emp-id="${r.employee_id}">1.5x</button>
              <button type="button" class="ot-chip-btn ${Math.abs(otMult - 2.0) < 0.001 ? 'selected' : ''}" data-mult="2.00" data-emp-id="${r.employee_id}">2.0x</button>
            </div>
            <div class="ot-custom-mult-wrap">
              <input type="number" min="0" max="3" step="0.01" class="ot-mult-input" id="ot-mult-${r.employee_id}" value="${otMult.toFixed(2)}" data-emp-id="${r.employee_id}" title="Multiplier 0.00 to 3.00">
              <span class="ot-mult-suffix">x</span>
            </div>
          </div>

          <!-- Formula preview (Day-Wise) -->
          <div class="ot-calc-preview" id="ot-preview-${r.employee_id}">
            <span>Base Wage: ${API.formatMoney(basePayDisplay)}</span>
            <span>OT: ${otDays > 0 ? `${otDays}d @ ${otMult.toFixed(2)}x = <strong>${API.formatMoney(otPayDisplay)}</strong>` : '0d'}</span>
          </div>

          <!-- Quick Notes -->
          <input type="text" class="notes-input-mini" placeholder="Notes (e.g. Worked extra half day)..." value="${this.escapeHtml(r.notes || '')}" data-emp-id="${r.employee_id}" id="notes-${r.employee_id}">
        </div>

        <!-- Visual Save Feedback -->
        <div class="card-save-status" id="save-status-${r.employee_id}">
          <span>✓ Saved</span>
        </div>
      </div>
    `;
  },

  attachCardEventListeners() {
    // Status button clicks (handles both regular and holiday segments)
    document.querySelectorAll('.status-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const empId = parseInt(btn.dataset.empId);
        const status = btn.dataset.status;
        const holidayWork = btn.dataset.holidayWork === '1';

        const updates = { status, is_holiday_work: holidayWork };

        // If clicking "Worked on Holiday", default overtime_days to 1.0 if currently 0
        if (holidayWork) {
          const rec = this.records.find(r => r.employee_id === empId);
          if (rec && (!rec.overtime_days || rec.overtime_days === 0)) {
            updates.overtime_days = 1.0;
          }
        } else if (btn.dataset.holidayWork === '0' && this.dateMeta && this.dateMeta.isPaidDayOff) {
          // If tapping "Off (Paid Leave)", reset OT days to 0
          updates.overtime_days = 0;
        }

        this.updateWorkerAttendance(empId, updates);
      });
    });

    // Overtime preset chip buttons
    document.querySelectorAll('.ot-chip-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const empId = parseInt(btn.dataset.empId);
        const mult = parseFloat(btn.dataset.mult);
        this.updateWorkerAttendance(empId, { overtime_multiplier: mult });
      });
    });

    // Custom overtime multiplier input (0.00 to 3.00)
    document.querySelectorAll('.ot-mult-input').forEach(input => {
      input.addEventListener('change', () => {
        const empId = parseInt(input.dataset.empId);
        let val = parseFloat(input.value);
        if (isNaN(val)) val = 1.5;
        val = Math.max(0, Math.min(3.0, Math.round(val * 100) / 100));
        input.value = val.toFixed(2);
        this.updateWorkerAttendance(empId, { overtime_multiplier: val });
      });
    });

    // Overtime step plus/minus (Day-Wise: step by 0.25d or 0.5d)
    document.querySelectorAll('.btn-step-plus').forEach(btn => {
      btn.addEventListener('click', () => {
        const empId = parseInt(btn.dataset.empId);
        const input = document.getElementById(`ot-input-${empId}`);
        let val = (parseFloat(input.value) || 0) + 0.5;
        if (val > 5) val = 5;
        input.value = val;
        this.updateWorkerAttendance(empId, { overtime_days: val });
      });
    });

    document.querySelectorAll('.btn-step-minus').forEach(btn => {
      btn.addEventListener('click', () => {
        const empId = parseInt(btn.dataset.empId);
        const input = document.getElementById(`ot-input-${empId}`);
        let val = (parseFloat(input.value) || 0) - 0.5;
        if (val < 0) val = 0;
        input.value = val;
        this.updateWorkerAttendance(empId, { overtime_days: val });
      });
    });

    // Overtime input manual change
    document.querySelectorAll('.ot-input').forEach(input => {
      input.addEventListener('change', () => {
        const empId = parseInt(input.dataset.empId);
        let val = parseFloat(input.value) || 0;
        if (val < 0) val = 0;
        if (val > 5) val = 5;
        input.value = val;
        this.updateWorkerAttendance(empId, { overtime_days: val });
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

    // Ensure overtime multiplier is valid float between 0.00 and 3.00
    if (record.overtime_multiplier !== undefined) {
      record.overtime_multiplier = Math.max(0, Math.min(3.0, Math.round(Number(record.overtime_multiplier) * 100) / 100));
    }

    // Default status if not marked
    if (record.status === 'NOT_MARKED') {
      record.status = (this.dateMeta && this.dateMeta.isPaidDayOff) ? 'PAID_LEAVE' : 'PRESENT';
    }

    // Refresh card UI visually
    this.updateCardUi(record);

    try {
      const payload = {
        employee_id: record.employee_id,
        date: this.currentDate,
        status: record.status,
        overtime_days: record.overtime_days !== undefined ? record.overtime_days : (record.overtime_hours || 0),
        overtime_multiplier: record.overtime_multiplier,
        is_holiday_work: record.is_holiday_work ? 1 : 0,
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
    card.className = `worker-card status-${record.status} ${record.is_holiday_work ? 'holiday-worked' : ''}`;

    // Update status buttons
    const btns = card.querySelectorAll('.status-btn');
    btns.forEach(b => {
      const isWorkedHolidayBtn = b.dataset.holidayWork === '1';
      if (isWorkedHolidayBtn) {
        b.classList.toggle('selected', !!record.is_holiday_work);
      } else if (b.dataset.holidayWork === '0' && this.dateMeta && this.dateMeta.isPaidDayOff && b.dataset.status === 'PAID_LEAVE') {
        b.classList.toggle('selected', !record.is_holiday_work && (record.status === 'PAID_LEAVE' || record.status === 'PAID_HOLIDAY'));
      } else {
        b.classList.toggle('selected', b.dataset.status === record.status && !record.is_holiday_work);
      }
    });

    const otMult = Number(record.overtime_multiplier !== undefined ? record.overtime_multiplier : 1.5);
    const otDays = Number(record.overtime_days !== undefined ? record.overtime_days : (record.overtime_hours || 0));

    // Update multiplier preset chips
    const chipBtns = card.querySelectorAll('.ot-chip-btn');
    chipBtns.forEach(b => {
      const chipVal = parseFloat(b.dataset.mult);
      b.classList.toggle('selected', Math.abs(chipVal - otMult) < 0.001);
    });

    // Update custom multiplier input
    const multInput = document.getElementById(`ot-mult-${record.employee_id}`);
    if (multInput) {
      multInput.value = otMult.toFixed(2);
    }

    // Update OT days input
    const otInput = document.getElementById(`ot-input-${record.employee_id}`);
    if (otInput) otInput.value = otDays;

    // Recalculate local display earnings (Day-Wise)
    let basePay = 0;
    if (record.status === 'PRESENT' || record.status === 'PAID_LEAVE' || record.status === 'PAID_HOLIDAY') {
      basePay = record.daily_wage;
    } else if (record.status === 'HALF_DAY') {
      basePay = record.daily_wage * 0.5;
    }

    const otPay = otDays * record.daily_wage * otMult;
    const totalDay = basePay + otPay;

    const earningEl = document.getElementById(`earning-${record.employee_id}`);
    if (earningEl) earningEl.textContent = API.formatMoney(totalDay);

    const otPreviewEl = document.getElementById(`ot-preview-${record.employee_id}`);
    if (otPreviewEl) {
      otPreviewEl.innerHTML = `
        <span>Base: ${API.formatMoney(basePay)}</span>
        <span>OT: ${otDays > 0 ? `${otDays}d @ ${otMult.toFixed(2)}x = <strong>${API.formatMoney(otPay)}</strong>` : '0d'}</span>
      `;
    }
  },

  recalculateDailyTotals() {
    let totalPresent = 0;
    let totalHalfDay = 0;
    let totalPaidLeave = 0;
    let totalAbsent = 0;
    let totalUnmarked = 0;
    let totalOtDays = 0;
    let totalHolidayWorkers = 0;
    let totalWagesToday = 0;

    for (const item of this.records) {
      if (item.status === 'PRESENT') totalPresent++;
      else if (item.status === 'HALF_DAY') totalHalfDay++;
      else if (item.status === 'PAID_LEAVE' || item.status === 'PAID_HOLIDAY') totalPaidLeave++;
      else if (item.status === 'ABSENT') totalAbsent++;
      else totalUnmarked++;

      if (item.is_holiday_work) totalHolidayWorkers++;

      let base = 0;
      if (item.status === 'PRESENT' || item.status === 'PAID_LEAVE' || item.status === 'PAID_HOLIDAY') {
        base = item.daily_wage;
      } else if (item.status === 'HALF_DAY') {
        base = item.daily_wage * 0.5;
      }

      const otDays = (item.overtime_days !== undefined ? item.overtime_days : (item.overtime_hours || 0));
      const ot = otDays * item.daily_wage * (item.overtime_multiplier || 1.5);
      totalOtDays += otDays;
      totalWagesToday += (base + ot);
    }

    this.updateStats({
      totalPresent,
      totalHalfDay,
      totalPaidLeave,
      totalAbsent,
      totalUnmarked,
      totalOtDays: Math.round(totalOtDays * 100) / 100,
      totalHolidayWorkers,
      totalWagesToday: Math.round(totalWagesToday * 100) / 100
    });
  },

  async markAllDefault() {
    if (this.records.length === 0) return;

    const isDayOff = !!(this.dateMeta && this.dateMeta.isPaidDayOff);
    const targetStatus = isDayOff ? 'PAID_LEAVE' : 'PRESENT';
    const actionLabel = isDayOff ? 'PAID LEAVE (Weekly Off / Holiday)' : 'PRESENT (Full Day)';

    const confirmed = confirm(`Mark all ${this.records.length} workers as ${actionLabel} for ${this.currentDate}?`);
    if (!confirmed) return;

    const batchRecords = this.records.map(r => ({
      employee_id: r.employee_id,
      status: targetStatus,
      overtime_days: 0,
      overtime_multiplier: r.overtime_multiplier || 1.5,
      is_holiday_work: 0,
      notes: isDayOff ? (this.dateMeta.dayOffReason || 'Paid Leave') : ''
    }));

    try {
      const res = await API.batchMarkAttendance(this.currentDate, batchRecords);
      if (res.success) {
        App.showToast(`Marked all workers as ${targetStatus}!`, 'success');
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
