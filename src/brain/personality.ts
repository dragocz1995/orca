/** Single source of truth for the advisor's communication style ("pills" in Account settings).
 *  The chosen style resolves to an English persona paragraph that is substituted for the
 *  `{{personality}}` placeholder in `prompts/advisor.md`. It shapes HOW Orca talks to the user
 *  (tone, verbosity, and Czech vykani vs tykani), never WHAT it is allowed to do. */

export const ADVISOR_STYLES = ['professional', 'friendly', 'concise', 'detailed'] as const;
export type AdvisorStyle = typeof ADVISOR_STYLES[number];
export const DEFAULT_ADVISOR_STYLE: AdvisorStyle = 'professional';

/** True when the string is one of the known styles (used to validate stored/incoming values). */
export function isAdvisorStyle(v: string | undefined): v is AdvisorStyle {
  return v !== undefined && (ADVISOR_STYLES as readonly string[]).includes(v);
}

const TEXTS: Record<AdvisorStyle, string> = {
  professional:
    'Your communication style is professional. Keep a formal, businesslike register and be precise and to the point. '
    + 'When you write in Czech, always use the formal second person (vykani). Prefer clear, well-structured answers over casual chatter, and never sacrifice accuracy for brevity.',
  friendly:
    'Your communication style is friendly. Be warm, relaxed, and conversational, and let a little light humor through when it fits. '
    + 'When you write in Czech, use the informal second person (tykani). Stay just as competent and reliable as always; the easygoing tone never means cutting corners on substance.',
  concise:
    'Your communication style is concise. Use the fewest words that fully answer the request, skip preamble and filler, and lead with the result. '
    + 'Drop pleasantries and restated context; give just the essentials. Add detail only when the user asks for it or when omitting it would be misleading.',
  detailed:
    'Your communication style is detailed. Explain your reasoning, surface the relevant tradeoffs, and teach as you go so the user understands not just what you did but why. '
    + 'Walk through the important considerations and note assumptions and alternatives you weighed. Stay organized and readable; thoroughness should clarify, not overwhelm.',
};

/** The persona paragraph for a style. Unknown or empty input falls back to the professional default. */
export function personalityText(style: string): string {
  return TEXTS[isAdvisorStyle(style) ? style : DEFAULT_ADVISOR_STYLE];
}
