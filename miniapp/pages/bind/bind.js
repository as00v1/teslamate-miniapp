// pages/bind/bind.js - 口令登录页
const auth = require('../../utils/auth');

Page({
  data: {
    passphrase: '',
    showPass: false,
    canSubmit: false,
    errorText: '',
    submitting: false
  },

  onInput(e) {
    const passphrase = e.detail.value;
    this.setData({
      passphrase,
      canSubmit: passphrase.length > 0,
      errorText: ''
    });
  },

  toggleShow() {
    this.setData({ showPass: !this.data.showPass });
  },

  doLogin() {
    if (!this.data.canSubmit || this.data.submitting) return;
    this.setData({ submitting: true, errorText: '' });

    // 绑定前先确保 openid 为真实身份（避免用 storage 残留的 demo_/dev_ 模拟身份绑定）
    auth.ensureAuthReady().then(() => {
      return auth.loginWithPassphrase(this.data.passphrase);
    }).then(() => {
      wx.showToast({ title: '登录成功', icon: 'success' });
      setTimeout(() => {
        const pages = getCurrentPages();
        if (pages.length > 1) {
          wx.navigateBack();
        } else {
          wx.switchTab({ url: '/pages/index/index' });
        }
      }, 800);
    }).catch((err) => {
      this.setData({ submitting: false, errorText: err.message || '登录失败' });
    });
  }
});
