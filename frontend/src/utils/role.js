export function normalizeRole(role) {
  if (typeof role !== "string") return "";
  return role.trim().toLowerCase();
}

export function isAdminRole(role) {
  return normalizeRole(role) === "admin";
}

export function isContributorRole(role) {
  return normalizeRole(role) === "contributor";
}
