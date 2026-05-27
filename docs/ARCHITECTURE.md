# 아키텍처

## 컴포넌트

### 1. Cloudflare Worker (`worker/`)

**역할**: API 게이트웨이 + Slack Events 수신 + 데이터 저장 조율

**엔드포인트**:

| Method | Path | 역할 |
|--------|------|------|
| POST | `/slack/events` | Slack Events API webhook (서명 검증 후 KV/R2 저장) |
| GET  | `/api/messages?panel=hr` | 패널별 메시지 목록 (대시보드 폴링) |
| POST | `/api/messages` | 대시보드에서 의견 작성 |
| PATCH | `/api/messages/:id?panel=hr` | 답글·해결 표시 등 부분 업데이트 |
| DELETE | `/api/messages/:id?panel=hr` | 의견 삭제 |
| POST | `/api/inbox` | 선택된 의견 → Claude Code Inbox `.md` 다운로드 |
| GET | `/img/:key` | R2 이미지 프록시 (캐싱) |
| GET | `/health` | 헬스 체크 |
| `*` | `/*` | 정적 자산 (대시보드 HTML) — Workers Assets binding |

**보안**:
- Slack 요청: `X-Slack-Signature` HMAC-SHA256 검증 + 5분 timestamp window
- 대시보드 요청: `X-Dashboard-Key` 헤더 (단순 공유 키, 임원 9명 분의 작은 그룹용)

### 2. KV 저장소 (`MESSAGES`)

**키 패턴**: `panel:{overview|hr|cs|finance|ophe|ai-design|boomzap|completed|cost|future}`

**값**: 해당 패널의 메시지 배열 (JSON)

```json
[{
  "id": "ts:1716800000.123456",
  "category": "decision",
  "author": "차대표",
  "title": "6/9 베타 임원 보고 일정",
  "content": "베타 다음 날 오후로 잡아주세요.",
  "at": "2026-05-27 11:30",
  "_ts": 1716800000123,
  "replies": [{"author":"차주용","content":"네 6/10 오후 2시로 예약 완료","at":"2026-05-27 11:45"}],
  "resolved": false,
  "slackTs": "1716800000.123456",
  "slackChannel": "C12345",
  "images": ["/img/F12345.png"],
  "fromSlack": true
}]
```

### 3. R2 저장소 (`IMAGES`)

**키 패턴**: `{slack_file_id}.{ext}` (예: `F08X9Y2K.png`)

**용도**: 슬랙 첨부 이미지를 Bot Token으로 다운로드 후 영구 보관 (Slack은 private URL이라 외부 노출 불가).

Worker가 `/img/:key`로 프록시하면서 적절한 `Content-Type`과 `Cache-Control` 부여.

### 4. 대시보드 (`public/index.html`)

**구조**: 단일 HTML (외부 의존 0개)
- `STATE.discussions` — 서버 fetch 결과 (localStorage 아님)
- `STATE.settings` — 백엔드 URL, Dashboard Key, 작성자 (개인 PC만)
- 5초마다 현재 패널 polling
- 패널 전환 시 즉시 fetch

## 데이터 흐름

### A. 슬랙 → 대시보드 (수신)

```
1. 임원이 슬랙 채널에 메시지 + 이미지 첨부
2. Slack Events API → POST /slack/events
3. Worker:
   a. X-Slack-Signature 검증
   b. event.type 분기:
      - "message" → 작성자 이름 조회 → 이미지 다운로드 → R2 업로드 → KV append
      - "message_changed" → KV 업데이트
      - "message_deleted" → KV 삭제
      - "reaction_added" → 이모지 → 카테고리 매핑 → KV 패치
4. 대시보드 polling (5초) → GET /api/messages?panel=X → 화면 갱신
```

### B. 대시보드 → Slack (선택, 미러링)

```
1. 임원이 대시보드 폼에서 작성 → POST /api/messages
2. (선택) 슬랙 Webhook URL 설정 시 → fetch POST to Slack webhook
3. 다른 임원의 대시보드 → 5초 polling → 새 메시지 표시
```

### C. Claude Code Inbox 생성

```
1. PM이 의견들 체크박스 선택
2. "🤖 Claude Code Inbox 생성" 버튼 → POST /api/inbox { panels, ids }
3. Worker가 메시지를 우선순위 (decision > request > question > feedback) 정렬
4. Markdown 생성 → Content-Disposition: attachment 응답
5. 브라우저가 inbox-YYYY-MM-DD.md 다운로드
6. PM이 `claude code -p "@inbox.md"` 실행
```

## 확장 계획 (Phase 2+)

| 단계 | 기능 | 추가 작업 |
|------|------|------|
| 5단계 | Anthropic API 분류 | Worker에 Claude API 호출 추가 (의견 → 레포/파일 추정) |
| 6단계 | GitHub Issue 자동 등록 | `GITHUB_TOKEN` secret + 분류된 의견 → 해당 레포 이슈 |
| 7단계 | Slack 슬래시 커맨드 | `/cc-do <id>` → Worker가 GitHub Actions trigger → Claude Code headless 실행 |
| 8단계 | 부서별 알림 | 패널별 슬랙 채널 분리 + 멘션 |

## 제약 사항

- Cloudflare KV는 eventual consistency — 다른 region에서 60초 이내 동기화
- Slack Events API는 3초 안에 200 응답 필수 (현재 비동기 작업은 `event.waitUntil` 활용 가능)
- R2의 무료 한도 10GB — 이미지 약 1만 장
- Dashboard Key는 단순 공유 키 (강력한 인증 필요 시 Cloudflare Access 도입)
