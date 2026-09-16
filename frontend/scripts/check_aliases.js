const axios = require('axios');

const API_BASE = process.env.API_BASE || 'http://localhost:5000';

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCategoryAlias(value) {
  const rawValue = normalizeText(value);
  if (!rawValue) return rawValue;

  if (["photos", "photo", "images", "image", "photography", "photographies"].some((alias) => rawValue.includes(alias))) {
    return 'images';
  }

  if (["vector", "vectors", "illustration", "illustrations", "illustrative"].some((alias) => rawValue.includes(alias))) {
    return 'vector/illustrations';
  }

  if (["abstract", "abtrsct", "abstr"].some((alias) => rawValue.includes(alias))) {
    return 'abstract';
  }

  if (["psd", "psds"].some((alias) => rawValue.includes(alias))) {
    return 'psd';
  }

  if (["video", "videos", "animation", "animations", "motion"].some((alias) => rawValue.includes(alias))) {
    return 'videos';
  }

  if (["template", "templates"].some((alias) => rawValue.includes(alias))) {
    return 'templates';
  }

  return rawValue;
}

function serverMatchesCategory(image, categoryQuery) {
  const category = normalizeCategoryAlias(categoryQuery);
  const imageCategory = normalizeText(image.category);
  const imageCategoryAlias = normalizeCategoryAlias(image.category);
  const categorySlots = String(image.category || '')
    .split(',')
    .map((v) => normalizeCategoryAlias(v))
    .filter(Boolean);

  const categoryTokens = categorySlots.flatMap((slot) => (slot || '').split(' ').filter(Boolean));

  const matchesCategory = !category || category === 'all' ||
    imageCategoryAlias === category ||
    categorySlots.some((slot) => slot === category || (slot && slot.includes(category)) || (category && category.includes(slot))) ||
    imageCategory === category ||
    imageCategory.includes(category) ||
    category.includes(imageCategory) ||
    categoryTokens.includes(category) ||
    categoryTokens.some((token) => token.includes(category) || category.includes(token));

  return matchesCategory;
}

(async function main(){
  try {
    console.log('Probe /images for total...');
    const probe = await axios.get(`${API_BASE}/images?limit=1&page=1`);
    const total = Number(probe.data.totalImages || 0);
    console.log('Backend totalImages:', total);

    const limit = Math.max(total, 1);
    const allRes = await axios.get(`${API_BASE}/images?limit=${limit}&page=1`);
    const images = Array.isArray(allRes.data.images) ? allRes.data.images : [];
    console.log('Fetched all images count:', images.length);

    const aliases = [
      'Images', 'Photos', 'images', 'photos', 'photo', 'photography',
      'Vector/illustrations', 'Vectors', 'vector', 'illustration',
      'Abstract', 'abtrsct', 'abstr',
      'PSD', 'psds',
      'Videos', 'video', 'animation',
      'Templates', 'template'
    ];

    const report = [];

    for (const alias of aliases) {
      const api = await axios.get(`${API_BASE}/images?limit=1&page=1&category=${encodeURIComponent(alias)}`);
      const apiCount = Number(api.data.totalImages || 0);

      // compute local expected
      const expected = images.filter(img => serverMatchesCategory(img, alias)).length;

      report.push({ alias, apiCount, expected });
    }

    console.table(report);

    const mismatches = report.filter(r => r.apiCount !== r.expected);
    if (mismatches.length === 0) {
      console.log('All alias checks match API counts.');
    } else {
      console.log('Mismatches found:');
      console.table(mismatches);
    }

  } catch (err) {
    console.error('Error:', err.message);
    if (err.response) console.error('Response:', err.response.data);
    process.exitCode = 2;
  }
})();
