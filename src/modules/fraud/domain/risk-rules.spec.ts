import { assessEngagement } from './risk-rules';

describe('assessEngagement', () => {
  it('flags more interactions than views as HIGH risk', () => {
    expect(assessEngagement({ views: 100, likes: 90, comments: 30, shares: 10 })).toBe('HIGH');
  });

  it('flags interactions with no views as MEDIUM risk', () => {
    expect(assessEngagement({ views: 0, likes: 5, comments: 0, shares: 0 })).toBe('MEDIUM');
  });

  it('treats plausible engagement as LOW risk', () => {
    expect(assessEngagement({ views: 1000, likes: 100, comments: 20, shares: 5 })).toBe('LOW');
  });
});
