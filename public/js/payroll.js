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
    tbody.innerHTML = '<tr><td colspan="11" class="text-center"><div class="spinner" style="margin: 20px auto;"></div>Calculating wages...</td></tr>';

    try {
      const res = await API.getPayrollReport(this.startDate, this.endDate);
      if (res.success) {
        this.reportData = res;
        this.renderGrandCards(res.grandTotals);
        this.renderTable(res.workers);
      }
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="11" class="text-center text-rose">Error calculating payroll: ${err.message}</td></tr>`;
    }
  },

  renderGrandCards(totals) {
    if (!totals) return;
    document.getElementById('grandGrossPay').textContent = API.formatMoney(totals.grandGrossPay);
    document.getElementById('grandBaseOtSplit').textContent = `Base: ${API.formatMoney(totals.grandBasePay)} | OT: ${API.formatMoney(totals.grandOtPay)}`;
    document.getElementById('grandOtHours').textContent = `${totals.grandOtHours}h`;
    document.getElementById('grandAdvances').textContent = API.formatMoney(totals.grandAdvances);
    document.getElementById('grandNetPayable').textContent = API.formatMoney(totals.grandNetPayable);

    // Count breakdown
    let total15 = 0;
    let total20 = 0;
    if (this.reportData && this.reportData.workers) {
      this.reportData.workers.forEach(w => {
        total15 += w.ot15Hours || 0;
        total20 += w.ot20Hours || 0;
      });
    }
    document.getElementById('grandOtBreakdown').textContent = `1.5x: ${total15.toFixed(1)}h | 2.0x: ${total20.toFixed(1)}h`;
  },

  renderTable(workers) {
    const tbody = document.getElementById('payrollTableBody');
    if (!workers || workers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" class="text-center">No active workers found for this range.</td></tr>';
      return;
    }

    tbody.innerHTML = workers.map(w => {
      return `
        <tr>
          <td>
            <strong>${this.escapeHtml(w.name)}</strong>
            <div class="text-xs text-muted">${this.escapeHtml(w.role || 'Worker')} (${this.escapeHtml(w.employee_code || '')})</div>
          </td>
          <td><strong>${API.formatMoney(w.daily_wage)}</strong></td>
          <td>
            <span style="font-weight: 700;">${w.effectiveDays}</span> days
            <div class="text-xs text-muted">P:${w.presentDays} | H:${w.halfDays} | A:${w.absentDays}</div>
          </td>
          <td>${w.ot15Hours > 0 ? `<strong>${w.ot15Hours}h</strong>` : '-'}</td>
          <td>${w.ot20Hours > 0 ? `<strong>${w.ot20Hours}h</strong>` : '-'}</td>
          <td>${API.formatMoney(w.basePayTotal)}</td>
          <td>${w.otPayTotal > 0 ? `<strong class="text-primary">${API.formatMoney(w.otPayTotal)}</strong>` : '-'}</td>
          <td><strong>${API.formatMoney(w.grossPayTotal)}</strong></td>
          <td class="text-rose">${w.totalAdvances > 0 ? `-${API.formatMoney(w.totalAdvances)}` : '0'}</td>
          <td>
            <strong class="text-success" style="font-size: 0.95rem;">
              ${API.formatMoney(w.netPayable)}
            </strong>
          </td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="PaymentsModule.quickAdvance(${w.employee_id}, '${this.escapeHtml(w.name)}')">
              + Advance
            </button>
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
