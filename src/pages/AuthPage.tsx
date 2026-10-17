import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Err } from "../components/ui";

export default function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const { login, signup } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr(null);
    const e = mode === "login" ? await login(email, password) : await signup(name, email, password);
    setBusy(false);
    if (e) setErr(e); else nav("/");
  };
  return (
    <div className="auth">
      <div className="card">
        <div className="brand" style={{ justifyContent: "center", paddingBottom: 4 }}><div className="mark">C</div><div><b>Crypto<i>Signal</i></b><small>4H → 1H → 5/15M</small></div></div>
        <div className="muted" style={{ textAlign: "center", fontSize: 13 }}>Approved crypto signals — key levels, AMD, backtest-checked</div>
        {mode === "signup" && <div className="field"><label>Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>}
        <div className="field"><label>Email</label><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label>Password</label><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} /></div>
        <Err msg={err} />
        <button className="btn" onClick={go} disabled={busy}>{busy ? "…" : mode === "login" ? "Sign in" : "Create account"}</button>
        <div className="muted" style={{ textAlign: "center", fontSize: 12.5 }}>
          {mode === "login" ? <>No account? <Link className="gold" to="/signup">Create one</Link></> : <>Have an account? <Link className="gold" to="/">Sign in</Link></>}
        </div>
        {mode === "signup" && <div className="mute2" style={{ textAlign: "center", fontSize: 11 }}>The first account created becomes the admin who controls approvals and settings.</div>}
      </div>
    </div>
  );
}
