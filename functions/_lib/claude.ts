/** Claude Code Inbox 생성 */

const PANEL_NAMES: Record<string, string> = {
  overview: "🏠 종합 현황", hr: "👥 HR 플랫폼", cs: "🎧 CS 플랫폼", finance: "💰 재무관리",
  ophe: "🌿 OPHE", "ai-design": "🎨 AI 디자인", boomzap: "💧 붐앤잽",
  completed: "✅ 완료 프로젝트", cost: "💵 과금 구조", future: "🚀 향후 계획",
};
const PANEL_REPO_HINT: Record<string, string> = {
  hr: "Interohrigin-hr", cs: "(예정) interohrigin-cs", finance: "io-finance",
  ophe: "ophe", "ai-design": "AI Design Agent", boomzap: "boomnzap",
};
const CAT_LABEL: Record<string, string> = {
  question: "❓ 질문", request: "📋 요청", decision: "⚠️ 결정필요", feedback: "👍 피드백",
};

export function buildInbox(messages: any[]): string {
  const now = new Date().toLocaleString("ko-KR");
  let md = `# Claude Code Inbox — 인터오리진 임원 의견 작업 지시\n\n`;
  md += `> 생성: ${now} · 의견 ${messages.length}건 · PM 차주용\n\n`;
  md += `## 사용법\n\n\`\`\`bash\nclaude code -p "@inbox.md 의 항목들을 우선순위 순으로 처리해줘. 각 항목마다 (1) 어느 레포의 어느 파일을 수정할지 추정 (2) 변경 사항 요약 (3) 실제 코드 변경 후 git diff. 결정필요는 사람 확인 후 진행."\n\`\`\`\n\n---\n\n`;

  const order = ["decision", "request", "question", "feedback"];
  const grouped: Record<string, any[]> = {};
  for (const c of order) grouped[c] = [];
  for (const m of messages) (grouped[m.category] || (grouped.question = grouped.question || [])).push(m);

  for (const cat of order) {
    const items = grouped[cat];
    if (!items?.length) continue;
    md += `## ${CAT_LABEL[cat]} (${items.length}건)\n\n`;
    items.forEach((m, i) => {
      const panelName = PANEL_NAMES[m.panel] || m.panel;
      const repoHint = PANEL_REPO_HINT[m.panel];
      md += `### ${i + 1}. ${panelName} — ${m.title || m.content.split("\n")[0].slice(0, 50)}\n\n`;
      md += `- **작성자**: ${m.author}\n- **시각**: ${m.at}\n`;
      if (repoHint) md += `- **관련 레포**: ${repoHint}\n`;
      if (m.fromSlack) md += `- **출처**: 슬랙 (ts: \`${m.slackTs}\`)\n`;
      if (m.resolved) md += `- **상태**: ✓ 해결됨\n`;
      md += `\n**내용:**\n\n\`\`\`\n${m.content}\n\`\`\`\n\n`;
      if (m.imageRefs?.length) md += `**첨부 이미지 ${m.imageRefs.length}건**: 슬랙 메시지에서 확인 (${m.slackTs})\n\n`;
      if (m.replies?.length) {
        md += `**답글:**\n\n`;
        m.replies.forEach((r: any) => { md += `> **${r.author}** (${r.at}): ${r.content}\n\n`; });
      }
      md += `---\n\n`;
    });
  }

  md += `## 작업 가이드\n\n`;
  md += `1. ⚠️ 결정필요는 PM 확인 후 진행 — 자동 진행 금지\n`;
  md += `2. 📋 요청은 1요청 = 1PR로 쪼개기\n`;
  md += `3. ❓ 질문은 코드 변경 없이 문서 답변\n`;
  md += `4. 👍 피드백은 CHANGELOG에 반영\n`;
  md += `5. main 직접 머지 금지 — 항상 PR 경유\n`;
  return md;
}
