import { describe, it, expect } from 'vitest';
import { parseQuickAddSyntax, resolveDateToken, sourceKind } from '../../client/utils/taskUtils.ts';

const thursday = new Date(2026, 9, 22); // Thu 22 Oct 2026
const monday = new Date(2026, 9, 19); // Mon 19 Oct 2026

describe('quick-add dates', () => {
  it('resolves relative words', () => {
    expect(resolveDateToken('today', thursday)).toBe('2026-10-22');
    expect(resolveDateToken('Tomorrow', thursday)).toBe('2026-10-23');
    expect(resolveDateToken('tmrw', thursday)).toBe('2026-10-23');
    expect(resolveDateToken('+3d', thursday)).toBe('2026-10-25');
    expect(resolveDateToken('+2w', thursday)).toBe('2026-11-05');
    expect(resolveDateToken('+1m', thursday)).toBe('2026-11-22');
    expect(resolveDateToken('eom', thursday)).toBe('2026-10-31');
  });

  it('resolves weekdays to the next occurrence strictly after today', () => {
    expect(resolveDateToken('fri', thursday)).toBe('2026-10-23');
    expect(resolveDateToken('thursday', thursday)).toBe('2026-10-29'); // same weekday: next week
    expect(resolveDateToken('mon', thursday)).toBe('2026-10-26');
    expect(resolveDateToken('mon', monday)).toBe('2026-10-26');
    expect(resolveDateToken('next-week', thursday)).toBe('2026-10-26');
    expect(resolveDateToken('next-week', monday)).toBe('2026-10-26');
    expect(resolveDateToken('SUN', thursday)).toBe('2026-10-25');
  });

  it('clamps month arithmetic and crosses years', () => {
    expect(resolveDateToken('+1m', new Date(2026, 0, 31))).toBe('2026-02-28');
    expect(resolveDateToken('+1m', new Date(2028, 0, 31))).toBe('2028-02-29'); // leap year
    expect(resolveDateToken('+2m', new Date(2026, 11, 15))).toBe('2027-02-15');
    expect(resolveDateToken('eom', new Date(2028, 1, 10))).toBe('2028-02-29');
    expect(resolveDateToken('+1d', new Date(2026, 11, 31))).toBe('2027-01-01');
  });

  it('accepts real ISO dates only and ignores other words', () => {
    expect(resolveDateToken('2026-11-01', thursday)).toBe('2026-11-01');
    expect(resolveDateToken('2026-02-31', thursday)).toBeNull();
    expect(resolveDateToken('john', thursday)).toBeNull();
    expect(resolveDateToken('+0x', thursday)).toBeNull();
  });

  it('parses tokens out of the title and keeps unknown @words', () => {
    const defaults = { priority: 0 as const, projectId: null, dueDate: null, tags: [] };
    const parsed = parseQuickAddSyntax('Email @john about invoice @fri !high', [], defaults, thursday);
    expect(parsed.title).toBe('Email @john about invoice');
    expect(parsed.dueDate).toBe('2026-10-23');
    expect(parsed.priority).toBe(3);

    const repeating = parseQuickAddSyntax('Pay rent ~monthly @eom ~nope', [], defaults, thursday);
    expect(repeating.title).toBe('Pay rent ~nope');
    expect(repeating.recurrence).toEqual({ every: 1, unit: 'month', from: 'due' });
    expect(repeating.dueDate).toBe('2026-10-31');
    expect(parseQuickAddSyntax('Stretch ~2w!', [], defaults, thursday).recurrence).toEqual({
      every: 2,
      unit: 'week',
      from: 'completion',
    });

    // Only tokens: fall back to the raw text as the title
    expect(parseQuickAddSyntax('@today', [], defaults, thursday).title).toBe('@today');
  });
});

describe('source links', () => {
  const defaults = { priority: 0 as const, projectId: null, dueDate: null, tags: [] };

  it('takes https links out of the title as sources', () => {
    const slack = 'https://acme.slack.com/archives/C1/p1';
    const parsed = parseQuickAddSyntax(`Reply to Sam ${slack} ${slack} http://plain.example.com`, [], defaults, thursday);
    expect(parsed.title).toBe('Reply to Sam http://plain.example.com');
    expect(parsed.sourceUrls).toEqual([slack]);
    // A bare link keeps the link as the title
    expect(parseQuickAddSyntax(slack, [], defaults, thursday)).toMatchObject({ title: slack, sourceUrls: [slack] });
  });

  it('infers the kind from the host', () => {
    expect(sourceKind('https://acme.slack.com/archives/C1')).toBe('Slack');
    expect(sourceKind('https://teams.microsoft.com/l/message/1')).toBe('Teams');
    expect(sourceKind('https://outlook.office365.com/mail/1')).toBe('Email');
    expect(sourceKind('https://mail.google.com/mail/u/0')).toBe('Email');
    expect(sourceKind('https://notslack.com/x')).toBe('Link');
    expect(sourceKind('https://example.com/slack.com')).toBe('Link');
  });
});
