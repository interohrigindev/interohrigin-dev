# 인터오리진 임원 대시보드 (Executive Dashboard)

> 차주용 PM 담당 9개 프로젝트의 종합 현황을 임원진과 공유하고, 슬랙 채널의 의견·이미지를 자동으로 끌어와 Claude Code 작업 지시서로 변환하는 시스템.

## 핵심 아키텍처

```
[임원/PM] ─── 슬랙 채널에 글·이미지 첨부 ───┐
                                              ▼
                              Slack Events API (webhook)
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      │       Cloudflare Worker (무료 한도)            │
                      │  - signing secret 검증                         │
                      │  - 이미지 다운 → R2 업로드                     │
                      │  - KV에 메시지/카테고리/답글 저장              │
                      │  - 이모지 반응 ❓📋⚠️👍 → 카테고리 자동 분류  │
                      └───────────────────────┬───────────────────────┘
                                              │
                  ┌───────────────────────────┴────────────────────────┐
                  ▼                                                    ▼
        [대시보드] (모두 같은 화면)                    [Claude Code Inbox]
        - 5초 폴링으로 실시간 갱신                       - PM이 선택 → inbox.md 다운로드
        - 슬랙 이미지 인라인 표시                        - `claude code -p "@inbox.md"` 한 줄
        - 답글·해결 표시·카테고리 전환                   - Claude가 PR 자동 생성
```

## 디렉토리 구조

```
executive-dashboard/
├── README.md           — 이 파일
├── docs/
│   └── SETUP.md        — Slack App + Cloudflare 셋업 단계별 가이드
├── public/
│   └── index.html      — 대시보드 (Cloudflare Workers Assets로 서빙)
└── worker/
    ├── wrangler.toml   — Cloudflare 설정
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts    — 메인 엔트리 (라우팅)
        ├── slack.ts    — Slack Events API 처리
        ├── storage.ts  — KV 메시지 저장 레이어
        └── claude.ts   — Claude Code Inbox 생성
```

## 빠른 시작

자세한 셋업은 [docs/SETUP.md](docs/SETUP.md) 참조. 큰 흐름만:

1. **Slack 워크스페이스에 App 생성** — Bot Token + Signing Secret 발급
2. **Cloudflare 계정에서 Worker 배포** — `cd worker && npx wrangler deploy`
3. **Secrets 설정** — `wrangler secret put SLACK_*`
4. **Slack App의 Event Subscriptions URL** → `https://your-worker.workers.dev/slack/events`
5. **임원에게 URL + Dashboard Key 공유** — 슬랙 채널에 글 올리면 자동으로 대시보드에 등장

## 운영 흐름

| 역할 | 동작 |
|------|------|
| **임원** | 슬랙 채널 `#차주용-보고`에 글 작성 (이미지 첨부 가능) → 이모지 반응으로 분류 (❓/📋/⚠️/👍) |
| **PM (차주용)** | 대시보드에서 실시간 모니터링 → 처리할 의견 체크 → "🤖 Claude Code Inbox 생성" → `inbox-YYYY-MM-DD.md` 다운로드 → `claude code -p "@inbox.md"` |
| **Claude Code** | Inbox 파일 받아서 우선순위 순으로 처리 → 결과 PR 생성 |

## 비용

| 서비스 | 사용량 | 비용 |
|------|------|------|
| Cloudflare Workers | 1000 req/일 (한도 10만) | $0 |
| Cloudflare KV | 의견 100건/월 (한도 1천 write/일) | $0 |
| Cloudflare R2 | 이미지 100MB (한도 10GB) | $0 |
| Slack Free Plan | 메시지 무제한 | $0 |
| **합계** | | **$0 / 월** |

## 라이선스

내부 사용 전용 (인터오리진).
