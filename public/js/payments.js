// Advances & Payouts (Payments) Module
const PaymentsModule = {
  payments: [],

  init() {
    this.bindEvents();
    this.loadPayments();
  },

  bindEvents() {
    const btnOpen = document.getElementById('btnOpenAddPayment');
    const btnBonus = document.getElementById('btnOpenAddBonus');
    const form = document.getElementById('paymentForm');
    const workerFilter = document.getElementById('paymentWorkerFilter');
    const typeFilter = document.getElementById('paymentTypeFilter');
    const typeSelect = document.getElementById('paymentType');

    if (btnOpen) {
      btnOpen.addEventListener('click', () => {
        this.openPaymentModal();
      });
    }

    if (btnBonus) {
      btnBonus.addEventListener('click', () => {
        this.openBonusModal();
      });
    }

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleSavePayment();
      });
    }

    if (workerFilter) {
      workerFilter.addEventListener('change', () => {
        this.loadPayments();
      });
    }

    if (typeFilter) {
      typeFilter.addEventListener('change', () => {
        this.render();
      });
    }

    if (typeSelect) {
      typeSelect.addEventListener('change', (e) => {
        this.updateNotesPlaceholder(e.target.value);
      });
    }
  },

  updateNotesPlaceholder(type) {
    const notesInput = document.getElementById('paymentNotes');
    if (!notesInput) return;
    if (type === 'BONUS') {
      notesInput.placeholder = 'e.g. Festival reward, Performance bonus, Attendance bonus';
    } else if (type === 'PAYOUT') {
      notesInput.placeholder = 'e.g. Previous month wage settlement, Cleared dues';
    } else {
      notesInput.placeholder = 'e.g. Emergency advance, Medical draw, Mid-week cash';
    }
  },

  async loadPayments() {
    const listEl = document.getElementById('paymentsList');
    const filterVal = document.getElementById('paymentWorkerFilter')?.value || '';
    listEl.innerHTML = '<div class="loader-wrap"><div class="spinner"></div><p>Loading payment records...</p></div>';

    try {
      const res = await API.getPayments(filterVal);
      if (res.success) {
        this.payments = res.payments || [];
        this.render();
      }
    } catch (err) {
      listEl.innerHTML = `<div class="error-msg">Error loading payments: ${err.message}</div>`;
    }
  },

  render() {
    const listEl = document.getElementById('paymentsList');
    const typeFilter = document.getElementById('paymentTypeFilter')?.value || '';
    const filtered = this.payments.filter(p => !typeFilter || p.type === typeFilter);

    const countLabel = document.getElementById('paymentsCountLabel');
    if (countLabel) {
      if (typeFilter) {
        countLabel.textContent = `${filtered.length} of ${this.payments.length} records`;
      } else {
        countLabel.textContent = `${this.payments.length} records`;
      }
    }

    if (filtered.length === 0) {
      let emptyMsg = 'No advances or payments recorded yet. Click "+ Record Advance / Payment" when a worker takes a cash advance or wage draw.';
      if (typeFilter === 'BONUS') {
        emptyMsg = '🎁 No bonus or reward records found. Click "🎁 Award Bonus / Reward" to record a festive or performance reward.';
      } else if (typeFilter === 'ADVANCE') {
        emptyMsg = '⚠️ No cash advances or draws recorded.';
      } else if (typeFilter === 'PAYOUT') {
        emptyMsg = '✅ No wage settlements recorded.';
      }

      listEl.innerHTML = `
        <div class="loader-wrap">
          <p>${emptyMsg}</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = filtered.map(p => {
      let typeLabel = '💵 Wage Settlement';
      let amountClass = 'text-success';
      let sign = '';

      if (p.type === 'ADVANCE') {
        typeLabel = '⚠️ Advance / Draw';
        amountClass = 'text-rose';
        sign = '-';
      } else if (p.type === 'PAYOUT') {
        typeLabel = '✅ Full Payout';
        amountClass = 'text-success';
        sign = '';
      } else if (p.type === 'BONUS') {
        typeLabel = '🎁 Bonus / Reward';
        amountClass = 'text-purple';
        sign = '+';
      }

      return `
        <div class="payment-item">
          <div>
            <div style="font-weight: 700; font-size: 0.95rem;">
              ${this.escapeHtml(p.employee_name)}
              <span class="worker-badge">${this.escapeHtml(p.role || '')}</span>
            </div>
            <div class="text-xs text-muted mt-1">
              📅 ${p.date} • 💳 ${p.payment_method} • <strong>${typeLabel}</strong>
            </div>
            ${p.notes ? `<div class="text-xs text-muted" style="font-style: italic;">"${this.escapeHtml(p.notes)}"</div>` : ''}
          </div>

          <div style="text-align: right;">
            <div class="payment-amount ${amountClass}">
              ${sign}${API.formatMoney(p.amount)}
            </div>
            <button class="btn btn-secondary btn-sm mt-1" style="font-size: 0.7rem; padding: 2px 6px;" onclick="PaymentsModule.deletePaymentEntry(${p.id})">
              🗑️ Delete
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  openPaymentModal(empId = null) {
    const form = document.getElementById('paymentForm');
    form.reset();
    document.getElementById('paymentDate').value = API.getLocalDateString();
    document.getElementById('paymentType').value = 'ADVANCE';
    this.updateNotesPlaceholder('ADVANCE');

    if (empId) {
      document.getElementById('paymentWorkerSelect').value = empId;
    }

    App.openModal('paymentModal');
  },

  openBonusModal(empId = null) {
    const form = document.getElementById('paymentForm');
    form.reset();
    document.getElementById('paymentDate').value = API.getLocalDateString();
    document.getElementById('paymentType').value = 'BONUS';
    this.updateNotesPlaceholder('BONUS');

    if (empId) {
      document.getElementById('paymentWorkerSelect').value = empId;
    }

    App.openModal('paymentModal');
  },

  quickAdvance(empId, empName) {
    this.openPaymentModal(empId);
  },

  quickBonus(empId, empName) {
    this.openBonusModal(empId);
  },

  async handleSavePayment() {
    const employee_id = document.getElementById('paymentWorkerSelect').value;
    const date = document.getElementById('paymentDate').value;
    const amount = parseFloat(document.getElementById('paymentAmount').value);
    const type = document.getElementById('paymentType').value;
    const payment_method = document.getElementById('paymentMethod').value;
    const notes = document.getElementById('paymentNotes').value.trim();

    if (!employee_id || !date || isNaN(amount) || amount <= 0) {
      App.showToast('Please select worker and enter a valid amount', 'error');
      return;
    }

    try {
      const res = await API.savePayment({
        employee_id: parseInt(employee_id),
        date,
        amount,
        type,
        payment_method,
        notes
      });

      if (res.success) {
        App.showToast('Payment/Advance recorded successfully', 'success');
        App.closeModal('paymentModal');
        await this.loadPayments();
        // Refresh payroll if loaded
        if (PayrollModule) PayrollModule.loadReport();
      }
    } catch (err) {
      App.showToast(`Error: ${err.message}`, 'error');
    }
  },

  async deletePaymentEntry(id) {
    const confirmed = confirm('Are you sure you want to delete this payment record?');
    if (!confirmed) return;

    try {
      const res = await API.deletePayment(id);
      if (res.success) {
        App.showToast('Payment record removed', 'success');
        await this.loadPayments();
        if (PayrollModule) PayrollModule.loadReport();
      }
    } catch (err) {
      App.showToast(`Error: ${err.message}`, 'error');
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
