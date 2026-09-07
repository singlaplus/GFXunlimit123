export const limitWords = (value, maxWords) => {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return value;
  return words.slice(0, maxWords).join(' ');
};

export const formatKeywords = (value, maxWords) => {
  const normalized = value
    .split(',')
    .flatMap((part) => part.split(/\s+/))
    .map((word) => word.trim())
    .filter(Boolean);

  const limitedWords = normalized.slice(0, maxWords);
  return limitedWords.join(', ');
};
