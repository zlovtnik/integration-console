import { describe, expect, it } from 'vitest';
import { syntaxHighlight } from '~/utils/syntaxHighlight';

describe('syntaxHighlight', () => {
  it('escapes server-controlled JSON before injecting highlight markup', () => {
    const highlighted = syntaxHighlight(
      JSON.stringify({
        tag: '<img src=x onerror=alert(1)>',
        script: '<script>alert(1)</script>',
        text: '"quoted" & \'single\'',
      }),
    );

    expect(highlighted).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(highlighted).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(highlighted).toContain(
      '\\&quot;quoted\\&quot; &amp; &#39;single&#39;',
    );
    expect(highlighted).not.toContain('<img');
    expect(highlighted).not.toContain('<script>');
    expect(highlighted).toContain('<span class="json-key">');
  });
});
