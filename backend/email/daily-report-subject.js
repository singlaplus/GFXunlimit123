const getDailyReportSubject = ({ siteName = 'GFXunlimit', metrics = {}, date = new Date() } = {}) => {
  const has = (key) => metrics?.[key] === true;
  const sections = [];

  const marketingSelected = has('totalRevenueInr') || has('totalDownloads');
  const websiteOverviewSelected = has('totalUsers') || has('totalContributors') || has('totalAssets');
  const assetStatisticsSelected = has('liveAssets') || has('pendingAssets') || has('rejectedAssets') || has('deletedAssetsLast30Days');
  const downloadsSelected = has('last24HoursDownloads') || has('last7DaysDownloads') || has('last30DaysDownloads') || has('last365DaysDownloads') || has('currentMonthDownloads') || has('currentFyDownloads');
  const salesRevenueSelected = has('totalOrders') || has('failedOrders') || has('paymentFailedCount') || has('totalDiscountInr') || has('totalEarningsInr');

  if (websiteOverviewSelected) sections.push('Website Overview');
  if (assetStatisticsSelected) sections.push('Asset Statistics');
  if (downloadsSelected) sections.push('Downloads');
  if (salesRevenueSelected) sections.push('Sales / Revenue');
  if (marketingSelected || (has('totalCustomers') && !websiteOverviewSelected && !salesRevenueSelected)) sections.push('Marketing');

  const sectionText = sections.length ? ` - ${sections.join('/')} -` : ' -';
  const timeText = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }).format(date).replace(' ', ': ');
  return `${siteName} daily website summary${sectionText} ${date.toDateString()} - ${timeText}`;
};

module.exports = { getDailyReportSubject };
