const DEFAULT_DEVELOPMENT_API_BASE_URL = 'http://localhost:5000';

function getApiBaseUrl(environment = process.env) {
  const configuredUrl = String(environment.REACT_APP_API_BASE_URL || '').trim();
  if (!configuredUrl) {
    if (environment.NODE_ENV === 'production') {
      throw new Error('REACT_APP_API_BASE_URL must be configured for production builds.');
    }
    return DEFAULT_DEVELOPMENT_API_BASE_URL;
  }

  let url;
  try {
    url = new URL(configuredUrl);
  } catch (_error) {
    throw new Error('REACT_APP_API_BASE_URL must be a valid HTTP(S) URL.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('REACT_APP_API_BASE_URL must be a valid HTTP(S) URL.');
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

const API_BASE_URL = getApiBaseUrl();

module.exports = { API_BASE_URL, getApiBaseUrl };
