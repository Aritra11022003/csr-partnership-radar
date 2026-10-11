/** G6: regex pre-scan for prompt-injection attempts in article text. Article text is data, never instructions. */
const PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(all\s+|the\s+)?(previous|prior|above|system)\s+(instructions?|prompts?|rules?)/i,
  /forget\s+(all\s+|your\s+)?(previous\s+)?instructions/i,
  /\byou\s+are\s+now\s+(a|an|the)\b/i,
  /\b(system|developer)\s*prompt\b/i,
  /\bmark\s+(this|it)\s+as\s+(partner_search|new_initiative|allocation_up|policy|call|relevant)/i,
  /\b(set|give|assign)\s+(the\s+)?(verdict|confidence|score)\s+(to|of|=)/i,
  /\bverdict\s*[:=]?\s*call\b/i,
  /\bconfidence\s*(of\s*)?1(\.0+)?\b/i,
  /<\/?\s*(system|instructions?|prompt)\s*>/i,
];

export function detectInjection(text: string): boolean {
  return PATTERNS.some((p) => p.test(text));
}
