// Payroll & Wage Calculation Module
const PayrollModule = {
  startDate: '',
  endDate: '',
  reportData: null,

  init() {
    this.bindEvents();
    this.setRange('this-month');
  },

  bindEvents() {
    // Quick range buttons
    document.querySelectorAll('.quick-ranges .range-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.quick-ranges .range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setRange(btn.dataset.range);
      });
    });

    const btnApplyCustom = document.getElementById('btnApplyPayrollFilter');
    btnApplyCustom.addEventListener('click', () => {
      const s = document.getElementById('payrollStart').value;
      const e = document.getElementById('payrollEnd').value;
      if (s && e) {
        this.startDate = s;
        this.endDate = e;
        this.loadReport();
      }
    });

    // Export CSV
    document.getElementById('btnExportCsv').addEventListener('click', () => {
      window.location.href = `/api/reports/export-csv?startDate=${this.startDate}&endDate=${this.endDate}`;
    });

    // Print
    document.getElementById('btnPrintPayroll').addEventListener('click', () => {
      window.print();
    });
  },

  setRange(type) {
    const customWrap = document.getElementById('customRangeWrap');
    const now = new Date();

    if (type === 'this-month') {
      customWrap.style.display = 'none';
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      this.startDate = this.formatDate(firstDay);
      this.endDate = this.formatDate(lastDay);
    } else if (type === 'this-week') {
      customWrap.style.display = 'none';
      const day = now.getDay();
      const diffToMonday = now.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(now.setDate(diffToMonday));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      this.startDate = this.formatDate(monday);
      this.endDate = this.formatDate(sunday);
    } else if (type === 'last-month') {
      customWrap.style.display = 'none';
      const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      this.startDate = this.formatDate(firstDay);
      this.endDate = this.formatDate(lastDay);
    } else if (type === 'custom') {
      customWrap.style.display = 'flex';
      document.getElementById('payrollStart').value = this.startDate;
      document.getElementById('payrollEnd').value = this.endDate;
      return;
    }

    this.loadReport();
  },

  async loadReport() {
    const tbody = document.getElementById('payrollTableBody');
    tbody.innerHTML = '<tr><td colspan="13" class="text-center"><div class="spinner" style="margin: 20px auto;"></div>Calculating wages...</td></tr>';

    try {
      const res = await API.getPayrollReport(this.startDate, this.endDate);
      if (res.success) {
        this.reportData = res;
        this.renderGrandCards(res.grandTotals);
        this.renderTable(res.workers);
      }
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="13" class="text-center text-rose">Error calculating payroll: ${err.message}</td></tr>`;
    }
  },

  renderGrandCards(totals) {
    if (!totals) return;
    document.getElementById('grandGrossPay').textContent = API.formatMoney(totals.grandGrossPay);
    const splitParts = [`Base: ${API.formatMoney(totals.grandBasePay)}`, `OT: ${API.formatMoney(totals.grandOtPay)}`];
    if (totals.grandBonus > 0) {
      splitParts.push(`Bonus: ${API.formatMoney(totals.grandBonus)}`);
    }
    document.getElementById('grandBaseOtSplit').textContent = splitParts.join(' | ');
    
    const extraBoxes = totals.grandTotalExtraBoxes || 0;
    const extraPieces = totals.grandTotalExtraPieces || 0;
    const otDays = totals.grandOtDays || 0;
    const otEl = document.getElementById('grandOtDays');
    if (otEl) {
      const parts = [];
      if (extraBoxes > 0) parts.push(`${extraBoxes} boxes`);
      if (extraPieces > 0) parts.push(`${extraPieces.toLocaleString()} pcs`);
      if (otDays > 0) parts.push(`${otDays}d`);
      otEl.textContent = parts.length > 0 ? parts.join(' / ') : '0 units';
    }

    document.getElementById('grandAdvances').textContent = API.formatMoney(totals.grandAdvances);
    document.getElementById('grandNetPayable').textContent = API.formatMoney(totals.grandNetPayable);

    document.getElementById('grandOtBreakdown').textContent = (totals.grandOtPay > 0)
      ? `OT Wages: ${API.formatMoney(totals.grandOtPay)}` 
      : 'No overtime in period';
  },

  renderTable(workers) {
    const tbody = document.getElementById('payrollTableBody');
    if (!workers || workers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="13" class="text-center">No active workers found for this range.</td></tr>';
      return;
    }

    tbody.innerHTML = workers.map(w => {
      const workedDays = Math.round((w.presentDays + (w.halfDays * 0.5)) * 10) / 10;
      const isManager = (w.worker_type === 'MANAGER');
      const typeBadge = isManager
        ? '<span class="manager-badge" style="font-size: 0.68rem; padding: 2px 6px;">👔 Manager</span>'
        : '<span class="worker-badge" style="font-size: 0.68rem; padding: 2px 6px;">📦 Worker</span>';

      // Extra Boxes / Pieces / OT column
      let otCol = '-';
      if (isManager) {
        if (w.totalOtDays > 0) {
          otCol = `<div class="text-xs text-muted">${w.totalOtDays}d (${this.escapeHtml(w.otSummaryText || '')})</div>`;
        } else {
          otCol = '<span class="text-muted text-xs">Exempt</span>';
        }
      } else {
        const parts = [];
        if (w.holidayWorkDays > 0) {
          parts.push(`<div><span class="badge" style="background:#dcfce7;color:#166534;font-size:0.72rem;padding:2px 6px;border-radius:4px;font-weight:600;">🎉 ${w.holidayWorkDays}d Hol (+${API.formatMoney(w.holidayWorkDays * 200)})</span></div>`);
        }
        if (w.totalExtraPieces > 0) {
          parts.push(`<div><strong>${w.totalExtraPieces.toLocaleString()} pcs</strong> <span class="text-xs text-muted">(${(w.totalExtraPieces / 500).toFixed(1).replace('.0', '')} eq)</span></div>`);
        }
        if (w.totalExtraBoxes > 0) {
          parts.push(`<div><strong>${w.totalExtraBoxes} boxes</strong></div>`);
        }
        if (w.totalOtDays > 0) {
          parts.push(`<div class="text-xs text-muted">${w.totalOtDays}d (${this.escapeHtml(w.otSummaryText || '')})</div>`);
        }
        if (parts.length > 0) {
          otCol = parts.join('');
        }
      }

      // Work Categories summary column
      let catCol = '-';
      if (isManager) {
        catCol = '<span class="text-muted text-xs">Exempt</span>';
      } else if (w.categoriesSummary && w.categoriesSummary !== '-') {
        catCol = `<span class="text-xs" style="color: #475569; font-weight: 500;">${this.escapeHtml(w.categoriesSummary)}</span>`;
      }

      return `
        <tr>
          <td>
            <div style="display: flex; align-items: center; gap: 6px;">
              <strong>${this.escapeHtml(w.name)}</strong>
              ${typeBadge}
            </div>
            <div class="text-xs text-muted">${this.escapeHtml(w.role || (isManager ? 'Manager' : 'Worker'))} (${this.escapeHtml(w.employee_code || '')})</div>
          </td>
          <td><strong>${API.formatMoney(w.daily_wage)}</strong></td>
          <td>
            <span style="font-weight: 700;">${workedDays}d</span>
            <div class="text-xs text-muted">P:${w.presentDays} | H:${w.halfDays}</div>
          </td>
          <td>
            <span style="font-weight: 600; color: #0284c7;">${w.paidLeaveDays}d</span>
            ${w.holidayWorkDays > 0 ? `<div class="text-xs text-purple">(${w.holidayWorkDays} worked)</div>` : ''}
          </td>
          <td>
            <strong style="font-size: 0.92rem;">${w.effectiveDays}d</strong>
          </td>
          <td>${otCol}</td>
          <td>${catCol}</td>
          <td>${API.formatMoney(w.basePayTotal)}</td>
          <td>${w.otPayTotal > 0 ? `<strong class="text-primary">${API.formatMoney(w.otPayTotal)}</strong>` : '-'}</td>
          <td>
            <strong>${API.formatMoney(w.grossPayTotal)}</strong>
            ${w.bonusTotal > 0 ? `<div class="text-xs text-purple" style="font-weight: 600;">🎁 +${API.formatMoney(w.bonusTotal)} bonus</div>` : ''}
          </td>
          <td class="text-rose">${w.totalAdvances > 0 ? `-${API.formatMoney(w.totalAdvances)}` : '0'}</td>
          <td>
            <strong class="text-success" style="font-size: 0.95rem;">
              ${API.formatMoney(w.netPayable)}
            </strong>
          </td>
          <td>
            <div style="display: flex; gap: 4px; justify-content: flex-end; flex-wrap: wrap;">
              <button class="btn btn-secondary btn-sm" style="font-size: 0.72rem; padding: 3px 6px;" onclick="PaymentsModule.quickAdvance(${w.employee_id}, '${this.escapeHtml(w.name)}')" title="Record Advance">
                + Adv
              </button>
              <button class="btn btn-secondary btn-sm" style="font-size: 0.72rem; padding: 3px 6px; color: #7e22ce;" onclick="PaymentsModule.quickBonus(${w.employee_id}, '${this.escapeHtml(w.name)}')" title="Award Bonus / Reward">
                🎁 Bonus
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  formatDate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
