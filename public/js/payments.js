// Advances & Payouts (Payments) Module
const PaymentsModule = {
  payments: [],

  init() {
    this.bindEvents();
    this.loadPayments();
  },

  bindEvents() {
    const btnOpen = document.getElementById('btnOpenAddPayment');
    const form = document.getElementById('paymentForm');
    const workerFilter = document.getElementById('paymentWorkerFilter');

    btnOpen.addEventListener('click', () => {
      this.openPaymentModal();
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSavePayment();
    });

    workerFilter.addEventListener('change', () => {
      this.loadPayments();
    });
  },

  async loadPayments() {
    const listEl = document.getElementById('paymentsList');
    const filterVal = document.getElementById('paymentWorkerFilter').value;
    listEl.innerHTML = '<div class="loader-wrap"><div class="spinner"></div><p>Loading payment records...</p></div>';

    try {
      const res = await API.getPayments(filterVal);
      if (res.success) {
        this.payments = res.payments || [];
        document.getElementById('paymentsCountLabel').textContent = `${this.payments.length} records`;
        this.render();
      }
    } catch (err) {
      listEl.innerHTML = `<div class="error-msg">Error loading payments: ${err.message}</div>`;
    }
  },

  render() {
    const listEl = document.getElementById('paymentsList');
    if (this.payments.length === 0) {
      listEl.innerHTML = `
        <div class="loader-wrap">
          <p>No advances or payments recorded yet. Click "+ Record Advance / Payment" when a worker takes a cash advance or wage draw.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = this.payments.map(p => {
      const typeLabel = p.type === 'ADVANCE' ? '⚠️ Advance / Draw' : (p.type === 'PAYOUT' ? '✅ Wage Settlement' : '🎁 Bonus');
      const isAdvance = p.type === 'ADVANCE';

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
            <div class="payment-amount ${isAdvance ? 'text-rose' : 'text-success'}">
              ${isAdvance ? '-' : ''}${API.formatMoney(p.amount)}
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

    if (empId) {
      document.getElementById('paymentWorkerSelect').value = empId;
    }

    App.openModal('paymentModal');
  },

  quickAdvance(empId, empName) {
    this.openPaymentModal(empId);
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
