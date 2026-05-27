# 셋업 가이드 — Slack App + Cloudflare Worker 배포

> 총 소요 시간: 약 30분 (처음 1회만)

## 사전 준비

- [ ] Slack 워크스페이스 관리자 권한 (인터오리진)
- [ ] Cloudflare 계정 (무료, [signup](https://dash.cloudflare.com/sign-up))
- [ ] Node.js 18+ 설치
- [ ] GitHub 레포 권한 (`interohrigin-dev/executive-dashboard`)

---

## 1. Slack App 생성 (5분)

1. https://api.slack.com/apps 접속 → **Create New App** → "From scratch"
2. App 이름: `Executive Dashboard Bot` / Workspace: 인터오리진 선택
3. 좌측 메뉴 **OAuth & Permissions** → Scopes의 **Bot Token Scopes**에 다음 추가:
   - `channels:history` — 채널 메시지 읽기
   - `channels:read` — 채널 정보 조회
   - `chat:write` — 봇이 메시지 발송 (선택)
   - `files:read` — 첨부 이미지 다운로드
   - `reactions:read` — 이모지 반응 감지
   - `users:read` — 작성자 이름 조회
4. 상단 **Install to Workspace** → 권한 확인 → 설치
5. 설치 후 **Bot User OAuth Token** (`xoxb-...`) 복사 → 메모장에 잠시 보관
6. 좌측 메뉴 **Basic Information** → **Signing Secret** 표시 → 복사 → 메모장에 보관

> ⚠️ **Event Subscriptions URL은 다음 단계 (Worker 배포 후)에서 설정합니다.**

---

## 2. Cloudflare 계정 + KV/R2 셋업 (5분)

1. https://dash.cloudflare.com 접속 → 로그인
2. **Workers & Pages** → **Plans** → Free 플랜 활성화 확인
3. 우측 상단 **Account ID** 복사 → 메모장에 보관 (선택)

---

## 3. 로컬에서 Worker 배포 (10분)

터미널에서:

```bash
cd ~/projects/executive-dashboard/worker

# 의존성 설치
npm install

# Cloudflare 로그인 (브라우저 열림)
npx wrangler login

# KV 네임스페이스 생성
npx wrangler kv:namespace create "MESSAGES"
# → 출력에서 id 복사 (예: "abc123def456...")
```

`wrangler.toml`의 `id = "REPLACE_WITH_KV_ID_AFTER_CREATE"` 부분을 위에서 받은 id로 교체:

```toml
[[kv_namespaces]]
binding = "MESSAGES"
id = "여기에-받은-id-붙여넣기"
```

R2 버킷 생성:

```bash
npx wrangler r2 bucket create executive-dashboard-images
```

Secrets 설정 (순서대로):

```bash
npx wrangler secret put SLACK_SIGNING_SECRET
# → 위 1번 6항에서 복사한 Signing Secret 붙여넣기

npx wrangler secret put SLACK_BOT_TOKEN
# → 위 1번 5항에서 복사한 xoxb- 토큰 붙여넣기

npx wrangler secret put DASHBOARD_KEY
# → 임의의 랜덤 문자열 (예: jy-dash-2026-xY9zKpQ)
#   임원에게 공유할 키. 한 번만 정하면 됨.
```

배포:

```bash
npx wrangler deploy
```

배포 완료 후 출력에 표시되는 URL 복사 (예: `https://executive-dashboard.YOUR-NAME.workers.dev`)

---

## 4. Slack App에 Event URL 등록 (3분)

1. https://api.slack.com/apps → 만든 App 선택
2. 좌측 **Event Subscriptions** → **Enable Events** ON
3. **Request URL**에 입력:
   ```
   https://executive-dashboard.YOUR-NAME.workers.dev/slack/events
   ```
4. ✓ Verified 표시 확인 (Slack이 Worker로 challenge 전송 → Worker가 정답 반환)
5. 같은 페이지 **Subscribe to bot events**에 다음 추가:
   - `message.channels` — 채널 메시지
   - `reaction_added` — 이모지 반응
6. **Save Changes**
7. 좌측 상단 노란 띠 알림 → **reinstall your app**

---

## 5. 슬랙 채널 생성 + 봇 초대 (2분)

1. Slack에서 채널 생성:
   - `#exec-dashboard-overview` — 종합
   - `#exec-dashboard-hr` — HR (선택, 분리하고 싶으면)
   - `#exec-dashboard-finance` — 재무
   - 또는 단일 채널 `#차주용-보고` 하나만 써도 OK
2. 각 채널에서 `/invite @Executive Dashboard Bot` 실행
3. 채널 이름에 따라 자동 분류:
   - `hr` 포함 → HR 탭
   - `cs` 포함 → CS 탭
   - `finance`/`재무`/`자금` 포함 → 재무관리 탭
   - `ophe` 포함 → OPHE 탭
   - `boom`/`zap`/`붐앤잽` 포함 → 붐앤잽 탭
   - 그 외 → 종합 탭

---

## 6. 임원에게 공유 (1분)

다음 정보를 카카오워크/이메일로 전달:

```
[차주용 PM] 임원 대시보드 공유

▣ URL: https://executive-dashboard.YOUR-NAME.workers.dev
▣ Dashboard Key: jy-dash-2026-xY9zKpQ

처음 접속 시:
1) 우상단 ⚙️ 설정 클릭
2) Dashboard Key 위 키 붙여넣기 → 저장
3) 작성자 이름 입력 (한 번만)

의견 작성 방법 (2가지 모두 OK):
A) 슬랙 채널 #차주용-보고 에 글 작성 (이미지 첨부 가능)
   - 메시지에 이모지 반응으로 분류:
     ❓ 질문 / 📋 요청 / ⚠️ 결정필요 / 👍 피드백
B) 대시보드에서 직접 의견 작성

5초마다 자동 동기화됨. 작성한 의견은 모든 임원이 같은 화면에서 봅니다.
```

---

## 7. PM 작업 흐름 (운영 시)

대시보드에서:

1. 임원이 슬랙에 글을 올리면 → 5초 후 대시보드에 자동 등장
2. 각 의견 좌측 **체크박스** 선택 → 여러 개 체크 가능 (탭 넘나들어도 유지)
3. 우상단 **🤖 Claude Code Inbox 생성** 버튼 클릭
4. `inbox-YYYY-MM-DD.md` 파일 자동 다운로드

터미널에서:

```bash
cd ~/Interohrigin-hr  # 또는 해당 레포
mv ~/Downloads/inbox-YYYY-MM-DD.md ./inbox.md
claude code -p "@inbox.md 의 항목들을 우선순위 순서대로 처리해줘. 각 항목마다 (1) 어느 파일을 수정할지 추정 (2) 변경 사항 요약 (3) 실제 코드 변경 후 git diff. 결정필요는 사람 확인 후 진행."
```

Claude Code가:
- ⚠️ 결정필요 → 사람 확인 대기 메시지 출력
- 📋 요청 → 파일 수정 + git commit
- ❓ 질문 → 답변 작성 후 종료
- 👍 피드백 → 작업 로그에 기록

---

## 8. 문제 해결

### Slack URL Verification 실패 (Request URL not verified)
- Worker가 정상 배포되었는지 확인: `curl https://YOUR-WORKER.workers.dev/health`
- `SLACK_SIGNING_SECRET`이 올바른지 확인 (`npx wrangler secret list`)

### 대시보드에서 "서버 미연결" 표시
- 설정 모달에서 **Dashboard Key** 입력 확인
- Worker URL이 비어 있으면 같은 도메인에서 호스팅된 것으로 가정 (Pages 배포 권장)

### 이미지가 깨져 보임
- Bot이 채널에 초대되어 있는지 확인 (`/invite @봇이름`)
- `files:read` scope 누락 가능 → OAuth 페이지에서 추가 후 reinstall

### 슬랙 메시지가 대시보드에 안 보임
- `npx wrangler tail` 로 실시간 로그 확인
- Event Subscriptions의 Subscribe to bot events에 `message.channels` 추가 확인

---

## 9. 비용 한도 알림 (선택)

Cloudflare 무료 한도:
- Workers: 10만 요청/일 (현재 사용량의 ~1%)
- KV: 1,000 write/일 (의견 1000건 = 안전 한도)
- R2: 10GB 저장 (이미지 약 1만 장)

한도 근접 시 Cloudflare 대시보드에서 이메일 알림 자동 설정 가능.

---

## 다음 단계 (선택 확장)

- **Anthropic API 자동 분류** — 의견 → 어느 레포·파일 수정 추정 (월 ~$0.1)
- **GitHub Issue 자동 등록** — 의견 → 해당 레포 이슈 자동 추가
- **Slack 슬래시 커맨드** — `/cc-do <의견ID>` → Claude Code 자동 실행 (서버에서)
- **부서별 채널 분리** — `#hr-feedback` `#cs-feedback` 등 패널별 채널
