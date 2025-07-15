export async function collectDocument(tabId) {
  try {
    const tab = await new Promise((resolve, reject) => {
      chrome.tabs.get(tabId, (t) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(t);
      });
    });

    const url = tab.url;
    if (!url) throw new Error("탭 URL 없음");

    const file_response = await fetch(url);
    if (!response.ok) throw new Error(`파일 다운로드 실패: HTTP ${response.status}`);

    const blob = await file_response.blob();
    //// File은 JavaScript 내장 함수 - 파일 업로드를 흉내낼 때 사용
    const file = new File([blob], "document.pdf", { type: "application/pdf" });

    const formData = new FormData();
    formData.append("file", file);
    formData.append("fast", "true");


    const response = await fetch("http://localhost:8000/collect/doc", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`서버 오류: ${response.status} - ${errText}`);
    }

    const result = await response.json();
    return result;
  } catch (err) {
    throw err;
  }
}
