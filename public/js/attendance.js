// Daily Attendance & Overtime Module (Day-Wise with Tuesday & Paid Holiday rules)
const AttendanceModule = {
  currentDate: API.getLocalDateString(),
  dateMeta: null,
  records: [],
  activeFilter: 'ALL',
  searchQuery: '',

  init() {
    this.bindEvents();
    this.currentDate = API.getLocalDateString();
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
      const [y, m, day] = this.currentDate.split('-').map(Number);
      const d = new Date(y, m - 1, day);
      d.setDate(d.getDate() - 1);
      this.setDate(API.getLocalDateString(d));
    });

    btnNext.addEventListener('click', () => {
      const [y, m, day] = this.currentDate.split('-').map(Number);
      const d = new Date(y, m - 1, day);
      d.setDate(d.getDate() + 1);
      this.setDate(API.getLocalDateString(d));
    });

    btnToday.addEventListener('click', () => {
      this.setDate(API.getLocalDateString());
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

    const todayStr = API.getLocalDateString();
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
            Every worker receives their full day's paid wage today. If any worker worked today, click <strong>"Worked Today (+Overtime)"</strong> to add the fixed <strong>₹200</strong> holiday overtime pay!
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

  isPieceCategory(cat) {
    return API.isPieceCategory(cat);
  },

  updateStats(summary) {
    if (!summary) return;
    document.getElementById('statPresentCount').textContent = summary.totalPresent || 0;
    document.getElementById('statHalfDayCount').textContent = summary.totalHalfDay || 0;
    const paidLeaveEl = document.getElementById('statPaidLeaveCount');
    if (paidLeaveEl) paidLeaveEl.textContent = summary.totalPaidLeave || 0;
    document.getElementById('statAbsentCount').textContent = summary.totalAbsent || 0;
    const otDaysEl = document.getElementById('statOtDays');
    if (otDaysEl) {
      const parts = [];
      if (summary.totalExtraBoxes > 0) parts.push(`${summary.totalExtraBoxes} bxs`);
      if (summary.totalExtraPieces > 0) parts.push(`${summary.totalExtraPieces.toLocaleString()} pcs`);
      otDaysEl.textContent = parts.length > 0 ? parts.join(' / ') : '0 units';
    }
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
        (r.employee_code && r.employee_code.toLowerCase().includes(this.searchQuery)) ||
        (r.work_category && r.work_category.toLowerCase().includes(this.searchQuery))
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
      filtered = filtered.filter(r => (r.extra_pieces || 0) > 0 || (r.extra_boxes || 0) > 0 || (r.overtime_days || 0) > 0 || r.is_holiday_work);
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
    const isManager = r.worker_type === 'MANAGER';
    const currentCat = r.work_category || '';
    const isPiece = this.isPieceCategory(currentCat);

    const extraBoxes = Number(r.extra_boxes || 0);
    const extraPieces = Number(r.extra_pieces !== undefined && r.extra_pieces !== null 
      ? r.extra_pieces 
      : (isPiece && extraBoxes > 0 ? (extraBoxes >= 100 ? extraBoxes : extraBoxes * 500) : 0));

    const boxRate = Number(r.box_rate !== undefined && r.box_rate !== null ? r.box_rate : (API.defaultBoxRate || 30.0));
    const otDays = Number(r.overtime_days || 0);
    const otMult = Number(r.overtime_multiplier || 0);

    // Live calculation breakdown preview
    let basePayDisplay = 0;
    if (isPresent || isPaidLeave) {
      basePayDisplay = r.daily_wage;
    } else if (isHalfDay) {
      basePayDisplay = r.daily_wage * 0.5;
    }

    let otPayDisplay = 0;
    if (isManager) {
      otPayDisplay = otDays * r.daily_wage * otMult;
    } else if (isPiece) {
      if (isPaidDayOff && isHolidayWork && !isAbsent) {
        otPayDisplay = 200;
      } else {
        otPayDisplay = 0;
      }
    } else {
      if (isPaidDayOff && !isHolidayWork) {
        otPayDisplay = 0;
      } else {
        otPayDisplay = extraBoxes * boxRate;
      }
    }

    const totalDayEst = basePayDisplay + otPayDisplay;

    let otControlsHtml = '';

    if (isManager) {
      otControlsHtml = `
        <div class="manager-exempt-notice">
          <span>👔 Manager: Fixed daily wage (Exempt from packaging work categories & box/piece overtime)</span>
        </div>
        <div class="ot-calc-preview mt-2" id="ot-preview-${r.employee_id}">
          <span>Daily Wage: ${API.formatMoney(basePayDisplay)}</span>
          ${otPayDisplay > 0 ? `<span>OT: <strong>${API.formatMoney(otPayDisplay)}</strong></span>` : ''}
        </div>
        <input type="text" class="notes-input-mini mt-2" placeholder="Notes (e.g. Planning, inventory, supervision)..." value="${this.escapeHtml(r.notes || '')}" data-emp-id="${r.employee_id}" id="notes-${r.employee_id}">
      `;
    } else {
      // Categories list for packaging worker dropdown
      const categories = API.workCategories || [
        'Sp 100', 'Sp 80', 'Sp 80 kishanganj', 'Pd 80', 'Pd 100', 'S 50', 'Pd 40', 'Pd 50',
        'P 100', 'p 95', 'P card', 'Sp card', 'pd orange card', 'pd pink card', 'pd big card',
        'sp big card', 'bangles(special)'
      ];

      const categoryOptionsHtml = categories.map(cat => 
        `<option value="${this.escapeHtml(cat)}" ${currentCat === cat ? 'selected' : ''}>${this.escapeHtml(cat)}</option>`
      ).join('');

      const categoryDropdownHtml = `
        <div class="work-category-row" id="cat-row-${r.employee_id}" style="${isAbsent ? 'opacity: 0.5; pointer-events: none;' : ''}">
          <label class="work-category-label">${isPiece ? '🃏' : '📦'} Work Category:</label>
          <select class="work-category-select" data-emp-id="${r.employee_id}" id="cat-select-${r.employee_id}">
            <option value="">-- Select Work Category --</option>
            ${categoryOptionsHtml}
          </select>
        </div>
      `;

      if (isPaidDayOff) {
        if (!isHolidayWork) {
          otControlsHtml = `
            ${categoryDropdownHtml}
            <div class="holiday-off-box" style="background: rgba(14, 165, 233, 0.08); border: 1px solid rgba(14, 165, 233, 0.2); border-radius: 8px; padding: 8px 12px; margin-top: 10px; font-size: 0.82rem; color: #0369a1;">
              <span>🌴 Paid Day Off: Full day's wage credited (₹0 Overtime)</span>
            </div>
            <div class="ot-calc-preview mt-2" id="ot-preview-${r.employee_id}">
              <span>Holiday Pay: ${API.formatMoney(basePayDisplay)}</span>
              <span>OT: <strong>₹0</strong></span>
            </div>
            <input type="text" class="notes-input-mini mt-2" placeholder="Notes..." value="${this.escapeHtml(r.notes || '')}" data-emp-id="${r.employee_id}" id="notes-${r.employee_id}">
          `;
        } else if (isPiece) {
          otControlsHtml = `
            ${categoryDropdownHtml}
            <div class="holiday-ot-active-box" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 10px 14px; margin-top: 10px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-weight: 600; color: #047857; font-size: 0.88rem;">🎉 ${this.escapeHtml(currentCat || 'Cards & Bangles')} (Holiday Work)</div>
                <div style="font-size: 0.78rem; color: #065f46;">Fixed Overtime Wage: <strong>+₹200</strong> added to full day wage</div>
              </div>
              <div style="background: #10b981; color: white; font-weight: 700; font-size: 0.82rem; padding: 4px 10px; border-radius: 6px;">
                +₹200 OT
              </div>
            </div>
            <div class="ot-calc-preview mt-2" id="ot-preview-${r.employee_id}">
              <span>Holiday Base: ${API.formatMoney(basePayDisplay)}</span>
              <span>Fixed Holiday OT: <strong>${API.formatMoney(200)}</strong></span>
            </div>
            <input type="text" class="notes-input-mini mt-2" placeholder="Notes (e.g. Holiday shift)..." value="${this.escapeHtml(r.notes || '')}" data-emp-id="${r.employee_id}" id="notes-${r.employee_id}">
          `;
        } else {
          // Rest of the categories on holiday work: same like other day (extra boxes)
          otControlsHtml = `
            ${categoryDropdownHtml}
            <div class="overtime-panel holiday-active">
              <div class="ot-controls-row">
                <div class="ot-label-group">
                  <span>📦 Extra Boxes Packed</span>
                  <span class="box-rate-tag">(@ ${API.formatMoney(boxRate)}/box)</span>
                </div>

                <div class="ot-stepper-wrap">
                  <button type="button" class="ot-step-btn btn-box-minus" data-emp-id="${r.employee_id}">-</button>
                  <input type="number" 
                         step="1" 
                         min="0" 
                         max="99999" 
                         class="ot-input box-count-input" 
                         id="box-input-${r.employee_id}" 
                         value="${extraBoxes}" 
                         data-emp-id="${r.employee_id}">
                  <span class="text-xs text-muted" id="unit-label-${r.employee_id}">boxes</span>
                  <button type="button" class="ot-step-btn btn-box-plus" data-emp-id="${r.employee_id}">+</button>
                </div>
              </div>

              <!-- Quick Chips -->
              <div class="box-quick-chips">
                <button type="button" class="box-chip-btn ${extraBoxes === 0 ? 'selected' : ''}" data-count="0" data-emp-id="${r.employee_id}">0</button>
                <button type="button" class="box-chip-btn ${extraBoxes === 1 ? 'selected' : ''}" data-count="1" data-emp-id="${r.employee_id}">+1</button>
                <button type="button" class="box-chip-btn ${extraBoxes === 2 ? 'selected' : ''}" data-count="2" data-emp-id="${r.employee_id}">+2</button>
                <button type="button" class="box-chip-btn ${extraBoxes === 3 ? 'selected' : ''}" data-count="3" data-emp-id="${r.employee_id}">+3</button>
                <button type="button" class="box-chip-btn ${extraBoxes === 5 ? 'selected' : ''}" data-count="5" data-emp-id="${r.employee_id}">+5</button>
                <button type="button" class="box-chip-btn ${extraBoxes === 10 ? 'selected' : ''}" data-count="10" data-emp-id="${r.employee_id}">+10</button>
              </div>

              <!-- Formula preview -->
              <div class="ot-calc-preview" id="ot-preview-${r.employee_id}">
                <span>Holiday Base: ${API.formatMoney(basePayDisplay)}</span>
                <span>Extra Boxes: ${extraBoxes > 0 ? `${extraBoxes} boxes × ${API.formatMoney(boxRate)} = <strong>${API.formatMoney(otPayDisplay)}</strong>` : '0 boxes'}</span>
              </div>

              <!-- Quick Notes -->
              <input type="text" class="notes-input-mini mt-2" placeholder="Notes (e.g. Holiday packaging shift)..." value="${this.escapeHtml(r.notes || '')}" data-emp-id="${r.employee_id}" id="notes-${r.employee_id}">
            </div>
          `;
        }
      } else {
        if (isPiece) {
          otControlsHtml = `
            ${categoryDropdownHtml}
            <div class="piece-disabled-box" style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 10px 14px; margin-top: 8px; text-align: center;">
              <div style="font-weight: 600; color: #475569; font-size: 0.84rem;">🃏 ${this.escapeHtml(currentCat)}</div>
              <div style="font-size: 0.78rem; color: #64748b; margin-top: 2px;">Overtime is currently disabled for Cards and Bangles on normal days</div>
            </div>
            <div class="ot-calc-preview mt-2" id="ot-preview-${r.employee_id}">
              <span>Base: ${API.formatMoney(basePayDisplay)}</span>
              <span>OT: <strong style="color: #64748b;">₹0 (Disabled)</strong></span>
            </div>
            <input type="text" class="notes-input-mini mt-2" placeholder="Notes (e.g. Card batch completed)..." value="${this.escapeHtml(r.notes || '')}" data-emp-id="${r.employee_id}" id="notes-${r.employee_id}">
          `;
        } else {
          otControlsHtml = `
            ${categoryDropdownHtml}
            <div class="overtime-panel">
              <div class="ot-controls-row">
                <div class="ot-label-group">
                  <span>📦 Extra Boxes Packed</span>
                  <span class="box-rate-tag">(@ ${API.formatMoney(boxRate)}/box)</span>
                </div>

                <div class="ot-stepper-wrap">
                  <button type="button" class="ot-step-btn btn-box-minus" data-emp-id="${r.employee_id}">-</button>
                  <input type="number" 
                         step="1" 
                         min="0" 
                         max="99999" 
                         class="ot-input box-count-input" 
                         id="box-input-${r.employee_id}" 
                         value="${extraBoxes}" 
                         data-emp-id="${r.employee_id}">
                  <span class="text-xs text-muted" id="unit-label-${r.employee_id}">boxes</span>
                  <button type="button" class="ot-step-btn btn-box-plus" data-emp-id="${r.employee_id}">+</button>
                </div>
              </div>

              <!-- Quick Chips -->
              <div class="box-quick-chips">
                <button type="button" class="box-chip-btn ${extraBoxes === 0 ? 'selected' : ''}" data-count="0" data-emp-id="${r.employee_id}">0</button>
                <button type="button" class="box-chip-btn ${extraBoxes === 1 ? 'selected' : ''}" data-count="1" data-emp-id="${r.employee_id}">+1</button>
                <button type="button" class="box-chip-btn ${extraBoxes === 2 ? 'selected' : ''}" data-count="2" data-emp-id="${r.employee_id}">+2</button>
                <button type="button" class="box-chip-btn ${extraBoxes === 3 ? 'selected' : ''}" data-count="3" data-emp-id="${r.employee_id}">+3</button>
                <button type="button" class="box-chip-btn ${extraBoxes === 5 ? 'selected' : ''}" data-count="5" data-emp-id="${r.employee_id}">+5</button>
                <button type="button" class="box-chip-btn ${extraBoxes === 10 ? 'selected' : ''}" data-count="10" data-emp-id="${r.employee_id}">+10</button>
              </div>

              <!-- Formula preview -->
              <div class="ot-calc-preview" id="ot-preview-${r.employee_id}">
                <span>Base: ${API.formatMoney(basePayDisplay)}</span>
                <span>Extra Boxes: ${extraBoxes > 0 ? `${extraBoxes} boxes × ${API.formatMoney(boxRate)} = <strong>${API.formatMoney(otPayDisplay)}</strong>` : '0 boxes'}</span>
              </div>

              <!-- Quick Notes -->
              <input type="text" class="notes-input-mini mt-2" placeholder="Notes (e.g. Extra packaging batch, target achieved)..." value="${this.escapeHtml(r.notes || '')}" data-emp-id="${r.employee_id}" id="notes-${r.employee_id}">
            </div>
          `;
        }
      }
    }

    // Tuesday or Paid Holiday Card
    if (isPaidDayOff) {
      if (isManager) {
        return `
          <div class="worker-card holiday-mode status-${r.status}" data-emp-id="${r.employee_id}" id="worker-card-${r.employee_id}">
            <div class="worker-header">
              <div class="worker-info">
                <div class="worker-name">
                  <span>${this.escapeHtml(r.name)}</span>
                  <span class="worker-badge manager-badge">👔 Manager</span>
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

            <!-- Holiday Status Segment for Manager -->
            <div class="holiday-status-segment">
              <button type="button" class="status-btn btn-paid-leave ${(!isPresent && !isAbsent) ? 'selected' : ''}" data-status="PAID_LEAVE" data-holiday-work="0" data-emp-id="${r.employee_id}">
                <span>🌴</span> Off (Paid Full Day)
              </button>
              <button type="button" class="status-btn btn-worked-holiday ${isPresent ? 'selected' : ''}" data-status="PRESENT" data-holiday-work="0" data-emp-id="${r.employee_id}">
                <span>👔</span> Worked Today
              </button>
              <button type="button" class="status-btn btn-absent ${isAbsent ? 'selected' : ''}" data-status="ABSENT" data-holiday-work="0" data-emp-id="${r.employee_id}" title="Unexcused Unpaid Absence">
                <span>❌</span> Absent
              </button>
            </div>

            ${otControlsHtml}

            <!-- Visual Save Feedback -->
            <div class="card-save-status" id="save-status-${r.employee_id}">
              <span>✓ Saved</span>
            </div>
          </div>
        `;
      }
      return `
        <div class="worker-card holiday-mode status-${r.status}" data-emp-id="${r.employee_id}" id="worker-card-${r.employee_id}">
          <div class="worker-header">
            <div class="worker-info">
              <div class="worker-name">
                <span>${this.escapeHtml(r.name)}</span>
                <span class="worker-badge ${isManager ? 'manager-badge' : ''}">${isManager ? '👔 Manager' : this.escapeHtml(r.role || 'Worker')}</span>
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

          <!-- Holiday Status Segment -->
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

          ${otControlsHtml}

          <!-- Visual Save Feedback -->
          <div class="card-save-status" id="save-status-${r.employee_id}">
            <span>✓ Saved</span>
          </div>
        </div>
      `;
    }

    // Regular Working Day Layout
    return `
      <div class="worker-card status-${r.status}" data-emp-id="${r.employee_id}" id="worker-card-${r.employee_id}">
        <div class="worker-header">
          <div class="worker-info">
            <div class="worker-name">
              <span>${this.escapeHtml(r.name)}</span>
              <span class="worker-badge ${isManager ? 'manager-badge' : ''}">${isManager ? '👔 Manager' : this.escapeHtml(r.role || 'Worker')}</span>
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

        ${otControlsHtml}

        <!-- Visual Save Feedback -->
        <div class="card-save-status" id="save-status-${r.employee_id}">
          <span>✓ Saved</span>
        </div>
      </div>
    `;
  },

  rebuildCard(empId) {
    const record = this.records.find(r => r.employee_id === empId);
    if (!record) return;
    const oldCard = document.getElementById(`worker-card-${empId}`);
    if (!oldCard) return;
    const temp = document.createElement('div');
    temp.innerHTML = this.createWorkerCardHtml(record);
    const newCard = temp.firstElementChild;
    oldCard.replaceWith(newCard);
    this.attachCardEventListeners(newCard);
  },

  attachCardEventListeners(root = document) {
    // Status button clicks (handles both regular and holiday segments)
    root.querySelectorAll('.status-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const empId = parseInt(btn.dataset.empId);
        const status = btn.dataset.status;
        const holidayWork = btn.dataset.holidayWork === '1';
        const record = this.records.find(r => r.employee_id === empId);
        if (!record) return;

        const isPaidDayOff = !!(this.dateMeta && this.dateMeta.isPaidDayOff);
        const hadHolidayWork = !!record.is_holiday_work;

        const updates = { status, is_holiday_work: holidayWork };

        if (record.worker_type === 'MANAGER') {
          updates.work_category = '';
          updates.extra_boxes = 0;
          updates.extra_pieces = 0;
          updates.box_rate = 0;
          updates.is_holiday_work = false;
        } else if (status === 'ABSENT' || holidayWork || (this.isPieceCategory(record.work_category) && !isPaidDayOff)) {
          updates.extra_boxes = 0;
          updates.extra_pieces = 0;
        }

        if (isPaidDayOff && (hadHolidayWork !== holidayWork || record.status !== status)) {
          Object.assign(record, updates);
          this.rebuildCard(empId);
        }

        this.updateWorkerAttendance(empId, updates);
      });
    });

    // Work Category dropdown change
    root.querySelectorAll('.work-category-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const empId = parseInt(sel.dataset.empId);
        const record = this.records.find(r => r.employee_id === empId);
        if (!record) return;

        const wasPiece = this.isPieceCategory(record.work_category);
        const willBePiece = this.isPieceCategory(sel.value);
        record.work_category = sel.value;

        if (willBePiece) {
          record.extra_boxes = 0;
          record.extra_pieces = 0;
        }

        if (wasPiece !== willBePiece) {
          this.rebuildCard(empId);
        }

        this.updateWorkerAttendance(empId, {
          work_category: record.work_category,
          extra_boxes: record.extra_boxes,
          extra_pieces: record.extra_pieces
        });
      });
    });

    // Stepper plus button (+)
    root.querySelectorAll('.btn-box-plus').forEach(btn => {
      btn.addEventListener('click', () => {
        const empId = parseInt(btn.dataset.empId);
        const record = this.records.find(r => r.employee_id === empId);
        if (!record) return;
        const isPiece = this.isPieceCategory(record.work_category);
        const step = isPiece ? 500 : 1;
        const input = document.getElementById(`box-input-${empId}`);
        let val = (parseFloat(input.value) || 0) + step;
        input.value = val;
        if (isPiece) {
          record.extra_pieces = val;
          record.extra_boxes = Math.round((val / 500) * 100) / 100;
          this.updateWorkerAttendance(empId, { extra_pieces: val, extra_boxes: record.extra_boxes });
        } else {
          record.extra_boxes = val;
          record.extra_pieces = 0;
          this.updateWorkerAttendance(empId, { extra_boxes: val, extra_pieces: 0 });
        }
      });
    });

    // Stepper minus button (-)
    root.querySelectorAll('.btn-box-minus').forEach(btn => {
      btn.addEventListener('click', () => {
        const empId = parseInt(btn.dataset.empId);
        const record = this.records.find(r => r.employee_id === empId);
        if (!record) return;
        const isPiece = this.isPieceCategory(record.work_category);
        const step = isPiece ? 500 : 1;
        const input = document.getElementById(`box-input-${empId}`);
        let val = (parseFloat(input.value) || 0) - step;
        if (val < 0) val = 0;
        input.value = val;
        if (isPiece) {
          record.extra_pieces = val;
          record.extra_boxes = Math.round((val / 500) * 100) / 100;
          this.updateWorkerAttendance(empId, { extra_pieces: val, extra_boxes: record.extra_boxes });
        } else {
          record.extra_boxes = val;
          record.extra_pieces = 0;
          this.updateWorkerAttendance(empId, { extra_boxes: val, extra_pieces: 0 });
        }
      });
    });

    // Quick chips
    root.querySelectorAll('.box-chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const empId = parseInt(btn.dataset.empId);
        const record = this.records.find(r => r.employee_id === empId);
        if (!record) return;
        const isPiece = this.isPieceCategory(record.work_category);
        const count = parseFloat(btn.dataset.count !== undefined ? btn.dataset.count : btn.dataset.boxes);
        const input = document.getElementById(`box-input-${empId}`);
        if (input) input.value = count;
        if (isPiece) {
          record.extra_pieces = count;
          record.extra_boxes = Math.round((count / 500) * 100) / 100;
          this.updateWorkerAttendance(empId, { extra_pieces: count, extra_boxes: record.extra_boxes });
        } else {
          record.extra_boxes = count;
          record.extra_pieces = 0;
          this.updateWorkerAttendance(empId, { extra_boxes: count, extra_pieces: 0 });
        }
      });
    });

    // Manual input entry
    root.querySelectorAll('.box-count-input').forEach(input => {
      input.addEventListener('change', () => {
        const empId = parseInt(input.dataset.empId);
        const record = this.records.find(r => r.employee_id === empId);
        if (!record) return;
        const isPiece = this.isPieceCategory(record.work_category);
        let val = Math.max(0, parseFloat(input.value) || 0);
        input.value = val;
        if (isPiece) {
          record.extra_pieces = val;
          record.extra_boxes = Math.round((val / 500) * 100) / 100;
          this.updateWorkerAttendance(empId, { extra_pieces: val, extra_boxes: record.extra_boxes });
        } else {
          record.extra_boxes = val;
          record.extra_pieces = 0;
          this.updateWorkerAttendance(empId, { extra_boxes: val, extra_pieces: 0 });
        }
      });
    });

    // Notes change
    root.querySelectorAll('.notes-input-mini').forEach(input => {
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

    if (record.worker_type === 'MANAGER') {
      record.work_category = '';
      record.extra_boxes = 0;
      record.extra_pieces = 0;
      record.box_rate = 0;
      record.is_holiday_work = false;
    }

    // Default status if not marked
    if (record.status === 'NOT_MARKED') {
      record.status = (this.dateMeta && this.dateMeta.isPaidDayOff) ? 'PAID_LEAVE' : 'PRESENT';
    }

    // Refresh card UI visually
    this.updateCardUi(record);

    try {
      const isManager = record.worker_type === 'MANAGER';
      const payload = {
        employee_id: record.employee_id,
        date: this.currentDate,
        status: record.status,
        work_category: isManager ? '' : (record.work_category || ''),
        extra_boxes: isManager ? 0 : parseFloat(record.extra_boxes || 0),
        extra_pieces: isManager ? 0 : parseFloat(record.extra_pieces || 0),
        box_rate: isManager ? 0 : parseFloat(record.box_rate !== undefined ? record.box_rate : (API.defaultBoxRate || 30.0)),
        overtime_days: parseFloat(record.overtime_days || 0),
        overtime_multiplier: parseFloat(record.overtime_multiplier || 0),
        is_holiday_work: isManager ? 0 : (record.is_holiday_work ? 1 : 0),
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
    card.className = `worker-card ${card.classList.contains('holiday-mode') ? 'holiday-mode' : ''} status-${record.status} ${record.is_holiday_work ? 'holiday-worked' : ''}`;

    const isManager = record.worker_type === 'MANAGER';
    const isAbsent = record.status === 'ABSENT';

    // Update status buttons
    const btns = card.querySelectorAll('.status-btn');
    btns.forEach(b => {
      if (isManager && this.dateMeta && this.dateMeta.isPaidDayOff) {
        if (b.dataset.status === 'PAID_LEAVE') {
          b.classList.toggle('selected', record.status === 'PAID_LEAVE' || record.status === 'PAID_HOLIDAY');
        } else if (b.dataset.status === 'PRESENT') {
          b.classList.toggle('selected', record.status === 'PRESENT');
        } else if (b.dataset.status === 'ABSENT') {
          b.classList.toggle('selected', record.status === 'ABSENT');
        }
      } else {
        const isWorkedHolidayBtn = b.dataset.holidayWork === '1';
        if (isWorkedHolidayBtn) {
          b.classList.toggle('selected', !!record.is_holiday_work);
        } else if (b.dataset.holidayWork === '0' && this.dateMeta && this.dateMeta.isPaidDayOff && b.dataset.status === 'PAID_LEAVE') {
          b.classList.toggle('selected', !record.is_holiday_work && (record.status === 'PAID_LEAVE' || record.status === 'PAID_HOLIDAY'));
        } else {
          b.classList.toggle('selected', b.dataset.status === record.status && !record.is_holiday_work);
        }
      }
    });

    // Toggle work category row opacity if absent
    const catRow = document.getElementById(`cat-row-${record.employee_id}`);
    if (catRow) {
      catRow.style.opacity = isAbsent ? '0.5' : '1';
      catRow.style.pointerEvents = isAbsent ? 'none' : 'auto';
    }

    // Recalculate local display earnings
    let basePay = 0;
    if (record.status === 'PRESENT' || record.status === 'PAID_LEAVE' || record.status === 'PAID_HOLIDAY') {
      basePay = record.daily_wage;
    } else if (record.status === 'HALF_DAY') {
      basePay = record.daily_wage * 0.5;
    }

    const isPaidDayOff = !!(this.dateMeta && this.dateMeta.isPaidDayOff);
    const isHolidayWork = !!record.is_holiday_work;
    const isPiece = this.isPieceCategory(record.work_category);
    let otPay = 0;
    const extraBoxes = Number(record.extra_boxes || 0);
    const boxRate = Number(record.box_rate !== undefined ? record.box_rate : (API.defaultBoxRate || 30.0));

    if (isManager) {
      otPay = (record.overtime_days || 0) * record.daily_wage * (record.overtime_multiplier || 0);
    } else if (isPiece) {
      if (isPaidDayOff && isHolidayWork && record.status !== 'ABSENT') {
        otPay = 200;
      } else {
        otPay = 0;
      }
    } else {
      if (isPaidDayOff && !isHolidayWork) {
        otPay = 0;
      } else {
        otPay = extraBoxes * boxRate;
      }
    }

    const totalDay = basePay + otPay;

    // Update Day Total badge
    const earningEl = document.getElementById(`earning-${record.employee_id}`);
    if (earningEl) earningEl.textContent = API.formatMoney(totalDay);

    // Update box count input & quick chip buttons
    const boxInput = document.getElementById(`box-input-${record.employee_id}`);
    if (boxInput) {
      boxInput.value = extraBoxes;
      boxInput.step = '1';
    }

    const boxChips = card.querySelectorAll('.box-chip-btn');
    boxChips.forEach(b => {
      const chipVal = parseFloat(b.dataset.count !== undefined ? b.dataset.count : b.dataset.boxes);
      b.classList.toggle('selected', chipVal === extraBoxes);
    });

    // Update category dropdown
    const catSelect = document.getElementById(`cat-select-${record.employee_id}`);
    if (catSelect && record.work_category !== undefined) {
      catSelect.value = record.work_category || '';
    }

    // Update calculation preview formula
    const otPreviewEl = document.getElementById(`ot-preview-${record.employee_id}`);
    if (otPreviewEl) {
      if (isManager) {
        otPreviewEl.innerHTML = `<span>Daily Wage: ${API.formatMoney(basePay)}</span>${otPay > 0 ? `<span>OT: <strong>${API.formatMoney(otPay)}</strong></span>` : ''}`;
      } else if (isPiece) {
        if (isPaidDayOff && isHolidayWork && record.status !== 'ABSENT') {
          otPreviewEl.innerHTML = `
            <span>Holiday Base: ${API.formatMoney(basePay)}</span>
            <span>Fixed Holiday OT: <strong>${API.formatMoney(200)}</strong></span>
          `;
        } else if (isPaidDayOff && !isHolidayWork) {
          otPreviewEl.innerHTML = `
            <span>Holiday Pay: ${API.formatMoney(basePay)}</span>
            <span>OT: <strong>₹0</strong></span>
          `;
        } else {
          otPreviewEl.innerHTML = `
            <span>Base: ${API.formatMoney(basePay)}</span>
            <span>OT: <strong style="color: #64748b;">₹0 (Disabled)</strong></span>
          `;
        }
      } else {
        if (isPaidDayOff && !isHolidayWork) {
          otPreviewEl.innerHTML = `
            <span>Holiday Pay: ${API.formatMoney(basePay)}</span>
            <span>OT: <strong>₹0</strong></span>
          `;
        } else {
          otPreviewEl.innerHTML = `
            <span>${isPaidDayOff ? 'Holiday Base' : 'Base'}: ${API.formatMoney(basePay)}</span>
            <span>Extra Boxes: ${extraBoxes > 0 ? `${extraBoxes} boxes × ${API.formatMoney(boxRate)} = <strong>${API.formatMoney(otPay)}</strong>` : '0 boxes'}</span>
          `;
        }
      }
    }
  },

  recalculateDailyTotals() {
    let totalPresent = 0;
    let totalHalfDay = 0;
    let totalPaidLeave = 0;
    let totalAbsent = 0;
    let totalUnmarked = 0;
    let totalOtDays = 0;
    let totalExtraBoxes = 0;
    let totalExtraPieces = 0;
    let totalHolidayWorkers = 0;
    let totalWagesToday = 0;

    for (const item of this.records) {
      if (item.status === 'PRESENT') totalPresent++;
      else if (item.status === 'HALF_DAY') totalHalfDay++;
      else if (item.status === 'PAID_LEAVE' || item.status === 'PAID_HOLIDAY') totalPaidLeave++;
      else if (item.status === 'ABSENT') totalAbsent++;
      else totalUnmarked++;

      let base = 0;
      if (item.status === 'PRESENT' || item.status === 'PAID_LEAVE' || item.status === 'PAID_HOLIDAY') {
        base = item.daily_wage;
      } else if (item.status === 'HALF_DAY') {
        base = item.daily_wage * 0.5;
      }

      let ot = 0;
      const isPaidDayOff = !!(this.dateMeta && this.dateMeta.isPaidDayOff);
      const isHolidayWork = !!item.is_holiday_work;
      const isPiece = this.isPieceCategory(item.work_category);
      const rate = Number(item.box_rate !== undefined ? item.box_rate : (API.defaultBoxRate || 30.0));

      if (item.worker_type === 'MANAGER') {
        const otDays = Number(item.overtime_days || 0);
        const otMult = Number(item.overtime_multiplier || 0);
        ot = otDays * item.daily_wage * otMult;
        totalOtDays += otDays;
      } else {
        if (item.is_holiday_work) totalHolidayWorkers++;
        if (isPiece) {
          if (isPaidDayOff && isHolidayWork && item.status !== 'ABSENT') {
            ot = 200;
          } else {
            ot = 0;
          }
        } else {
          if (isPaidDayOff && !isHolidayWork) {
            ot = 0;
          } else {
            const boxes = Number(item.extra_boxes || 0);
            ot = boxes * rate;
            totalExtraBoxes += boxes;
          }
        }
      }

      totalWagesToday += (base + ot);
    }

    this.updateStats({
      totalPresent,
      totalHalfDay,
      totalPaidLeave,
      totalAbsent,
      totalUnmarked,
      totalOtDays: Math.round(totalOtDays * 100) / 100,
      totalExtraBoxes: Math.round(totalExtraBoxes * 100) / 100,
      totalExtraPieces: Math.round(totalExtraPieces),
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
      work_category: r.work_category || '',
      extra_boxes: 0,
      box_rate: r.box_rate || API.defaultBoxRate || 30.0,
      overtime_days: 0,
      overtime_multiplier: 0.0,
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
