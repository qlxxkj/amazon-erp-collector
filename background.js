// 亚马逊采集插件 - 后台服务工作者
'use strict';

console.log('Background script开始加载...');

// Supabase配置
const SUPABASE_CONFIG = {
  url: 'https://qxgkagprwozrbddhoosw.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4Z2thZ3Byd296cmJkZGhvb3N3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEzNjM0MjEsImV4cCI6MjA3NjkzOTQyMX0.hgtBVV0gAzU3CetY2Ao7p43w2hzgxc7ji--5-BBxIGo'
};

let currentSession = null;

// 消息监听器
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background收到消息:', request.action);
  console.log('完整请求:', JSON.stringify(request));
  
  switch (request.action) {
    case 'ping':
      console.log('收到ping请求，返回pong');
      sendResponse({ success: true, message: 'pong' });
      break;
    
    case 'login':
      console.log('处理登录请求');
      handleLogin(request, sendResponse);
      return true;
    
    case 'register':
      console.log('处理注册请求');
      handleRegister(request, sendResponse);
      return true;
    
    case 'saveProduct':
      console.log('处理保存商品请求');
      handleSaveProduct(request, sendResponse);
      return true;
    
    case 'getProducts':
      console.log('处理获取商品请求');
      handleGetProducts(request, sendResponse);
      return true;
    
    case 'logout':
      console.log('处理登出请求');
      handleLogout(sendResponse);
      return true;
    
    case 'checkLoginStatus':
      console.log('处理检查登录状态请求');
      handleCheckLoginStatus(sendResponse);
      return true;
    
    case 'collectFromDetailPage':
      console.log('处理从详情页采集请求');
      handleCollectFromDetailPage(request, sendResponse);
      return true;
    
    default:
      console.log('未知操作:', request.action);
      sendResponse({ success: false, error: '未知操作' });
  }
});

console.log('消息监听器已设置');

