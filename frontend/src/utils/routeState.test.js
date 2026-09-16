import { resolveActivePage } from "./routeState";

describe("resolveActivePage", () => {
  it("maps admin subpaths like /admin/users to the admin page", () => {
    expect(resolveActivePage("/admin/users")).toBe("admin");
  });

  it("maps analytics, commerce, and orders routes to their page keys", () => {
    expect(resolveActivePage("/admin/analytics")).toBe("analytics");
    expect(resolveActivePage("/admin/commerce")).toBe("commerce");
    expect(resolveActivePage("/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/orders")).toBe("orders");
  });
});
