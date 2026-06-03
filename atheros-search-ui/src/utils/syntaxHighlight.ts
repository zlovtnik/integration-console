const TOKEN_PATTERN =
  /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function syntaxHighlight(json: string): string {
  let highlighted = '';
  let lastIndex = 0;

  json.replace(TOKEN_PATTERN, (match, ...args) => {
    const offset = args[args.length - 2] as number;
    highlighted += escapeHtml(json.slice(lastIndex, offset));

    let cls = 'json-num';
    if (/^"/.test(match)) cls = /:$/.test(match) ? 'json-key' : 'json-str';
    else if (/true|false/.test(match)) cls = 'json-bool';
    else if (/null/.test(match)) cls = 'json-null';

    highlighted += `<span class="${cls}">${escapeHtml(match)}</span>`;
    lastIndex = offset + match.length;
    return match;
  });

  return highlighted + escapeHtml(json.slice(lastIndex));
}
