export interface FormattedSubject {
  /** The email is a reply (subject started with "RE_", "RE:", "FW:" ...). */
  isReply: boolean;
  /** The readable part of the subject: descriptive segments joined with a dot. */
  title: string;
  /** Individual descriptive segments of the subject for clean rendering. */
  segments: string[];
  /** Short identifiers (booking, bill of lading, invoice numbers) to show as chips. */
  references: string[];
}

const REPLY_PREFIX = /^\s*(?:re|fw|fwd)\s*[_:]\s*/i;
// Subjects separate their parts with " - " or " _ ", and sometimes glue a dash to a number: "INVOICE -5250071780".
const SEGMENT_SEPARATOR = /\s+[-_]+\s+|\s+-(?=\d)/;
// One word with a digit in it, e.g. 5RUS-81876, 5250079208, MSC(MEDUUD646871).
const REFERENCE = /^(?=.*\d)\S{4,24}$/;

/** "HOCHIMINH CITY_VIETNAM" -> "HOCHIMINH CITY, VIETNAM"; other underscores become spaces. */
function tidy(segment: string): string {
  return segment
    .replace(/(\p{L})_(?=\p{L})/gu, "$1, ")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Turn a raw shipping email subject into a title plus reference chips. Wording and casing are kept
 * as they are, since company and port names must not be altered; only the layout changes.
 */
export function formatSubject(subject: string | undefined): FormattedSubject {
  const raw = (subject || "").trim();
  if (!raw) return { isReply: false, title: "(no subject)", segments: [], references: [] };

  const isReply = REPLY_PREFIX.test(raw);
  const body = raw.replace(REPLY_PREFIX, "");

  const words: string[] = [];
  const references: string[] = [];
  for (const segment of body.split(SEGMENT_SEPARATOR)) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    if (REFERENCE.test(trimmed)) {
      // A date written 07_01_2026 reads better as 07/01/2026; other identifiers stay exactly as sent.
      const reference = trimmed.replace(/^(\d{2})_(\d{2})_(\d{4})$/, "$1/$2/$3");
      if (!references.includes(reference)) references.push(reference);
    } else {
      const cleaned = tidy(trimmed);
      if (cleaned) words.push(cleaned);
    }
  }

  // Nothing descriptive left (a subject that is only reference numbers): keep it readable as it was.
  if (words.length === 0) {
    const fallbackTitle = tidy(body) || raw;
    return { isReply, title: fallbackTitle, segments: [fallbackTitle], references: [] };
  }
  return { isReply, title: words.join(" · "), segments: words, references };
}
