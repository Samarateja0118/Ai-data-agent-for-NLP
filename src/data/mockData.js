export const metrics = {
  revenue: {
    current: 128400,
    previous: 116100,
    format: 'currency'
  },
  orders: {
    current: 1842,
    previous: 1698,
    format: 'number'
  },
  conversionRate: {
    current: 4.8,
    previous: 4.2,
    format: 'percent'
  },
  returningCustomers: {
    current: 38,
    previous: 35,
    format: 'percent'
  },
  adSpend: {
    current: 26400,
    previous: 23100,
    format: 'currency'
  }
};

export const regionRows = [
  { region: 'North America', revenue: 54600, orders: 712, growth: 11.2 },
  { region: 'Europe', revenue: 32100, orders: 498, growth: 8.1 },
  { region: 'Asia Pacific', revenue: 28700, orders: 441, growth: 16.5 },
  { region: 'Latin America', revenue: 13000, orders: 191, growth: 5.4 }
];

export const campaignRows = [
  { name: 'Spring Search', channel: 'Search', spend: 9200, revenue: 38400, roas: 4.17 },
  { name: 'Creator Push', channel: 'Social', spend: 6700, revenue: 18100, roas: 2.7 },
  { name: 'Lifecycle Winback', channel: 'Email', spend: 2200, revenue: 14900, roas: 6.77 },
  { name: 'Retargeting Loop', channel: 'Display', spend: 5400, revenue: 12100, roas: 2.24 }
];

export const monthlyRevenueSeries = [
  { month: 'Jan', revenue: 84200, orders: 1204 },
  { month: 'Feb', revenue: 89600, orders: 1288 },
  { month: 'Mar', revenue: 93400, orders: 1362 },
  { month: 'Apr', revenue: 101800, orders: 1481 },
  { month: 'May', revenue: 108500, orders: 1556 },
  { month: 'Jun', revenue: 112900, orders: 1612 },
  { month: 'Jul', revenue: 118400, orders: 1704 },
  { month: 'Aug', revenue: 122600, orders: 1768 },
  { month: 'Sep', revenue: 119300, orders: 1721 },
  { month: 'Oct', revenue: 124900, orders: 1792 },
  { month: 'Nov', revenue: 128400, orders: 1842 }
];

export const analystHighlights = [
  {
    label: 'Forecast Confidence',
    value: '92%',
    note: 'Revenue forecast variance stayed below 4% over the last six weeks.'
  },
  {
    label: 'Pipeline Health',
    value: 'Strong',
    note: 'Lead-to-order velocity improved in three out of four regions.'
  },
  {
    label: 'Retention Signal',
    value: '+3 pts',
    note: 'Returning customer share climbed from 35% to 38%.'
  }
];

export const dashboards = [
  {
    id: 'exec-overview',
    name: 'Executive Overview',
    description: 'High-level business health with revenue, orders, and conversion trends.',
    focus: ['revenue', 'orders', 'conversion']
  },
  {
    id: 'marketing-performance',
    name: 'Marketing Performance',
    description: 'Campaign efficiency, ROAS, and spend-to-revenue comparison.',
    focus: ['campaigns', 'roas', 'ad spend']
  },
  {
    id: 'regional-breakdown',
    name: 'Regional Breakdown',
    description: 'Performance by market with revenue, order volume, and growth.',
    focus: ['regions', 'growth', 'geography']
  }
];

export const starterPrompts = [
  'What changed in revenue this month?',
  'Which region is growing fastest?',
  'Open the best dashboard for campaign performance.',
  'Summarize the business like an analyst.'
];
