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

function buildCategoryTokens(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized.split(' ').map((t) => t.trim()).filter(Boolean);
}

function serverMatchesCategory(image, categoryQuery) {
  const category = normalizeCategoryAlias(categoryQuery);
  const imageCategory = normalizeText(image.category);
  const imageCategoryAlias = normalizeCategoryAlias(image.category);
  const categorySlots = String(image.category || '')
    .split(',')
    .map((v) => normalizeCategoryAlias(v))
    .filter(Boolean);
  const categoryTokens = categorySlots.flatMap((slot) => buildCategoryTokens(slot));

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
  try{
    console.log('Fetching total images (probe)...');
    const probe = await axios.get(`${API_BASE}/images?limit=1&page=1`);
    const total = Number(probe.data.totalImages || 0);
    console.log('Backend reported totalImages:', total);

    const limit = Math.max(total, 1);
    console.log('Fetching all images with limit=', limit);
    const res = await axios.get(`${API_BASE}/images?limit=${limit}&page=1`);
    const images = Array.isArray(res.data.images) ? res.data.images : [];
    console.log('Fetched images length:', images.length);

    const visibleCategories = ["All", "Images", "Vector/illustrations", "PSD", "Videos", "Templates", "Abstract"];

    // compute counts by applying server matching logic locally
    const localCounts = {};
    for (const cat of visibleCategories) localCounts[cat] = 0;

    images.forEach((image) => {
      visibleCategories.forEach((cat) => {
        if (cat === 'All') return; // skip All for per-image increment
        if (serverMatchesCategory(image, cat)) {
          localCounts[cat] = (localCounts[cat] || 0) + 1;
        }
      });
    });

    console.log('\nLocal computed counts (server normalization):');
    console.table(localCounts);

    // Now query server for each category
    console.log('\nQuerying backend /images?category=... for each category');
    for (const cat of visibleCategories) {
      if (cat === 'All') {
        const p = await axios.get(`${API_BASE}/images?limit=1&page=1`);
        console.log(`API -> ${cat}: totalImages=${p.data.totalImages}`);
        continue;
      }

      const r = await axios.get(`${API_BASE}/images?limit=1&page=1&category=${encodeURIComponent(cat)}`);
      console.log(`API -> ${cat}: totalImages=${r.data.totalImages} | localExpected=${localCounts[cat] || 0}`);
    }

    // Check for images that appear in API but not in local fetch (shouldn't happen)
    const noCategory = images.filter(img => !img.category || String(img.category).trim()==='').length;
    console.log('\nImages with empty category:', noCategory);

    const sumBuckets = Object.values(localCounts).reduce((a,b)=>a+(Number(b)||0),0);
    console.log('Sum of bucket counts (may exceed total due to multi-slot assets):', sumBuckets);

  }catch(err){
    console.error('Error during checks:', err.message);
    if (err.response) {
      console.error('Response data:', err.response.data);
    }
    process.exitCode = 2;
  }
})();
