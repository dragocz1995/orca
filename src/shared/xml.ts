/** Escape a string for safe embedding in XML text or double/single-quoted attribute values, using the
 *  five predefined XML entities. Shared by the daemon-side turn context/result builders so the escaping
 *  rule lives in one place. Plugins keep their own local copy — they import only packaged deps, never
 *  daemon sources. */
export const xmlEscape = (value: string): string => value
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
