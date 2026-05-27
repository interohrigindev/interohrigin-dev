/**
 * Claude Code Inbox 생성
 * - PM이 선택한 의견들을 정리된 Markdown으로 변환
 * - PM은 이 파일을 Claude Code에 던지면 바로 작업 시작 가능
 */

import type { Message } from "./storage";

const PANEL_NAMES: Record<string, string> = {
  overview:  "🏠 종합 현황",
  hr:        "👥 HR 플랫폼",
  cs:        "🎧 CS 플랫폼",
  finance:   "💰 재무관리",
  ophe:      "🌿 OPHE",
  "ai-design": "🎨 AI 디자인",
  boomzap:   "💧 붐앤잽",
  completed: "✅ 완료 프로젝트",
  cost:      "💵 과금 구조",
  future:    "🚀 향후 계획",
};

const PANEL_REPO_HINT: Record<string, string> = {
  hr:        "Interohrigin-hr (React + Vite + Supabase)",
  cs:        "(예정) interohrigin-cs",
  finance:   "io-finance (Cloudflare Pages)",
  ophe:      "ophe (Next.js + Cafe24 핸드오프)",
  "ai-design": "AI Design Agent (Next.js + Vercel)",
  boomzap:   "boomnzap (Cloudflare Workers + D1)",
  completed: "(레퍼런스: 완료된 프로젝트들의 후속 보강)",
};

const CAT_LABEL: Record<string, string> = {
  question: "❓ 질문",
  request:  "📋 요청",
  decision: "⚠️ 결정필요",
  feedback: "👍 피드백",
};

export function buildInbox(messages: Array<Message & { panel: string }>): string {
  const now = new Date().toLocaleString("ko-KR");
  let md = `# Claude Code Inbox — 인터오리진 임원 의견 작업 지시\n\n`;
  md += `> 생성: ${now} · 의견 ${messages.length}건 · PM 차주용\n\n`;
  md += `## 사용법\n\n`;
  md += `이 파일을 Claude Code에 던지세요:\n\n`;
  md += `\`\`\`bash\nclaude code -p "@inbox-YYYY-MM-DD.md 의 항목들을 우선순위 순서대로 처리해줘. 각 항목마다 (1) 어느 레포의 어느 파일을 수정할지 추정 (2) 변경 사항 요약 (3) 실제 코드 변경 후 git diff 보여주기. 결정필요는 사람 확인 후 진행."\n\`\`\`\n\n`;
  md += `---\n\n`;

  // 우선순위: decision > request > question > feedback
  const order = ["decision", "request", "question", "feedback"];
  const grouped: Record<string, typeof messages> = {};
  for (const cat of order) grouped[cat] = [];
  for (const m of messages) {
    if (grouped[m.category]) grouped[m.category].push(m);
    else (grouped.question = grouped.question || []).push(m);
  }

  for (const cat of order) {
    const items = grouped[cat];
    if (!items || items.length === 0) continue;
    md += `## ${CAT_LABEL[cat]} (${items.length}건)\n\n`;
    items.forEach((m, i) => {
      const panelName = PANEL_NAMES[m.panel] || m.panel;
      const repoHint = PANEL_REPO_HINT[m.panel];
      md += `### ${i + 1}. ${panelName} — ${m.title || m.content.split("\n")[0].slice(0, 50)}\n\n`;
      md += `- **작성자**: ${m.author}\n`;
      md += `- **작성 시각**: ${m.at}\n`;
      if (repoHint) md += `- **관련 레포**: ${repoHint}\n`;
      if (m.fromSlack) md += `- **출처**: 슬랙 채널 (Slack ts: \`${m.slackTs}\`)\n`;
      if (m.resolved)  md += `- **상태**: ✓ 해결됨\n`;
      md += `\n**내용:**\n\n`;
      md += "```\n" + m.content + "\n```\n\n";
      if (m.images && m.images.length > 0) {
        md += `**첨부 이미지 (${m.images.length}건)**: ${m.images.map(u => `\`${u}\``).join(", ")}\n\n`;
      }
      if (m.replies && m.replies.length > 0) {
        md += `**답글:**\n\n`;
        m.replies.forEach(r => { md += `> **${r.author}** (${r.at}): ${r.content}\n\n`; });
      }
      md += `---\n\n`;
    });
  }

  md += `## 작업 가이드 (Claude Code용)\n\n`;
  md += `1. **⚠️ 결정필요** 항목은 코드 수정 전에 PM에게 다시 확인 — 자동 진행 금지\n`;
  md += `2. **📋 요청**은 가능한 한 작은 PR 단위로 쪼개기 (1 요청 = 1 PR)\n`;
  md += `3. **❓ 질문**은 코드 변경 없이 README/주석/문서로만 답변 후 종료\n`;
  md += `4. **👍 피드백**은 commit log/CHANGELOG에 반영 후 종료\n`;
  md += `5. 모든 변경은 \`git commit\` 후 \`git push\`로 PR 생성 — 직접 main 머지 금지\n`;
  md += `6. 작업 완료 후 결과를 슬랙 채널 \`#차주용-보고\` 에 자동 알림 (Webhook URL은 환경변수)\n\n`;
  md += `## 참고 — 인터오리진 시스템 구조\n\n`;
  md += `- HR · CS · 복지몰 · 재무관리 = 단일 Supabase Pro 공유 (project ref \`ckzbzumycmgkcpyhlclb\`)\n`;
  md += `- OPHE = Next.js + Cafe24 핸드오프 (커머스 로직은 Cafe24 위임)\n`;
  md += `- 붐앤잽 = Cloudflare Workers + D1 + 멀티 AI (Gemini 무료 라우터 기본)\n`;
  md += `- AI Design = Vercel + Anthropic/OpenAI/Google/OpenRouter\n`;
  return md;
}
