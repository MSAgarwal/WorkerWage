// API Client & Shared Utilities
const API = {
  currency: '₹',
  defaultOtMult: 1.5,

  // Generic fetch wrapper
  async request(endpoint, options = {}) {
    const defaultHeaders = {
      'Content-Type': 'application/json'
    };

    const config = {
      ...options,
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
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Server error occurred');
      }
      return data;
    } catch (err) {
      console.error(`API Error on ${endpoint}:`, err);
      throw err;
    }
  },

  // Auth APIs
  async verifyPin(pin) {
    return this.request('/api/auth/verify', { method: 'POST', body: { pin } });
  },

  async changePin(currentPin, newPin) {
    return this.request('/api/auth/change-pin', { method: 'POST', body: { currentPin, newPin } });
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
      if (res.settings.default_ot_multiplier) this.defaultOtMult = parseFloat(res.settings.default_ot_multiplier) || 1.5;
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
