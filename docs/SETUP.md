# 셋업 가이드 — Cloudflare Pages + GitHub 자동 배포

> 채널: `https://interohriginichq.slack.com/archives/C0B6FK9BCE5` (단일)
> 소요 시간: 약 25분 (1회만, 결제 카드 등록 불필요)

이 가이드는 **Cloudflare Pages + Pages Functions**로 배포합니다. R2(파일 저장소)는 사용하지 않고, 첨부 이미지는 슬랙 메시지로 점프하는 링크로 표시합니다.

---

## 1. Slack App 준비 (이미 완료된 경우 스킵)

이미 메모장에 다음 3개 값이 있다면 다음 단계로:
- `SLACK_BOT_TOKEN` (xoxb-...)
- `SLACK_SIGNING_SECRET` (32자 hex)
- `DASHBOARD_KEY` (본인이 정한 임의 문자열)

아니라면 (이전 안내 참고):
1. https://api.slack.com/apps → Create New App → From scratch
2. OAuth Scopes 6개: `channels:history`, `channels:read`, `chat:write`, `files:read`, `reactions:read`, `users:read`
3. Install to Workspace → Bot Token 복사
4. Basic Information → Signing Secret 복사

---

## 2. Cloudflare Pages 프로젝트 생성 (5분)

1. https://dash.cloudflare.com → 좌측 **Workers & Pages** → **Create** → **Pages** 탭 → **Connect to Git**
2. GitHub 인증 (처음이면) → **interohrigindev/interohrigin-dev** 레포 선택 → **Begin setup**
3. **Build settings**:
   - **Production branch**: `main`
   - **Framework preset**: `None`
   - **Build command**: (비워둠)
   - **Build output directory**: `public`
   - **Root directory**: `/` (기본)
4. **Environment variables** → **Add variable** (Production):
   - `SLACK_WORKSPACE` = `interohriginichq`
   - `SLACK_CHANNEL_ID` = `C0B6FK9BCE5`
   - `SLACK_CHANNEL_URL` = `https://interohriginichq.slack.com/archives/C0B6FK9BCE5`
5. **Save and Deploy** 클릭 → 첫 빌드 진행 (1~2분)
6. 배포 완료 시 URL 표시됨 — 예: `https://interohrigin-dev.pages.dev`

---

## 3. KV 네임스페이스 + Secrets 연결 (5분)

배포된 프로젝트 페이지 → 좌측 **Settings**

### (a) KV 바인딩

1. **Functions** 탭 → **KV namespace bindings** → **Add binding**
2. **Variable name**: `MESSAGES`
3. **KV namespace**: 드롭다운에서 `executive-dashboard-MESSAGES` 선택
   (이미 만들어진 `ba52d2bbb46e4cd9a328814656abdd6d`)
4. **Save**

### (b) Secrets (환경변수의 보안 버전)

같은 **Settings** → **Environment variables** → **Production** 섹션에서:

| Variable name | 값 | 타입 |
|------|------|------|
| `SLACK_SIGNING_SECRET` | 메모장의 Signing Secret 값 | **Secret** (Encrypt 체크) |
| `SLACK_BOT_TOKEN` | 메모장의 `xoxb-...` 값 | **Secret** (Encrypt 체크) |
| `DASHBOARD_KEY` | 본인이 정한 키 | **Secret** (Encrypt 체크) |

> 일반 변수와 달리 Secret은 한 번 저장하면 다시 볼 수 없습니다 (보안).

저장 후 **Deployments** 탭 → 최근 배포의 **Retry deployment** 클릭 (Secrets 적용 위해 재배포).

---

## 4. Slack App에 Event URL 등록 (3분)

1. https://api.slack.com/apps → 본인 앱 선택
2. 좌측 **Event Subscriptions** → **Enable Events** ON
3. **Request URL**:
   ```
   https://interohrigin-dev.pages.dev/slack/events
   ```
   (위 3번에서 발급된 Pages URL + `/slack/events`)
   → 자동으로 ✓ Verified
4. **Subscribe to bot events** 추가:
   - `message.channels`
   - `reaction_added`
   - `reaction_removed`
5. **Save Changes** → 상단 띠 → **reinstall your app**

