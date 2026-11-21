// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader): run(input) returns
// exactly what csv-reader returns for {text, header}: {columns, rows, errors}.
//
// The reference reads one character at a time and builds every field up a character
// at a time. This module reads the same text once, left to right, with the same
// broken-row policy, but jumps between the characters that matter instead of
// stepping through the rest: indexOf finds the next comma or line break of an
// unquoted field and the next quote of a quoted one, and the text between two such
// characters is taken as one slice. Nothing is cached from one call to the next;
// every call answers its own input alone.
//
// This revision drops the regex scans: an unquoted field's terminator is the nearer
// of the next comma and the next LF (found with indexOf), and the slice between the
// field's start and its terminator is the field's value, checked for a stray CR on
// the small slice itself; a quoted field's closing quote is the next quote that is
// not doubled (found with indexOf), and a quoted field with no doubled quote and
// no CR inside is one slice. Each field's result is written into shared locals, so
// no object is allocated per field.
//
// Policy (csv-reader 1.0.0's, kept exactly):
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it one quote and each CRLF or lone CR inside it read as LF; what
//     follows its closing quote, up to the next comma or line break, is appended
//     as it stands (quote_junk, when the field ends); a quote that never closes
//     is a literal character, and the text after it is read again as unquoted
//     (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it (every record when header is false), each padded with ""
//     (short_row, with fields: its field count) or cut (long_row, with extra:
//     the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met: line the 1-based line
//     its record starts on, counting every LF, CRLF and lone CR inside quotes,
//     and row its record's index in rows, null for the header.

/** How a field ended: at a comma (the record goes on), at a line break or at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input, {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended, and how many characters an
  // unquoted read kept (for quote_junk). Shared locals, so no object per field.
  let fv = '';
  let fe = END;
  let fa = 0;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF is dropped
  // (stray_cr). Sets fv/fe/fa. The field ends at the nearer of the next comma and the next LF; any CR inside the
  // slice up to there is a stray one (a CR right before that LF is the CRLF that ends the field instead).
  function readUnquoted(value) {
    const comma = text.indexOf(',', pos);
    const lf = text.indexOf('\n', pos);
    let end;
    let isComma;
    if (comma !== -1 && (lf === -1 || comma < lf)) {
      end = comma;
      isComma = true;
    } else if (lf !== -1) {
      end = lf;
      isComma = false;
    } else {
      end = len;
      isComma = false;
    }
    // A CR right before the LF is the CRLF ending the field, not part of it.
    let sliceEnd = end;
    if (!isComma && end === lf && end > pos && text.charCodeAt(end - 1) === 13) sliceEnd = end - 1;
    let chunk = sliceEnd > pos ? text.slice(pos, sliceEnd) : '';
    let added = 0;
    if (chunk.indexOf('\r') !== -1) {
      // Stray CRs inside the field: one error each, dropped, the field goes on to its terminator.
      let from = 0;
      for (;;) {
        const r = chunk.indexOf('\r', from);
        if (r === -1) break;
        error('stray_cr');
        value += chunk.slice(from, r);
        added += r - from;
        from = r + 1;
      }
      value += chunk.slice(from);
      added += chunk.length - from;
    } else {
      value += chunk;
      added += chunk.length;
    }
    fv = value;
    fa = added;
    if (isComma) {
      pos = end + 1;
      fe = COMMA;
      return;
    }
    if (end === len) {
      pos = len;
      fe = END;
      return;
    }
    pos = end + 1;
    line += 1;
    fe = LINE_BREAK;
  }

  // Counts the line breaks in `s`: every LF and every CR, a CRLF counting once.
  function countBreaks(s) {
    let n = 0;
    let i = -1;
    for (;;) {
      const cr = s.indexOf('\r', i + 1);
      const lf = s.indexOf('\n', i + 1);
      if (cr === -1 && lf === -1) return n;
      if (cr !== -1 && (lf === -1 || cr < lf)) {
        n += 1;
        i = s.charCodeAt(cr + 1) === 10 ? cr + 1 : cr;
      } else {
        n += 1;
        i = lf;
      }
    }
  }

  // Appends the quoted segment text[a, b) onto `parts`, reading each CRLF or lone CR inside it as one LF.
  function addSegment(parts, a, b) {
    if (b <= a) return;
    const seg = text.slice(a, b);
    if (seg.indexOf('\r') === -1) {
      if (seg.indexOf('\n') !== -1) line += countBreaks(seg);
      parts.push(seg);
      return;
    }
    line += countBreaks(seg);
    parts.push(seg.replace(/\r\n?/g, '\n'));
  }

  // Reads a quoted field whose opening quote is at pos. Sets fv/fe.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value;
    const q = text.indexOf('"', pos + 1);
    if (q === -1) {
      // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      readUnquoted('"');
      return;
    }
    if (text.charCodeAt(q + 1) !== 34) {
      // The first quote found closes the field: one slice, unless a CR inside it needs reading as LF.
      const seg = text.slice(pos + 1, q);
      if (seg.indexOf('\r') === -1) {
        if (seg.indexOf('\n') !== -1) line += countBreaks(seg);
        value = seg;
      } else {
        line += countBreaks(seg);
        value = seg.replace(/\r\n?/g, '\n');
      }
      pos = q + 1;
    } else {
      // A doubled quote (or a CR) forces the piece-by-piece path.
      const parts = [];
      let segStart = pos + 1;
      let cur = pos + 1;
      for (;;) {
        const qq = text.indexOf('"', cur);
        if (qq === -1) {
          pos = open + 1;
          line = openLine;
          error('unterminated_quote');
          readUnquoted('"');
          return;
        }
        if (text.charCodeAt(qq + 1) === 34) {
          addSegment(parts, segStart, qq);
          parts.push('"');
          cur = qq + 2;
          segStart = qq + 2;
          continue;
        }
        addSegment(parts, segStart, qq);
        value = parts.join('');
        pos = qq + 1;
        break;
      }
    }
    if (pos >= len) {
      fv = value;
      fe = END;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fv = value;
      fe = COMMA;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fv = value;
      fe = LINE_BREAK;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fv = value;
      fe = LINE_BREAK;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    readUnquoted(value);
    if (fa > 0) error('quote_junk');
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(fv);
    } while (fe === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
