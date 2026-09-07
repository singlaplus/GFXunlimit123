import { Navigate, useLocation } from "react-router-dom";

export default function ProtectedRoute({ children, allowedRoles = [], userRole, allowedPermissions = [], userPermissions = {}, fallback = null }) {
  const location = useLocation();
  const normalizedRole = String(userRole || "").trim().toLowerCase();
  const roleAllowed = allowedRoles.length === 0 || allowedRoles.some((role) => role.toLowerCase() === normalizedRole);
  const permissionAllowed = allowedPermissions.length === 0 || allowedPermissions.every((permission) => Boolean(userPermissions?.[permission]));
  const allowed = roleAllowed && permissionAllowed;

  if (!allowed) {
    return fallback || <Navigate to="/" replace state={{ from: location }} />;
  }

  return children;
}
