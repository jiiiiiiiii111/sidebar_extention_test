export function getPageMode(url) {
  if (!url) return "default";
  if (
    url.includes('login') || url.includes('signup') || url.includes('signin') ||
    url.includes('auth') || url.includes('password') || url.includes('account')
  ) {
    return "sensitive";
  }
  if (
    url.startsWith('chrome://') || url.startsWith('chrome-extension://') ||
    url.startsWith('about:') || url.startsWith('moz-extension://')
  ) {
    return "default";
  }
  if (
    url === 'https://www.google.com' || url === 'https://www.naver.com' ||
    url === 'https://www.youtube.com'
  ) {
    return "default";
  }
  if (url.includes('.pdf') || url.includes('.doc') || url.includes('.docx')) {
    chrome.runtime.sendMessage({ type: "DOCS_DETECTED" , url: url});
    return "document";
  }
  if (url.includes('youtube.com/watch') || url.includes('youtube.com/shorts')) {
    return "youtube";
  }
  return "recommendation";
}
