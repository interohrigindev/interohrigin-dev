# 셋업 가이드 (단일 슬랙 채널 운영)

> 채널: `#차주용-보고` (또는 운영 중인 단일 채널)
> 채널 ID: `C0B6FK9BCE5`
> 워크스페이스: `interohriginichq.slack.com`
> 소요 시간: 약 30분 (1회만)

---

## 사전 준비

- [ ] Slack 워크스페이스 관리자 권한 (`interohriginichq`)
- [ ] Cloudflare 계정 ([signup](https://dash.cloudflare.com/sign-up), 무료)
- [ ] Node.js 18+ 설치 확인 (`node -v`)
- [ ] GitHub 레포 `interohrigindev/interohrigin-dev`

---

## 1. Slack App 생성 (5분)

1. https://api.slack.com/apps → **Create New App** → "From scratch"
2. App 이름: `Executive Dashboard Bot` · Workspace: `interohriginichq`
3. 좌측 **OAuth & Permissions** → **Bot Token Scopes** 추가:
   - `channels:history` — 채널 메시지 읽기
   - `channels:read` — 채널 정보
   - `chat:write` — (선택) 봇 발송
   - `files:read` — 이미지 첨부 다운로드
   - `reactions:read` — 이모지 반응 감지
   - `users:read` — 작성자 이름
4. **Install to Workspace** → 권한 확인 → 설치
5. 설치 후 표시되는 **Bot User OAuth Token** (`xoxb-...`) 복사 → 메모장 보관
6. 좌측 **Basic Information** → **Signing Secret** 복사 → 메모장 보관

> Event URL은 다음 (Worker 배포 후) 단계에서 설정.

---

## 2. 로컬에서 Worker 배포 (15분)

```bash
cd ~/projects/executive-dashboard/worker
npm install

# Cloudflare 로그인 (브라우저 자동 열림)
npx wrangler login

# KV 생성 → 출력된 id 메모
npx wrangler kv:namespace create "MESSAGES"
```

`wrangler.toml`의 `id = "REPLACE_WITH_KV_ID_AFTER_CREATE"` 를 위 id로 교체.

```bash
# R2 버킷
npx wrangler r2 bucket create executive-dashboard-images

# Secrets 설정
npx wrangler secret put SLACK_SIGNING_SECRET   # 1번 6항 값
npx wrangler secret put SLACK_BOT_TOKEN        # 1번 5항 xoxb- 값
npx wrangler secret put DASHBOARD_KEY          # 임의 랜덤 문자열 (예: jy-2026-xY9z)

# 배포
npx wrangler deploy
```

배포 완료 시 출력된 URL을 복사 (예: `https://executive-dashboard.YOUR-NAME.workers.dev`).

---

## 3. Slack App에 Event URL 등록 (3분)

1. https://api.slack.com/apps → 만든 App 선택
2. 좌측 **Event Subscriptions** → **Enable Events** ON
3. **Request URL** 에 입력:
   ```
   https://executive-dashboard.YOUR-NAME.workers.dev/slack/events
   ```
   → 자동으로 ✓ Verified 표시 확인
4. **Subscribe to bot events** 에 추가:
   - `message.channels` — 채널 메시지
   - `reaction_added` — 이모지 추가
   - `reaction_removed` — 이모지 제거 (해결됨 취소)
5. **Save Changes**
6. 상단 노란 띠 → **reinstall your app**

---

## 4. 채널에 봇 초대 (1분)

슬랙에서 `#차주용-보고` 채널 진입 →

```
/invite @Executive Dashboard Bot
```

봇이 채널에 들어가야 메시지·이미지·이모지를 받을 수 있습니다.

---

## 5. 임원에게 공유 (1분)

대시보드 URL: `https://executive-dashboard.YOUR-NAME.workers.dev`

카카오워크/메일 템플릿:

```
[차주용 PM] 임원 의견 보드 안내

▣ 대시보드: https://executive-dashboard.YOUR-NAME.workers.dev
▣ 접속 키: jy-2026-xY9z

처음 접속 시:
1) 우상단 ⚙️ 설정 클릭
2) "Dashboard Key" 위 키 붙여넣기 → 저장
   (한 번만 입력하면 다음부터 자동)

의견 작성 방법 — 슬랙 채널만 사용:
▶ #차주용-보고 채널에 자유롭게 글 작성 (이미지 드래그앤드롭 OK)
▶ 메시지에 이모지 반응으로 분류 표시:
   ❓ 질문 / 📋 요청 / ⚠️ 결정필요 / 👍 피드백
▶ 추가 의견은 thread 답글로 작성
▶ 처리 완료되면 PM이 ✅ 이모지로 표시 (자동 동기화)

대시보드는 슬랙 의견을 한 화면에서 보기 좋게 정리해놓은 것입니다.
직접 대시보드에 의견 작성도 가능하지만, 슬랙이 더 편하실 겁니다.
```

---

## 6. PM 작업 흐름 (운영 시)

### 임원이 슬랙에 글 올림
→ 5초 후 대시보드에 자동 등장
→ PM에게 슬랙 알림 (기본 슬랙 알림 설정 그대로)

### PM이 처리할 때

1. 대시보드에서 의견 확인 + 우선순위 판단
2. 처리할 항목 좌측 **체크박스** 선택 (여러 탭에 걸쳐 선택 가능)
3. 우상단 **🤖 Claude Code Inbox 생성** 클릭 → `inbox-YYYY-MM-DD.md` 다운로드

터미널에서:

```bash
cd ~/Interohrigin-hr   # 작업 대상 레포로 이동
mv ~/Downloads/inbox-2026-05-27.md ./inbox.md
claude code -p "@inbox.md 의 항목들을 우선순위 순으로 처리해줘. 각 항목마다 (1) 어느 파일 수정 (2) 변경 요약 (3) git diff. ⚠️결정필요는 사람 확인 후 진행."
```

### 완료 보고 (슬랙에서)

PM이 슬랙 메시지에 ✅ 이모지 반응 → 대시보드 자동 "해결됨" 표시 → 임원이 슬랙 채널에서도 ✅ 확인 가능.

선택: thread에 "완료" 답글 추가 → 다른 임원에게 통보.

---

## 7. 문제 해결

### Event URL Verification 실패
- Worker 헬스 확인: `curl https://YOUR-WORKER.workers.dev/health`
- Secrets 확인: `npx wrangler secret list`

### "서버 미연결" 표시
- 우상단 ⚙️ 설정 → **Dashboard Key** 입력 확인 (PM이 설정한 키와 일치 여부)

### 이미지가 깨짐
- 봇이 채널에 들어가 있는지 (`/invite @봇이름`)
- `files:read` scope 추가 후 reinstall

### 슬랙 메시지가 대시보드에 안 보임
- `npx wrangler tail` 로 실시간 로그 확인
- `wrangler.toml`의 `SLACK_CHANNEL_ID` 가 실제 채널 ID와 일치하는지 확인 (현재 `C0B6FK9BCE5`)
- Event Subscriptions에 `message.channels` 추가 + reinstall 확인

### 이모지 반응이 동기화 안 됨
- `reaction_added` / `reaction_removed` Event 구독 추가 + reinstall

---

## 8. 비용 한도

| 서비스 | 무료 한도 | 예상 사용 |
|------|------|------|
| Cloudflare Workers | 10만 req/일 | ~1,000 req/일 |
| Cloudflare KV | 1,000 write/일 | ~50 write/일 |
| Cloudflare R2 | 10GB 저장 | 이미지 100MB |
| Slack Free Plan | 메시지 무제한 | — |

→ **월 $0**

---

## 다음 단계 (선택 확장)

- **Anthropic API 자동 분류** — 의견 → 어느 레포/파일 수정 추정 (월 ~$0.1)
- **GitHub Issue 자동 등록** — 분류된 의견 → 레포 이슈
- **Claude Code 자동 실행** — `/cc-do <id>` 슬랙 슬래시 커맨드 → 헤드리스 실행 + PR 자동
