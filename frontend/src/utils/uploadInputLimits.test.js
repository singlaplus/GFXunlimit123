import { limitWords, formatKeywords } from './uploadInputLimits';

describe('upload input limits', () => {
  it('limits title text to five words', () => {
    expect(limitWords('one two three four five six', 5)).toBe('one two three four five');
  });

  it('limits description text to ten words', () => {
    expect(limitWords('one two three four five six seven eight nine ten eleven', 10)).toBe(
      'one two three four five six seven eight nine ten'
    );
  });

  it('formats keywords into a comma separated list with the requested limit', () => {
    expect(formatKeywords('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen', 14)).toBe(
      'one, two, three, four, five, six, seven, eight, nine, ten, eleven, twelve, thirteen, fourteen'
    );
  });

  it('normalizes existing commas so there is only one separator between keywords', () => {
    expect(formatKeywords('one, two,three  four', 10)).toBe('one, two, three, four');
  });
});
