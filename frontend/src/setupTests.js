// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

beforeEach(() => {
  window.scrollTo = jest.fn();
});

afterAll(() => {
  jest.restoreAllMocks();
});

// Provide a lightweight global mock for react-router-dom so tests can import
// hooks like useLocation/useNavigate without requiring the actual library.
jest.mock(
  "react-router-dom",
  () => ({
    useLocation: jest.fn().mockReturnValue({ search: "?tab=controls" }),
    useNavigate: () => jest.fn(),
    Link: ({ children }) => children,
    NavLink: ({ children }) => children
  }),
  { virtual: true }
);
