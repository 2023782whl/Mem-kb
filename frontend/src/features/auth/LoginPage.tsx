import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole, Sparkles, UserRound } from "lucide-react";
import { api } from "../../api/client";
import { Brand } from "../../shared/Brand";
import type { User } from "../../types/domain";

export function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
  const [identifier, setIdentifier] = useState("admin");
  const [password, setPassword] = useState(import.meta.env.DEV ? "admin123456" : "");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await api.login(identifier, password, remember);
      onLogin(result.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <Brand />
        <div className="login-copy">
          <h1>知识中心</h1>
          <p>沉淀企业 SOP、运营资产和个人策略打法。</p>
        </div>
        <form onSubmit={submit} className="login-form">
          <label><span>用户名</span><div className="field-with-icon"><UserRound size={17} /><input autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} /></div></label>
          <label><span>密码</span><div className="field-with-icon"><LockKeyhole size={17} /><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></div></label>
          <label className="remember-login"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>在这台设备上保持登录</span></label>
          <button className="button primary wide" disabled={loading}>{loading ? "正在登录" : "进入知识中心"}<ArrowRight size={18} /></button>
          {error ? <p className="form-error">{error}</p> : null}
        </form>
      </section>
      <aside className="login-context">
        <span className="context-symbol" aria-label="知识沉淀"><Sparkles size={25} strokeWidth={1.8} /></span>
        <h2>让知识有来源，也有去处。</h2>
        <p>问答引用、Markdown 自更新、文档图谱和图片素材统一进入 GBrain 长期记忆层。</p>
      </aside>
    </main>
  );
}
