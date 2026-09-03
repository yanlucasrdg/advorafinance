import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/plans")({
  component: () => <Navigate to="/admin" replace />,
});
