export const getBadge = (user) => {

  if (user.downloads >= 500)
    return "👑 Elite Contributor";

  if (user.downloads >= 100)
    return "💎 Platinum Contributor";

  if (user.downloads >= 50)
    return "🥇 Gold Contributor";

  if (user.downloads >= 10)
    return "🥈 Silver Contributor";

  if (user.uploads >= 10)
    return "🥉 Bronze Contributor";

  if (user.uploads >= 1)
    return "🌱 New Contributor";

  return "👤 New User";
};