---

## 5. 슬랙 채널에 봇 초대 (1분)

채널 `https://interohriginichq.slack.com/archives/C0B6FK9BCE5` 진입:

```
/invite @Executive Dashboard Bot
```

---

## 6. 임원에게 공유

대시보드 URL: `https://interohrigin-dev.pages.dev`

카카오워크/메일 템플릿:

```
[차주용 PM] 임원 의견 보드

▣ 보기: https://interohrigin-dev.pages.dev
▣ 접속 키: (DASHBOARD_KEY 값)

처음 접속 시:
1) 우상단 ⚙️ 설정 클릭
2) "Dashboard Key" 위 키 붙여넣기 → 저장

의견 작성 — 슬랙 채널만:
▶ https://interohriginichq.slack.com/archives/C0B6FK9BCE5
▶ 메시지 + 이미지 첨부 자유롭게
▶ 이모지로 분류: ❓ 질문 / 📋 요청 / ⚠️ 결정필요 / 👍 피드백
▶ thread 답글 = 자동 동기화
▶ PM이 ✅ 누르면 자동 "해결됨"

이미지는 슬랙에서 보기로 열립니다 (대시보드에서 "슬랙에서 보기" 클릭).
```

---

## 7. 운영 흐름

```
임원 슬랙에 글 작성
   ↓ (5초 후)
대시보드 자동 표시
   ↓
PM 의견 선택 → "🤖 Claude Code Inbox 생성"
   ↓
inbox.md 다운로드
   ↓
claude code -p "@inbox.md ..." → PR 자동
   ↓
PM 슬랙에 ✅ → 자동 "해결됨"
```

---

## 8. 자주 발생하는 문제

### Event URL Verification 실패
- 배포가 끝났는지 확인: 브라우저로 `https://interohrigin-dev.pages.dev/health` 접속 → `{"ok":true,...}` 표시되어야 함
- Secret이 올바른지 (특히 SLACK_SIGNING_SECRET)
- Functions가 활성화되었는지: Pages 대시보드 → Functions 탭 → "Active" 표시

### "서버 미연결" 표시
- 우상단 ⚙️ 설정 → Dashboard Key 입력 확인

### 슬랙 메시지가 대시보드에 안 보임
- 봇이 채널에 들어갔는지 (`/invite @봇이름`)
- Event Subscriptions에 `message.channels` 추가 + reinstall
- Pages 대시보드 → Functions 탭 → Real-time logs로 에러 확인

### 코드를 수정한 뒤 반영 안 됨
- GitHub에 push → 1~2분 후 Pages 자동 재빌드
- 브라우저에서 우상단 **🔄 데이터 새로고침** 버튼

---

## 9. 비용

| 서비스 | 무료 한도 | 우리 사용량 |
|------|------|------|
| Cloudflare Pages 빌드 | 500 builds/월 | ~10/월 |
| Pages Functions | 10만 req/일 | ~1,000/일 |
| Cloudflare KV | 1,000 write/일 | ~50/일 |
| Slack Free | 무제한 | — |

→ **월 $0** (결제 카드 등록 불필요)

---

## 10. GitHub 커밋 진행상황 연동 (선택)

각 프로젝트 탭에 GitHub 레포의 최근 커밋을 "개발 진행상황"으로 표시하려면 토큰이 필요합니다 (레포가 private이라 인증 필수).

1. https://github.com/settings/tokens → **Generate new token (classic)**
2. 권한(scope): **`repo`** 체크 (private 레포 읽기)
3. 만료기간: 90일 또는 No expiration
4. 생성된 토큰(`ghp_...`) 복사
5. Cloudflare Pages → Settings → Environment variables → Production →
   - `GITHUB_TOKEN` = `ghp_...` (**Secret**, Encrypt 체크)
6. Deployments → Retry deployment

연동 레포: interohrigin-hr · io-finance · ophe · boomnzap · exhiboot · interohrigin-ir · interohrigin-dev
→ HR/재무/OPHE/붐앤잽/완료(Exhiboot·I&C)/종합 탭에 최근 커밋이 기능/수정/문서로 분류되어 표시됩니다. (KV 10분 캐시)
