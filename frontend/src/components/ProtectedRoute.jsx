
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
export default function ProtectedRoute({children}) {
 const t = useAuthStore(s=>s.token);
 return t ? children : <Navigate to="/login"/>;
}
