// API Client & Shared Utilities
const API = {
  currency: '₹',
  defaultOtMult: 0.0,
  defaultBoxRate: 30.0,
  workCategories: [
    'Sp 100', 'Sp 80', 'Sp 80 kishanganj', 'Pd 80', 'Pd 100', 'S 50', 'Pd 40', 'Pd 50',
    'P 100', 'p 95', 'P card', 'Sp card', 'pd orange card', 'pd pink card', 'pd big card',
    'sp big card', 'bangles(special)'
  ],

  // Check if category is piece-based (cards or bangles)
  isPieceCategory(cat) {
    if (!cat) return false;
    const lower = String(cat).toLowerCase();
    return lower.includes('card') || lower.includes('bangle');
  },

  // Timezone-safe local date string helper (YYYY-MM-DD)
  getLocalDateString(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  _authToken: null,

  // In-memory token for Authorization: Bearer header alongside HttpOnly cookie
  getToken() {
    return this._authToken || '';
  },

  setToken(token) {
    this._authToken = token || null;
  },

  // Generic fetch wrapper with Bearer token & 401 interception
  async request(endpoint, options = {}) {
    const defaultHeaders = {
      'Content-Type': 'application/json'
    };

    const token = this.getToken();
    if (token) {
      defaultHeaders['Authorization'] = `Bearer ${token}`;
    }

    const config = {
      ...options,
      credentials: 'include',
      headers: {
        ...defaultHeaders,
        ...(options.headers || {})
      }
    };

    if (config.body && typeof config.body === 'object') {
      config.body = JSON.stringify(config.body);
    }

    try {
      const response = await fetch(endpoint, config);
      let data = {};
      try {
        data = await response.json();
      } catch (e) {
        data = {};
      }

      // Hide offline banner on successful server response
      const offlineBanner = document.getElementById('networkOfflineBanner');
      if (offlineBanner && offlineBanner.style.display !== 'none') {
        offlineBanner.style.display = 'none';
      }

      if (!response.ok) {
        if (response.status === 401 && endpoint !== '/api/auth/verify' && endpoint !== '/api/auth/check') {
          this.setToken(null);
          if (window.App && typeof window.App.handleUnauthorized === 'function') {
            window.App.handleUnauthorized();
          }
        }
        const errorMsg = data.error || (data.details ? data.details.join(', ') : 'Server error occurred');
        throw new Error(errorMsg);
      }
      return data;
    } catch (err) {
      if (err.name === 'TypeError' && String(err.message).toLowerCase().includes('fetch')) {
        const offlineBanner = document.getElementById('networkOfflineBanner');
        if (offlineBanner) {
          offlineBanner.style.display = 'flex';
        }
        throw new Error('Connection to server lost. Please check Wi-Fi or Hotspot.');
      }
      console.error(`API Error on ${endpoint}:`, err);
      throw err;
    }
  },

  // Auth APIs
  async verifyPin(pin) {
    const res = await this.request('/api/auth/verify', { method: 'POST', body: { pin } });
    if (res.success && res.token) {
      this.setToken(res.token);
    }
    return res;
  },

  async workerLogin(identifier, pin) {
    const res = await this.request('/api/auth/worker-login', { method: 'POST', body: { identifier, pin } });
    if (res.success && res.token) {
      this.setToken(res.token);
    }
    return res;
  },

  async checkAuth() {
    const res = await this.request('/api/auth/check');
    if (res && res.authenticated && res.token) {
      this.setToken(res.token);
    }
    return res;
  },

  async logout() {
    this.setToken(null);
    try {
      await this.request('/api/auth/logout', { method: 'POST' });
    } catch (e) {}
  },

  async changePin(currentPin, newPin) {
    return this.request('/api/auth/change-pin', { method: 'POST', body: { currentPin, newPin } });
  },

  // Worker Passbook API
  async getWorkerPassbook(month = '', employeeId = '') {
    let url = '/api/worker/passbook?';
    if (month) url += `month=${encodeURIComponent(month)}&`;
    if (employeeId) url += `employee_id=${encodeURIComponent(employeeId)}&`;
    return this.request(url);
  },

  // Database Backup Download via secure HttpOnly cookie & Blob (Zero Token in URL)
  async downloadBackup() {
    try {
      const response = await fetch('/api/backup', {
        method: 'GET',
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error(`Backup download failed (HTTP ${response.status})`);
      }
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      const today = this.getLocalDateString();
      a.download = `attendance_backup_${today}.db`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      alert('Failed to download backup: ' + err.message);
    }
  },

  // Server Info & Mobile QR Code
  async getServerInfo() {
    return this.request('/api/server-info');
  },

  // Settings APIs
  async getSettings() {
    const res = await this.request('/api/settings');
    if (res.success && res.settings) {
      if (res.settings.currency_symbol) this.currency = res.settings.currency_symbol;
      if (res.settings.default_ot_multiplier !== undefined && res.settings.default_ot_multiplier !== null) {
        this.defaultOtMult = parseFloat(res.settings.default_ot_multiplier);
      }
      if (res.settings.default_box_rate !== undefined && res.settings.default_box_rate !== null) {
        this.defaultBoxRate = parseFloat(res.settings.default_box_rate);
      }
      if (res.settings.work_categories_list && Array.isArray(res.settings.work_categories_list)) {
        this.workCategories = res.settings.work_categories_list;
      }
    }
    return res;
  },

  async updateSettings(settingsObj) {
    const res = await this.request('/api/settings', { method: 'PUT', body: settingsObj });
    await this.getSettings();
    return res;
  },

  // Holiday APIs
  async getHolidays() {
    return this.request('/api/holidays');
  },

  async saveHoliday(holidayData) {
    return this.request('/api/holidays', { method: 'POST', body: holidayData });
  },

  async deleteHoliday(id) {
    return this.request(`/api/holidays/${id}`, { method: 'DELETE' });
  },

  // Employee APIs
  async getEmployees(status = 'ALL') {
    return this.request(`/api/employees?status=${encodeURIComponent(status)}`);
  },

  async saveEmployee(workerData) {
    if (workerData.id) {
      return this.request(`/api/employees/${workerData.id}`, { method: 'PUT', body: workerData });
    } else {
      return this.request('/api/employees', { method: 'POST', body: workerData });
    }
  },

  async deleteEmployee(id, hardDelete = false) {
    return this.request(`/api/employees/${id}?hardDelete=${hardDelete}`, { method: 'DELETE' });
  },

  // Attendance APIs
  async getAttendance(date) {
    return this.request(`/api/attendance?date=${date}`);
  },

  async markAttendance(record) {
    return this.request('/api/attendance', { method: 'POST', body: record });
  },

  async batchMarkAttendance(date, records) {
    return this.request('/api/attendance/batch', { method: 'POST', body: { date, records } });
  },

  // Payments / Advances APIs
  async getPayments(employeeId = '', startDate = '', endDate = '') {
    let url = '/api/payments?';
    if (employeeId) url += `employee_id=${employeeId}&`;
    if (startDate) url += `startDate=${startDate}&`;
    if (endDate) url += `endDate=${endDate}&`;
    return this.request(url);
  },

  async savePayment(paymentData) {
    return this.request('/api/payments', { method: 'POST', body: paymentData });
  },

  async deletePayment(id) {
    return this.request(`/api/payments/${id}`, { method: 'DELETE' });
  },

  // Reports
  async getPayrollReport(startDate = '', endDate = '', employeeId = '') {
    let url = '/api/reports/payroll?';
    if (startDate) url += `startDate=${startDate}&`;
    if (endDate) url += `endDate=${endDate}&`;
    if (employeeId) url += `employee_id=${employeeId}&`;
    return this.request(url);
  },

  // Format Helper: Currency
  formatMoney(amount) {
    const num = Number(amount) || 0;
    return `${this.currency}${num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
};
