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
| `KAKAOWORK_APP_KEY` | 카카오워크 봇 App Key (권장 방식) |
| `KAKAOWORK_CONVERSATION_ID` | 모든 의견/답글을 보낼 **단톡방 id** (기존 방에 봇 초대 후 `/api/kakao-rooms` 로 확인) |
| `KAKAOWORK_RECIPIENTS` | (CONVERSATION_ID 미지정 시) 이 이메일들로 봇이 그룹방을 자동 생성해 거기로 전송 |
| `KAKAOWORK_CONVERSATION_NAME` | (자동 생성 그룹방 이름, 선택) |
| `KAKAOWORK_WEBHOOK_URL` | (대안) 인커밍 웹훅 URL. App Key 없이 이 URL 로 `{text}` 전송 |
| `DASHBOARD_URL` | 알림 메시지에 넣을 대시보드 주소 (미설정 시 `https://interohrigin-dev.pages.dev`) |

### 카카오워크 알림 연동 (봇 → 단톡방 1곳 공유)

대시보드의 **모든 의견·답글**을 지정한 **단톡방 하나**에 봇이 공유한다.

봇 만들기: 관리자 페이지 → **봇(Bot) 관리 → 봇(Bot) 개발** → 봇 생성 →
권한 `메시지 발송`·`채팅방 조회`·`채팅방 개설`·`멤버 조회` 체크 → 저장 → **App Key** 복사
(알림형이라 Request/Callback URL·대화기능 불필요).

**방법 A — 기존 단톡방에 보내기 (권장)**
1. 카카오워크에서 그 봇을 **"IO 개발현황" 단톡방에 초대**
2. Cloudflare Pages 환경변수에 `KAKAOWORK_APP_KEY` 등록 → 재배포
3. `https://interohrigin-dev.pages.dev/api/kakao-rooms?key=<DASHBOARD_KEY>` 열어 그 방의 **id** 확인
4. 환경변수 `KAKAOWORK_CONVERSATION_ID` = 그 id → 재배포

**방법 B — 봇이 그룹방 자동 생성**
1. 환경변수 `KAKAOWORK_APP_KEY` + `KAKAOWORK_RECIPIENTS`(멤버 이메일들) 등록 → 재배포
2. 봇이 그 멤버들로 그룹방을 만들어(이름은 `KAKAOWORK_CONVERSATION_NAME`) 거기로 전송

확인: `https://interohrigin-dev.pages.dev/api/kakao-test?key=<DASHBOARD_KEY>` → `mode:bot`,
`targetConversationId` 가 잡히고 단톡방에 테스트 메시지가 오면 완료.

> 동작 원리: (A) `conversations.list` 로 방 id 확인 → `messages.send`. (B) `users.find_by_email` → `conversations.open(user_ids)` 그룹 생성(KV 캐시) → `messages.send`.

> `DASHBOARD_KEY` 를 변경하면 `public/index.html` 의 `DEFAULT_KEY` 상수도 같은 값으로 맞춰야 합니다.

## 배포

GitHub `main` 푸시 → Cloudflare Pages 자동 배포.

## 비용

월 $0 (Cloudflare 무료 한도 내).

## 라이선스

내부 사용 전용 (인터오리진).
