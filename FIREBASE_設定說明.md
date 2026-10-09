# 🔥 Firebase 設定教學

## 步驟一：建立 Firebase 專案
1. 前往 https://console.firebase.google.com/
2. 點「新增專案」→ 輸入名稱（例如 `jellycat-proxy`）
3. 停用 Google Analytics（可選）→ 建立專案

## 步驟二：啟用 Authentication
1. 左側選單 → Authentication → 開始使用
2. 選擇「Sign-in method」→ 啟用「Google」
3. 輸入支援電子郵件 → 儲存

## 步驟三：建立 Firestore Database
1. 左側選單 → Firestore Database → 建立資料庫
2. 選「正式版模式」（或測試版也可）
3. 選擇地區（建議 asia-east1 台灣）→ 啟用

## 步驟四：設定 Firestore 安全規則
在 Firestore → 規則，貼入以下規則：
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## 步驟五：取得設定碼
1. 專案設定（齒輪）→ 一般設定
2. 往下找「您的應用程式」→ 點「</>」（網頁）
3. 輸入應用程式暱稱 → 不需要 Firebase Hosting → 「繼續」
4. 複製 firebaseConfig 物件中的內容

## 步驟六：填入 app.js
打開 `app.js`，找到第 15-22 行：
```js
const firebaseConfig = {
  apiKey: "AIzaSyPLACEHOLDER",      ← 換成你的 apiKey
  authDomain: "...",                  ← 換成你的 authDomain
  projectId: "...",                   ← 換成你的 projectId
  storageBucket: "...",               ← 換成你的 storageBucket
  messagingSenderId: "...",           ← 換成你的 messagingSenderId
  appId: "..."                        ← 換成你的 appId
};
```

## ⚠️ 注意
在填入正確設定之前，App 會自動使用「Demo 模式」（LocalStorage）
資料只存在瀏覽器中，不會跨裝置同步，但功能完全可以使用！

## 步驟七：部署（可選）
若要在任何裝置用手機打開，建議部署到：
- Firebase Hosting（免費）
- Netlify（拖拉上傳即可）
- GitHub Pages
