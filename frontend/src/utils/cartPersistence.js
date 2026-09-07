import axios from 'axios';
import { getEffectiveAuthToken } from './authSession';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

/**
 * Check if user is authenticated
 */
export const isUserAuthenticated = () => {
  return !!getEffectiveAuthToken();
};

/**
 * Load cart from server if user is logged in, otherwise from localStorage
 */
export const loadCartItems = async () => {
  const token = getEffectiveAuthToken();

  if (!token) {
    // User not logged in - use localStorage
    const stored = localStorage.getItem('customer-cart');
    try {
      return JSON.parse(stored || '[]');
    } catch {
      return [];
    }
  }

  // User is logged in - try to load from server
  try {
    const response = await axios.get(`${API_BASE_URL}/cart/get`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return response.data?.items || [];
  } catch (err) {
    console.error('Failed to load cart from server:', err.message || err);
    // Fallback to localStorage if server fails
    const stored = localStorage.getItem('customer-cart');
    try {
      return JSON.parse(stored || '[]');
    } catch {
      return [];
    }
  }
};

/**
 * Save cart to server if user is logged in, otherwise to localStorage
 */
export const saveCartItems = async (items) => {
  const token = getEffectiveAuthToken();

  // Always save to localStorage for offline support
  localStorage.setItem('customer-cart', JSON.stringify(items));

  if (!token) {
    // User not logged in - localStorage is enough
    return true;
  }

  // User is logged in - also save to server
  try {
    await axios.post(`${API_BASE_URL}/cart/save`, 
      { items },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return true;
  } catch (err) {
    console.error('Failed to save cart to server:', err.message || err);
    // Still return true since localStorage was saved
    return true;
  }
};

/**
 * Clear cart from server if user is logged in, and from localStorage
 */
export const clearCartItems = async () => {
  // Always clear localStorage
  localStorage.removeItem('customer-cart');

  const token = getEffectiveAuthToken();
  if (!token) {
    return true;
  }

  // Also clear from server if logged in
  try {
    await axios.post(`${API_BASE_URL}/cart/clear`, {}, 
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return true;
  } catch (err) {
    console.error('Failed to clear cart on server:', err.message || err);
    return true;
  }
};
