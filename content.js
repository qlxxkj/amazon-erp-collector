// 亚马逊商品采集插件 - 内容脚本
(function() {
  'use strict';
  
  // 检测市场
  function detectMarketplace() {
    const hostname = window.location.hostname;
    if (hostname.includes('.com')) return 'US';
    if (hostname.includes('.co.jp')) return 'JP';
    if (hostname.includes('.de')) return 'DE';
    if (hostname.includes('.co.uk')) return 'UK';
    return 'US';
  }
  
  // 配置
  const CONFIG = {
    delayMin: 800,
    delayMax: 2000,
    maxProductsPerPage: 100,
    marketplace: detectMarketplace(),
    userAgents: [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
    ]
  };
  
  // 状态管理
  let collectionState = {
    isCollecting: false,
    isPaused: false,
    queue: [],
    currentIndex: 0,
    successCount: 0,
    failureCount: 0,
    totalItems: 0
  };
  
  // DOM 元素
  let globalCollectBtn = null;
  let progressBar = null;
  let progressContainer = null;
  
  // 初始化
  function init() {
    console.log('亚马逊采集插件初始化...');
    
    // 等待页面加载完成
    setTimeout(() => {
      detectPageType();
      addGlobalCollectButton();
      addCollectButtonsToProducts();
      setupEventListeners();
      
      // 恢复之前的状态
      chrome.storage.local.get(['collectionState'], (result) => {
        if (result.collectionState) {
          collectionState = result.collectionState;
          if (collectionState.isCollecting) {
            showProgressBar();
            updateProgressBar();
          }
        }
      });
    }, 1000);
  }
  
  // 检测页面类型
  function detectPageType() {
    const url = window.location.href;
    const path = window.location.pathname;
    
    if (url.includes('/s?') || url.includes('/s/')) {
      console.log('检测到搜索列表页');
      return 'search';
    } else if (url.includes('/Best-Sellers')) {
      console.log('检测到Bestseller榜单页');
      return 'bestseller';
    } else if (url.includes('/gp/new-releases')) {
      console.log('检测到New Releases榜单页');
      return 'new-releases';
    } else if (url.includes('/dp/') || url.includes('/gp/product/')) {
      console.log('检测到商品详情页');
      return 'product';
    }
    
    return 'unknown';
  }
  
  // 添加全局采集按钮
  function addGlobalCollectButton() {
    const existingBtn = document.querySelector('#amazon-collector-global-btn');
    if (existingBtn) {
      console.log('全局采集按钮已存在');
      return;
    }
    
    console.log('正在添加全局采集按钮...');
    const btn = document.createElement('button');
    btn.id = 'amazon-collector-global-btn';
    btn.className = 'amazon-collector-btn amazon-collector-global';
    btn.innerHTML = '<span class="collector-icon">📥</span> 采集本页所有';
    btn.title = '采集本页所有商品';
    
    // 添加到页面右上角
    const container = document.createElement('div');
    container.id = 'amazon-collector-global-container';
    container.style.cssText = `
      position: fixed;
      top: 220px;
      right: 20px;
      z-index: 9999;
    `;
    container.appendChild(btn);
    document.body.appendChild(container);
    
    globalCollectBtn = btn;
    console.log('全局采集按钮已添加');
  }
  
  // 为每个商品添加采集按钮
  function addCollectButtonsToProducts() {
    const pageType = detectPageType();
    
    // 根据页面类型处理
    if (pageType === 'product') {
      // 商品详情页，添加单个采集按钮
      addProductDetailCollectButton();
    } else {
      // 列表页，添加多个采集按钮
      let productSelectors = [];
      
      switch(pageType) {
        case 'search':
          productSelectors = [
            'div[data-component-type="s-search-result"]',
            '.s-result-item',
            '[data-asin]'
          ];
          break;
        case 'bestseller':
        case 'new-releases':
          productSelectors = [
            '.zg-item-immersion',
            '.p13n-sc-uncoverable-faceout',
            '[data-p13n-asin-metadata]',
            '.zg-item',
            '.p13n-gridItem',
            '[data-asin]'
          ];
          break;
        default:
          productSelectors = ['[data-asin]'];
      }
      
      // 查找商品元素
      let foundProducts = false;
      for (const selector of productSelectors) {
        const products = document.querySelectorAll(selector);
        if (products.length > 0) {
          console.log(`找到 ${products.length} 个商品，使用选择器: ${selector}`);
          products.forEach((product, index) => {
            if (index < CONFIG.maxProductsPerPage) {
              addCollectButtonToProduct(product, pageType);
            }
          });
          foundProducts = true;
          break;
        }
      }
      
      if (!foundProducts) {
        console.log('未找到任何商品元素');
      }
    }
  }
  
  // 为单个商品添加采集按钮
  function addCollectButtonToProduct(product, pageType) {
    // 检查是否已添加按钮
    if (product.querySelector('.amazon-collector-btn')) return;
    
    // 获取ASIN
    const asin = getASINFromProduct(product, pageType);
    if (!asin) return;
    
    // 创建采集按钮
    const btn = document.createElement('button');
    btn.className = 'amazon-collector-btn amazon-collector-product';
    btn.dataset.asin = asin;
    btn.innerHTML = '<span class="collector-icon">+</span> 采集';
    btn.title = '采集此商品';
    
    // 根据页面类型添加到不同位置
    if (pageType === 'search') {
      // 搜索列表页：将按钮放置在商品图片的右上角
      const imageContainer = product.querySelector('.s-product-image-container') ||
                          product.querySelector('.a-section.aok-relative.s-image-square-aspect') ||
                          product.querySelector('img[src*="images-amazon.com"]').closest('div');
      
      if (imageContainer) {
        // 确保图片容器有相对定位
        imageContainer.style.position = 'relative';
        
        // 设置按钮为绝对定位，放置在右上角
        btn.style.position = 'absolute';
        btn.style.top = '5px';
        btn.style.right = '5px';
        btn.style.zIndex = '2147483647';
        btn.style.padding = '4px 8px';
        btn.style.fontSize = '11px';
        btn.style.cursor = 'pointer';
        btn.style.pointerEvents = 'auto';
        
        imageContainer.appendChild(btn);
      } else {
        // 如果找不到图片容器，添加到商品元素末尾
        const btnContainer = document.createElement('div');
        btnContainer.className = 'amazon-collector-btn-container';
        btnContainer.style.cssText = `
          margin: 8px 0;
          text-align: center;
        `;
        btnContainer.appendChild(btn);
        product.appendChild(btnContainer);
      }
    } else if (pageType === 'bestseller' || pageType === 'new-releases') {
      // Bestseller/New Releases页：尝试找到图片容器，将按钮添加到图片旁边
      const imageContainer = product.querySelector('.a-spacing-mini') || 
                            product.querySelector('img')?.closest('div');
      
      if (imageContainer) {
        // 确保图片容器有相对定位
        imageContainer.style.position = 'relative';
        
        // 设置按钮为绝对定位，放置在右上角
        btn.style.position = 'absolute';
        btn.style.top = '5px';
        btn.style.right = '5px';
        btn.style.zIndex = '2147483647';
        btn.style.padding = '4px 8px';
        btn.style.fontSize = '11px';
        btn.style.cursor = 'pointer';
        btn.style.pointerEvents = 'auto';
        
        imageContainer.appendChild(btn);
      } else {
        // 如果找不到图片容器，添加到商品元素末尾
        const btnContainer = document.createElement('div');
        btnContainer.className = 'amazon-collector-btn-container';
        btnContainer.style.cssText = `
          margin: 8px 0;
          text-align: center;
        `;
        btnContainer.appendChild(btn);
        product.appendChild(btnContainer);
      }
    }
  }
  
  // 从商品元素获取ASIN
  function getASINFromProduct(product, pageType) {
    if (pageType === 'search') {
      return product.getAttribute('data-asin') || 
             product.querySelector('[data-asin]')?.getAttribute('data-asin');
    } else if (pageType === 'bestseller' || pageType === 'new-releases') {
      // 尝试多种方式获取ASIN
      let asin = product.getAttribute('data-p13n-asin-metadata')?.split('"asin":"')[1]?.split('"')[0];
      if (!asin) {
        asin = product.getAttribute('data-asin');
      }
      if (!asin) {
        asin = product.querySelector('[data-asin]')?.getAttribute('data-asin');
      }
      if (!asin) {
        // 尝试从链接中提取ASIN
        const link = product.querySelector('a[href*="/dp/"]') || product.querySelector('a[href*="/gp/product/"]');
        if (link) {
          const asinMatch = link.href.match(/\/dp\/([A-Z0-9]{10})/) || link.href.match(/\/gp\/product\/([A-Z0-9]{10})/);
          if (asinMatch) {
            asin = asinMatch[1];
          }
        }
      }
      return asin;
    } else if (pageType === 'product') {
      // 商品详情页，从URL或页面元素获取ASIN
      const url = window.location.href;
      const asinMatch = url.match(/\/dp\/([A-Z0-9]{10})/) || url.match(/\/gp\/product\/([A-Z0-9]{10})/);
      if (asinMatch) return asinMatch[1];
      
      // 从页面元素获取
      return document.querySelector('[data-asin]')?.getAttribute('data-asin') ||
             document.getElementById('ASIN')?.value;
    }
    return null;
  }
  
  // 商品详情页添加采集按钮
  function addProductDetailCollectButton() {
    // 检查是否已添加按钮
    if (document.querySelector('.amazon-collector-product-detail')) return;
    
    // 获取ASIN
    const asin = getASINFromProduct(null, 'product');
    if (!asin) return;
    
    // 创建采集按钮
    const btn = document.createElement('button');
    btn.className = 'amazon-collector-btn amazon-collector-product amazon-collector-product-detail';
    btn.dataset.asin = asin;
    btn.innerHTML = '<span class="collector-icon">+</span> 采集';
    btn.title = '采集当前商品';
    
    // 尝试找到商品图片容器
    const imageSelectors = [
      '#landingImage', // 主图
      '#imgBlkFront', // 前图
      '#altImages', // 其他图片
      '.a-dynamic-image-container', // 动态图片容器
      '#imageBlock', // 图片块
      '#leftCol', // 左侧栏（通常包含图片）
      '.imgTagWrapper', // 图片标签包装器
      '#imageBlockThumbs' // 图片缩略图
    ];
    
    let inserted = false;
    for (const selector of imageSelectors) {
      const imageElement = document.querySelector(selector);
      if (imageElement) {
        // 找到图片的父容器
        let container = imageElement.closest('.a-section') || 
                       imageElement.closest('div') ||
                       imageElement.parentElement;
        
        if (container) {
          // 确保容器有相对定位
          container.style.position = 'relative';
          
          // 设置按钮为绝对定位，放置在右上角
          btn.style.position = 'absolute';
          btn.style.top = '5px';
          btn.style.right = '5px';
          btn.style.zIndex = '2147483647';
          btn.style.padding = '8px 12px';
          btn.style.fontSize = '12px';
          btn.style.cursor = 'pointer';
          btn.style.pointerEvents = 'auto';
          btn.style.backgroundColor = '#ff9900';
          btn.style.color = 'white';
          btn.style.border = 'none';
          btn.style.borderRadius = '4px';
          btn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
          
          container.appendChild(btn);
          inserted = true;
          console.log('详情页采集按钮已添加到图片容器');
          break;
        }
      }
    }
    
    // 如果没有找到图片容器，尝试其他位置
    if (!inserted) {
      const targetPositions = [
        '#centerCol', // 中央内容区
        '#rightCol', // 右侧栏
        '#buyBox', // 购买区域
        '#productTitle' // 标题附近
      ];
      
      for (const selector of targetPositions) {
        const container = document.querySelector(selector);
        if (container) {
          // 添加到容器开头
          container.insertBefore(btn, container.firstChild);
          inserted = true;
          console.log('详情页采集按钮已添加到:', selector);
          break;
        }
      }
    }
    
    // 如果还是没有找到位置，添加到页面顶部
    if (!inserted) {
      const topContainer = document.querySelector('#content');
      if (topContainer) {
        topContainer.insertBefore(btn, topContainer.firstChild);
        console.log('详情页采集按钮已添加到页面顶部');
      }
    }
  }
  
  // 设置事件监听器
  function setupEventListeners() {
    console.log('正在设置事件监听器...');
    
    // 监听来自background script的消息
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log('Content收到消息:', request.action);
      
      if (request.action === 'collectProductData') {
        console.log('收到采集商品数据请求:', request.asin);
        handleCollectProductDataMessage(request, sendResponse);
        return true;
      }
    });
    
    // 使用事件委托处理所有采集按钮点击
    document.addEventListener('click', (e) => {
      const globalBtn = e.target.closest('#amazon-collector-global-btn');
      if (globalBtn) {
        console.log('点击了全局采集按钮');
        handleGlobalCollect();
        return;
      }
      
      const productBtn = e.target.closest('.amazon-collector-product');
      if (productBtn) {
        const asin = productBtn.dataset.asin;
        console.log('点击了商品采集按钮，ASIN:', asin);
        handleProductCollect(asin, productBtn);
        return;
      }
    });
    console.log('事件监听器设置完成');
  }
  
  // 处理来自background的采集商品数据消息
  async function handleCollectProductDataMessage(request, sendResponse) {
    try {
      const asin = request.asin;
      console.log('开始采集商品数据:', asin);
      
      // 采集商品数据
      const productData = await collectProductData(asin);
      
      console.log('商品数据采集完成:', productData.cleaned.title);
      sendResponse({ success: true, productData: productData });
    } catch (error) {
      console.error('采集商品数据失败:', error);
      sendResponse({ success: false, error: error.message });
    }
  }
  
  // 处理全局采集
  async function handleGlobalCollect() {
    console.log('开始采集本页所有商品');
    
    // 检查登录状态
    const isLoggedIn = await checkLoginStatus();
    console.log('登录状态:', isLoggedIn);
    
    if (!isLoggedIn) {
      console.log('未登录，显示登录模态框');
      showAuthModal(handleGlobalCollect);
      return;
    }
    
    // 获取所有商品ASIN
    const asins = getAllProductASINs();
    if (asins.length === 0) {
      alert('未找到可采集的商品');
      return;
    }
    
    // 初始化采集队列
    collectionState = {
      isCollecting: true,
      isPaused: false,
      queue: asins,
      currentIndex: 0,
      successCount: 0,
      failureCount: 0,
      totalItems: asins.length
    };
    
    // 显示进度条
    showProgressBar();
    
    // 开始采集
    startCollection();
  }
  
  // 处理单个商品采集
  async function handleProductCollect(asin, button) {
    console.log('采集单个商品:', asin);
    
    // 检查登录状态
    const isLoggedIn = await checkLoginStatus();
    console.log('登录状态:', isLoggedIn);
    
    if (!isLoggedIn) {
      console.log('未登录，显示登录模态框');
      showAuthModal(() => handleProductCollect(asin, button));
      return;
    }
    
    // 更新按钮状态
    if (button) {
      button.innerHTML = '<span class="collector-icon">⏳</span> 采集中...';
      button.disabled = true;
    }
    
    // 采集单个商品
    try {
      const pageType = detectPageType();
      let productData;
      
      if (pageType === 'product') {
        // 商品详情页，采集完整数据
        productData = await collectProductData(asin);
        
        const saveResult = await saveToSupabase(productData);
        
        if (saveResult.success) {
          if (button) {
            button.innerHTML = '<span class="collector-icon">✓</span> 已采集';
            button.style.backgroundColor = '#4CAF50';
          }
          alert(`商品 ${asin} 采集成功！`);
        } else {
          if (button) {
            button.innerHTML = '<span class="collector-icon">+</span> 采集';
            button.disabled = false;
          }
          
          const errorMsg = saveResult.error || '未知错误';
          
          // 检测JWT过期错误
          if (errorMsg.includes('登录已过期') || 
              errorMsg.includes('JWT expired') ||
              errorMsg.includes('请重新登录')) {
            console.log('检测到登录过期，显示登录模态框');
            showAuthModal(() => {
              // 登录成功后重试采集
              handleProductCollect(asin, button);
            });
            return;
          }
          
          alert(`商品 ${asin} 采集失败: ${errorMsg}`);
        }
      } else {
        // 列表页，跳转到详情页采集完整数据
        console.log('列表页采集，将跳转到详情页获取完整信息');
        
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            action: 'collectFromDetailPage',
            asin: asin,
            returnUrl: window.location.href
          }, resolve);
        });
        
        if (response && response.success) {
          if (button) {
            button.innerHTML = '<span class="collector-icon">✓</span> 已采集';
            button.style.backgroundColor = '#4CAF50';
          }
          alert(`商品 ${asin} 采集成功！`);
        } else {
          if (button) {
            button.innerHTML = '<span class="collector-icon">+</span> 采集';
            button.disabled = false;
          }
          
          const errorMsg = response?.error || '未知错误';
          
          // 检测JWT过期错误
          if (errorMsg.includes('登录已过期') || 
              errorMsg.includes('JWT expired') ||
              errorMsg.includes('请重新登录')) {
            console.log('检测到登录过期，显示登录模态框');
            showAuthModal(() => {
              // 登录成功后重试采集
              handleSingleProductCollect(button, asin);
            });
            return;
          }
          
          alert(`商品 ${asin} 采集失败: ${errorMsg}`);
        }
      }
    } catch (error) {
      console.error('采集失败:', error);
      if (button) {
        button.innerHTML = '<span class="collector-icon">+</span> 采集';
        button.disabled = false;
      }
      
      const errorMsg = error.message || '未知错误';
      
      // 检测JWT过期错误
      if (errorMsg.includes('登录已过期') || 
          errorMsg.includes('JWT expired') ||
          errorMsg.includes('请重新登录') ||
          errorMsg.includes('401')) {
        console.log('检测到登录过期，显示登录模态框');
        showAuthModal(() => {
          // 登录成功后重试采集
          handleSingleProductCollect(button, asin);
        });
        return;
      }
      
      alert('采集过程中发生错误: ' + errorMsg);
    }
  }
  
  // 获取本页所有商品ASIN
  function getAllProductASINs() {
    const asins = new Set();
    const pageType = detectPageType();
    
    // 根据页面类型选择不同的选择器
    let productElements = [];
    if (pageType === 'search') {
      productElements = document.querySelectorAll('div[data-component-type="s-search-result"], [data-asin]');
    } else if (pageType === 'bestseller' || pageType === 'new-releases') {
      productElements = document.querySelectorAll('.zg-item-immersion, .p13n-sc-uncoverable-faceout, .zg-item, .p13n-gridItem, [data-p13n-asin-metadata], [data-asin]');
    }
    
    // 提取ASIN
    productElements.forEach(product => {
      const asin = getASINFromProduct(product, pageType);
      if (asin && asin.length === 10) { // 验证ASIN格式
        asins.add(asin);
      }
    });
    
    return Array.from(asins).slice(0, CONFIG.maxProductsPerPage);
  }
  
  // 检查登录状态
  function checkLoginStatus() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'checkLoginStatus' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('检查登录状态失败:', chrome.runtime.lastError);
          resolve({ isLoggedIn: false, isExpired: false });
        } else if (response && response.success) {
          resolve({ 
            isLoggedIn: response.isLoggedIn, 
            isExpired: response.isExpired,
            message: response.message 
          });
        } else {
          resolve({ isLoggedIn: false, isExpired: false });
        }
      });
    });
  }
  
  // 显示认证模态框
  function showAuthModal(onSuccess) {
    console.log('正在显示登录模态框...');
    // 创建模态框
    const modal = document.createElement('div');
    modal.id = 'amazon-collector-auth-modal';
    modal.innerHTML = `
      <div class="auth-modal-content">
        <div class="auth-modal-header">
          <h3>登录 / 注册</h3>
          <button class="auth-modal-close">&times;</button>
        </div>
        <div class="auth-modal-body">
          <div class="auth-tabs">
            <button class="auth-tab active" data-tab="login">登录</button>
            <button class="auth-tab" data-tab="register">注册</button>
          </div>
          <div class="auth-form" id="login-form">
            <div class="form-group">
              <label>邮箱</label>
              <input type="email" id="login-email" placeholder="请输入邮箱">
            </div>
            <div class="form-group">
              <label>密码</label>
              <input type="password" id="login-password" placeholder="请输入密码">
            </div>
            <button id="login-submit" class="auth-submit-btn">登录</button>
            <div class="auth-message" id="login-message"></div>
          </div>
          <div class="auth-form" id="register-form" style="display: none;">
            <div class="form-group">
              <label>邮箱</label>
              <input type="email" id="register-email" placeholder="请输入邮箱">
            </div>
            <div class="form-group">
              <label>密码</label>
              <input type="password" id="register-password" placeholder="请输入密码（至少6位）">
            </div>
            <div class="form-group">
              <label>确认密码</label>
              <input type="password" id="register-confirm" placeholder="请再次输入密码">
            </div>
            <button id="register-submit" class="auth-submit-btn">注册</button>
            <div class="auth-message" id="register-message"></div>
          </div>
        </div>
      </div>
    `;
    
    // 添加到页面
    document.body.appendChild(modal);
    console.log('登录模态框已添加到页面');
    
    // 设置样式
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    
    const content = modal.querySelector('.auth-modal-content');
    content.style.cssText = `
      background: white;
      padding: 20px;
      border-radius: 8px;
      width: 90%;
      max-width: 400px;
      max-height: 80vh;
      overflow-y: auto;
    `;
    
    // 事件监听
    modal.querySelector('.auth-modal-close').addEventListener('click', () => {
      modal.remove();
    });
    
    // 标签切换
    modal.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        modal.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        if (tab.dataset.tab === 'login') {
          modal.querySelector('#login-form').style.display = 'block';
          modal.querySelector('#register-form').style.display = 'none';
        } else {
          modal.querySelector('#login-form').style.display = 'none';
          modal.querySelector('#register-form').style.display = 'block';
        }
      });
    });
    
    // 登录提交
    modal.querySelector('#login-submit').addEventListener('click', async () => {
      console.log('点击登录按钮');
      const email = modal.querySelector('#login-email').value;
      const password = modal.querySelector('#login-password').value;
      const message = modal.querySelector('#login-message');
      
      console.log('登录表单数据:', { email, password: password ? '***' : '' });
      
      if (!email || !password) {
        console.log('邮箱或密码为空');
        message.textContent = '请输入邮箱和密码';
        message.style.color = 'red';
        return;
      }
      
      try {
        console.log('开始调用登录函数...');
        const success = await loginUser(email, password);
        console.log('登录函数返回结果:', success);
        
        if (success) {
          message.textContent = '登录成功！';
          message.style.color = 'green';
          console.log('登录成功，准备关闭模态框');
          setTimeout(() => {
            modal.remove();
            if (onSuccess) onSuccess();
          }, 1000);
        } else {
          message.textContent = '登录失败，请检查邮箱和密码';
          message.style.color = 'red';
          console.log('登录失败');
        }
      } catch (error) {
        console.error('登录异常:', error);
        message.textContent = '登录出错: ' + error.message;
        message.style.color = 'red';
      }
    });
    
    // 注册提交
    modal.querySelector('#register-submit').addEventListener('click', async () => {
      console.log('点击注册按钮');
      const email = modal.querySelector('#register-email').value;
      const password = modal.querySelector('#register-password').value;
      const confirm = modal.querySelector('#register-confirm').value;
      const message = modal.querySelector('#register-message');
      
      console.log('注册表单数据:', { email, password: password ? '***' : '', confirm: confirm ? '***' : '' });
      
      if (!email || !password) {
        console.log('邮箱或密码为空');
        message.textContent = '请输入邮箱和密码';
        message.style.color = 'red';
        return;
      }
      
      if (password !== confirm) {
        console.log('两次输入的密码不一致');
        message.textContent = '两次输入的密码不一致';
        message.style.color = 'red';
        return;
      }
      
      if (password.length < 6) {
        console.log('密码长度不足6位');
        message.textContent = '密码长度至少6位';
        message.style.color = 'red';
        return;
      }
      
      try {
        console.log('开始调用注册函数...');
        const success = await registerUser(email, password);
        console.log('注册函数返回结果:', success);
        
        if (success) {
          message.textContent = '注册成功！已自动登录';
          message.style.color = 'green';
          console.log('注册成功，准备关闭模态框');
          setTimeout(() => {
            modal.remove();
            if (onSuccess) onSuccess();
          }, 1000);
        } else {
          message.textContent = '注册失败，邮箱可能已被使用';
          message.style.color = 'red';
          console.log('注册失败');
        }
      } catch (error) {
        console.error('注册异常:', error);
        message.textContent = '注册出错: ' + error.message;
        message.style.color = 'red';
      }
    });
  }
  
  // 用户登录
  async function loginUser(email, password) {
    console.log('loginUser函数被调用，参数:', { email, password: password ? '***' : '' });
    
    // 先测试连接
    console.log('测试与background.js的连接...');
    try {
      const testResponse = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('连接超时：background.js未响应'));
        }, 5000);
        
        chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      console.log('连接测试结果:', testResponse);
    } catch (testError) {
      console.error('连接测试失败:', testError);
      alert('插件后台服务未响应，请重新加载扩展');
      return false;
    }
    
    // 调用Supabase认证
    return new Promise((resolve) => {
      console.log('发送登录消息到background.js');
      const message = {
        action: 'login',
        email: email,
        password: password
      };
      console.log('消息内容:', JSON.stringify({ ...message, password: '***' }));
      
      chrome.runtime.sendMessage(message, (response) => {
        console.log('收到background.js的响应:', response);
        console.log('chrome.runtime.lastError:', chrome.runtime.lastError);
        
        if (chrome.runtime.lastError) {
          console.error('消息发送失败:', chrome.runtime.lastError);
          resolve(false);
        } else if (!response) {
          console.error('未收到响应');
          resolve(false);
        } else if (response.success) {
          console.log('登录成功，用户:', response.user);
          resolve(true);
        } else {
          console.error('登录失败:', response.error);
          resolve(false);
        }
      });
    });
  }
  
  // 用户注册
  async function registerUser(email, password) {
    console.log('registerUser函数被调用，参数:', { email, password: password ? '***' : '' });
    return new Promise((resolve) => {
      console.log('发送注册消息到background.js');
      chrome.runtime.sendMessage({
        action: 'register',
        email: email,
        password: password
      }, (response) => {
        console.log('收到background.js的响应:', response);
        if (chrome.runtime.lastError) {
          console.error('消息发送失败:', chrome.runtime.lastError);
          resolve(false);
        } else {
          resolve(response && response.success);
        }
      });
    });
  }
  
  // 开始采集队列
  async function startCollection() {
    if (!collectionState.isCollecting || collectionState.isPaused) {
      return;
    }
    
    if (collectionState.currentIndex >= collectionState.queue.length) {
      // 采集完成
      collectionState.isCollecting = false;
      saveCollectionState();
      
      // 显示完成消息
      alert(`采集完成！成功: ${collectionState.successCount}, 失败: ${collectionState.failureCount}`);
      
      // 隐藏进度条
      if (progressContainer) {
        progressContainer.remove();
      }
      return;
    }
    
    const asin = collectionState.queue[collectionState.currentIndex];
    
    try {
      // 随机延迟，避免被检测
      const delay = CONFIG.delayMin + Math.random() * (CONFIG.delayMax - CONFIG.delayMin);
      await sleep(delay);
      
      // 采集数据
      const productData = await collectProductData(asin);
      
      // 保存到Supabase
      const saveResult = await saveToSupabase(productData);
      
      if (saveResult.success) {
        collectionState.successCount++;
      } else {
        collectionState.failureCount++;
        console.error(`保存失败 ${asin}:`, saveResult.error);
      }
      
    } catch (error) {
      console.error(`采集失败 ${asin}:`, error);
      collectionState.failureCount++;
      
      const errorMsg = error.message || '未知错误';
      
      // 检测JWT过期错误
      if (errorMsg.includes('登录已过期') || 
          errorMsg.includes('JWT expired') ||
          errorMsg.includes('请重新登录') ||
          errorMsg.includes('401')) {
        console.log('检测到登录过期，停止采集并显示登录模态框');
        collectionState.isCollecting = false;
        collectionState.isPaused = true;
        saveCollectionState();
        
        showAuthModal(() => {
          // 登录成功后继续采集
          collectionState.isPaused = false;
          startCollection();
        });
        return;
      }
      
      // 检查是否是saveResult.error中的JWT过期
      if (error.error && error.error.includes('登录已过期')) {
        console.log('检测到登录过期，停止采集并显示登录模态框');
        collectionState.isCollecting = false;
        collectionState.isPaused = true;
        saveCollectionState();
        
        showAuthModal(() => {
          // 登录成功后继续采集
          collectionState.isPaused = false;
          startCollection();
        });
        return;
      }
    }
    
    // 更新进度
    collectionState.currentIndex++;
    saveCollectionState();
    updateProgressBar();
    
    // 继续下一个
    if (!collectionState.isPaused) {
      setTimeout(startCollection, 100); // 小延迟后继续
    }
  }
  
  // 从列表页采集商品数据
  async function collectProductDataFromList(asin, button) {
    console.log(`正在从列表页采集商品 ${asin} 数据...`);
    
    // 找到包含该ASIN的商品元素
    const pageType = detectPageType();
    let productElement = null;
    
    if (pageType === 'search') {
      productElement = document.querySelector(`div[data-asin="${asin}"]`);
    } else if (pageType === 'bestseller' || pageType === 'new-releases') {
      // 尝试多种方式找到商品元素
      productElement = document.querySelector(`[data-p13n-asin-metadata*="${asin}"]`) ||
                      document.querySelector(`[data-asin="${asin}"]`);
      
      if (!productElement) {
        // 如果找不到，遍历所有商品元素检查链接中的ASIN
        const allProducts = document.querySelectorAll('.zg-item-immersion, .p13n-sc-uncoverable-faceout, .zg-item, .p13n-gridItem');
        for (const product of allProducts) {
          const link = product.querySelector('a[href*="/dp/"]');
          if (link && link.href.includes(asin)) {
            productElement = product;
            break;
          }
        }
      }
    }
    
    if (!productElement) {
      console.error(`未找到商品 ${asin} 的元素`);
      throw new Error(`未找到商品 ${asin} 的元素`);
    }
    
    // 从商品元素中提取信息
    let title = '';
    let price = '0.00';
    let rating = 0;
    let reviews = 0;
    let mainImage = '';
    
    // 提取标题
    const titleElement = productElement.querySelector('h2 a span, h2 span, .a-size-base-plus, .a-size-medium, .p13n-sc-truncated, .p13n-sc-truncated-desktop-type');
    if (titleElement) {
      title = titleElement.textContent.trim();
    }
    
    // 提取价格
    const priceElement = productElement.querySelector('.a-price-whole, .a-price .a-offscreen, .p13n-sc-price');
    if (priceElement) {
      price = priceElement.textContent.replace(/[^0-9.]/g, '');
    }
    
    // 提取评分
    const ratingElement = productElement.querySelector('.a-icon-alt, [aria-label*="stars"]');
    if (ratingElement) {
      const ratingText = ratingElement.textContent || ratingElement.getAttribute('aria-label');
      const ratingMatch = ratingText.match(/([0-9.]+)/);
      if (ratingMatch) {
        rating = parseFloat(ratingMatch[1]);
      }
    }
    
    // 提取评论数
    const reviewsElement = productElement.querySelector('.a-size-base, [aria-label*="ratings"]');
    if (reviewsElement) {
      const reviewsText = reviewsElement.textContent;
      const reviewsMatch = reviewsText.match(/([0-9,]+)/);
      if (reviewsMatch) {
        reviews = parseInt(reviewsMatch[1].replace(/,/g, ''));
      }
    }
    
    // 提取主图
    const imageElement = productElement.querySelector('img');
    if (imageElement) {
      mainImage = imageElement.getAttribute('src') || imageElement.getAttribute('data-src');
    }
    
    const productUrl = `https://www.amazon.com/dp/${asin}`;
    
    const productData = {
      asin: asin,
      url: productUrl,
      raw: productElement.outerHTML,
      cleaned: {
        asin: asin,
        parent_asin: asin,
        title: title || `产品 ${asin}`,
        brand: '',
        price: price,
        strike_price: null,
        final_price: price,
        coupon_amount: 0,
        ratings: rating,
        reviews: reviews,
        bought_in_past_month: 0,
        BSR: null,
        category: '',
        product_dimensions: null,
        item_length: null,
        item_width: null,
        item_height: null,
        item_size_unit: null,
        item_weight: null,
        item_weight_value: null,
        item_weight_unit: null,
        shipping: '',
        main_image: mainImage,
        other_images: [],
        variants: [],
        variant_attributes: [],
        bullet_points: [],
        description: '',
        Date_First_Available: null,
        OEM_Part_Number: null,
        marketplace: CONFIG.marketplace,
        updated_at: new Date().toISOString()
      },
      optimized: {},
      translations: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      user_id: null,
      status: 'collected',
      marketplace: CONFIG.marketplace
    };
    
    console.log(`从列表页采集商品 ${asin} 完成:`, productData.cleaned.title);
    return productData;
  }

  // 采集商品数据
  async function collectProductData(asin) {
    console.log(`正在采集商品 ${asin} 数据...`);
    
    const productUrl = `https://www.amazon.com/dp/${asin}`;
    
    const dimensions = extractProductDimensions();
    const otherImages = extractOtherImages();
    const dateFirstAvailable = extractDateFirstAvailable();
    const oemPartNumber = extractOEMPartNumber();
    const boughtInPastMonth = extractBoughtInPastMonth();
    const variants = extractVariants();
    const variantAttributes = extractVariantAttributes();
    const strikePrice = extractStrikePrice();
    
    const brandElement = document.querySelector('#bylineInfo');
    let brandText = brandElement?.textContent?.trim() || 'Unknown';
    if (brandText.includes('Brand: ')) {
      brandText = brandText.replace('Brand: ', '').trim();
    }
    if (brandText.includes('Visit the ')) {
      brandText = brandText.replace('Visit the ', '').replace(' Store', '').trim();
    }
    
    const productData = {
      asin: asin,
      url: productUrl,
      raw: document.documentElement.outerHTML,
      cleaned: {
        asin: asin,
        parent_asin: asin,
        title: document.querySelector('#productTitle')?.textContent?.trim() || `Product ${asin}`,
        brand: brandText,
        price: extractPrice(),
        strike_price: strikePrice,
        final_price: extractPrice(),
        coupon_amount: 0,
        ratings: parseFloat(document.querySelector('#acrPopover')?.getAttribute('title') || '0'),
        reviews: parseInt(document.querySelector('#acrCustomerReviewText')?.textContent?.replace(/[^0-9]/g, '') || '0'),
        bought_in_past_month: boughtInPastMonth,
        BSR: extractBSR(),
        category: extractCategory(),
        product_dimensions: dimensions.product_dimensions,
        item_length: dimensions.item_length,
        item_width: dimensions.item_width,
        item_height: dimensions.item_height,
        item_size_unit: dimensions.item_size_unit,
        item_weight: dimensions.item_weight,
        item_weight_value: dimensions.item_weight_value,
        item_weight_unit: dimensions.item_weight_unit,
        shipping: 'Free Shipping',
        main_image: document.querySelector('#landingImage')?.getAttribute('src') || '',
        other_images: otherImages,
        variants: variants,
        variant_attributes: variantAttributes,
        bullet_points: extractBulletPoints(),
        description: document.querySelector('#productDescription')?.textContent?.trim() || '',
        Date_First_Available: dateFirstAvailable,
        OEM_Part_Number: oemPartNumber,
        marketplace: CONFIG.marketplace,
        updated_at: new Date().toISOString()
      },
      optimized: {},
      translations: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      user_id: null,
      status: 'collected',
      marketplace: CONFIG.marketplace
    };
    
    console.log('采集到的商品数据:', productData.cleaned);
    return productData;
  }
  
  // 提取价格
  function extractPrice() {
    const priceOffscreen = document.querySelector('.a-price .a-offscreen');
    
    if (priceOffscreen) {
      const priceText = priceOffscreen.textContent.trim();
      const match = priceText.match(/[\d,]+\.?\d*/);
      if (match) {
        return match[0].replace(/,/g, '');
      }
    }
    
    const priceWhole = document.querySelector('.a-price-whole');
    const priceFraction = document.querySelector('.a-price-fraction');
    
    if (priceWhole && priceFraction) {
      const wholePart = priceWhole.textContent.trim();
      const fractionPart = priceFraction.textContent.trim();
      
      if (wholePart.includes('.')) {
        return wholePart.replace(/,/g, '');
      }
      
      return `${wholePart.replace(/,/g, '')}.${fractionPart}`;
    }
    
    return '0.00';
  }
  
  // 提取划线价格
  function extractStrikePrice() {
    const strikePriceElement = document.querySelector('.a-text-strike .a-offscreen') ||
                             document.querySelector('.basisPrice .a-offscreen') ||
                             document.querySelector('.priceBlockStrikePriceString .a-offscreen');
    
    if (strikePriceElement) {
      const priceText = strikePriceElement.textContent.trim();
      const match = priceText.match(/[\d,]+\.?\d*/);
      if (match) {
        return match[0].replace(/,/g, '');
      }
    }
    
    return null;
  }
  
  // 提取其他图片
  function extractOtherImages() {
    const otherImages = [];
    
    // 从altImages容器提取
    const altImages = document.querySelectorAll('#altImages img, .a-spacing-small img, .itemNo0 img');
    altImages.forEach(img => {
      const src = img.getAttribute('src') || img.getAttribute('data-src');
      if (src && !src.includes('spinner') && !otherImages.includes(src)) {
        otherImages.push(src);
      }
    });
    
    // 从主图容器提取
    const mainImages = document.querySelectorAll('#landingImage, #imgBlkFront, #imgBlkBack');
    mainImages.forEach(img => {
      const src = img.getAttribute('src');
      if (src && !otherImages.includes(src)) {
        otherImages.push(src);
      }
    });
    
    return otherImages;
  }
  
  // 提取产品尺寸和重量
  function extractProductDimensions() {
    const dimensions = {
      product_dimensions: null,
      item_length: null,
      item_width: null,
      item_height: null,
      item_size_unit: null,
      item_weight: null,
      item_weight_value: null,
      item_weight_unit: null
    };
    
    const selectors = [
      '#productDetails_techSpec_section_1 tr',
      '#productDetails_detailBullets_sections1 li',
      '#productDetails_db_sections tr',
      '#detailBullets_feature_div li',
      '#productDetails_techSpec_section_2 tr',
      '.techSpecSection tr',
      '#productDetails_feature_div li'
    ];
    
    for (const selector of selectors) {
      const detailRows = document.querySelectorAll(selector);
      detailRows.forEach(row => {
        const text = row.textContent;
        
        if (!text) return;
        
        const th = row.querySelector('th');
        const td = row.querySelector('td');
        const label = th ? th.textContent : text.split(':')[0];
        const value = td ? td.textContent : text.split(':').slice(1).join(':');
        
        if (label.includes('Product Dimensions') || label.includes('产品尺寸') || label.includes('Package Dimensions')) {
          const match = value.match(/([\d.]+)\s*[xX]\s*([\d.]+)\s*[xX]\s*([\d.]+)\s*(inches|cm|mm|inch|centimeters)?/i);
          if (match) {
            dimensions.item_length = match[1];
            dimensions.item_width = match[2];
            dimensions.item_height = match[3];
            dimensions.item_size_unit = match[4] || 'inches';
            dimensions.product_dimensions = `${match[1]} x ${match[2]} x ${match[3]} ${dimensions.item_size_unit}`;
          }
        }
        
        if (label.includes('Item Weight') || label.includes('产品重量') || label.includes('Shipping Weight') || label.includes('Package Weight')) {
          const match = value.match(/([\d.]+)\s*(pounds|lbs|kg|g|oz|ounces|kilograms|grams)/i);
          if (match) {
            dimensions.item_weight_value = match[1];
            dimensions.item_weight_unit = match[2];
            dimensions.item_weight = `${match[1]} ${match[2]}`;
          }
        }
      });
    }
    
    return dimensions;
  }
  
  // 提取上架时间
  function extractDateFirstAvailable() {
    const selectors = [
      '#productDetails_techSpec_section_1 tr',
      '#productDetails_detailBullets_sections1 li',
      '#productDetails_db_sections tr',
      '#detailBullets_feature_div li',
      '#productDetails_techSpec_section_2 tr',
      '.techSpecSection tr',
      '#productDetails_feature_div li',
      '#detail-bullets .detail-bullet-list li',
      '#productDetails_detailBullets_sections1 tr',
      '#productDetails_techSpec_section_1 tbody tr',
      '#detailBullets_feature_div ul li',
      '#productDetails_feature_div ul li'
    ];
    
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        const text = element.textContent || element.innerText;
        
        if (!text) continue;
        
        const th = element.querySelector('th');
        const td = element.querySelector('td');
        
        let label, value;
        
        if (th && td) {
          label = th.textContent || th.innerText;
          value = td.textContent || td.innerText;
        } else {
          const parts = text.split(':');
          if (parts.length >= 2) {
            label = parts[0].trim();
            value = parts.slice(1).join(':').trim();
          } else {
            label = text;
            value = '';
          }
        }
        
        if (label.includes('Date First Available') || label.includes('首次上架') || label.includes('Available Date') || label.includes('First Available')) {
          if (!value) continue;
          
          const match = value.match(/(\d{4}\/\d{1,2}\/\d{1,2})/);
          if (match) {
            return match[1];
          }
          
          const match2 = value.match(/(\w+\s+\d{1,2},\s+\d{4})/);
          if (match2) {
            try {
              const date = new Date(match2[1]);
              if (!isNaN(date.getTime())) {
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                return `${year}/${month}/${day}`;
              }
            } catch (e) {
              console.warn('日期解析失败:', match2[1], e);
            }
          }
          
          const match3 = value.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
          if (match3) {
            return match3[1];
          }
        }
      }
    }
    
    return null;
  }
  
  // 提取OEM零件号
  function extractOEMPartNumber() {
    const oemElement = document.querySelector('#productDetails_techSpec_section_1 tr') ||
                      document.querySelector('#productDetails_detailBullets_sections1');
    
    if (oemElement) {
      const text = oemElement.textContent;
      if (text.includes('OEM Part Number') || text.includes('OEM零件号') || text.includes('Manufacturer Part Number')) {
        const match = text.match(/:\s*([A-Z0-9\-]+)/);
        if (match) {
          return match[1];
        }
      }
    }
    
    return null;
  }
  
  // 提取过去一个月购买数量
  function extractBoughtInPastMonth() {
    const selectors = [
      '#social-proofing-faceout',
      '#social-proofing',
      '#productDetails_feature_div',
      '#centerCol',
      '#productTitle',
      '#productDetails_techSpec_section_1',
      '#productDetails_detailBullets_sections1',
      '#productDetails_db_sections',
      '.a-section.a-spacing-medium',
      '#feature-bullets',
      '#productDescription'
    ];
    
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        const text = element.textContent || element.innerText;
        
        if (!text) continue;
        
        // 匹配多种格式的购买量文本
        const patterns = [
          /(\d+[,\d]*\.?\d*[Kk]?)\s*bought\s+in\s+past\s+month/i,
          /(\d+[,\d]*\.?\d*[Kk]?)\s*bought\s+in\s+the\s+past\s+month/i,
          /(\d+[,\d]*\.?\d*[Kk]?)\s*bought\s+in\s+last\s+month/i,
          /(\d+[,\d]*\.?\d*[Kk]?)\s*bought\s+in\s+the\s+last\s+month/i,
          /(\d+[,\d]*\.?\d*[Kk]?)\s*purchased\s+in\s+past\s+month/i,
          /(\d+[,\d]*\.?\d*[Kk]?)\s*purchased\s+in\s+the\s+past\s+month/i,
          /(\d+[,\d]*\.?\d*[Kk]?)\s*sold\s+in\s+past\s+month/i,
          /(\d+[,\d]*\.?\d*[Kk]?)\s*sold\s+in\s+the\s+past\s+month/i,
          /(\d+[,\d]*\.?\d*[Kk]?)\s*bought\s+in\s+past\s+30\s+days/i,
          /(\d+[,\d]*\.?\d*[Kk]?)\s*bought\s+in\s+the\s+past\s+30\s+days/i,
          /(\d+[,\d]*\.?\d*[Kk]?)\s*purchased\s+in\s+past\s+30\s+days/i,
          /(\d+[,\d]*\.?\d*[Kk]?)\s*purchased\s+in\s+the\s+past\s+30\s+days/i,
          /(\d+[,\d]*\.?\d*[Kk]?)\s+sold\s+in\s+past\s+30\s+days/i,
          /(\d+[,\d]*\.?\d*[Kk]?)\s+sold\s+in\s+the\s+past\s+30\s+days/i
        ];
        
        for (const pattern of patterns) {
          const match = text.match(pattern);
          if (match) {
            let num = match[1];
            
            // 处理K/k后缀
            if (num.includes('K') || num.includes('k')) {
              const numStr = num.replace(/[Kk]/, '');
              const numValue = parseFloat(numStr);
              return Math.round(numValue * 1000);
            }
            
            // 处理逗号分隔的数字
            num = num.replace(/,/g, '');
            
            // 转换为整数
            const numValue = parseInt(num);
            if (!isNaN(numValue) && numValue > 0) {
              return numValue;
            }
          }
        }
      }
    }
    
    // 尝试在整个页面中搜索
    const bodyText = document.body.textContent || document.body.innerText;
    const globalPatterns = [
      /(\d+[,\d]*\.?\d*[Kk]?)\s*bought\s+in\s+past\s+month/i,
      /(\d+[,\d]*\.?\d*[Kk]?)\s*bought\s+in\s+the\s+past\s+month/i,
      /(\d+[,\d]*\.?\d*[Kk]?)\s*purchased\s+in\s+past\s+month/i,
      /(\d+[,\d]*\.?\d*[Kk]?)\s*sold\s+in\s+past\s+month/i
    ];
    
    for (const pattern of globalPatterns) {
      const match = bodyText.match(pattern);
      if (match) {
        let num = match[1];
        
        if (num.includes('K') || num.includes('k')) {
          const numStr = num.replace(/[Kk]/, '');
          const numValue = parseFloat(numStr);
          return Math.round(numValue * 1000);
        }
        
        num = num.replace(/,/g, '');
        const numValue = parseInt(num);
        if (!isNaN(numValue) && numValue > 0) {
          return numValue;
        }
      }
    }
    
    return 0;
  }
  
  // 提取变体信息
  function extractVariants() {
    const variants = [];
    
    // 从变体选择器提取
    const variantElements = document.querySelectorAll('#variation_color_name li, #variation_size_name li, #variation_pattern_name li');
    variantElements.forEach(el => {
      const variantText = el.textContent.trim();
      if (variantText) {
        variants.push(variantText);
      }
    });
    
    return variants;
  }
  
  // 提取变体属性
  function extractVariantAttributes() {
    const attributes = {};
    
    // 提取颜色
    const colorElement = document.querySelector('#variation_color_name .selection');
    if (colorElement) {
      attributes.color = colorElement.textContent.trim();
    }
    
    // 提取尺寸
    const sizeElement = document.querySelector('#variation_size_name .selection');
    if (sizeElement) {
      attributes.size = sizeElement.textContent.trim();
    }
    
    return attributes;
  }
  
  // 提取BSR
  function extractBSR() {
    const bsrElement = document.querySelector('#productDetails_detailBullets_sections1') ||
                      document.querySelector('#SalesRank');
    if (bsrElement) {
      const text = bsrElement.textContent;
      const match = text.match(/#([0-9,]+)/);
      if (match) {
        return match[1].replace(/,/g, '');
      }
    }
    return null;
  }
  
  // 提取分类
  function extractCategory() {
    const breadcrumbs = document.querySelectorAll('.a-breadcrumb a');
    if (breadcrumbs.length > 0) {
      return Array.from(breadcrumbs).map(a => a.textContent.trim()).join(' > ');
    }
    return '';
  }
  
  // 提取要点
  function extractBulletPoints() {
    const bulletElements = document.querySelectorAll('#feature-bullets li');
    return Array.from(bulletElements).map(li => li.textContent.trim()).filter(text => text);
  }
  
  // 保存到Supabase
  async function saveToSupabase(productData) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'saveProduct',
        productData: productData
      }, (response) => {
        if (response && response.success) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: response?.error || '保存失败' });
        }
      });
    });
  }
  
  // 保存采集状态
  function saveCollectionState() {
    chrome.storage.local.set({ collectionState: collectionState });
  }
  
  // 显示进度条
  function showProgressBar() {
    if (progressContainer) {
      progressContainer.remove();
    }
    
    progressContainer = document.createElement('div');
    progressContainer.id = 'amazon-collector-progress';
    progressContainer.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: white;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 15px;
      z-index: 9999;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      min-width: 300px;
    `;
    
    progressContainer.innerHTML = `
      <div style="margin-bottom: 10px; font-weight: bold;">采集进度</div>
      <div style="margin-bottom: 5px;">
        <div style="width: 100%; background: #f0f0f0; border-radius: 4px; overflow: hidden;">
          <div id="progress-bar" style="height: 20px; background: #4CAF50; width: 0%; transition: width 0.3s;"></div>
        </div>
      </div>
      <div style="font-size: 12px; color: #666; margin-bottom: 10px;">
        <span id="progress-text">0 / 0</span>
        <span style="float: right;">成功: <span id="success-count">0</span> | 失败: <span id="failure-count">0</span></span>
      </div>
      <div style="display: flex; gap: 10px;">
        <button id="pause-btn" style="flex: 1; padding: 5px; background: #ff9800; color: white; border: none; border-radius: 4px; cursor: pointer;">暂停</button>
        <button id="resume-btn" style="flex: 1; padding: 5px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; display: none;">继续</button>
        <button id="cancel-btn" style="flex: 1; padding: 5px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">取消</button>
      </div>
    `;
    
    document.body.appendChild(progressContainer);
    
    // 事件监听
    progressContainer.querySelector('#pause-btn').addEventListener('click', () => {
      collectionState.isPaused = true;
      saveCollectionState();
      progressContainer.querySelector('#pause-btn').style.display = 'none';
      progressContainer.querySelector('#resume-btn').style.display = 'block';
    });
    
    progressContainer.querySelector('#resume-btn').addEventListener('click', () => {
      collectionState.isPaused = false;
      saveCollectionState();
      progressContainer.querySelector('#pause-btn').style.display = 'block';
      progressContainer.querySelector('#resume-btn').style.display = 'none';
      startCollection();
    });
    
    progressContainer.querySelector('#cancel-btn').addEventListener('click', () => {
      if (confirm('确定要取消采集吗？')) {
        collectionState.isCollecting = false;
        collectionState.isPaused = false;
        saveCollectionState();
        progressContainer.remove();
      }
    });
    
    updateProgressBar();
  }
  
  // 更新进度条
  function updateProgressBar() {
    if (!progressContainer) return;
    
    const total = collectionState.totalItems;
    const current = collectionState.currentIndex;
    const success = collectionState.successCount;
    const failure = collectionState.failureCount;
    
    const progress = total > 0 ? Math.round((current / total) * 100) : 0;
    
    const progressBar = progressContainer.querySelector('#progress-bar');
    const progressText = progressContainer.querySelector('#progress-text');
    const successCount = progressContainer.querySelector('#success-count');
    const failureCount = progressContainer.querySelector('#failure-count');
    
    if (progressBar) progressBar.style.width = `${progress}%`;
    if (progressText) progressText.textContent = `${current} / ${total}`;
    if (successCount) successCount.textContent = success;
    if (failureCount) failureCount.textContent = failure;
  }
  
  // 工具函数
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // 监听页面变化
  const observer = new MutationObserver(() => {
    addCollectButtonsToProducts();
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
  
  // 初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
