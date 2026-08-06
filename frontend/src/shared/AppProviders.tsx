import { App as AntApp, ConfigProvider } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { useI18n } from "../i18n";
import { GlobalTooltip } from "./GlobalTooltip";

export function AppProviders({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: .2, ease: "easeOut" }}><ConfigProvider
      locale={locale === "en-US" ? enUS : zhCN}
      theme={{
        token: {
          colorPrimary: "#4c6ef5",
          colorInfo: "#4c6ef5",
          colorSuccess: "#16a34a",
          colorWarning: "#d97706",
          colorError: "#dc2626",
          colorText: "#111827",
          colorTextSecondary: "#667085",
          colorBorder: "#e5e7eb",
          colorBgLayout: "#f7f8fa",
          colorBgContainer: "#ffffff",
          borderRadius: 8,
          borderRadiusLG: 12,
          fontFamily: 'Inter, "SF Pro Text", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif'
        },
        components: {
          Button: { controlHeight: 38, fontWeight: 650 },
          Input: { controlHeight: 40 },
          Modal: { titleFontSize: 17 }
        }
      }}
    >
      <AntApp>{children}<GlobalTooltip /></AntApp>
    </ConfigProvider></MotionConfig>
  );
}
