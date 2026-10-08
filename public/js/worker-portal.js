/**
 * Worker Portal Module (Worker Passbook)
 * Provides a dedicated, strictly read-only interface for packaging workers to view
 * their daily attendance, packaging category, box-packing overtime, advances, and net wage balance.
 */
const WorkerPortalModule = {
  currentWorker: null,
  currentMonth: null, // 'YYYY-MM'
  activeSubTab: 'wpTabAttendance',

  init() {
    this.bindEvents();
  },

  bindEvents() {
    // Month Stepper controls
    const btnPrev = document.getElementById('btnWpPrevMonth');
    if (btnPrev) {
      btnPrev.addEventListener('click', () => this.changeMonth(-1));
    }

    const btnNext = document.getElementById('btnWpNextMonth');
    if (btnNext) {
      btnNext.addEventListener('click', () => this.changeMonth(1));
    }

    const btnToday = document.getElementById('btnWpCurrentMonth');
    if (btnToday) {
      btnToday.addEventListener('click', () => this.goToCurrentMonth());
    }

    const monthInput = document.getElementById('wpMonthInput');
    if (monthInput) {
      monthInput.addEventListener('change', (e) => {
        if (e.target.value) {
          this.currentMonth = e.target.value;
          this.loadPassbook(this.currentMonth);
        }
      });
    }

    // Sub-tab switcher (Attendance vs Advances)
    const tabBtns = document.querySelectorAll('.wp-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.wptab;
        this.switchSubTab(targetTab);
      });
    });

    // Exit / Logout button
    const btnLogout = document.getElementById('btnWorkerLogout');
    if (btnLogout) {
      btnLogout.addEventListener('click', async () => {
        await App.logoutWorker();
      });
    }

    // Back to Admin button (when admin previews worker passbook)
    const btnBackToAdmin = document.getElementById('btnWpBackToAdmin');
    if (btnBackToAdmin) {
      btnBackToAdmin.addEventListener('click', () => {
        if (window.App && typeof window.App.returnToAdminFromPassbook === 'function') {
          window.App.returnToAdminFromPassbook();
        }
      });
    }

    // Change Secret Key button in Worker Passbook Header
    const btnChangeKey = document.getElementById('btnWpChangeKey');
    if (btnChangeKey) {
      btnChangeKey.addEventListener('click', () => {
        this.openChangeKeyModal();
      });
    }

    // Change Key Form Submit
    const changeKeyForm = document.getElementById('workerChangeKeyForm');
    if (changeKeyForm) {
      changeKeyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.submitChangeKey();
      });
    }
  },

  switchSubTab(tabId) {
    this.activeSubTab = tabId;

    document.querySelectorAll('.wp-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.wptab === tabId);
    });

    document.querySelectorAll('.wp-tab-content').forEach(content => {
      if (content.id === tabId) {
        content.style.display = 'block';
        content.classList.add('active');
      } else {
        content.style.display = 'none';
        content.classList.remove('active');
      }
    });
  },

  show(workerData) {
    this.currentWorker = workerData;
    const now = new Date();
    this.currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const portalView = document.getElementById('workerPortalView');
    if (portalView) {
      portalView.style.display = 'flex';
    }

    const btnBackToAdmin = document.getElementById('btnWpBackToAdmin');
    if (btnBackToAdmin) {
      btnBackToAdmin.style.display = (window.App && window.App.isUnlocked) ? 'inline-flex' : 'none';
    }

    this.loadPassbook(this.currentMonth);
  },

  hide() {
    this.currentWorker = null;
    const portalView = document.getElementById('workerPortalView');
    if (portalView) {
      portalView.style.display = 'none';
    }
  },

  changeMonth(delta) {
    if (!this.currentMonth) {
      const now = new Date();
      this.currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    const [yearStr, monthStr] = this.currentMonth.split('-');
    let year = parseInt(yearStr, 10);
    let month = parseInt(monthStr, 10) + delta;

    if (month > 12) {
      month = 1;
      year += 1;
    } else if (month < 1) {
      month = 12;
      year -= 1;
    }

    this.currentMonth = `${year}-${String(month).padStart(2, '0')}`;
    this.loadPassbook(this.currentMonth);
  },

  goToCurrentMonth() {
    const now = new Date();
    this.currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    this.loadPassbook(this.currentMonth);
  },

  formatMonthLabel(monthStr) {
    try {
      const [year, month] = monthStr.split('-').map(Number);
      const date = new Date(year, month - 1, 1);
      return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    } catch (e) {
      return monthStr;
    }
  },

  formatDateWithDay(dateStr) {
    try {
      const [y, m, d] = dateStr.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      return date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        weekday: 'short'
      });
    } catch (e) {
      return dateStr;
    }
  },

  async loadPassbook(monthStr) {
    const monthDisplay = document.getElementById('wpMonthDisplay');
    const monthInput = document.getElementById('wpMonthInput');
    if (monthDisplay) monthDisplay.textContent = this.formatMonthLabel(monthStr);
    if (monthInput) monthInput.value = monthStr;

    // Show loading state in tables
    const attBody = document.getElementById('wpAttendanceBody');
    const payBody = document.getElementById('wpPaymentsBody');
    if (attBody) {
      attBody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted"><div class="spinner" style="margin: 0 auto 8px;"></div>Loading passbook records...</td></tr>';
    }
    if (payBody) {
      payBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted"><div class="spinner" style="margin: 0 auto 8px;"></div>Loading advance records...</td></tr>';
    }

    try {
      const employeeId = this.currentWorker ? this.currentWorker.employee_id || this.currentWorker.id : '';
      const res = await API.getWorkerPassbook(monthStr, employeeId);

      if (res && res.success) {
        this.renderProfile(res.worker);
        this.renderSummary(res.summary, res.worker);
        this.renderAttendance(res.attendance || []);
        this.renderPayments(res.payments || []);
      }
    } catch (err) {
      console.error('Failed to load worker passbook:', err);
      if (attBody) {
        attBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-rose">Error loading passbook: ${err.message}</td></tr>`;
      }
      if (payBody) {
        payBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-rose">Error loading advances: ${err.message}</td></tr>`;
      }
    }
  },

  renderProfile(worker) {
    if (!worker) return;

    const nameEl = document.getElementById('wpWorkerName');
    const codeEl = document.getElementById('wpWorkerCode');
    const roleEl = document.getElementById('wpWorkerRole');
    const wageEl = document.getElementById('wpDailyWage');
    const phoneEl = document.getElementById('wpPhone');
    const statusEl = document.getElementById('wpWorkerStatus');

    if (nameEl) nameEl.textContent = worker.name || 'Worker';
    if (codeEl) codeEl.textContent = worker.employee_code || '-';
    if (roleEl) {
      const typeLabel = worker.worker_type === 'MANAGER' ? '👔 Manager / Supervisor' : '📦 Packaging Worker';
      roleEl.textContent = worker.role ? `${worker.role} (${typeLabel})` : typeLabel;
    }
    if (wageEl) wageEl.textContent = API.formatMoney(worker.daily_wage || 0);
    if (phoneEl) phoneEl.textContent = worker.phone || 'Not recorded';
    if (statusEl) {
      statusEl.textContent = worker.status === 'ACTIVE' ? 'Active 🟢' : 'Inactive ⚪';
      statusEl.className = `wp-status-badge ${worker.status === 'ACTIVE' ? 'active' : ''}`;
    }
  },

  renderSummary(summary, worker) {
    const netEl = document.getElementById('wpNetPayable');
    const daysEl = document.getElementById('wpEffectiveDays');
    const daysSubEl = document.getElementById('wpDaysBreakdown');
    const grossEl = document.getElementById('wpGrossPay');
    const grossSubEl = document.getElementById('wpGrossBreakdown');
    const advEl = document.getElementById('wpTotalAdvances');
    const advSubEl = document.getElementById('wpAdvancesSub');

    if (!summary) {
      if (netEl) netEl.textContent = API.formatMoney(0);
      if (daysEl) daysEl.textContent = '0 Days';
      if (daysSubEl) daysSubEl.textContent = 'No work recorded';
      if (grossEl) grossEl.textContent = API.formatMoney(0);
      if (grossSubEl) grossSubEl.textContent = 'Base: ₹0 + OT: ₹0';
      if (advEl) advEl.textContent = API.formatMoney(0);
      if (advSubEl) advSubEl.textContent = 'No advances taken';
      return;
    }

    if (netEl) netEl.textContent = API.formatMoney(summary.netPayable || 0);
    if (daysEl) daysEl.textContent = `${summary.effectiveDays || 0} Days`;
    if (daysSubEl) {
      daysSubEl.textContent = `Present: ${summary.presentDays || 0} | Half: ${summary.halfDays || 0} | Off: ${summary.paidLeaveDays || 0} | Absent: ${summary.absentDays || 0}`;
    }

    if (grossEl) grossEl.textContent = API.formatMoney(summary.grossPayTotal || 0);
    if (grossSubEl) {
      const parts = [`Base: ${API.formatMoney(summary.basePayTotal || 0)}`, `OT: ${API.formatMoney(summary.otPayTotal || 0)}`];
      if (summary.bonusTotal > 0) {
        parts.push(`Bonus: +${API.formatMoney(summary.bonusTotal)}`);
      }
      grossSubEl.textContent = parts.join(' | ');
    }

    if (advEl) advEl.textContent = API.formatMoney(summary.totalAdvances || 0);
    if (advSubEl) {
      if (summary.totalSettlements > 0) {
        advSubEl.textContent = `Advances: ${API.formatMoney(summary.totalAdvances)} | Settled: ${API.formatMoney(summary.totalSettlements)}`;
      } else {
        advSubEl.textContent = 'Mid-month advances & draws';
      }
    }
  },

  renderAttendance(records) {
    const body = document.getElementById('wpAttendanceBody');
    const countEl = document.getElementById('wpAttendanceCount');
    if (countEl) countEl.textContent = records.length;

    if (!records || records.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No attendance marked yet for this month.</td></tr>';
      return;
    }

    let html = '';
    for (const rec of records) {
      const dateFormatted = this.formatDateWithDay(rec.date);

      // Status pill styling
      let statusClass = 'wp-status-pill present';
      let statusLabel = 'Present';

      if (rec.status === 'HALF_DAY') {
        statusClass = 'wp-status-pill half-day';
        statusLabel = 'Half Day (½)';
      } else if (rec.status === 'PAID_LEAVE' || rec.status === 'PAID_HOLIDAY') {
        statusClass = 'wp-status-pill paid-off';
        statusLabel = rec.is_holiday_work ? 'Worked on Off / Holiday' : 'Paid Off';
      } else if (rec.status === 'ABSENT') {
        statusClass = 'wp-status-pill absent';
        statusLabel = 'Absent';
      }

      // Work category & Box overtime details
      let catDisplay = rec.work_category ? `<span class="badge-cat">${rec.work_category}</span>` : '<span class="text-muted">-</span>';
      let boxDisplay = '<span class="text-muted">-</span>';

      if (rec.extra_boxes > 0) {
        boxDisplay = `<strong class="text-primary">+${rec.extra_boxes} boxes</strong> <span class="text-xs text-muted">(${API.formatMoney(rec.overtime_pay || 0)})</span>`;
      } else if (rec.extra_pieces > 0) {
        boxDisplay = `<strong class="text-purple">+${rec.extra_pieces} pcs</strong> <span class="text-xs text-muted">(${API.formatMoney(rec.overtime_pay || 0)})</span>`;
      } else if (rec.overtime_pay > 0) {
        boxDisplay = `<strong class="text-primary">${API.formatMoney(rec.overtime_pay)} OT</strong>`;
      }

      const totalPay = API.formatMoney(rec.total_pay || 0);
      const notes = rec.notes ? rec.notes : '<span class="text-muted">-</span>';

      html += `
        <tr>
          <td><strong>${dateFormatted}</strong></td>
          <td><span class="${statusClass}">${statusLabel}</span></td>
          <td>${catDisplay}</td>
          <td>${boxDisplay}</td>
          <td><strong class="text-success">${totalPay}</strong></td>
          <td><small class="text-muted">${notes}</small></td>
        </tr>
      `;
    }

    body.innerHTML = html;
  },

  renderPayments(records) {
    const body = document.getElementById('wpPaymentsBody');
    const countEl = document.getElementById('wpPaymentCount');
    if (countEl) countEl.textContent = records.length;

    if (!records || records.length === 0) {
      body.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">No advances or payment transactions recorded for this month.</td></tr>';
      return;
    }

    let html = '';
    for (const p of records) {
      const dateFormatted = this.formatDateWithDay(p.date);

      let typeClass = 'wp-status-pill half-day';
      let typeLabel = 'Cash Advance';
      let amountClass = 'text-rose';
      let sign = '- ';

      if (p.type === 'PAYOUT') {
        typeClass = 'wp-status-pill present';
        typeLabel = 'Wage Settlement';
        amountClass = 'text-success';
        sign = '';
      } else if (p.type === 'BONUS') {
        typeClass = 'wp-status-pill paid-off';
        typeLabel = 'Bonus / Reward';
        amountClass = 'text-primary';
        sign = '+ ';
      }

      const amountFormatted = `${sign}${API.formatMoney(p.amount)}`;
      const methodLabel = p.payment_method ? p.payment_method.toUpperCase() : 'CASH';
      const notes = p.notes ? p.notes : '<span class="text-muted">-</span>';

      html += `
        <tr>
          <td><strong>${dateFormatted}</strong></td>
          <td><span class="${typeClass}">${typeLabel}</span></td>
          <td><span class="code-pill">${methodLabel}</span></td>
          <td><strong class="${amountClass}">${amountFormatted}</strong></td>
          <td><small class="text-muted">${notes}</small></td>
        </tr>
      `;
    }

    body.innerHTML = html;
  },

  openChangeKeyModal() {
    const form = document.getElementById('workerChangeKeyForm');
    if (form) form.reset();
    const errEl = document.getElementById('wpChangeKeyError');
    if (errEl) {
      errEl.style.display = 'none';
      errEl.textContent = '';
    }
    // Reset eye toggle icons and input types
    document.querySelectorAll('#workerChangeKeyModal .btn-toggle-eye').forEach(b => b.textContent = '👁️');
    document.querySelectorAll('#workerChangeKeyModal input').forEach(input => {
      if (input.id && input.id.startsWith('wp')) input.type = 'password';
    });

    if (window.App && typeof window.App.openModal === 'function') {
      window.App.openModal('workerChangeKeyModal');
      setTimeout(() => {
        const curInput = document.getElementById('wpCurrentKey');
        if (curInput) curInput.focus();
      }, 150);
    }
  },

  async submitChangeKey() {
    const curKey = document.getElementById('wpCurrentKey')?.value.trim();
    const newKey = document.getElementById('wpNewKey')?.value.trim();
    const confirmKey = document.getElementById('wpConfirmKey')?.value.trim();
    const errEl = document.getElementById('wpChangeKeyError');
    const submitBtn = document.getElementById('btnSaveNewKey');

    const showError = (msg) => {
      if (errEl) {
        errEl.textContent = msg;
        errEl.style.display = 'block';
      }
    };

    if (!curKey) {
      showError('Please enter your current secret key.');
      return;
    }
    if (!newKey || newKey.length < 5) {
      showError('New secret key must be at least 5 digits / characters long.');
      return;
    }
    if (newKey !== confirmKey) {
      showError('New secret key and confirmation do not match.');
      return;
    }

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Updating...';
      }
      const res = await API.changeWorkerKey(curKey, newKey);
      if (res && res.success) {
        if (window.App && typeof window.App.closeModal === 'function') {
          window.App.closeModal('workerChangeKeyModal');
          window.App.showToast('Secret key updated successfully! Use your new key next time you log in.', 'success');
        }
      } else {
        showError(res.error || res.message || 'Failed to update key. Please verify your current key.');
      }
    } catch (err) {
      showError(err.message || 'Failed to update secret key. Check your current key.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Update Key';
      }
    }
  }
};
