import { render, screen } from "@testing-library/react";

jest.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/admin" }),
  Navigate: ({ to }) => <div>{to}</div>,
}), { virtual: true });

const ProtectedRoute = require("./ProtectedRoute").default;

describe("ProtectedRoute", () => {
  it("redirects unauthorized users to the home page", () => {
    render(
      <ProtectedRoute allowedRoles={["admin"]} userRole="customer">
        <div>Admin page</div>
      </ProtectedRoute>
    );

    expect(screen.getByText("/")).toBeInTheDocument();
  });
});
