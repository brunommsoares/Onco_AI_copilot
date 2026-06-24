/**
 * Browser Compatibility Utilities
 * Ensures the application works across all browsers and devices
 */

// Check if browser supports modern features
export const browserSupport = {
  // CSS Features
  backdropFilter: CSS.supports('backdrop-filter', 'blur(10px)'),
  grid: CSS.supports('display', 'grid'),
  flexbox: CSS.supports('display', 'flex'),
  
  // JavaScript Features
  asyncAwait: typeof async function(){} === 'function',
  fetch: typeof fetch !== 'undefined',
  localStorage: typeof localStorage !== 'undefined',
  
  // Web APIs
  clipboard: navigator.clipboard && navigator.clipboard.writeText,
  share: navigator.share && typeof navigator.share === 'function',
  geolocation: navigator.geolocation,
  
  // Touch Support
  touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
  
  // Device Type Detection
  isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
  isTablet: /iPad|Android(?!.*Mobile)/i.test(navigator.userAgent),
  isDesktop: !(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent))
};

// Fallback for backdrop-filter
export const getBackdropFilter = () => {
  if (browserSupport.backdropFilter) {
    return 'backdrop-filter: blur(20px);';
  }
  return 'background: rgba(255, 255, 255, 0.95);';
};

// Fallback for CSS Grid
export const getGridSupport = () => {
  if (browserSupport.grid) {
    return 'grid';
  }
  return 'flex';
};

// Enhanced fetch with timeout and fallbacks
export const enhancedFetch = async (url, options = {}, timeout = 10000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
};

// Clipboard fallback
export const copyToClipboard = async (text) => {
  if (browserSupport.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.warn('Clipboard API failed, falling back to execCommand');
    }
  }
  
  // Fallback for older browsers
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  try {
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (error) {
    document.body.removeChild(textArea);
    return false;
  }
};

// Share fallback
export const shareContent = async (data) => {
  if (browserSupport.share) {
    try {
      await navigator.share(data);
      return true;
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.warn('Native sharing failed, falling back to clipboard');
      }
    }
  }
  
  // Fallback: copy to clipboard
  const shareText = `${data.title || ''}\n\n${data.text || ''}\n\n${data.url || ''}`.trim();
  return await copyToClipboard(shareText);
};

// CSS Custom Properties fallback
export const getCSSVariable = (variable, fallback) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable);
  return value || fallback;
};

// Touch event handling
export const addTouchSupport = (element, options = {}) => {
  if (!browserSupport.touch) return;
  
  const {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    preventDefault = true
  } = options;
  
  if (onTouchStart) {
    element.addEventListener('touchstart', (e) => {
      if (preventDefault) e.preventDefault();
      onTouchStart(e);
    }, { passive: false });
  }
  
  if (onTouchMove) {
    element.addEventListener('touchmove', (e) => {
      if (preventDefault) e.preventDefault();
      onTouchMove(e);
    }, { passive: false });
  }
  
  if (onTouchEnd) {
    element.addEventListener('touchend', (e) => {
      if (preventDefault) e.preventDefault();
      onTouchEnd(e);
    }, { passive: false });
  }
};

// Responsive image loading
export const loadResponsiveImage = (src, sizes = '100vw') => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
    img.sizes = sizes;
  });
};

// Intersection Observer fallback
export const createIntersectionObserver = (callback, options = {}) => {
  if ('IntersectionObserver' in window) {
    return new IntersectionObserver(callback, options);
  }
  
  // Fallback for older browsers
  return {
    observe: () => {},
    unobserve: () => {},
    disconnect: () => {}
  };
};

// Resize Observer fallback
export const createResizeObserver = (callback) => {
  if ('ResizeObserver' in window) {
    return new ResizeObserver(callback);
  }
  
  // Fallback for older browsers
  return {
    observe: () => {},
    unobserve: () => {},
    disconnect: () => {}
  };
};

// Performance monitoring
export const measurePerformance = (name, fn) => {
  if ('performance' in window && performance.mark) {
    const startMark = `${name}-start`;
    const endMark = `${name}-end`;
    
    performance.mark(startMark);
    const result = fn();
    performance.mark(endMark);
    
    performance.measure(name, startMark, endMark);
    const measure = performance.getEntriesByName(name)[0];
    console.log(`${name} took ${measure.duration}ms`);
    
    return result;
  }
  
  // Fallback for older browsers
  const start = Date.now();
  const result = fn();
  const duration = Date.now() - start;
  console.log(`${name} took ${duration}ms`);
  
  return result;
};

// Service Worker registration with fallback
export const registerServiceWorker = async (swPath) => {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register(swPath);
      console.log('Service Worker registered successfully:', registration);
      return registration;
    } catch (error) {
      console.warn('Service Worker registration failed:', error);
      return null;
    }
  }
  console.warn('Service Worker not supported');
  return null;
};

// PWA installation prompt
export const showInstallPrompt = () => {
  if ('BeforeInstallPromptEvent' in window) {
    return new Promise((resolve) => {
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        resolve(e);
      });
    });
  }
  return null;
};

// Device orientation handling
export const handleOrientation = (callback) => {
  if ('onorientationchange' in window) {
    window.addEventListener('orientationchange', callback);
  } else if ('onresize' in window) {
    window.addEventListener('resize', callback);
  }
};

// Export all utilities
export default {
  browserSupport,
  getBackdropFilter,
  getGridSupport,
  enhancedFetch,
  copyToClipboard,
  shareContent,
  getCSSVariable,
  addTouchSupport,
  loadResponsiveImage,
  createIntersectionObserver,
  createResizeObserver,
  measurePerformance,
  registerServiceWorker,
  showInstallPrompt,
  handleOrientation
};
