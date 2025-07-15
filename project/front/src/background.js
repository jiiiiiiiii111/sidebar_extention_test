import { collectBrowser } from './utils/browserCollector.js';
import { collectDocument } from './utils/documentCollector.js';
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

// 자동 수집 트리거 관리: Document
function handleDocumentAutoCollect(tabId, triggerType) {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    chrome.tabs.get(tabId, (tab) => {
      const url = tab.url;
      const now = Date.now();

      // 페이지 모드 감지
      console.log("[AutoDoc] URL:",url);
      const mode = getPageMode(url);
      console.log("[AutoDoc] Mode:", mode);
      if (mode !== "document") {
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

      // WebSocket 리셋
      // 사용자가 혼동하지 않게 이전 요약 결과를 지우고 "새로운 요약이 곧 시작됨"을 UI에 전달
      chrome.runtime.sendMessage({ type: "RESET_WEBSOCKET_MESSAGE" });

      // 데이터 수집 및 전송
      collectDocument(tabId).then((result) => {
        if (result) {
            console.log("[AutoDoc] 추출된 텍스트:", result);
            chrome.runtime.sendMessage({
                type: "DOCUMENT_PROCESSED",
                result, // 프론트로 요약 결과 보내기
            });
        }
      })

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
      } else if (mode === "document") {
        handleDocumentAutoCollect(id, 'complete');
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

});