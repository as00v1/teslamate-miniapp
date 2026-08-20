// pages/users/users.js - 用户管理页
const auth = require('../../utils/auth');
const fmt = require('../../utils/format');

Page({
  data: {
    isOwner: false,
    openid: '',
    members: []
  },

  onShow() {
    this.loadMembers();
  },

  loadMembers() {
    // 真实模式：以服务端成员列表为准（auth.fetchMembers 内部已区分 mock/真实）
    auth.fetchMembers().then((list) => {
      const members = (list || []).map(m => ({
        ...m,
        boundTimeText: m.bound_at ? fmt.fmtDateTime(m.bound_at) : ''
      }));
      this.setData({
        isOwner: auth.isOwner(),
        openid: auth.getOpenid(),
        members
      });
    }).catch(() => {
      // 降级：本地缓存
      const members = auth.getMembers().map(m => ({
        ...m,
        boundTimeText: m.bound_at ? fmt.fmtDateTime(m.bound_at) : ''
      }));
      this.setData({
        isOwner: auth.isOwner(),
        openid: auth.getOpenid(),
        members
      });
    });
  },

  doRemoveMember(e) {
    const targetOpenid = e.currentTarget.dataset.openid;
    if (!targetOpenid) return;
    wx.showModal({
      title: '移除用户',
      content: '移除后该微信将无法查看车辆数据，需要重新登录。确定继续？',
      confirmColor: '#E82127',
      success: (res) => {
        if (res.confirm) {
          auth.removeMember(targetOpenid).then(() => {
            this.loadMembers();
            wx.showToast({ title: '已移除', icon: 'success' });
          }).catch((err) => {
            wx.showToast({ title: err.message || '移除失败', icon: 'none' });
          });
        }
      }
    });
  },

  doUnbind() {
    wx.showModal({
      title: '解绑当前账号',
      content: '解绑后将无法查看车辆数据，需重新输入口令登录。确定继续？',
      confirmColor: '#E82127',
      success: (res) => {
        if (res.confirm) {
          auth.unbind();
          wx.showToast({ title: '已解绑', icon: 'success' });
          setTimeout(() => {
            wx.navigateBack();
          }, 800);
        }
      }
    });
  }
});
