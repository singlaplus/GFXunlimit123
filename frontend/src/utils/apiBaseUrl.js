const DEFAULT_DEVELOPMENT_API_BASE_URL = 'http://localhost:5000';

function isLoopbackHostname(hostname) {
  const normalizedHostname = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return normalizedHostname === 'localhost'
    || normalizedHostname.endsWith('.localhost')
    || normalizedHostname === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(normalizedHostname);
}

function getApiBaseUrl(environment = process.env, browserLocation = typeof window !== 'undefined' ? window.location : null) {
  const configuredUrl = String(environment.REACT_APP_API_BASE_URL || '').trim();
  if (!configuredUrl) {
    if (browserLocation?.origin && ['development', 'production'].includes(environment.NODE_ENV)) {
      return browserLocation.origin;
    }
    if (environment.NODE_ENV === 'production') {
      throw new Error('REACT_APP_API_BASE_URL must be configured for production builds.');
    }
    const hostname = String(browserLocation?.hostname || '').trim();
    if (hostname && hostname !== '0.0.0.0' && hostname !== '::') {
      const formattedHostname = hostname.includes(':') && !hostname.startsWith('[')
        ? `[${hostname}]`
        : hostname;
      return `http://${formattedHostname}:5000`;
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

  if (
    browserLocation?.origin &&
    isLoopbackHostname(url.hostname) &&
    !isLoopbackHostname(browserLocation.hostname)
  ) {
    return browserLocation.origin;
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

const API_BASE_URL = getApiBaseUrl();

module.exports = { API_BASE_URL, getApiBaseUrl };
