// 弹出页面JavaScript
document.addEventListener('DOMContentLoaded', function() {
  // 获取DOM元素
  const userSection = document.getElementById('user-section');
  const totalCollectedEl = document.getElementById('total-collected');
  const todayCollectedEl = document.getElementById('today-collected');
  const usCountEl = document.getElementById('us-count');
  const jpCountEl = document.getElementById('jp-count');
  const historyList = document.getElementById('history-list');
  const collectCurrentBtn = document.getElementById('collect-current');
  const viewCollectionBtn = document.getElementById('view-collection');
  const settingsBtn = document.getElementById('settings');
  const viewAllHistoryBtn = document.getElementById('view-all-history');
  const marketplaceBtns = document.querySelectorAll('.marketplace-btn');
  
  let currentUser = null;
  let currentMarketplace = 'all';
  let userStats = {
    total: 0,
    today: 0,
    byMarketplace: {}
  };
  
  // 初始化
  init();
  
  // 初始化函数
  async function init() {
    await checkAuth();
    loadUserStats();
    loadRecentHistory();
    setupEventListeners();
  }
  
  // 检查认证状态
  async function checkAuth() {
    try {
      const session = await getStorageData('supabaseSession');
      if (session) {
        currentUser = session.user;
        renderUserInfo();
      } else {
        renderLoginPrompt();
      }
    } catch (error) {
      console.error('检查认证失败:', error);
      renderLoginPrompt();
    }
  }
  
  // 渲染用户信息
  function renderUserInfo() {
    if (!currentUser) {
      renderLoginPrompt();
      return;
    }
    
    userSection.innerHTML = `
      <div class="user-info">
        <div>
          <div class="user-email" title="${currentUser.email}">${currentUser.email}</div>
          <div style="font-size: 11px; color: #666; margin-top: 2px;">用户ID: ${currentUser.id.substring(0, 8)}...</div>
        </div>
        <button class="logout-btn">退出登录</button>
      </div>
    `;
    
    // 添加登出事件
    userSection.querySelector('.logout-btn').addEventListener('click', logout);
  }
  
  // 渲染登录提示
  function renderLoginPrompt() {
    userSection.innerHTML = `
      <div class="login-prompt">
        <div style="margin-bottom: 10px; color: #666;">请登录以使用采集功能</div>
        <button class="login-btn">登录 / 注册</button>
      </div>
    `;
    
    // 添加登录事件
    userSection.querySelector('.login-btn').addEventListener('click', () => {
      // 打开认证页面或显示认证模态框
      chrome.tabs.create({ url: 'auth.html' });
    });
  }
  
  // 加载用户统计
  async function loadUserStats() {
    if (!currentUser) return;
    
    try {
      const response = await sendMessageToBackground({ action: 'getProducts' });
      if (response.success) {
        const products = response.data || [];
        const today = new Date().toISOString().split('T')[0];
        
        userStats.total = response.count || 0;
        userStats.today = products.filter(p => p.created_at?.startsWith(today)).length;
        userStats.byMarketplace = {};
        
        products.forEach(product => {
          const marketplace = product.marketplace || 'unknown';
          userStats.byMarketplace[marketplace] = (userStats.byMarketplace[marketplace] || 0) + 1;
        });
        
        updateStatsDisplay();
      }
    } catch (error) {
      console.error('加载统计失败:', error);
      showError('加载统计失败');
    }
  }
  
  // 更新统计显示
  function updateStatsDisplay() {
    totalCollectedEl.textContent = userStats.total.toLocaleString();
    todayCollectedEl.textContent = userStats.today.toLocaleString();
    usCountEl.textContent = (userStats.byMarketplace.US || 0).toLocaleString();
    jpCountEl.textContent = (userStats.byMarketplace.JP || 0).toLocaleString();
  }
  
  // 加载最近历史
  async function loadRecentHistory() {
    if (!currentUser) {
      historyList.innerHTML = '<div class="no-data">请先登录</div>';
      return;
    }
    
    try {
      const response = await sendMessageToBackground({ 
        action: 'getProducts', 
        page: 1, 
        limit: 5,
        marketplace: currentMarketplace === 'all' ? null : currentMarketplace
      });
      
      if (response.success) {
        const products = response.data || [];
        
        if (products.length === 0) {
          historyList.innerHTML = '<div class="no-data">暂无采集记录</div>';
          return;
        }
        
        historyList.innerHTML = products.map(product => `
          <div class="history-item">
            <div>
              <div class="asin" title="${product.asin}">${product.asin}</div>
              <div style="font-size: 10px; color: #999; margin-top: 2px;">
                ${formatDate(product.created_at)}
              </div>
            </div>
            <div class="status ${product.status || 'collected'}">
              ${product.status || 'collected'}
            </div>
          </div>
        `).join('');
      } else {
        historyList.innerHTML = '<div class="error">加载失败</div>';
      }
    } catch (error) {
      console.error('加载历史失败:', error);
      historyList.innerHTML = '<div class="error">加载失败</div>';
    }
  }
  
  // 设置事件监听器
  function setupEventListeners() {
    // 采集当前页面
    collectCurrentBtn.addEventListener('click', () => {
      if (!currentUser) {
        alert('请先登录');
        return;
      }
      
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].url.includes('amazon.')) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'collectAll' }, (response) => {
            if (chrome.runtime.lastError) {
              alert('请在亚马逊页面使用此功能');
            } else if (response && response.success) {
              alert('已开始采集当前页面');
              window.close(); // 关闭弹出窗口
            }
          });
        } else {
          alert('请在亚马逊页面使用此功能');
        }
      });
    });
    
    // 查看已采集
    viewCollectionBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'collection.html' });
    });
    
    // 插件设置
    settingsBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'options.html' });
    });
    
    // 查看全部历史
    viewAllHistoryBtn.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'collection.html' });
    });
    
    // 市场筛选
    marketplaceBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        marketplaceBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMarketplace = btn.dataset.marketplace;
        loadRecentHistory();
      });
    });
  }
  
  // 登出
  async function logout() {
    try {
      const response = await sendMessageToBackground({ action: 'logout' });
      if (response.success) {
        currentUser = null;
        userStats = { total: 0, today: 0, byMarketplace: {} };
        init(); // 重新初始化
      }
    } catch (error) {
      console.error('登出失败:', error);
      showError('登出失败');
    }
  }
  
  // 辅助函数
  async function getStorageData(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key]);
      });
    });
  }
  
  function sendMessageToBackground(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: false, error: '无响应' });
        }
      });
    });
  }
  
  function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  
  function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = message;
    errorDiv.style.position = 'fixed';
    errorDiv.style.top = '10px';
    errorDiv.style.left = '10px';
    errorDiv.style.right = '10px';
    errorDiv.style.zIndex = '1000';
    document.body.appendChild(errorDiv);
    
    setTimeout(() => errorDiv.remove(), 3000);
  }
  
  // 监听来自内容脚本的消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateStats') {
      loadUserStats();
      loadRecentHistory();
    }
  });
});
