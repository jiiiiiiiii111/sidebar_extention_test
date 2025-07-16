import { collectBrowser } from './utils/browserCollector.js';
import { documentCollector } from './utils/documentCollector.js';
import { getPageMode } from './utils/pageMode';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// src/background.js  Manifest v3, Chrome 116+
const API = import.meta.env.VITE_API_BASE + "/collect/browser";

// 전역 단일 디바운스 타이머 및 상태
let debounceTimer = null;
// url 이벤트 윈도우 관리
let lastSentUrl = null;
let lastSentTime = 0;
// 자동 수집 트리거 관리: handleBrowserAutoCollect
function handleBrowserAutoCollect(tabId, triggerType) {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    chrome.tabs.get(tabId, (tab) => {
      const url = tab.url;
      const now = Date.now();

      // 페이지 모드 감지
      console.log(url);
      const mode = getPageMode(url);
      console.log(mode);
      if (mode !== "recommendation") {
        debounceTimer = null;
        return;
      }

      // 10초 이내 동일 url에 대한 연속 요청 무시
      if (url === lastSentUrl && now - lastSentTime < 10000) {
        debounceTimer = null;
        return;
      }
      lastSentUrl = url;
      lastSentTime = now;

      // 데이터 수집 및 전송
      collectBrowser(tabId).then((data) => {
        if (data) {
          chrome.runtime.sendMessage({ type: "RESET_WEBSOCKET_MESSAGE" });
          sendToBackend(data, triggerType);
        }
      });
      debounceTimer = null;
    });
  }, 1500);
}


// 자동 트리거: 탭 로드 완료 (url, complete)
chrome.tabs.onUpdated.addListener((id, info, tab) => {
  try {
    // info.url이 있을 때
    if (info.url && tab && tab.url) {
      const mode = getPageMode(tab.url);
      // console.log(mode);
      if (mode === "recommendation") {
        setTimeout(() => handleBrowserAutoCollect(id, 'url'), 500);
      }
    }
    // status가 complete일 때 (tab.url이 있을 때만)
    if (info.status === "complete" && tab && tab.url) {
      const mode = getPageMode(tab.url);
      // console.log(mode);
      if (mode === "recommendation") {
        handleBrowserAutoCollect(id, 'complete');
      }
    }
  } catch (e) {
    console.error("[onUpdated] Unexpected error", e);
  }
});

// 자동 트리거: 탭 전환 (tab)
chrome.tabs.onActivated.addListener(({ tabId }) => {
  try {
    handleBrowserAutoCollect(tabId, 'tab');
  } catch (e) {
    console.error("[onActivated] Unexpected error", e);
  }
});

// 백엔드 전송 함수
async function sendToBackend(data, triggerType) {
  if (!data) return;
  const API = import.meta.env.VITE_API_BASE + "/collect/browser";
  // JWT 읽기
  chrome.storage.local.get(['token'], async (result) => {
    const token = result.token;
    try {
      await fetch(API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : undefined
        },
        body: JSON.stringify({ ...data, trigger_type: triggerType })
      });
      console.log(`[sendToBackend] Data sent (trigger: ${triggerType})`);
    } catch (e) {
      console.error("[sendToBackend] Failed", e);
    }
  });
}


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
// DOM 준비: content_script에서 CONTENT_READY 메시지
  if (msg.type === "CONTENT_READY" && sender.tab && sender.tab.id) {
    handleBrowserAutoCollect(sender.tab.id, 'content_ready');
  }
// 버튼 클릭 메시지 수집 요청 시 처리
  if (msg.type === "COLLECT_BROWSER_BY_BUTTON") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) return sendResponse({ error: "No active tab" });

      const data = await collectBrowser(tabId);
      if (data) {
        sendToBackend(data, 'button');
        sendResponse(data);
      } else {
        sendResponse({ error: "Collection failed" });
      }
    });
    return true; // async 응답
  }
  if (msg.type === "DOCS_DETECTED") {
    // 로그인 상태 확인
    chrome.storage.local.get(['token'], (result) => {
      const token = result.token;
      if (!token) {
        console.log("로그인이 필요합니다. PDF 처리를 건너뜁니다.");
        sendResponse({ status: "login_required", error: "로그인이 필요합니다." });
        return;
      }

      // async 함수를 별도로 정의하여 실행
      (async () => {
        try {
          const pdfUrl = msg.url;
          const blob = await documentCollector(pdfUrl);

          const formData = new FormData();
          formData.append("file", blob, "document.pdf");
          formData.append("fast", "true");

          const response = await fetch("http://localhost:8000/collect/doc", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${token}`
            },
            body: formData,
          });

          const result = await response.json();
          console.log("추출된 텍스트:", result);
          sendResponse({ status: "PDF processed", result: result });
        } catch (error) {
          console.error("PDF 처리 중 오류:", error);
          sendResponse({ status: "error", error: error.message });
        }
      })();
    });
    return true; // async 응답
  }

});
