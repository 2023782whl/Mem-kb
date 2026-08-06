import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Sparkles, UserRound } from "lucide-react";
import { api } from "../../api/client";
import { Brand } from "../../shared/Brand";
import { LanguageSwitcher } from "../../shared/LanguageSwitcher";
import type { User } from "../../types/domain";
import { useI18n } from "../../i18n";

const PASSWORD_AUTOFILL_KEY = "mem_kb_password_autofill";

function initialPasswordAutofill() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(PASSWORD_AUTOFILL_KEY) !== "false";
}

async function readBrowserPassword() {
  if (typeof navigator === "undefined" || !navigator.credentials?.get) return null;
  try {
    return await navigator.credentials.get({ mediation: "optional", password: true } as CredentialRequestOptions) as (Credential & { password?: string }) | null;
  } catch {
    return null;
  }
}

async function storeBrowserPassword(identifier: string, password: string) {
  const PasswordCredentialClass = (window as unknown as { PasswordCredential?: new (data: { id: string; name: string; password: string }) => Credential }).PasswordCredential;
  if (!PasswordCredentialClass || !navigator.credentials?.store || !identifier || !password) return;
  try {
    await navigator.credentials.store(new PasswordCredentialClass({ id: identifier, name: identifier, password }));
  } catch {
    // The browser may decline credential storage; login should still continue.
  }
}

export function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
  const { t } = useI18n();
  const [identifier, setIdentifier] = useState("admin");
  const [autoFillPassword, setAutoFillPassword] = useState(initialPasswordAutofill);
  const [password, setPassword] = useState(() => initialPasswordAutofill() && import.meta.env.DEV ? "admin123456" : "");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(PASSWORD_AUTOFILL_KEY, String(autoFillPassword));
    if (!autoFillPassword) return;
    let active = true;
    if (import.meta.env.DEV) setPassword((current) => current || "admin123456");
    void readBrowserPassword().then((credential) => {
      if (!active || !credential?.password) return;
      setIdentifier(credential.id || "admin");
      setPassword(credential.password);
    });
    return () => { active = false; };
  }, [autoFillPassword]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await api.login(identifier, password, remember);
      if (autoFillPassword) void storeBrowserPassword(identifier, password);
      onLogin(result.user);
    } catch (reason) {
      setError(t(reason instanceof Error ? reason.message : "登录失败"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-utility"><LanguageSwitcher fullLabel /></div>
      <section className="login-panel">
        <Brand />
        <div className="login-copy">
          <h1>知识中心</h1>
          <p>沉淀企业 SOP、运营资产和个人策略打法。</p>
        </div>
        <form onSubmit={submit} className="login-form">
          <label><span>用户名</span><div className="field-with-icon"><UserRound size={17} /><input name="username" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} /></div></label>
          <label><span>密码</span><div className="field-with-icon has-trailing-control"><LockKeyhole size={17} /><input name="password" type={passwordVisible ? "text" : "password"} autoComplete={autoFillPassword ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" className="password-visibility" onClick={() => setPasswordVisible((value) => !value)} aria-label={passwordVisible ? "隐藏密码" : "显示密码"} title={passwordVisible ? "隐藏密码" : "显示密码"}>{passwordVisible ? <EyeOff /> : <Eye />}</button></div></label>
          <button type="button" className="login-autofill-switch" role="switch" aria-checked={autoFillPassword} onClick={() => setAutoFillPassword((value) => !value)} title={autoFillPassword ? "关闭自动回填密码" : "开启自动回填密码"}><span><strong>自动回填密码</strong><small>使用浏览器安全保存的登录凭据</small></span><i /></button>
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
