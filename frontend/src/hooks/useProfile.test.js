import { act, renderHook, waitFor } from "@testing-library/react";
import axios from "axios";
import useProfile from "./useProfile";

jest.mock("axios");

describe("useProfile startup session handling", () => {
  const setUserRole = jest.fn();
  const setUserPermissions = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it("uses the restored session without issuing a duplicate profile request", async () => {
    localStorage.setItem("userRole", "contributor");
    localStorage.setItem("userPermissions", JSON.stringify({ upload: true }));

    renderHook(() => useProfile(setUserRole, setUserPermissions, {
      sessionResolved: true,
      authStatus: "authenticated",
    }));

    await waitFor(() => expect(setUserRole).toHaveBeenCalledWith("contributor"));
    expect(setUserPermissions).toHaveBeenCalledWith({ upload: true });
    expect(axios.get).not.toHaveBeenCalled();

    localStorage.setItem("token", "session-token");
    axios.get.mockResolvedValue({
      data: { role: "admin", custom_permissions: { manageUsers: true } },
    });
    act(() => window.dispatchEvent(new Event("auth-changed")));
    await waitFor(() => expect(setUserRole).toHaveBeenCalledWith("admin"));
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it("clears stale local role and permissions for a restored anonymous session", async () => {
    localStorage.setItem("userRole", "admin");
    localStorage.setItem("userPermissions", JSON.stringify({ manageUsers: true }));

    renderHook(() => useProfile(setUserRole, setUserPermissions, {
      sessionResolved: true,
      authStatus: "anonymous",
    }));

    await waitFor(() => expect(setUserRole).toHaveBeenCalledWith(""));
    expect(setUserPermissions).toHaveBeenCalledWith({});
    expect(localStorage.getItem("userRole")).toBeNull();
    expect(localStorage.getItem("userPermissions")).toBeNull();
    expect(axios.get).not.toHaveBeenCalled();
  });
});
