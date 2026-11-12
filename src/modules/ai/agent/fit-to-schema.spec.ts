import { campaignBriefOutput } from '../prompts/campaign-brief.v1';
import { fitToSchema } from './fit-to-schema';

describe('fitToSchema', () => {
  it('fits a slightly overlong brief draft so it validates', () => {
    const draft = {
      brief: `${'Show the car on a real drive. '.repeat(60)}`,
      goals: '  More test drives booked.  ',
      audience: 'Families looking for an electric car',
      contentRules: ['Show the car', 'ok', 'Mention the range', 'Film outdoors', 'Keep it under 60s', 'No other brands'],
      hashtags: ['#BYD', '#EV', '#DriveElectric', '#Family', '#Green', '#Extra'],
      notes: 'not part of the schema',
    };

    const fitted = fitToSchema(campaignBriefOutput, draft) as typeof draft;
    const parsed = campaignBriefOutput.safeParse(fitted);

    expect(parsed.success).toBe(true);
    expect(fitted.brief.length).toBeLessThanOrEqual(1500);
    expect(fitted.brief.endsWith('.')).toBe(true);
    expect(fitted.goals).toBe('More test drives booked.');
    expect(fitted.contentRules).toEqual([
      'Show the car',
      'Mention the range',
      'Film outdoors',
      'Keep it under 60s',
      'No other brands',
    ]);
    expect(fitted.hashtags).toHaveLength(5);
    expect('notes' in fitted).toBe(false);
  });

  it('leaves real gaps for validation to catch', () => {
    const fitted = fitToSchema(campaignBriefOutput, { brief: 'Too short', hashtags: [] });

    expect(campaignBriefOutput.safeParse(fitted).success).toBe(false);
  });
});
