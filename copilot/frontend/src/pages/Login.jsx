import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../services/firebase";
import {
  Microscope,
  Eye,
  EyeOff,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate("/");
    } catch (err) {
      setError("Credenciais inválidas. Por favor, verifique os seus dados.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="sc-login-page min-h-screen flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm mx-auto">
          {/* Logo */}
          <div className="flex items-center justify-center gap-3 mb-10">
            <div className="sc-login-logo-icon w-11 h-11 rounded-xl flex items-center justify-center">
              <Microscope className="w-5 h-5 text-white" />
            </div>
            <span className="sc-login-brand text-lg font-bold tracking-tight">SilverCancer</span>
          </div>

          <div className="sc-login-form-card rounded-2xl p-8">
            <div className="text-center mb-8">
              <h2 className="sc-login-form-title text-2xl font-bold tracking-tight mb-2">
                Iniciar sessão
              </h2>
              <p className="sc-login-form-subtitle text-sm">
                Aceda ao seu assistente de investigação
              </p>
            </div>

            {error && (
              <div className="sc-login-error flex items-center gap-3 p-3 rounded-xl mb-6 text-sm">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="email" className="sc-login-label block text-xs font-semibold mb-1.5">
                  E-MAIL
                </label>
                <input
                  id="email"
                  type="email"
                  placeholder="email@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="sc-input py-3"
                  disabled={isLoading}
                />
              </div>

              <div>
                <label htmlFor="password" className="sc-login-label block text-xs font-semibold mb-1.5">
                  PALAVRA-PASSE
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Introduza a sua palavra-passe"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="sc-input py-3 pr-11"
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="sc-login-eye-btn absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded transition-colors"
                    aria-label={showPassword ? "Ocultar palavra-passe" : "Mostrar palavra-passe"}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div className="text-right mt-1">
                  <Link
                    to="/forgot-password"
                    className="sc-login-register-link text-xs font-medium transition-colors"
                  >
                    Esqueceu a palavra-passe?
                  </Link>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="sc-login-submit w-full py-3.5 text-base font-semibold rounded-xl text-white transition-all duration-200"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    A iniciar sessão...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    Entrar
                    <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </button>
            </form>

            <div className="sc-login-divider mt-8 pt-6 text-center">
              <p className="sc-login-form-subtitle text-sm mb-3">
                Não tem uma conta?
              </p>
              <Link
                to="/register"
                className="sc-login-register-link inline-flex items-center gap-1 text-sm font-semibold transition-colors"
              >
                Criar conta
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          <div className="text-center mt-5">
            <Link
              to="/terms"
              className="sc-login-terms text-xs transition-colors"
            >
              Termos e Condições
            </Link>
          </div>
      </div>
    </div>
  );
}
