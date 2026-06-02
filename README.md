# 인터오리진 임원 대시보드

> **9개 프로젝트 현황을 한 화면에 + 임원이 페이지에서 직접 의견·요청을 남기고 PM이 처리** 하는 사내 운영 대시보드.

## 운영 흐름 (현재)

```
┌──────────────────────────────────────────────────────────────┐
│  대시보드 (interohrigin-dev.pages.dev)                        │
│                                                              │
│  임원·이사: 프로젝트 탭에서 의견·요청 직접 작성              │
│   ↓  (❓질문 / 📋요청 / ⚠️결정필요 / 👍피드백 분류)          │
│  서버(Cloudflare KV)에 저장 → 모든 임원에게 실시간 공유      │
│   ↓                                                          │
│  PM(차주용): 답글 / 검토중 / 완료 상태 변경 (페이지에서 직접) │
│   ↓                                                          │
│  필요 시 Claude Code Inbox(.md)로 내려받아 작업 지시         │
└──────────────────────────────────────────────────────────────┘
```

> 슬랙 연동은 사용하지 않습니다. 모든 의견 수집·처리는 대시보드 페이지 안에서 직접 이뤄집니다.

## 핵심 동작

- **어느 기기에서 열어도 자동 연결**: 페이지에 대시보드 키가 내장돼 있어, URL만 열면 별도 설정 없이 서버에 연결되고 모든 의견이 공유됩니다.
- **실시간 동기화**: 현재 보고 있는 탭을 5초마다 폴링해 새 의견·답글·상태를 반영합니다.
- **서버 저장이 진실(source of truth)**: 모든 의견은 Cloudflare KV에 저장됩니다. (브라우저 localStorage는 설정/조회기록 등 보조용)

## 역할

| 역할 | 동작 |
|------|------|
| **임원·이사** | 대시보드 접속 → 프로젝트 탭에서 의견·요청 작성. 같은 화면을 모두 공유. |
| **PM (차주용)** | 의견 확인 → 답글/상태 변경(검토중·완료) → 필요 시 Inbox로 내려받아 Claude Code에 지시 → 결과 공유. |

## 디렉토리

```
.
├── README.md
├── public/
│   ├── index.html       — 대시보드 (의견 작성·조회·상태관리)
│   └── _routes.json     — /api/*, /health 만 Functions 라우팅
├── functions/           — Cloudflare Pages Functions (API)
│   ├── api/messages.ts  — 의견 CRUD (KV 저장)
│   ├── api/commits.ts   — 프로젝트별 GitHub 커밋 조회
│   ├── api/inbox.ts     — Claude Code Inbox(.md) 생성
│   └── _lib/storage.ts  — KV 저장 레이어
└── docs/                — SETUP / ARCHITECTURE
```

## 환경변수 (Cloudflare Pages)

| 변수 | 용도 |
|------|------|
| `DASHBOARD_KEY` | 대시보드 접근 키 (index.html 내장 기본값과 동일해야 함) |
| `MESSAGES` (KV 바인딩) | 의견 저장 네임스페이스 |
| `GITHUB_TOKEN` | 프로젝트 커밋 조회용 (선택) |

> `DASHBOARD_KEY` 를 변경하면 `public/index.html` 의 `DEFAULT_KEY` 상수도 같은 값으로 맞춰야 합니다.

## 배포

GitHub `main` 푸시 → Cloudflare Pages 자동 배포.

## 비용

월 $0 (Cloudflare 무료 한도 내).

## 라이선스

내부 사용 전용 (인터오리진).
