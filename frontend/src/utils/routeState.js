const adminRoute = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";

export function resolveActivePage(pathname) {
  if (!pathname || pathname === "/") return "home";

  if (pathname === "/explore" || pathname === "/search" || pathname.startsWith("/asset/") || ["/photos", "/vectors", "/psd", "/psds", "/videos", "/templates"].includes(pathname)) {
    return "explore";
  }

  if (pathname === "/favorites") return "favorites";
  if (pathname === "/downloads") return "downloads";
  if (pathname === "/upload") return "upload";
  if (pathname === "/profile") return "profile";
  if (pathname === "/payments") return "payments";
  if (pathname === "/contributor") return "contributor";
  if (pathname === "/myuploads") return "myuploads";
  if (pathname === "/customer") return "customer";
  if (pathname === "/dashboard") return "dashboard";
  if (pathname === "/messages") return "messages";

  if (pathname === adminRoute || pathname.startsWith(`${adminRoute}/`)) {
    if (pathname === `${adminRoute}/analytics`) return "analytics";
    if (pathname === `${adminRoute}/commerce`) return "commerce";
    if (pathname === `${adminRoute}/orders`) return "orders";
    return "admin";
  }

  if (pathname === "/admin/analytics") return "analytics";
  if (pathname === "/admin/commerce") return "commerce";
  if (pathname === "/admin/orders") return "orders";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";

  return "home";
}