// 辅助函数：刷新Token
async function refreshToken() {
  if (!currentSession || !currentSession.refresh_token) {
    throw new Error('No refresh token available');
  }

  console.log('正在尝试刷新Token...');
  try {
    const response = await fetch(`${SUPABASE_CONFIG.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_CONFIG.anonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refresh_token: currentSession.refresh_token })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error_description || data.message || 'Token refresh failed');
    }

    // 更新 session
    // 注意：刷新返回的数据可能不包含 user 对象，所以我们需要保留原来的 user 对象
    const user = currentSession.user;
    currentSession = { ...data, user: data.user || user };
    
    await chrome.storage.local.set({ supabaseSession: currentSession });
    console.log('Token 刷新成功');
    return currentSession;
  } catch (error) {
    console.error('Token 刷新失败:', error);
    currentSession = null;
    await chrome.storage.local.remove('supabaseSession');
    throw error;
  }
}

// 辅助函数：发送请求到Supabase
async function supabaseRequest(endpoint, options = {}) {
  const url = `${SUPABASE_CONFIG.url}${endpoint}`;
  
  const getHeaders = () => {
    const headers = {
      'apikey': SUPABASE_CONFIG.anonKey,
      'Content-Type': 'application/json',
      ...options.headers
    };
    
    if (currentSession && currentSession.access_token) {
      headers['Authorization'] = `Bearer ${currentSession.access_token}`;
    }
    return headers;
  };
  
  let response = await fetch(url, {
    ...options,
    headers: getHeaders()
  });
  
  // 如果是 401 错误，尝试刷新 Token 并重试
  if (response.status === 401) {
    console.log('收到 401 错误，尝试刷新 Token...');
    try {
      await refreshToken();
      // 使用新的 Token 重试请求
      response = await fetch(url, {
        ...options,
        headers: getHeaders()
      });
    } catch (e) {
      console.log('Token 刷新失败或重试失败:', e);
      // 刷新失败，继续处理原始响应（将在下方抛出错误）
    }
  }
  
  if (!response.ok) {
    let errorMessage = '请求失败';
    try {
      const error = await response.json();
      errorMessage = error.message || error.error_description || errorMessage;
      
      // 检测JWT过期错误
      if (errorMessage.includes('JWT expired') || 
          errorMessage.includes('Invalid JWT') || 
          errorMessage.includes('Token expired') ||
          response.status === 401) {
        console.log('检测到JWT过期，清除会话');
        currentSession = null;
        chrome.storage.local.remove('supabaseSession');
        errorMessage = '登录已过期，请重新登录';
      }
    } catch (e) {
      errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      
      // 对于401错误，也清除会话
      if (response.status === 401) {
        console.log('检测到401未授权错误，清除会话');
        currentSession = null;
        chrome.storage.local.remove('supabaseSession');
        errorMessage = '登录已过期，请重新登录';
      }
    }
    throw new Error(errorMessage);
  }
  
  const text = await response.text();
  if (!text || text.trim() === '') {
    return null;
  }
  
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('JSON解析失败:', text);
    throw new Error('响应数据格式错误');
  }
}

// 处理用户登录
async function handleLogin(request, sendResponse) {
  console.log('handleLogin函数被调用');
  
  try {
    const { email, password } = request;
    console.log('开始调用Supabase登录API...');
    
    const response = await fetch(`${SUPABASE_CONFIG.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_CONFIG.anonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    console.log('Supabase登录API返回:', data);
    
    if (!response.ok) {
      throw new Error(data.error_description || data.message || '登录失败');
    }
    
    currentSession = data;
    chrome.storage.local.set({ supabaseSession: data });
    console.log('用户登录成功:', email);
    
    sendResponse({ success: true, user: data.user });
  } catch (error) {
    console.error('登录失败:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// 处理用户注册
async function handleRegister(request, sendResponse) {
  console.log('handleRegister函数被调用');
  
  try {
    const { email, password } = request;
    console.log('开始调用Supabase注册API...');
    
    const response = await fetch(`${SUPABASE_CONFIG.url}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_CONFIG.anonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    console.log('Supabase注册API返回:', data);
    
    if (!response.ok) {
      throw new Error(data.error_description || data.message || '注册失败');
    }
    
    if (data.user) {
      console.log('注册成功，开始自动登录...');
      
      const loginResponse = await fetch(`${SUPABASE_CONFIG.url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_CONFIG.anonKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });
      
      const loginData = await loginResponse.json();
      
      if (!loginResponse.ok) {
        throw new Error(loginData.error_description || loginData.message || '自动登录失败');
      }
      
      currentSession = loginData;
      chrome.storage.local.set({ supabaseSession: loginData });
      console.log('用户注册并登录成功:', email);
      
      sendResponse({ success: true, user: loginData.user });
    } else {
      console.log('注册失败：未返回用户数据');
      sendResponse({ success: false, error: '注册失败' });
    }
  } catch (error) {
    console.error('注册失败:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// 处理商品保存
async function handleSaveProduct(request, sendResponse) {
  try {
    if (!currentSession) {
      sendResponse({ success: false, error: '用户未登录' });
      return;
    }
    
    const productData = request.productData;
    const userId = currentSession.user.id;

    // 检查是否存在重复ASIN
    try {
      const checkUrl = `/rest/v1/listings?user_id=eq.${userId}&asin=eq.${productData.asin}&select=id`;
      const existingProducts = await supabaseRequest(checkUrl);
      
      if (existingProducts && existingProducts.length > 0) {
        console.log(`商品 ${productData.asin} 已存在，跳过保存`);
        sendResponse({ success: true, message: '商品已存在', skipped: true });
        return;
      }
    } catch (checkError) {
      console.warn('检查重复商品失败，尝试直接保存:', checkError);
      // 继续执行保存逻辑
    }
    
    const productToSave = {
      ...productData,
      user_id: userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const data = await supabaseRequest('/rest/v1/listings', {
      method: 'POST',
      body: JSON.stringify(productToSave)
    });
    
    console.log('商品保存成功:', productData.asin);
    sendResponse({ success: true, data: data });
  } catch (error) {
    console.error('保存商品失败:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// 处理获取商品列表
async function handleGetProducts(request, sendResponse) {
  try {
    if (!currentSession) {
      sendResponse({ success: false, error: '用户未登录' });
      return;
    }
    
    const userId = currentSession.user.id;
    const { page = 1, limit = 50, marketplace } = request;
    const offset = (page - 1) * limit;
    
    let url = `/rest/v1/listings?user_id=eq.${userId}&order=created_at.desc&limit=${limit}&offset=${offset}`;
    
    if (marketplace) {
      url += `&marketplace=eq.${marketplace}`;
    }
    
    const data = await supabaseRequest(url);
    
    const countResponse = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/listings?user_id=eq.${userId}&select=count`, {
      headers: {
        'apikey': SUPABASE_CONFIG.anonKey,
        'Authorization': `Bearer ${currentSession.access_token}`,
        'Prefer': 'count=exact'
      }
    });
    
    const countHeader = countResponse.headers.get('Content-Range');
    const count = countHeader ? parseInt(countHeader.split('/')[1]) : data.length;
    
    sendResponse({ 
      success: true, 
      data: data, 
      count: count,
      page: page,
      totalPages: Math.ceil(count / limit)
    });
  } catch (error) {
    console.error('获取商品失败:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// 处理用户登出
async function handleLogout(sendResponse) {
  try {
    if (currentSession && currentSession.access_token) {
      await fetch(`${SUPABASE_CONFIG.url}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_CONFIG.anonKey,
          'Authorization': `Bearer ${currentSession.access_token}`
        }
      });
    }
    
    currentSession = null;
    chrome.storage.local.remove('supabaseSession');
    chrome.storage.local.remove('collectionState');
    
    console.log('用户已登出');
    sendResponse({ success: true });
  } catch (error) {
    console.error('登出失败:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// 检查登录状态
async function handleCheckLoginStatus(sendResponse) {
  try {
    const result = await chrome.storage.local.get(['supabaseSession']);
    const session = result.supabaseSession;
    
    if (!session || !session.access_token) {
      console.log('未找到登录会话');
      sendResponse({ 
        success: true, 
        isLoggedIn: false, 
        isExpired: false,
        message: '未登录' 
      });
      return;
    }
    
    currentSession = session;
    
    // 检查是否过期
    // Supabase 的 expires_at 是秒，Date.now() 是毫秒
    const now = Date.now() / 1000;
    const expiresAt = session.expires_at || 0;
    const isExpired = expiresAt ? now >= expiresAt : false;
    // 提前 5 分钟 (300秒) 刷新
    const isAboutToExpire = expiresAt ? now >= expiresAt - 300 : false;
    
    if (isExpired || isAboutToExpire) {
      console.log('登录会话已过期或即将过期，尝试刷新Token...');
      try {
        await refreshToken();
        console.log('Token刷新成功，登录状态正常');
        sendResponse({ 
          success: true, 
          isLoggedIn: true, 
          isExpired: false,
          message: '已登录' 
        });
      } catch (e) {
        console.log('Token刷新失败，登录会话已过期');
        sendResponse({ 
          success: true, 
          isLoggedIn: false, 
          isExpired: true,
          message: '登录已过期' 
        });
      }
    } else {
      console.log('登录状态正常');
      sendResponse({ 
        success: true, 
        isLoggedIn: true, 
        isExpired: false,
        message: '已登录' 
      });
    }
  } catch (error) {
    console.error('检查登录状态失败:', error);
    sendResponse({ 
      success: false, 
      isLoggedIn: false, 
      isExpired: false,
      error: error.message 
    });
  }
}

// 处理从详情页采集
async function handleCollectFromDetailPage(request, sendResponse) {
  let tabId = null;
  try {
    const { asin, returnUrl } = request;
    const productUrl = `https://www.amazon.com/dp/${asin}`;
    
    console.log('准备从详情页采集:', asin);
    
    // 检查是否已经打开详情页
    const tabs = await chrome.tabs.query({ url: `*://*.amazon.com/dp/${asin}*` });
    
    let tab;
    if (tabs.length > 0) {
      // 如果已打开，使用该标签页但不激活
      tab = tabs[0];
      console.log('使用已打开的详情页:', tab.url);
      
      // 如果该标签页在前台，切换到后台
      if (tab.active) {
        await chrome.tabs.update(tab.id, { active: false });
        console.log('将详情页切换到后台');
      }
    } else {
      // 在后台创建新标签页打开详情页（不激活）
      tab = await chrome.tabs.create({ url: productUrl, active: false });
      console.log('已在后台打开详情页:', tab.url);
    }
    
    tabId = tab.id;
    
    // 等待页面加载完成
    await waitForTabToLoad(tab.id);
    
    console.log('详情页加载完成，开始采集数据');
    
    // 发送消息给content script采集数据
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'collectProductData',
      asin: asin
    });
    
    console.log('采集响应:', response);
    
    if (response && response.success) {
      // 保存到Supabase
      const saveResponse = await handleSaveProductInternal(response.productData);
      
      if (saveResponse.success) {
        // 关闭后台标签页
        try {
          await chrome.tabs.remove(tab.id);
          console.log('已关闭后台详情页');
        } catch (e) {
          console.warn('关闭标签页失败:', e);
        }
        
        sendResponse({ success: true, productData: response.productData });
      } else {
        sendResponse({ success: false, error: saveResponse.error });
      }
    } else {
      sendResponse({ success: false, error: response?.error || '采集失败' });
    }
  } catch (error) {
    console.error('从详情页采集失败:', error);
    
    // 发生错误时，尝试关闭标签页
    if (tabId) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (e) {
        console.warn('关闭标签页失败:', e);
      }
    }
    
    sendResponse({ success: false, error: error.message });
  }
}

// 等待标签页加载完成
function waitForTabToLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        // 额外等待一段时间，确保页面完全加载
        setTimeout(resolve, 2000);
      }
    };
    
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// 内部保存商品函数
async function handleSaveProductInternal(productData) {
  try {
    if (!currentSession) {
      return { success: false, error: '用户未登录' };
    }
    
    const userId = currentSession.user.id;
    
    const productToSave = {
      ...productData,
      user_id: userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    console.log('准备保存商品数据:', productToSave.asin);
    
    const response = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/listings`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_CONFIG.anonKey,
        'Authorization': `Bearer ${currentSession.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(productToSave)
    });
    
    console.log('保存响应状态:', response.status, response.statusText);
    
    if (!response.ok) {
      let errorMessage = '保存失败';
      try {
        const error = await response.json();
        errorMessage = error.message || error.error_description || errorMessage;
      } catch (e) {
        errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      }
      console.error('保存商品失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
    
    const text = await response.text();
    console.log('保存响应内容:', text);
    
    if (!text || text.trim() === '') {
      console.log('商品保存成功（无响应内容）:', productData.asin);
      return { success: true, data: null };
    }
    
    try {
      const data = JSON.parse(text);
      console.log('商品保存成功:', productData.asin);
      return { success: true, data: data };
    } catch (e) {
      console.error('JSON解析失败:', text);
      return { success: true, data: null };
    }
  } catch (error) {
    console.error('保存商品失败:', error);
    return { success: false, error: error.message };
  }
}

// 加载保存的会话
async function loadSavedSession() {
  try {
    const result = await chrome.storage.local.get('supabaseSession');
    if (result.supabaseSession) {
      currentSession = result.supabaseSession;
      console.log('已加载保存的会话:', currentSession.user?.email);
    }
  } catch (error) {
    console.error('加载会话失败:', error);
  }
}

// 安装事件
chrome.runtime.onInstalled.addListener(() => {
  console.log('亚马逊采集插件已安装');
  loadSavedSession();
});

// 启动时加载会话
loadSavedSession();

console.log('Background script加载完成');
