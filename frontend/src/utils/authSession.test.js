import { getEffectiveAuthToken, clearAuthSessionStorage, hasActiveSession, buildAuthHeaders, shouldTriggerAuthSessionExpired } from './authSession';

describe('authSession token resolution', () => {
  beforeEach(() => {
    document.cookie = 'authToken=; Max-Age=0; path=/; SameSite=Lax';
    localStorage.clear();
  });

  it('treats a localStorage token as an active session when no readable cookie is present', () => {
    localStorage.setItem('token', 'local-token');

    expect(hasActiveSession()).toBe(true);
  });

  it('falls back to localStorage token when no cookie exists', () => {
    localStorage.setItem('token', 'local-token');

    expect(getEffectiveAuthToken()).toBe('local-token');
  });

  it('ignores null-like placeholder tokens and drops the bearer header', () => {
    localStorage.setItem('token', 'null');

    expect(getEffectiveAuthToken()).toBeNull();
    expect(hasActiveSession()).toBe(false);
    expect(buildAuthHeaders()).toEqual({});
  });

  it('prefers the cookie token over localStorage when both values exist', () => {
    localStorage.setItem('token', 'local-token');
    document.cookie = 'authToken=cookie-token; path=/; SameSite=Lax';

    expect(getEffectiveAuthToken()).toBe('cookie-token');
  });

  it('clears the stored session token', () => {
    localStorage.setItem('token', 'local-token');
    clearAuthSessionStorage();

    expect(localStorage.getItem('token')).toBeNull();
  });

  it('does not trigger logout for a generic access-denied 401 while a session exists', () => {
    localStorage.setItem('token', 'local-token');

    expect(shouldTriggerAuthSessionExpired({
      response: {
        status: 401,
        data: { error: 'Access denied' }
      }
    })).toBe(false);
  });

  it('triggers logout for an explicit expired-session 401', () => {
    localStorage.setItem('token', 'local-token');

    expect(shouldTriggerAuthSessionExpired({
      response: {
        status: 401,
        data: 'Session expired. Please log in again.'
      }
    })).toBe(true);
  });
});
